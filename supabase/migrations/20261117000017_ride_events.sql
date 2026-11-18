-- Rides can be posted to a club event.
--
-- * rides.event_id is optional. Only a community ride can point at an event, and
--   only at an event from that same community, on a day the event covers.
-- * A ride that stops fitting its event (the ride or the event moved, or the event
--   was cancelled) is quietly unlinked. The ride itself is never touched or blocked.
-- * Days are Denver days, same as the events.

alter table public.rides add column event_id uuid references public.community_events (id) on delete set null;
create index rides_event_idx on public.rides (event_id) where event_id is not null;

grant select (event_id) on public.rides to authenticated;
grant insert (event_id) on public.rides to authenticated;
grant update (event_id) on public.rides to authenticated;

-- Does this event cover this ride? (Not cancelled, same community, ride's Denver day inside the event.)
create function public.enforce_ride_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.community_events;
  v_day date := (new.depart_at at time zone 'America/Denver')::date;
  v_fits boolean;
  v_new boolean := tg_op = 'INSERT' or new.event_id is distinct from old.event_id;
begin
  if new.event_id is null then
    return new;
  end if;
  if v_new and new.community_id is null then
    raise exception 'Only community rides can be for an event.' using errcode = 'P0001';
  end if;
  select * into v_event from public.community_events where id = new.event_id;
  v_fits := found and v_event.community_id is not distinct from new.community_id
            and v_event.cancelled_at is null
            and public.event_days(v_event.starts_at, v_event.ends_at, v_event.all_day) @> v_day;
  if v_fits then
    return new;
  end if;
  if not v_new then
    new.event_id := null; -- the ride or its event moved on
    return new;
  end if;
  if v_event.id is null or v_event.community_id is distinct from new.community_id then
    raise exception 'Pick an event from this ride''s community.' using errcode = 'P0001';
  end if;
  if v_event.cancelled_at is not null then
    raise exception 'This event was cancelled.' using errcode = 'P0001';
  end if;
  raise exception 'That event isn''t on this ride''s day.' using errcode = 'P0001';
end;
$$;

create trigger rides_event before insert or update of event_id, depart_at, community_id on public.rides
  for each row execute function public.enforce_ride_event();

-- Unlink rides that no longer fit their event (it moved, or it was cancelled).
create function public.release_event_rides(p_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.rides r set event_id = null
  from public.community_events e
  where e.id = p_event_id and r.event_id = e.id
    and (e.cancelled_at is not null
         or not (public.event_days(e.starts_at, e.ends_at, e.all_day) @> r.ride_date));
$$;

revoke execute on function public.enforce_ride_event() from public, anon, authenticated;
revoke execute on function public.release_event_rides(uuid) from public, anon, authenticated;

-- Events now count their rides.
create or replace function public.community_events(p_community_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_community_member(p_community_id) then
    raise exception 'You''re not in this community. Ask a member for its code.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'community_id', e.community_id, 'title', e.title, 'description', e.description,
      'location', e.location, 'resort_id', e.resort_id, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
      'all_day', e.all_day, 'source', e.source,
      'going', (select count(*) from public.community_event_rsvps r where r.event_id = e.id),
      'i_am_in', exists (select 1 from public.community_event_rsvps r where r.event_id = e.id and r.user_id = v_uid),
      'going_people', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'avatar_path', x.avatar_path, 'gender', x.gender)
                         order by x.rsvp_at)
        from (
          select p.id, p.full_name, p.avatar_path, p.gender, r.created_at as rsvp_at
          from public.community_event_rsvps r
          join public.profiles p on p.id = r.user_id
          where r.event_id = e.id and not public.is_blocked_between(v_uid, r.user_id)
          order by r.created_at
          limit 4
        ) x
      ), '[]'::jsonb),
      'ride_count', (select count(*) from public.rides r
                     where r.event_id = e.id and r.cancelled_at is null and coalesce(r.return_at, r.depart_at) > now())
    ) order by e.starts_at, e.id)
    from public.community_events e
    where e.community_id = p_community_id
      and e.cancelled_at is null
      and public.event_days(e.starts_at, e.ends_at, e.all_day) && daterange(p_from, p_to, '[]')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.update_community_event(
  p_event_id uuid, p_title text, p_description text, p_location text, p_resort_id text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_all_day boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.community_events;
begin
  select * into e from public.community_events where id = p_event_id;
  if not found or not public.is_community_admin(e.community_id) then
    raise exception 'Only community admins can change events.' using errcode = '42501';
  end if;
  if e.source = 'ics' then
    raise exception 'This event comes from the club calendar. Change it there.' using errcode = 'P0001';
  end if;
  if e.cancelled_at is not null then
    raise exception 'This event was cancelled.' using errcode = 'P0001';
  end if;
  perform public.check_event_fields(p_title, p_description, p_location, p_resort_id, p_starts_at, p_ends_at);
  update public.community_events
     set title = btrim(p_title), description = coalesce(p_description, ''), location = coalesce(p_location, ''),
         resort_id = p_resort_id, starts_at = p_starts_at, ends_at = p_ends_at,
         all_day = coalesce(p_all_day, false), updated_at = now()
   where id = p_event_id;
  perform public.release_event_rides(p_event_id);
end;
$$;

create or replace function public.cancel_community_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.community_events;
begin
  select * into e from public.community_events where id = p_event_id;
  if not found or not public.is_community_admin(e.community_id) then
    raise exception 'Only community admins can cancel events.' using errcode = '42501';
  end if;
  if e.source = 'ics' then
    raise exception 'This event comes from the club calendar. Change it there.' using errcode = 'P0001';
  end if;
  update public.community_events set cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
   where id = p_event_id;
  perform public.release_event_rides(p_event_id);
end;
$$;

revoke execute on function public.community_events(uuid, date, date) from public, anon;
grant execute on function public.community_events(uuid, date, date) to authenticated;
revoke execute on function public.update_community_event(uuid, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.update_community_event(uuid, text, text, text, text, timestamptz, timestamptz, boolean) to authenticated;
revoke execute on function public.cancel_community_event(uuid) from public, anon;
grant execute on function public.cancel_community_event(uuid) to authenticated;

-- The driver's edit view and the board show the event.
create or replace function public.ride_for_edit(p_ride_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'resort_id', r.resort_id, 'trip_type', r.trip_type, 'depart_at', r.depart_at, 'return_at', r.return_at,
    'return_meet', r.return_meet, 'leave_from', r.leave_from, 'seats_total', r.seats_total, 'gas_per_rider', r.gas_per_rider,
    'gear', r.gear, 'notes', r.notes, 'contact', r.contact, 'ride_date', r.ride_date, 'community_id', r.community_id, 'event_id', r.event_id,
    'riders', (select count(*) from public.ride_seats s where s.ride_id = r.id),
    'seats_taken_to', (select count(*) from public.ride_seats s where s.ride_id = r.id and 'to' = any (public.seat_legs(r.trip_type, s.legs))),
    'seats_taken_from', (select count(*) from public.ride_seats s where s.ride_id = r.id and 'from' = any (public.seat_legs(r.trip_type, s.legs)))
  )
  from public.rides r
  where r.id = p_ride_id and r.driver_id = auth.uid() and r.cancelled_at is null;
$$;


-- Two new columns at the end: event_id and event_title.
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
  s.my_legs as my_seat_legs,
  r.event_id,
  ev.title as event_title
from public.rides r
join public.profiles p on p.id = r.driver_id
left join public.communities c on c.id = r.community_id
left join public.community_events ev on ev.id = r.event_id
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

-- Unlinking a ride from its event (event moved or cancelled) must never be blocked
-- or announced: an update whose only change is event_id going to null skips the
-- ride rules, the driver checks and the "ride changed" chat line. Each function is
-- the latest earlier definition plus that one early return.
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
  -- Unlinking a ride from its event changes nothing else, so it skips every check.
  if tg_op = 'UPDATE' and new.event_id is null and old.event_id is not null
     and to_jsonb(new) - 'event_id' = to_jsonb(old) - 'event_id' then
    return new;
  end if;
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

create or replace function public.enforce_verified_driver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Unlinking a ride from its event changes nothing else, so it skips every check.
  if tg_op = 'UPDATE' and new.event_id is null and old.event_id is not null
     and to_jsonb(new) - 'event_id' = to_jsonb(old) - 'event_id' then
    return new;
  end if;
  if new.cancelled_at is not null then
    return new;
  end if;
  if not public.is_profile_ready(new.driver_id) then
    raise exception 'Set up your profile first: a verified selfie, a few details and your interests. It takes about two minutes.'
      using errcode = 'P0001';
  end if;
  if not public.is_verified_driver(new.driver_id) then
    raise exception 'Add your insurance card before hosting. It takes about a minute in Account → Driver verification.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.announce_ride_changes()
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
  -- Unlinking a ride from its event changes nothing else, so it skips every check.
  if tg_op = 'UPDATE' and new.event_id is null and old.event_id is not null
     and to_jsonb(new) - 'event_id' = to_jsonb(old) - 'event_id' then
    return null;
  end if;
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
