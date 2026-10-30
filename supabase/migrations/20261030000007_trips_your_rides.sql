-- Round trips and one-way rides, the Your Rides tab, ride chat, check-ins
-- and push reminders.
--
-- TRIPS. A ride is one of:
--   round_trip     up to the mountain at depart_at, back down at return_at
--   to_mountain    one way up, at depart_at
--   from_mountain  one way down, at depart_at (leaves from the mountain)
-- On a round trip, a passenger books both legs or just one. Each leg has
-- seats_total seats. A one-way seat on a round trip costs half the gas.
-- The Colorado gas cap (C.R.S. 43-1-127) follows the miles: half the
-- round-trip miles for a one-way ride.
--
-- ONE RIDE PER PERSON PER DAY, refined: drivers still drive one trip a day
-- and can't also ride that day. Passengers can now combine two one-way legs
-- in a day (up with one driver, down with another), but never two seats on
-- the same leg.
--
-- REMINDERS (sent by the send-ride-reminders edge function, every minute):
--   2 hours before each leg   everyone on that leg: "Leaving in 2 hours"
--   5 minutes before          passengers: "Confirm your ride"
--                             driver: "Confirm your passengers"
-- The app itself locks into the Your Ride screen from 30 minutes before a leg.

------------------------------------------------------------------------------
-- Rides: trip type and return
------------------------------------------------------------------------------
alter table public.rides
  add column trip_type text not null default 'round_trip' check (trip_type in ('round_trip', 'to_mountain', 'from_mountain')),
  add column return_at timestamptz,
  add column return_meet text not null default '' check (char_length(return_meet) <= 80);

-- Existing round trips come back 8 hours later.
update public.rides set return_at = depart_at + interval '8 hours' where trip_type = 'round_trip' and return_at is null;

alter table public.rides add constraint rides_return_valid check (
  (trip_type = 'round_trip') = (return_at is not null)
  and (return_at is null or (return_at > depart_at + interval '30 minutes' and return_at < depart_at + interval '20 hours'))
);

grant select (trip_type, return_at, return_meet) on public.rides to authenticated;
grant insert (trip_type, return_at, return_meet) on public.rides to authenticated;
grant update (trip_type, return_at, return_meet) on public.rides to authenticated;

/** When a leg leaves: 'to' = up to the mountain, 'from' = back down. Null if the ride has no such leg. */
create function public.leg_at(p_trip_type text, p_depart_at timestamptz, p_return_at timestamptz, p_leg text)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_leg = 'to' and p_trip_type in ('round_trip', 'to_mountain') then p_depart_at
    when p_leg = 'from' and p_trip_type = 'round_trip' then p_return_at
    when p_leg = 'from' and p_trip_type = 'from_mountain' then p_depart_at
  end;
$$;

/** The legs a seat covers. On a one-way ride a seat always covers the ride's one leg. */
create function public.seat_legs(p_trip_type text, p_legs text)
returns text[]
language sql
immutable
as $$
  select case
    when p_trip_type = 'to_mountain' then array['to']
    when p_trip_type = 'from_mountain' then array['from']
    when p_legs = 'both' then array['to', 'from']
    else array[p_legs]
  end;
$$;

