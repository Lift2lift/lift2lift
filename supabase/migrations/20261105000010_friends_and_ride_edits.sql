-- Friends, and editing a ride after it's posted.

------------------------------------------------------------------------------
-- Friends. One row per pair, smaller id first. A request stays 'pending'
-- until the other person accepts. Declining, cancelling and unfriending all
-- delete the row. Rows are only changed through the functions below.
------------------------------------------------------------------------------
create table public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requested_by = user_a or requested_by = user_b)
);

create index friendships_user_b_idx on public.friendships (user_b);
create index friendships_requested_by_idx on public.friendships (requested_by) where status = 'pending';

alter table public.friendships enable row level security;

create policy "People see their own friendships"
  on public.friendships for select to authenticated
  using ((select auth.uid()) = user_a or (select auth.uid()) = user_b);

revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

/** Send a friend request. If they already asked you, this accepts it. Returns 'sent' or 'friends'. */
create function public.friend_request(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_row public.friendships;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_user_id = v_uid then
    raise exception 'You can''t add yourself as a friend.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'That person isn''t on Lift2Lift.' using errcode = 'P0002';
  end if;

  v_a := least(v_uid, p_user_id);
  v_b := greatest(v_uid, p_user_id);
  perform pg_advisory_xact_lock(hashtextextended(v_a::text || v_b::text, 7311));

  select * into v_row from public.friendships where user_a = v_a and user_b = v_b;
  if found then
    if v_row.status = 'accepted' then
      return 'friends';
    elsif v_row.requested_by = v_uid then
      return 'sent';
    end if;
    update public.friendships set status = 'accepted', accepted_at = now() where user_a = v_a and user_b = v_b;
    return 'friends';
  end if;

  if (select count(*) from public.friendships where requested_by = v_uid and status = 'pending') >= 100 then
    raise exception 'You have 100 friend requests waiting. Cancel a few before sending more.' using errcode = 'P0001';
  end if;

  insert into public.friendships (user_a, user_b, requested_by) values (v_a, v_b, v_uid);
  return 'sent';
end;
$$;

/** Accept or decline a request someone sent you. */
create function public.friend_respond(p_user_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
    where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id)
      and status = 'pending' and requested_by = p_user_id;
  else
    delete from public.friendships
    where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id)
      and status = 'pending' and requested_by = p_user_id;
  end if;
  if not found then
    raise exception 'That friend request isn''t there anymore.' using errcode = 'P0002';
  end if;
end;
$$;

/** Unfriend, or cancel a request you sent. */
create function public.friend_remove(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships
  where auth.uid() is not null
    and user_a = least(auth.uid(), p_user_id) and user_b = greatest(auth.uid(), p_user_id);
$$;

/** Your friends, requests waiting for you, and requests you sent. */
create function public.my_friends()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as other,
           f.status, f.requested_by, f.created_at, coalesce(f.accepted_at, f.created_at) as since
    from public.friendships f
    where auth.uid() in (f.user_a, f.user_b)
  ),
  ppl as (
    select m.*, jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar_path', p.avatar_path, 'gender', p.gender,
                                   'home_resort_id', p.home_resort_id, 'since', m.since) as person
    from mine m join public.profiles p on p.id = m.other
  )
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(person order by person ->> 'name') from ppl where status = 'accepted'), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(person order by created_at desc) from ppl where status = 'pending' and requested_by <> auth.uid()), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(person order by created_at desc) from ppl where status = 'pending' and requested_by = auth.uid()), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;

/**
 * The friends shown on someone's profile, mutual friends first, plus how
 * many you share and where you stand with them (self, friends, sent, received, none).
 */
create function public.profile_friends(p_user_id uuid, p_limit int default 24)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with theirs as (
    select case when f.user_a = p_user_id then f.user_b else f.user_a end as other, f.accepted_at
    from public.friendships f
    where p_user_id in (f.user_a, f.user_b) and f.status = 'accepted'
  ),
  mine as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as other
    from public.friendships f
    where auth.uid() in (f.user_a, f.user_b) and f.status = 'accepted'
  ),
  shown as (
    select t.other, t.accepted_at, (t.other in (select other from mine)) as mutual
    from theirs t
    order by (t.other in (select other from mine)) desc, t.accepted_at desc
    limit least(greatest(p_limit, 0), 100)
  )
  select jsonb_build_object(
    'count', (select count(*) from theirs),
    'mutual', case when p_user_id = auth.uid() then 0 else (select count(*) from theirs where other in (select other from mine)) end,
    'state', case
      when p_user_id = auth.uid() then 'self'
      else coalesce((
        select case when f.status = 'accepted' then 'friends' when f.requested_by = auth.uid() then 'sent' else 'received' end
        from public.friendships f
        where f.user_a = least(auth.uid(), p_user_id) and f.user_b = greatest(auth.uid(), p_user_id)
      ), 'none')
    end,
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar_path', p.avatar_path, 'gender', p.gender, 'mutual', s.mutual)
                       order by s.mutual desc, s.accepted_at desc)
      from shown s join public.profiles p on p.id = s.other
    ), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;

