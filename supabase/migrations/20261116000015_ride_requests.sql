-- Ride requests: booking a seat asks the driver, who confirms or denies it.
--
--   * claim_seat now makes a pending request. It holds the seat while the
--     driver decides: it counts toward the car's seats and the
--     one-ride-a-day rule, so nobody else can grab it in the meantime.
--   * The driver gets a push. respond_seat_request() confirms the rider (they
--     get the ride chat, the driver's contact, reminders and check-in) or
--     denies them (the seat frees up and they can't request that ride again).
--   * The rider gets a push either way.
--   * A request nobody answers expires 2 hours before the first leg it covers,
--     the same cutoff Colorado sets for booking (C.R.S. 43-1-127). The seat
--     frees up and the rider gets a push.
--   * Seats booked before this change stay confirmed.
--
-- Pushes for requests go through a small outbox that the every-minute
-- reminder job (claim_due_notifications) drains.

-- ---------------------------------------------------------------------------
-- Seat status
-- ---------------------------------------------------------------------------

-- The column default is 'confirmed' so every existing seat (and anything the
-- service inserts by hand) is a real booking. Riders only ever book through
-- claim_seat, which inserts 'pending' explicitly.
alter table public.ride_seats
  add column status text not null default 'confirmed' check (status in ('pending', 'confirmed')),
  add column decided_at timestamptz;

create index ride_seats_pending_idx on public.ride_seats (ride_id) where status = 'pending';

-- When a pending request runs out: 2 hours before the first leg it covers.
create function public.seat_request_deadline(p_trip_type text, p_depart_at timestamptz, p_return_at timestamptz, p_legs text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select min(public.leg_at(p_trip_type, p_depart_at, p_return_at, l)) - interval '2 hours'
  from unnest(public.seat_legs(p_trip_type, p_legs)) l;
$$;

-- A driver's "no" sticks for that ride, so a rider can't keep re-requesting.
create table public.ride_seat_denials (
  ride_id uuid not null references public.rides (id) on delete cascade,
  rider_id uuid not null references public.profiles (id) on delete cascade,
  denied_at timestamptz not null default now(),
  primary key (ride_id, rider_id)
);
alter table public.ride_seat_denials enable row level security;
revoke all on public.ride_seat_denials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Push outbox
-- ---------------------------------------------------------------------------

create table public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('seat_request', 'seat_confirmed', 'seat_denied', 'request_expired')),
  ride_id uuid references public.rides (id) on delete cascade,
  leg text check (leg in ('to', 'from')),
  about_id uuid references public.profiles (id) on delete cascade, -- the rider a request is about
  title text not null,
  body text not null,
  url text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index push_outbox_unsent_idx on public.push_outbox (created_at) where sent_at is null;
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated;

-- Writes the push for one step of a request.
--   seat_request     → driver: "Sam wants a round-trip seat to Vail on Sat, Jan 10. Confirm or deny by 4:30 AM."
--   seat_confirmed   → rider:  "Eli confirmed your seat to Vail on Sat, Jan 10. Meet at Folsom Field at 6:30 AM."
--   seat_denied      → rider:  "Eli declined your request for a seat to Vail on Sat, Jan 10. Tap to find another ride."
--   request_expired  → rider:  "Eli didn't confirm your seat to Vail on Sat, Jan 10 in time, so the request expired. ..."
create function public.queue_seat_push(p_kind text, p_ride_id uuid, p_rider_id uuid, p_legs text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rides;
  v_resort text;
  v_rider text;
  v_driver text;
  v_leg text;
  v_at timestamptz;
  v_meet text;
  v_day text;
  v_what text;
  fmt constant text := 'FMHH12:MI AM';
begin
  select * into r from public.rides where id = p_ride_id;
  if not found then
    return;
  end if;

  -- A rider who cancels and re-requests doesn't ping the driver again for half an hour.
  if p_kind = 'seat_request' and exists (
    select 1 from public.push_outbox o
    where o.kind = 'seat_request' and o.ride_id = p_ride_id and o.about_id = p_rider_id
      and o.created_at > now() - interval '30 minutes'
  ) then
    return;
  end if;

  select coalesce(name, 'the mountain') into v_resort from public.resorts where id = r.resort_id;
  v_resort := coalesce(v_resort, 'the mountain');
  select coalesce(nullif(split_part(trim(full_name), ' ', 1), ''), 'A rider') into v_rider from public.profiles where id = p_rider_id;
  select coalesce(nullif(split_part(trim(full_name), ' ', 1), ''), 'The driver') into v_driver from public.profiles where id = r.driver_id;
  v_rider := coalesce(v_rider, 'A rider');
  v_driver := coalesce(v_driver, 'The driver');

  v_leg := (public.seat_legs(r.trip_type, p_legs))[1];
  v_at := public.leg_at(r.trip_type, r.depart_at, r.return_at, v_leg);
  v_meet := case when v_leg = 'from' and r.trip_type = 'round_trip' and r.return_meet <> '' then r.return_meet else r.leave_from end;
  v_day := to_char(r.ride_date, 'Dy, Mon FMDD');
  v_what := case
    when r.trip_type = 'round_trip' and p_legs = 'both' then 'round-trip seat to '
    when v_leg = 'from' then 'seat back from '
    when r.trip_type = 'round_trip' then 'seat up to '
    else 'seat to '
  end || v_resort;

  insert into public.push_outbox (user_id, kind, ride_id, leg, about_id, title, body, url)
  select
    case when p_kind = 'seat_request' then r.driver_id else p_rider_id end,
    p_kind,
    r.id,
    v_leg,
    p_rider_id,
    case p_kind
      when 'seat_request' then 'New ride request'
      when 'seat_confirmed' then 'You''re in!'
      when 'seat_denied' then 'Request declined'
      else 'Request expired'
    end,
    left(case p_kind
      when 'seat_request' then
        v_rider || ' wants a ' || v_what || ' on ' || v_day || '. Confirm or deny by ' ||
        to_char(public.seat_request_deadline(r.trip_type, r.depart_at, r.return_at, p_legs) at time zone 'America/Denver', fmt) || '.'
      when 'seat_confirmed' then
        v_driver || ' confirmed your ' || v_what || ' on ' || v_day || '. Meet at ' || v_meet || ' at ' ||
        to_char(v_at at time zone 'America/Denver', fmt) || '.'
      when 'seat_denied' then
        v_driver || ' declined your request for a ' || v_what || ' on ' || v_day || '. Tap to find another ride.'
      else
        v_driver || ' didn''t confirm your ' || v_what || ' on ' || v_day || ' in time, so the request expired. Tap to find another ride.'
    end, 300),
    case when p_kind in ('seat_request', 'seat_confirmed')
      then 'lift2lift:///rides?ride=' || r.id || '&leg=' || v_leg
      else 'lift2lift:///?resort=' || r.resort_id || '&day=' || r.ride_date
    end;
end;
$$;
revoke execute on function public.queue_seat_push(text, uuid, uuid, text) from public, anon, authenticated;

-- Frees every pending request past its deadline and tells each rider.
-- Runs every minute from claim_due_notifications, and before any booking or
-- answer so a stale request never holds a seat.
create function public.expire_seat_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  n integer := 0;
begin
  for v in
    delete from public.ride_seats s
    using public.rides r
    where r.id = s.ride_id
      and s.status = 'pending'
      and r.cancelled_at is null
      and public.seat_request_deadline(r.trip_type, r.depart_at, r.return_at, s.legs) <= now()
    returning s.ride_id, s.rider_id, s.legs
  loop
    perform public.queue_seat_push('request_expired', v.ride_id, v.rider_id, v.legs);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.expire_seat_requests() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Booking makes a request
-- ---------------------------------------------------------------------------

create or replace function public.claim_seat_rules(p_ride_id uuid, p_legs text default 'both')
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

  -- Requests nobody answered in time don't hold seats.
  perform public.expire_seat_requests();

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
    return; -- already have a seat or a request
  end if;

  if exists (select 1 from public.ride_seat_denials where ride_id = p_ride_id and rider_id = v_uid) then
    raise exception 'The driver turned down your request for this ride. Try another one.' using errcode = 'P0001';
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

  -- No two seats (or requests) on the same leg on the same day.
  if exists (
    select 1 from public.ride_seats s
    join public.rides r on r.id = s.ride_id
    where s.rider_id = v_uid and r.ride_date = v_ride.ride_date and r.cancelled_at is null
      and public.seat_legs(r.trip_type, s.legs) && v_legs
  ) then
    raise exception 'You already have a seat or a request that day. You can book one ride up and one ride down, but not two at once.' using errcode = 'P0001';
  end if;

  -- Pending requests hold their seats, so they count here.
  foreach v_leg in array v_legs loop
    select count(*) into v_taken from public.ride_seats s
    where s.ride_id = p_ride_id and v_leg = any (public.seat_legs(v_ride.trip_type, s.legs));
    if v_taken >= v_ride.seats_total then
      raise exception '%', case when v_leg = 'to' then 'The ride up is full.' else 'The ride down is full.' end using errcode = 'P0001';
    end if;
  end loop;

  insert into public.ride_seats (ride_id, rider_id, legs, status) values (p_ride_id, v_uid, p_legs, 'pending');
  perform public.queue_seat_push('seat_request', p_ride_id, v_uid, p_legs);
end;
$$;

-- ---------------------------------------------------------------------------
-- The driver answers
-- ---------------------------------------------------------------------------

create function public.respond_seat_request(p_ride_id uuid, p_rider_id uuid, p_confirm boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_seat public.ride_seats;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_confirm is null then
    raise exception 'Pick confirm or deny.' using errcode = 'P0001';
  end if;

  -- A request past its deadline (2 hours before it leaves) is gone by the time
  -- we look for it below, so it can't be confirmed late.
  perform public.expire_seat_requests();

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.driver_id <> v_uid then
    raise exception 'Only the driver can answer requests for this ride.' using errcode = '42501';
  end if;
  if v_ride.cancelled_at is not null then
    raise exception 'This ride was cancelled.' using errcode = 'P0001';
  end if;

  select * into v_seat from public.ride_seats where ride_id = p_ride_id and rider_id = p_rider_id for update;
  if not found then
    raise exception 'That request is gone. The rider cancelled it, or it expired.' using errcode = 'P0002';
  end if;
  if v_seat.status = 'confirmed' then
    if p_confirm then
      return; -- already confirmed
    end if;
    raise exception 'They''re already confirmed. To take them off the ride, remove them instead.' using errcode = 'P0001';
  end if;

  if p_confirm then
    -- Someone blocked someone since the request came in.
    if public.is_blocked_between(v_uid, p_rider_id) or exists (
      select 1 from public.ride_seats s
      where s.ride_id = p_ride_id and s.rider_id <> p_rider_id and s.status = 'confirmed'
        and public.is_blocked_between(s.rider_id, p_rider_id)
    ) then
      raise exception 'This request can''t be confirmed. Deny it to free the seat.' using errcode = 'P0001';
    end if;

    update public.ride_seats set status = 'confirmed', decided_at = now()
    where ride_id = p_ride_id and rider_id = p_rider_id;
    perform public.queue_seat_push('seat_confirmed', p_ride_id, p_rider_id, v_seat.legs);
  else
    delete from public.ride_seats where ride_id = p_ride_id and rider_id = p_rider_id;
    insert into public.ride_seat_denials (ride_id, rider_id) values (p_ride_id, p_rider_id) on conflict do nothing;
    perform public.queue_seat_push('seat_denied', p_ride_id, p_rider_id, v_seat.legs);
  end if;
end;
$$;
revoke execute on function public.respond_seat_request(uuid, uuid, boolean) from public, anon;
grant execute on function public.respond_seat_request(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Only confirmed riders are on the ride
-- ---------------------------------------------------------------------------

-- Chat, check-ins and Your Rides' day-of view all go through this.
create or replace function public.is_ride_member(p_ride_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rides r where r.id = p_ride_id and r.driver_id = p_user_id)
      or exists (select 1 from public.ride_seats s where s.ride_id = p_ride_id and s.rider_id = p_user_id and s.status = 'confirmed');
$$;

-- The driver's phone number waits until they say yes.
create or replace function public.ride_contact(p_ride_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.contact
  from public.rides r
  where r.id = p_ride_id
    and (
      r.driver_id = auth.uid()
      or exists (select 1 from public.ride_seats s where s.ride_id = r.id and s.rider_id = auth.uid() and s.status = 'confirmed')
    );
$$;

create or replace function public.checkin_window(p_ride public.rides, p_leg text, p_rider uuid)
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
  if not exists (select 1 from public.ride_seats s where s.ride_id = p_ride.id and s.rider_id = p_rider and s.status = 'confirmed'
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

-- Reminders go to the driver and confirmed riders only.
create or replace function public.claim_due_reminders()
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
    where exists (select 1 from public.ride_seats s where s.ride_id = lv.id and s.status = 'confirmed'
                  and lv.leg = any (public.seat_legs(lv.trip_type, s.legs)))
    union all
    select lv.id, lv.leg, lv.at, lv.resort_id, lv.leave_from, lv.return_meet, lv.trip_type, s.rider_id, false
    from live lv join public.ride_seats s on s.ride_id = lv.id
    where s.status = 'confirmed' and lv.leg = any (public.seat_legs(lv.trip_type, s.legs))
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

-- The push job: expire requests, then reminders, ride changes and the outbox.
-- Adds a url column so request pushes can open the right screen. (Older
-- versions of the edge function ignore it and open Your Rides.)
drop function public.claim_due_notifications();
create function public.claim_due_notifications()
returns table (user_id uuid, kind text, ride_id uuid, leg text, leg_at timestamptz, title text, body text, tokens text[], url text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Requests nobody answered in time free their seats; the riders hear about it below.
  perform public.expire_seat_requests();

  -- A request the rider cancelled, or the driver already answered in the app,
  -- doesn't need a push anymore.
  delete from public.push_outbox o
  where o.sent_at is null and o.kind = 'seat_request'
    and not exists (select 1 from public.ride_seats s where s.ride_id = o.ride_id and s.rider_id = o.about_id and s.status = 'pending');

  return query select d.*, null::text from public.claim_due_reminders() d;

  -- Ride changes reach everyone with a seat or a request, so a pending rider
  -- hears if the driver cancels or moves the time.
  return query
  with changed as (
    update public.ride_messages m set pushed_at = now()
    where m.kind = 'update' and m.pushed_at is null and m.created_at > now() - interval '1 hour'
    returning m.ride_id, m.body
  )
  select s.rider_id,
         'ride_changed'::text,
         c.ride_id,
         (case when r.trip_type = 'from_mountain' then 'from' else 'to' end)::text,
         r.depart_at,
         (case when r.cancelled_at is not null then 'Ride cancelled' else 'Ride updated' end)::text,
         c.body,
         coalesce((select array_agg(t.token) from public.push_tokens t where t.user_id = s.rider_id), '{}'),
         null::text
  from changed c
  join public.rides r on r.id = c.ride_id
  join public.ride_seats s on s.ride_id = c.ride_id;

  -- Requests, confirmations, denials and expiries. Anything older than a day
  -- (the job was down) is marked sent without pushing.
  return query
  with due as (
    update public.push_outbox o set sent_at = now()
    where o.sent_at is null
    returning o.user_id, o.kind, o.ride_id, o.leg, o.title, o.body, o.url, o.created_at
  )
  select d.user_id, d.kind, d.ride_id, d.leg,
         public.leg_at(r.trip_type, r.depart_at, r.return_at, d.leg),
         d.title, d.body,
         coalesce((select array_agg(t.token) from public.push_tokens t where t.user_id = d.user_id), '{}'),
         d.url
  from due d
  left join public.rides r on r.id = d.ride_id
  where d.created_at > now() - interval '1 day';
end;
$$;
revoke execute on function public.claim_due_notifications() from public, anon, authenticated;
grant execute on function public.claim_due_notifications() to service_role;

-- Reviews are for people who actually rode together.
create or replace function public.reviews_to_write()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_rides as (
    select r.*
    from public.rides r
    join public.ride_seats s on s.ride_id = r.id and s.rider_id = auth.uid() and s.status = 'confirmed'
    where r.cancelled_at is null
      and r.depart_at < now()
      and r.depart_at > now() - interval '14 days'
  ),
  people as (
    select m.id as ride_id, m.driver_id as person_id, 'driver' as role from my_rides m
    union all
    select m.id, s.rider_id, 'passenger' from my_rides m join public.ride_seats s on s.ride_id = m.id
    where s.rider_id <> auth.uid() and s.status = 'confirmed'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'ride_id', m.id,
    'resort_id', m.resort_id,
    'depart_at', m.depart_at,
    'closes_at', m.depart_at + interval '14 days',
    'people', (
      select jsonb_agg(jsonb_build_object(
        'id', p.person_id, 'role', p.role, 'name', pr.full_name, 'avatar_path', pr.avatar_path, 'gender', pr.gender)
        order by p.role, pr.full_name)
      from people p
      join public.profiles pr on pr.id = p.person_id
      where p.ride_id = m.id
        and not exists (select 1 from public.reviews rv
                        where rv.ride_id = m.id and rv.reviewer_id = auth.uid() and rv.reviewee_id = p.person_id)
    )
  ) order by m.depart_at desc), '[]'::jsonb)
  from my_rides m
  where exists (
    select 1 from people p
    where p.ride_id = m.id
      and not exists (select 1 from public.reviews rv
                      where rv.ride_id = m.id and rv.reviewer_id = auth.uid() and rv.reviewee_id = p.person_id)
  );
$$;

create or replace function public.submit_review(p_ride_id uuid, p_reviewee_id uuid, p_experience numeric, p_driving numeric default null, p_body text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  select * into v_ride from public.rides where id = p_ride_id;
  if not found or v_ride.cancelled_at is not null then
    raise exception 'That ride doesn''t exist or was cancelled.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = v_uid and status = 'confirmed') then
    raise exception 'Only passengers on this ride can review it.' using errcode = 'P0001';
  end if;
  if v_ride.depart_at > now() then
    raise exception 'You can review this ride after it leaves.' using errcode = 'P0001';
  end if;
  if v_ride.depart_at < now() - interval '14 days' then
    raise exception 'Reviews close 14 days after the ride.' using errcode = 'P0001';
  end if;
  if p_reviewee_id = v_uid then
    raise exception 'You can''t review yourself.' using errcode = 'P0001';
  end if;

  if p_reviewee_id = v_ride.driver_id then
    v_role := 'driver';
    if p_driving is null then
      raise exception 'Rate their driving too.' using errcode = 'P0001';
    end if;
  elsif exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = p_reviewee_id and status = 'confirmed') then
    v_role := 'passenger';
    p_driving := null;
  else
    raise exception 'They weren''t on this ride.' using errcode = 'P0001';
  end if;

  begin
    insert into public.reviews (ride_id, reviewer_id, reviewee_id, reviewee_role, driving_rating, experience_rating, body)
    values (p_ride_id, v_uid, p_reviewee_id, v_role, p_driving, p_experience, left(trim(coalesce(p_body, '')), 1000));
  exception
    when unique_violation then
      raise exception 'You already reviewed them for this ride.' using errcode = 'P0001';
    when check_violation then
      raise exception 'Ratings go from half a star to 5 stars, in half-star steps.' using errcode = 'P0001';
  end;
end;
$$;

-- "Rides taken" on a profile counts rides they were confirmed on.
create or replace function public.profile_page(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'avatar_path', p.avatar_path,
    'gender', p.gender,
    'bio', p.bio,
    'instagram', p.instagram,
    'discipline', p.discipline,
    'home_resort_id', p.home_resort_id,
    'school_year', p.school_year,
    'hometown', p.hometown,
    'interests', to_jsonb(p.interests),
    'prompts', p.prompts,
    'member_since', p.created_at,
    'id_verified', coalesce(v.identity_status = 'verified' and v.status <> 'rejected', false),
    'driver_verified', public.is_verified_driver(p.id),
    'profile_complete', public.is_profile_ready(p.id),
    'rides_driven', (select count(*) from public.rides r where r.driver_id = p.id and r.cancelled_at is null and r.depart_at < now()),
    'rides_taken', (select count(*) from public.ride_seats s join public.rides r on r.id = s.ride_id
                    where s.rider_id = p.id and s.status = 'confirmed' and r.cancelled_at is null and r.depart_at < now()),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'resort_id', r.resort_id, 'depart_at', r.depart_at,
                                          'seats_total', r.seats_total, 'seats_taken',
                                          (select count(*) from public.ride_seats s where s.ride_id = r.id))
                       order by r.depart_at)
      from public.rides r
      where r.driver_id = p.id and r.cancelled_at is null and r.depart_at > now()
        and (r.community_id is null or public.can_see_ride(r.id))
    ), '[]'::jsonb)
  ) end
  from public.profiles p
  left join public.driver_verifications v on v.user_id = p.id
  where p.id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- The board: seat counts include requests (they hold seats), but the faces in
-- the car are confirmed riders only. Three new columns at the end:
--   seats_pending   requests waiting on the driver
--   my_seat_status  'pending' or 'confirmed' if you have a seat, else null
--   my_seat_legs    which legs that seat covers
-- ---------------------------------------------------------------------------

create or replace view public.ride_board with (security_invoker = on) as
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
  coalesce(s.rider_ids, '{}'::uuid[]) as rider_ids,
  coalesce(s.rider_names, '{}'::text[]) as rider_names,
  r.ride_date,
  public.trip_gas_cap(r.resort_id, r.depart_at, r.trip_type) as gas_cap,
  public.is_verified_driver(r.driver_id) as driver_verified,
  p.avatar_path as driver_avatar_path,
  p.gender as driver_gender,
  coalesce(s.rider_avatar_paths, '{}'::text[]) as rider_avatar_paths,
  coalesce(s.rider_genders, '{}'::text[]) as rider_genders,
  rt.driving_avg as driver_driving_avg,
  rt.experience_avg as driver_experience_avg,
  coalesce(rt.review_count, 0) as driver_review_count,
  r.trip_type,
  r.return_at,
  r.return_meet,
  coalesce(s.taken_to, 0) as seats_taken_to,
  coalesce(s.taken_from, 0) as seats_taken_from,
  coalesce(s.rider_legs, '{}'::text[]) as rider_legs,
  r.community_id,
  c.name as community_name,
  coalesce(s.pending, 0) as seats_pending,
  s.my_status as my_seat_status,
  s.my_legs as my_seat_legs
from public.rides r
join public.profiles p on p.id = r.driver_id
left join public.communities c on c.id = r.community_id
left join lateral (
  select
    count(*) filter (where 'to' = any (public.seat_legs(r.trip_type, rs.legs)))::integer as taken_to,
    count(*) filter (where 'from' = any (public.seat_legs(r.trip_type, rs.legs)))::integer as taken_from,
    count(*) filter (where rs.status = 'pending')::integer as pending,
    array_agg(rs.rider_id order by rs.created_at) filter (where rs.status = 'confirmed') as rider_ids,
    array_agg(rp.full_name order by rs.created_at) filter (where rs.status = 'confirmed') as rider_names,
    array_agg(rp.avatar_path order by rs.created_at) filter (where rs.status = 'confirmed') as rider_avatar_paths,
    array_agg(rp.gender order by rs.created_at) filter (where rs.status = 'confirmed') as rider_genders,
    array_agg(rs.legs order by rs.created_at) filter (where rs.status = 'confirmed') as rider_legs,
    max(rs.status) filter (where rs.rider_id = (select auth.uid())) as my_status,
    max(rs.legs) filter (where rs.rider_id = (select auth.uid())) as my_legs
  from public.ride_seats rs
  join public.profiles rp on rp.id = rs.rider_id
  where rs.ride_id = r.id
    -- A request past its deadline is about to be cleared; don't let it hold a seat.
    and (rs.status = 'confirmed' or public.seat_request_deadline(r.trip_type, r.depart_at, r.return_at, rs.legs) > now())
) s on true
left join lateral (
  select round(avg(rv.driving_rating), 2) as driving_avg,
         round(avg(rv.experience_rating), 2) as experience_avg,
         count(*)::integer as review_count
  from public.reviews rv
  where rv.reviewee_id = r.driver_id and rv.reviewee_role = 'driver'
) rt on true
where r.cancelled_at is null and coalesce(r.return_at, r.depart_at) > now() - interval '2 hours';

-- ---------------------------------------------------------------------------
-- Your Rides: your requests show as pending, and drivers see who's asking.
--   my_status   'pending' | 'confirmed' for a passenger, null for the driver
--   expires_at  when a pending request runs out
--   requests    (driver only) riders waiting on an answer, with their rating
--   contact, passengers and check-ins stay hidden until you're confirmed
-- ---------------------------------------------------------------------------

create or replace function public.my_trips()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select r.*,
           case when r.driver_id = auth.uid() then 'driver' else 'passenger' end as my_role,
           s.legs as my_legs,
           s.status as my_status,
           case when s.status = 'pending' then public.seat_request_deadline(r.trip_type, r.depart_at, r.return_at, s.legs) end as my_expires_at
    from public.rides r
    left join public.ride_seats s on s.ride_id = r.id and s.rider_id = auth.uid()
    where r.cancelled_at is null
      and coalesce(r.return_at, r.depart_at) > now() - interval '3 hours'
      and (
        r.driver_id = auth.uid()
        or s.status = 'confirmed'
        or (s.status = 'pending' and public.seat_request_deadline(r.trip_type, r.depart_at, r.return_at, s.legs) > now())
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'role', m.my_role,
    'my_legs', m.my_legs,
    'my_status', m.my_status,
    'expires_at', m.my_expires_at,
    'resort_id', m.resort_id,
    'trip_type', m.trip_type,
    'depart_at', m.depart_at,
    'return_at', m.return_at,
    'leave_from', m.leave_from,
    'return_meet', m.return_meet,
    'seats_total', m.seats_total,
    'gas_per_rider', m.gas_per_rider,
    'contact', case when m.my_role = 'driver' or m.my_status = 'confirmed' then m.contact else '' end,
    'driver', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar_path', p.avatar_path, 'gender', p.gender)
               from public.profiles p where p.id = m.driver_id),
    'passengers', case when m.my_role = 'driver' or m.my_status = 'confirmed' then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar_path', p.avatar_path, 'gender', p.gender, 'legs', s.legs)
                       order by s.created_at)
      from public.ride_seats s join public.profiles p on p.id = s.rider_id
      where s.ride_id = m.id and s.status = 'confirmed'), '[]'::jsonb) else '[]'::jsonb end,
    'requests', case when m.my_role = 'driver' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.full_name, 'avatar_path', p.avatar_path, 'gender', p.gender, 'legs', s.legs,
               'requested_at', s.created_at,
               'expires_at', public.seat_request_deadline(m.trip_type, m.depart_at, m.return_at, s.legs),
               'rating', (select round(avg(rv.experience_rating), 1) from public.reviews rv
                          where rv.reviewee_id = p.id and rv.reviewee_role = 'passenger'),
               'review_count', (select count(*) from public.reviews rv where rv.reviewee_id = p.id and rv.reviewee_role = 'passenger'))
             order by s.created_at)
      from public.ride_seats s join public.profiles p on p.id = s.rider_id
      where s.ride_id = m.id and s.status = 'pending'
        and public.seat_request_deadline(m.trip_type, m.depart_at, m.return_at, s.legs) > now()), '[]'::jsonb) else '[]'::jsonb end,
    'checkins', case when m.my_role = 'driver' or m.my_status = 'confirmed' then coalesce((
      select jsonb_agg(jsonb_build_object('leg', c.leg, 'rider_id', c.rider_id, 'rider_confirmed_at', c.rider_confirmed_at,
                                          'driver_status', c.driver_status))
      from public.ride_checkins c where c.ride_id = m.id), '[]'::jsonb) else '[]'::jsonb end
  ) order by m.depart_at), '[]'::jsonb)
  from mine m;
$$;