/** Legal gas cap for a trip: round-trip miles for a round trip, half for one way. */
create function public.trip_gas_cap(p_resort_id text, p_depart_at timestamptz, p_trip_type text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_trip_type = 'round_trip' then public.gas_cap_dollars(p_resort_id, p_depart_at)
              else floor(public.gas_cap_dollars(p_resort_id, p_depart_at) / 2.0)::int end;
$$;

grant execute on function public.trip_gas_cap(text, timestamptz, text) to anon, authenticated;

------------------------------------------------------------------------------
-- Seats: which legs
------------------------------------------------------------------------------
alter table public.ride_seats
  add column legs text not null default 'both' check (legs in ('both', 'to', 'from'));

grant select (legs) on public.ride_seats to authenticated;

------------------------------------------------------------------------------
-- Ride rules trigger: trip-aware gas cap and the refined daily rule.
------------------------------------------------------------------------------
create or replace function public.enforce_ride_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap int;
  v_name text;
  v_taken int;
  v_label text;
begin
  -- Round trips default to coming back 8 hours later (the app always sends a time).
  if new.trip_type = 'round_trip' and new.return_at is null then
    new.return_at := new.depart_at + interval '8 hours';
  elsif new.trip_type <> 'round_trip' then
    new.return_at := null;
    new.return_meet := '';
  end if;

  new.ride_date := (new.depart_at at time zone 'America/Denver')::date;

  if tg_op = 'INSERT' or new.depart_at is distinct from old.depart_at then
    if new.depart_at < now() + interval '2 hours' then
      raise exception 'Rides have to leave at least 2 hours from now so riders can book ahead.' using errcode = 'P0001';
    end if;
  end if;

  if new.cancelled_at is not null then
    return new; -- cancelling is always allowed
  end if;

  -- Trip type can't change once someone has a seat.
  if tg_op = 'UPDATE' and new.trip_type is distinct from old.trip_type
     and exists (select 1 from public.ride_seats where ride_id = new.id) then
    raise exception 'Riders already booked this trip, so it can''t switch between one way and round trip.' using errcode = 'P0001';
  end if;

  -- Gas cap: a full car can't add up to more than the legal maximum.
  v_cap := public.trip_gas_cap(new.resort_id, new.depart_at, new.trip_type);
  if new.gas_per_rider * new.seats_total > v_cap then
    select name into v_name from public.resorts where id = new.resort_id;
    v_label := case when new.trip_type = 'round_trip' then 'a round trip to' else 'a one-way trip to' end;
    raise exception 'Colorado caps gas money for % % at $% total. With % seat%, ask at most $% per rider.',
      v_label, v_name, v_cap, new.seats_total, case when new.seats_total = 1 then '' else 's' end, floor(v_cap / new.seats_total)
      using errcode = 'P0001';
  end if;

  -- Can't drop below the seats already claimed on either leg.
  if tg_op = 'UPDATE' then
    select greatest(
      count(*) filter (where 'to' = any (public.seat_legs(new.trip_type, s.legs))),
      count(*) filter (where 'from' = any (public.seat_legs(new.trip_type, s.legs))))
    into v_taken from public.ride_seats s where s.ride_id = new.id;
    if new.seats_total < v_taken then
      raise exception '% riders already have seats. Remove someone before lowering the seat count.', v_taken using errcode = 'P0001';
    end if;
  end if;

  -- One trip per driver per day, and no riding the same day.
  perform pg_advisory_xact_lock(hashtextextended(new.driver_id::text, 43127));

  if exists (
    select 1 from public.rides r
    where r.driver_id = new.driver_id and r.ride_date = new.ride_date
      and r.cancelled_at is null and r.id <> new.id
  ) then
    raise exception 'You already have a ride posted that day. Colorado allows one trip per driver per day.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.ride_seats s
    join public.rides r on r.id = s.ride_id
    where s.rider_id = new.driver_id and r.ride_date = new.ride_date
      and r.cancelled_at is null and r.id <> new.id
  ) then
    raise exception 'You have a seat in someone else''s car that day. It''s one ride per person per day, so bail on that seat first.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

------------------------------------------------------------------------------
-- Claiming a seat, with legs.
------------------------------------------------------------------------------
drop function public.claim_seat(uuid);
drop function public.claim_seat_rules(uuid);

create function public.claim_seat(p_ride_id uuid, p_legs text default 'both')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_legs text[];
  v_leg text;
  v_first timestamptz;
  v_taken int;
