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