/** Find people by name or Instagram handle (2+ characters, up to 20 results). */
create function public.search_people(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select replace(replace(replace(trim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') as q
  ),
  hits as (
    select p.id, p.full_name, p.avatar_path, p.gender, p.home_resort_id, p.school_year,
           case when p.full_name ilike q.q || '%' then 0
                when p.full_name ilike '% ' || q.q || '%' then 1
                when p.instagram ilike ltrim(q.q, '@') || '%' then 2
                else 3 end as rank
    from public.profiles p, q
    where auth.uid() is not null
      and char_length(trim(coalesce(p_query, ''))) >= 2
      and p.id <> auth.uid()
      and char_length(trim(p.full_name)) > 0
      and (p.full_name ilike '%' || q.q || '%' or p.instagram ilike ltrim(q.q, '@') || '%')
    order by rank, p.full_name
    limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'avatar_path', h.avatar_path, 'gender', h.gender,
                                               'home_resort_id', h.home_resort_id, 'school_year', h.school_year)
                            order by h.rank, h.full_name), '[]'::jsonb)
  from hits h;
$$;

revoke execute on function public.friend_request(uuid) from public, anon;
revoke execute on function public.friend_respond(uuid, boolean) from public, anon;
revoke execute on function public.friend_remove(uuid) from public, anon;
revoke execute on function public.my_friends() from public, anon;
revoke execute on function public.profile_friends(uuid, int) from public, anon;
revoke execute on function public.search_people(text) from public, anon;
grant execute on function public.friend_request(uuid) to authenticated;
grant execute on function public.friend_respond(uuid, boolean) to authenticated;
grant execute on function public.friend_remove(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.profile_friends(uuid, int) to authenticated;
grant execute on function public.search_people(text) to authenticated;

------------------------------------------------------------------------------
-- Editing a ride. Drivers could already update their own rides; these rules
-- protect riders who've booked: same mountain and day, gas only goes down.
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
  v_booked boolean := false;
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

  if tg_op = 'UPDATE' then
    v_booked := exists (select 1 from public.ride_seats where ride_id = new.id);

    -- Finished rides stay as they were.
    if coalesce(old.return_at, old.depart_at) < now() then
      raise exception 'This ride is over, so it can''t be edited.' using errcode = 'P0001';
    end if;

    -- A new time for the ride back still has to give people time to get there.
    if new.return_at is distinct from old.return_at and new.return_at is not null
       and new.return_at < now() + interval '30 minutes' then
      raise exception 'The ride back has to leave at least 30 minutes from now.' using errcode = 'P0001';
    end if;

    -- Once someone's booked, the mountain and the day are what they signed up
    -- for, and gas money can only go down.
    if v_booked and new.resort_id is distinct from old.resort_id then
      raise exception 'Riders already booked this trip, so the mountain can''t change. Cancel it and post a new ride instead.' using errcode = 'P0001';
    end if;
    if v_booked and new.ride_date is distinct from old.ride_date then
      raise exception 'Riders are booked for %, so the ride can''t move to another day. You can still change the time.',
        to_char(old.ride_date, 'FMDay, Mon FMDD') using errcode = 'P0001';
    end if;
    if v_booked and new.gas_per_rider > old.gas_per_rider then
      raise exception 'Riders already agreed to $% for gas. You can lower it, but not raise it.', old.gas_per_rider using errcode = 'P0001';
    end if;
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

/** Everything the edit form needs, for the driver only. */
create function public.ride_for_edit(p_ride_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'resort_id', r.resort_id, 'trip_type', r.trip_type, 'depart_at', r.depart_at, 'return_at', r.return_at,
    'return_meet', r.return_meet, 'leave_from', r.leave_from, 'seats_total', r.seats_total, 'gas_per_rider', r.gas_per_rider,
    'gear', r.gear, 'notes', r.notes, 'contact', r.contact, 'ride_date', r.ride_date,
    'riders', (select count(*) from public.ride_seats s where s.ride_id = r.id),
    'seats_taken_to', (select count(*) from public.ride_seats s where s.ride_id = r.id and 'to' = any (public.seat_legs(r.trip_type, s.legs))),
    'seats_taken_from', (select count(*) from public.ride_seats s where s.ride_id = r.id and 'from' = any (public.seat_legs(r.trip_type, s.legs)))
  )
  from public.rides r
  where r.id = p_ride_id and r.driver_id = auth.uid() and r.cancelled_at is null;
$$;

revoke execute on function public.ride_for_edit(uuid) from public, anon;
grant execute on function public.ride_for_edit(uuid) to authenticated;

------------------------------------------------------------------------------
-- Telling riders. A change posts an "update" line in the ride chat and is
-- pushed to everyone booked. A new time resets that leg's reminders so they
-- go out on the new schedule.
------------------------------------------------------------------------------
alter table public.ride_messages
  add column kind text not null default 'chat' check (kind in ('chat', 'update')),
  add column pushed_at timestamptz;
-- People still only insert (ride_id, body), so their messages are always 'chat'.

create function public.announce_ride_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text;
  v_parts text[] := '{}';
  v_body text;
  fmt constant text := 'FMHH12:MI AM';
begin
  if not exists (select 1 from public.ride_seats where ride_id = new.id) then
    return null;
  end if;

  select coalesce(nullif(split_part(trim(full_name), ' ', 1), ''), 'Your driver') into v_first
  from public.profiles where id = new.driver_id;

  if new.cancelled_at is not null and old.cancelled_at is null then
    v_body := v_first || ' cancelled this ride.';
  elsif new.cancelled_at is null then
    if new.depart_at is distinct from old.depart_at then
      v_parts := array_append(v_parts,
        (case when new.trip_type = 'from_mountain' then 'leaves the mountain at ' else 'leaves at ' end) ||
        to_char(new.depart_at at time zone 'America/Denver', fmt) ||
        ' (was ' || to_char(old.depart_at at time zone 'America/Denver', fmt) || ')');
    end if;
    if new.return_at is distinct from old.return_at and new.return_at is not null then
      v_parts := array_append(v_parts, 'heads back at ' || to_char(new.return_at at time zone 'America/Denver', fmt) ||
        coalesce(' (was ' || to_char(old.return_at at time zone 'America/Denver', fmt) || ')', ''));
    end if;
    if new.leave_from is distinct from old.leave_from then
      v_parts := array_append(v_parts, 'meet at ' || new.leave_from);
    end if;
    if new.return_meet is distinct from old.return_meet and new.return_meet <> '' then
      v_parts := array_append(v_parts, 'the ride back meets at ' || new.return_meet);
    end if;
    if new.gas_per_rider is distinct from old.gas_per_rider then
      v_parts := array_append(v_parts, case when new.gas_per_rider = 0 then 'the ride is now free'
        else 'gas is now $' || new.gas_per_rider || ' (was $' || old.gas_per_rider || ')' end);
    end if;
    if new.seats_total is distinct from old.seats_total then
      v_parts := array_append(v_parts, new.seats_total || ' seat' || case when new.seats_total = 1 then '' else 's' end || ' total');
    end if;
    if new.gear is distinct from old.gear then
      v_parts := array_append(v_parts, 'gear: ' || new.gear);
    end if;
    if new.contact is distinct from old.contact then
      v_parts := array_append(v_parts, 'new contact: ' || new.contact);
    end if;
    if new.notes is distinct from old.notes then
      v_parts := array_append(v_parts, 'updated the notes');
    end if;
    if cardinality(v_parts) > 0 then
      v_body := v_first || ' changed the ride: ' || array_to_string(v_parts, ', ') || '.';
    end if;
  end if;

  if v_body is not null then
    insert into public.ride_messages (ride_id, sender_id, body, kind)
    values (new.id, new.driver_id, left(v_body, 1000), 'update');
  end if;

  -- New times: send that leg's reminders again on the new schedule.
  if new.depart_at is distinct from old.depart_at then
    delete from public.ride_notifications_sent
    where ride_id = new.id and leg = case when new.trip_type = 'from_mountain' then 'from' else 'to' end;
  end if;
  if new.return_at is distinct from old.return_at then
    delete from public.ride_notifications_sent where ride_id = new.id and leg = 'from';
  end if;
  return null;
end;
$$;

revoke execute on function public.announce_ride_changes() from public, anon, authenticated;

create trigger rides_announce_changes
  after update on public.rides
  for each row execute function public.announce_ride_changes();

/**
 * Pushes due now: the ride-day reminders, plus "Ride updated" and "Ride
 * cancelled" for anyone booked when the driver changes a ride. Same shape
 * as before, so send-ride-reminders doesn't change.
 */
alter function public.claim_due_notifications() rename to claim_due_reminders;

create function public.claim_due_notifications()
returns table (user_id uuid, kind text, ride_id uuid, leg text, leg_at timestamptz, title text, body text, tokens text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query select * from public.claim_due_reminders();

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
         coalesce((select array_agg(t.token) from public.push_tokens t where t.user_id = s.rider_id), '{}')
  from changed c
  join public.rides r on r.id = c.ride_id
  join public.ride_seats s on s.ride_id = c.ride_id;
end;
$$;

revoke execute on function public.claim_due_notifications() from public, anon, authenticated;
grant execute on function public.claim_due_notifications() to service_role;