begin
  if v_uid is null then
    raise exception 'Sign in to claim a seat.' using errcode = '28000';
  end if;
  if not public.is_profile_ready(v_uid) then
    raise exception 'Set up your profile first: a verified selfie, a few details and your interests. It takes about two minutes.'
      using errcode = 'P0001';
  end if;
  if p_legs not in ('both', 'to', 'from') then
    raise exception 'Pick round trip, up only or down only.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 43127));

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'That ride no longer exists.' using errcode = 'P0002';
  end if;
  if v_ride.cancelled_at is not null then
    raise exception 'The driver cancelled this ride.' using errcode = 'P0001';
  end if;
  if v_ride.driver_id = v_uid then
    raise exception 'You''re driving this one.' using errcode = 'P0001';
  end if;

  if v_ride.trip_type <> 'round_trip' then
    p_legs := 'both'; -- a one-way ride has one leg
  end if;
  v_legs := public.seat_legs(v_ride.trip_type, p_legs);

  if exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = v_uid) then
    return; -- already have a seat
  end if;

  select min(public.leg_at(v_ride.trip_type, v_ride.depart_at, v_ride.return_at, l)) into v_first from unnest(v_legs) l;
  if v_first < now() + interval '2 hours' then
    raise exception 'Booking closed. Seats have to be claimed at least 2 hours before the ride leaves.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.rides r
    where r.driver_id = v_uid and r.ride_date = v_ride.ride_date and r.cancelled_at is null
  ) then
    raise exception 'You''re driving that day. It''s one ride per person per day.' using errcode = 'P0001';
  end if;

  -- No two seats on the same leg on the same day.
  if exists (
    select 1 from public.ride_seats s
    join public.rides r on r.id = s.ride_id
    where s.rider_id = v_uid and r.ride_date = v_ride.ride_date and r.cancelled_at is null
      and public.seat_legs(r.trip_type, s.legs) && v_legs
  ) then
    raise exception 'You already have a seat that day. You can book one ride up and one ride down, but not two at once.' using errcode = 'P0001';
  end if;

  foreach v_leg in array v_legs loop
    select count(*) into v_taken from public.ride_seats s
    where s.ride_id = p_ride_id and v_leg = any (public.seat_legs(v_ride.trip_type, s.legs));
    if v_taken >= v_ride.seats_total then
      raise exception '%', case when v_leg = 'to' then 'The ride up is full.' else 'The ride down is full.' end using errcode = 'P0001';
    end if;
  end loop;

  insert into public.ride_seats (ride_id, rider_id, legs) values (p_ride_id, v_uid, p_legs);
end;
$$;

revoke execute on function public.claim_seat(uuid, text) from public, anon;
grant execute on function public.claim_seat(uuid, text) to authenticated;

/** Is this person the driver or a passenger on this ride? */
create function public.is_ride_member(p_ride_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rides r where r.id = p_ride_id and r.driver_id = p_user_id)
      or exists (select 1 from public.ride_seats s where s.ride_id = p_ride_id and s.rider_id = p_user_id);
$$;

grant execute on function public.is_ride_member(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- Ride chat: the driver and passengers of one ride.
------------------------------------------------------------------------------
create table public.ride_messages (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index ride_messages_ride_idx on public.ride_messages (ride_id, created_at);

alter table public.ride_messages enable row level security;

create policy "Ride members read the chat"
  on public.ride_messages for select to authenticated
  using (public.is_ride_member(ride_id, (select auth.uid())));

create policy "Ride members post in the chat"
  on public.ride_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_ride_member(ride_id, (select auth.uid()))
    and exists (select 1 from public.rides r where r.id = ride_id and r.cancelled_at is null
                and coalesce(r.return_at, r.depart_at) > now() - interval '12 hours')
  );

revoke all on public.ride_messages from anon, authenticated;
grant select on public.ride_messages to authenticated;
grant insert (ride_id, body) on public.ride_messages to authenticated;

-- Live updates for the chat (Supabase Realtime).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ride_messages;
  end if;
end $$;

------------------------------------------------------------------------------
-- Check-ins at pickup: passenger confirms they're in, driver confirms each passenger.
------------------------------------------------------------------------------
create table public.ride_checkins (
  ride_id uuid not null references public.rides (id) on delete cascade,
  leg text not null check (leg in ('to', 'from')),
  rider_id uuid not null references public.profiles (id) on delete cascade,
  rider_confirmed_at timestamptz,
  driver_status text check (driver_status in ('picked_up', 'no_show')),
  driver_confirmed_at timestamptz,
  primary key (ride_id, leg, rider_id)
);

alter table public.ride_checkins enable row level security;
create policy "Ride members see check-ins" on public.ride_checkins for select to authenticated
  using (public.is_ride_member(ride_id, (select auth.uid())));
revoke all on public.ride_checkins from anon, authenticated;
grant select on public.ride_checkins to authenticated;

/** Shared checks: the leg exists, the person is on it, and it's check-in time. */
create function public.checkin_window(p_ride public.rides, p_leg text, p_rider uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := public.leg_at(p_ride.trip_type, p_ride.depart_at, p_ride.return_at, p_leg);
begin
  if v_at is null then
    raise exception 'This ride doesn''t have that leg.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.ride_seats s where s.ride_id = p_ride.id and s.rider_id = p_rider
                 and p_leg = any (public.seat_legs(p_ride.trip_type, s.legs))) then
    raise exception 'That passenger isn''t booked on this leg.' using errcode = 'P0001';
  end if;
  if now() < v_at - interval '30 minutes' then
    raise exception 'Check-in opens 30 minutes before the ride leaves.' using errcode = 'P0001';
  end if;
  if now() > v_at + interval '3 hours' then
    raise exception 'Check-in for this ride has closed.' using errcode = 'P0001';
  end if;
end;
$$;

/** Passenger: "I'm here / I'm in." */
create function public.confirm_my_seat(p_ride_id uuid, p_leg text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
begin
  select * into v_ride from public.rides where id = p_ride_id and cancelled_at is null;
  if not found then
    raise exception 'That ride no longer exists.' using errcode = 'P0001';
  end if;
  perform public.checkin_window(v_ride, p_leg, auth.uid());
  insert into public.ride_checkins (ride_id, leg, rider_id, rider_confirmed_at)
  values (p_ride_id, p_leg, auth.uid(), now())
  on conflict (ride_id, leg, rider_id) do update set rider_confirmed_at = coalesce(public.ride_checkins.rider_confirmed_at, now());
end;
$$;

/** Driver: mark each passenger picked up or a no-show. */
create function public.confirm_passenger(p_ride_id uuid, p_leg text, p_rider_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
begin
  select * into v_ride from public.rides where id = p_ride_id and cancelled_at is null;
  if not found or v_ride.driver_id <> auth.uid() then
    raise exception 'Only the driver can confirm passengers.' using errcode = 'P0001';
  end if;
  if p_status not in ('picked_up', 'no_show') then
    raise exception 'Pick "picked up" or "no-show".' using errcode = 'P0001';
  end if;
  perform public.checkin_window(v_ride, p_leg, p_rider_id);
  insert into public.ride_checkins (ride_id, leg, rider_id, driver_status, driver_confirmed_at)
  values (p_ride_id, p_leg, p_rider_id, p_status, now())
  on conflict (ride_id, leg, rider_id) do update set driver_status = excluded.driver_status, driver_confirmed_at = now();
end;
$$;

revoke execute on function public.checkin_window(public.rides, text, uuid) from public, anon, authenticated;
revoke execute on function public.confirm_my_seat(uuid, text) from public, anon;
revoke execute on function public.confirm_passenger(uuid, text, uuid, text) from public, anon;
grant execute on function public.confirm_my_seat(uuid, text) to authenticated;
grant execute on function public.confirm_passenger(uuid, text, uuid, text) to authenticated;

------------------------------------------------------------------------------
-- Your Rides: everything about my upcoming and in-progress trips.
------------------------------------------------------------------------------
create function public.my_trips()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select r.*, case when r.driver_id = auth.uid() then 'driver' else 'passenger' end as my_role,
           (select s.legs from public.ride_seats s where s.ride_id = r.id and s.rider_id = auth.uid()) as my_legs
    from public.rides r
    where r.cancelled_at is null
      and coalesce(r.return_at, r.depart_at) > now() - interval '3 hours'
      and public.is_ride_member(r.id, auth.uid())
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'role', m.my_role,
    'my_legs', m.my_legs,
    'resort_id', m.resort_id,
    'trip_type', m.trip_type,
    'depart_at', m.depart_at,
    'return_at', m.return_at,
    'leave_from', m.leave_from,
    'return_meet', m.return_meet,
    'seats_total', m.seats_total,
    'gas_per_rider', m.gas_per_rider,
    'contact', m.contact,
    'driver', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar_path', p.avatar_path, 'gender', p.gender)
               from public.profiles p where p.id = m.driver_id),
    'passengers', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar_path', p.avatar_path, 'gender', p.gender, 'legs', s.legs)
                       order by s.created_at)
      from public.ride_seats s join public.profiles p on p.id = s.rider_id where s.ride_id = m.id), '[]'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(jsonb_build_object('leg', c.leg, 'rider_id', c.rider_id, 'rider_confirmed_at', c.rider_confirmed_at,
                                          'driver_status', c.driver_status))
      from public.ride_checkins c where c.ride_id = m.id), '[]'::jsonb)
  ) order by m.depart_at), '[]'::jsonb)
  from mine m;
$$;

revoke execute on function public.my_trips() from public, anon;
grant execute on function public.my_trips() to authenticated;

------------------------------------------------------------------------------
-- Push notifications
------------------------------------------------------------------------------
create table public.push_tokens (
  token text primary key check (char_length(token) between 10 and 300),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;
create policy "People see their own devices" on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy "People remove their own devices" on public.push_tokens for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;

/** Called by the app after the person allows notifications. Moves a token to whoever's signed in. */
create function public.register_push_token(p_token text, p_platform text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

create table public.ride_notifications_sent (
  ride_id uuid not null references public.rides (id) on delete cascade,
  leg text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('two_hours', 'confirm_ride', 'confirm_passengers')),
  sent_at timestamptz not null default now(),
  primary key (ride_id, leg, user_id, kind)
);

alter table public.ride_notifications_sent enable row level security;
revoke all on public.ride_notifications_sent from anon, authenticated;

/**
 * Reminders that are due now. Each is returned once: calling this records
 * them as sent. Service role only (the send-ride-reminders edge function).
 */
create function public.claim_due_notifications()
returns table (user_id uuid, kind text, ride_id uuid, leg text, leg_at timestamptz, title text, body text, tokens text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with legs as (
    select r.*, l.leg, public.leg_at(r.trip_type, r.depart_at, r.return_at, l.leg) as at
    from public.rides r
    cross join (values ('to'), ('from')) as l(leg)
    where r.cancelled_at is null
  ),
  live as (select * from legs where at is not null and at > now() - interval '10 minutes' and at < now() + interval '2 hours 1 minute'),
  people as (
    select lv.id as ride_id, lv.leg, lv.at, lv.resort_id, lv.leave_from, lv.return_meet, lv.trip_type,
           lv.driver_id as person, true as is_driver
    from live lv
    where exists (select 1 from public.ride_seats s where s.ride_id = lv.id and lv.leg = any (public.seat_legs(lv.trip_type, s.legs)))
    union all
    select lv.id, lv.leg, lv.at, lv.resort_id, lv.leave_from, lv.return_meet, lv.trip_type, s.rider_id, false
    from live lv join public.ride_seats s on s.ride_id = lv.id
    where lv.leg = any (public.seat_legs(lv.trip_type, s.legs))
  ),
  due as (
    select p.*, 'two_hours'::text as kind from people p where now() >= p.at - interval '2 hours' and now() < p.at - interval '5 minutes'
    union all
    select p.*, case when p.is_driver then 'confirm_passengers' else 'confirm_ride' end
    from people p where now() >= p.at - interval '5 minutes' and now() < p.at + interval '30 minutes'
  ),
  fresh as (
    insert into public.ride_notifications_sent (ride_id, leg, user_id, kind)
    select d.ride_id, d.leg, d.person, d.kind from due d
    on conflict do nothing
    returning ride_notifications_sent.ride_id, ride_notifications_sent.leg, ride_notifications_sent.user_id, ride_notifications_sent.kind
  )
  select f.user_id, f.kind, f.ride_id, f.leg, d.at,
    case f.kind
      when 'two_hours' then 'Leaving in 2 hours'
      when 'confirm_ride' then 'Confirm your ride'
      else 'Confirm your passengers'
    end,
    case f.kind
      when 'two_hours' then
        (case when f.leg = 'to' then 'Up to ' else 'Back from ' end) || rs.name || ' at ' ||
        to_char(d.at at time zone 'America/Denver', 'FMHH12:MI AM') || ' from ' ||
        (case when f.leg = 'from' and d.trip_type = 'round_trip' and d.return_meet <> '' then d.return_meet else d.leave_from end) ||
        '. Tap for the countdown and chat.'
      when 'confirm_ride' then 'Your ride ' || (case when f.leg = 'to' then 'to ' else 'from ' end) || rs.name || ' leaves in 5 minutes. Tap to confirm you''re in.'
      else 'Leaving for ' || rs.name || ' in 5 minutes. Tap to check off your passengers.'
    end,
    coalesce((select array_agg(t.token) from public.push_tokens t where t.user_id = f.user_id), '{}')
  from fresh f
  join due d on d.ride_id = f.ride_id and d.leg = f.leg and d.person = f.user_id and d.kind = f.kind
  join public.resorts rs on rs.id = d.resort_id;
end;
$$;

revoke execute on function public.claim_due_notifications() from public, anon, authenticated;
grant execute on function public.claim_due_notifications() to service_role;

------------------------------------------------------------------------------
-- Board: trip type, return, and seats per leg.
------------------------------------------------------------------------------
drop view public.ride_board;
create view public.ride_board
with (security_invoker = on)
as
select
  r.id,
  r.driver_id,
  p.full_name as driver_name,
  r.resort_id,
  r.depart_at,
  r.leave_from,
  r.seats_total,
  r.gas_per_rider,
  r.gear,
  r.notes,
  r.created_at,
  greatest(coalesce(s.taken_to, 0), coalesce(s.taken_from, 0)) as seats_taken,
  coalesce(s.rider_ids, '{}') as rider_ids,
  coalesce(s.rider_names, '{}') as rider_names,
  r.ride_date,
  public.trip_gas_cap(r.resort_id, r.depart_at, r.trip_type) as gas_cap,
  public.is_verified_driver(r.driver_id) as driver_verified,
  p.avatar_path as driver_avatar_path,
  p.gender as driver_gender,
  coalesce(s.rider_avatar_paths, '{}') as rider_avatar_paths,
  coalesce(s.rider_genders, '{}') as rider_genders,
  rt.driving_avg as driver_driving_avg,
  rt.experience_avg as driver_experience_avg,
  coalesce(rt.review_count, 0) as driver_review_count,
  r.trip_type,
  r.return_at,
  r.return_meet,
  coalesce(s.taken_to, 0) as seats_taken_to,
  coalesce(s.taken_from, 0) as seats_taken_from,
  coalesce(s.rider_legs, '{}') as rider_legs
from public.rides r
join public.profiles p on p.id = r.driver_id
left join lateral (
  select
    count(*) filter (where 'to' = any (public.seat_legs(r.trip_type, rs.legs)))::int as taken_to,
    count(*) filter (where 'from' = any (public.seat_legs(r.trip_type, rs.legs)))::int as taken_from,
    array_agg(rs.rider_id order by rs.created_at) as rider_ids,
    array_agg(rp.full_name order by rs.created_at) as rider_names,
    array_agg(rp.avatar_path order by rs.created_at) as rider_avatar_paths,
    array_agg(rp.gender order by rs.created_at) as rider_genders,
    array_agg(rs.legs order by rs.created_at) as rider_legs
  from public.ride_seats rs
  join public.profiles rp on rp.id = rs.rider_id
  where rs.ride_id = r.id
) s on true
left join lateral (
  select round(avg(rv.driving_rating), 2) as driving_avg, round(avg(rv.experience_rating), 2) as experience_avg, count(*)::int as review_count
  from public.reviews rv
  where rv.reviewee_id = r.driver_id and rv.reviewee_role = 'driver'
) rt on true
where r.cancelled_at is null
  and coalesce(r.return_at, r.depart_at) > now() - interval '2 hours';

revoke all on public.ride_board from anon, authenticated;
grant select on public.ride_board to authenticated;
