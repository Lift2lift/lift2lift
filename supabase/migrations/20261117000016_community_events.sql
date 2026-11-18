-- Community events: club events with RSVPs.
--
-- * Admins make, change and cancel events; every member sees them and says
--   they're going. Outsiders see nothing.
-- * Events from a club calendar (source 'ics') are changed only on that
--   calendar, never here. A later migration adds the import.
-- * Days are Denver days, so an event at 11 pm is on that day for everyone.
-- * All writes go through the functions below. The tables are read-only.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
create table public.community_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  location text not null default '' check (char_length(location) <= 120),
  resort_id text references public.resorts (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'ics')),
  ics_uid text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at >= starts_at),
  unique (community_id, ics_uid)
);

create index community_events_community_idx on public.community_events (community_id, starts_at);

create table public.community_event_rsvps (
  event_id uuid not null references public.community_events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index community_event_rsvps_user_idx on public.community_event_rsvps (user_id);

alter table public.community_events enable row level security;
alter table public.community_event_rsvps enable row level security;
revoke all on public.community_events from anon, authenticated;
revoke all on public.community_event_rsvps from anon, authenticated;
grant select on public.community_events to authenticated;
grant select on public.community_event_rsvps to authenticated;

create policy "Members read their community's events"
  on public.community_events for select to authenticated
  using (public.is_community_member(community_id));

create policy "Members read their community's RSVPs"
  on public.community_event_rsvps for select to authenticated
  using (exists (
    select 1 from public.community_events e
    where e.id = event_id and public.is_community_member(e.community_id)
  ));

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
-- The Denver days an event covers, first and last day included.
-- An event that ends exactly at midnight doesn't count the new day.
create function public.event_days(p_starts timestamptz, p_ends timestamptz, p_all_day boolean)
returns daterange
language sql
immutable
set search_path = ''
as $$
  select daterange(
    (p_starts at time zone 'America/Denver')::date,
    case
      when not p_all_day and p_ends > p_starts
           and (p_ends at time zone 'America/Denver')::time = time '00:00'
        then ((p_ends at time zone 'America/Denver')::date - 1)
      else (p_ends at time zone 'America/Denver')::date
    end,
    '[]'
  );
$$;

-- Has the event finished? (An all-day event runs to the end of its last day.)
create function public.event_is_over(p_starts timestamptz, p_ends timestamptz, p_all_day boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case when p_all_day
    then upper(public.event_days(p_starts, p_ends, true)) - 1 < (now() at time zone 'America/Denver')::date
    else p_ends < now()
  end;
$$;

revoke execute on function public.event_days(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.event_days(timestamptz, timestamptz, boolean) to authenticated;
revoke execute on function public.event_is_over(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.event_is_over(timestamptz, timestamptz, boolean) to authenticated;

-- Leaving (or being removed from) a community drops that person's RSVPs there.
create function public.drop_event_rsvps_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.community_event_rsvps r
  using public.community_events e
  where e.id = r.event_id and e.community_id = old.community_id and r.user_id = old.user_id;
  return old;
end;
$$;

create trigger community_members_drop_event_rsvps
  after delete on public.community_members
  for each row execute function public.drop_event_rsvps_on_leave();

revoke execute on function public.drop_event_rsvps_on_leave() from public, anon, authenticated;

-- Shared checks for create and update.
create function public.check_event_fields(p_title text, p_description text, p_location text, p_resort_id text,
                                          p_starts_at timestamptz, p_ends_at timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 80 then
    raise exception 'Give the event a title (2 to 80 characters).' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_description, '')) > 1000 then
    raise exception 'The description can be up to 1000 characters.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_location, '')) > 120 then
    raise exception 'The location can be up to 120 characters.' using errcode = 'P0001';
  end if;
  if public.has_blocked_term(p_title) or public.has_blocked_term(p_description) or public.has_blocked_term(p_location) then
    raise exception 'That includes language that isn''t allowed on Lift2Lift. Please reword it.' using errcode = 'P0001';
  end if;
  if p_starts_at is null or p_ends_at is null then
    raise exception 'Pick when the event starts and ends.' using errcode = 'P0001';
  end if;
  if p_ends_at < p_starts_at then
    raise exception 'The event can''t end before it starts.' using errcode = 'P0001';
  end if;
  if p_resort_id is not null and not exists (select 1 from public.resorts where id = p_resort_id) then
    raise exception 'Pick a mountain from the list.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.check_event_fields(text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;

------------------------------------------------------------------------------
-- Reading
------------------------------------------------------------------------------
-- Events that touch any Denver day from p_from to p_to, soonest first.
-- ride_count is 0 until rides can be linked to events.
create function public.community_events(p_community_id uuid, p_from date, p_to date)
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
      'ride_count', 0
    ) order by e.starts_at, e.id)
    from public.community_events e
    where e.community_id = p_community_id
      and e.cancelled_at is null
      and public.event_days(e.starts_at, e.ends_at, e.all_day) && daterange(p_from, p_to, '[]')
  ), '[]'::jsonb);
end;
$$;

------------------------------------------------------------------------------
-- RSVPs
------------------------------------------------------------------------------
create function public.set_event_rsvp(p_event_id uuid, p_going boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  e public.community_events;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select * into e from public.community_events where id = p_event_id;
  if not found or not public.is_community_member(e.community_id) then
    raise exception 'You''re not in this community. Ask a member for its code.' using errcode = 'P0001';
  end if;
  if e.cancelled_at is not null then
    raise exception 'This event was cancelled.' using errcode = 'P0001';
  end if;
  if coalesce(p_going, false) then
    if public.event_is_over(e.starts_at, e.ends_at, e.all_day) then
      raise exception 'This event is over.' using errcode = 'P0001';
    end if;
    insert into public.community_event_rsvps (event_id, user_id) values (p_event_id, v_uid)
    on conflict do nothing;
  else
    delete from public.community_event_rsvps where event_id = p_event_id and user_id = v_uid;
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Admin tools
------------------------------------------------------------------------------
create function public.create_community_event(
  p_community_id uuid, p_title text, p_description text, p_location text, p_resort_id text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_all_day boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only community admins can add events.' using errcode = '42501';
  end if;
  perform public.check_event_fields(p_title, p_description, p_location, p_resort_id, p_starts_at, p_ends_at);
  insert into public.community_events (community_id, title, description, location, resort_id, starts_at, ends_at, all_day, source, created_by)
  values (p_community_id, btrim(p_title), coalesce(p_description, ''), coalesce(p_location, ''), p_resort_id,
          p_starts_at, p_ends_at, coalesce(p_all_day, false), 'manual', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create function public.update_community_event(
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
end;
$$;

create function public.cancel_community_event(p_event_id uuid)
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
end;
$$;

revoke execute on function public.community_events(uuid, date, date) from public, anon;
grant execute on function public.community_events(uuid, date, date) to authenticated;
revoke execute on function public.set_event_rsvp(uuid, boolean) from public, anon;
grant execute on function public.set_event_rsvp(uuid, boolean) to authenticated;
revoke execute on function public.create_community_event(uuid, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.create_community_event(uuid, text, text, text, text, timestamptz, timestamptz, boolean) to authenticated;
revoke execute on function public.update_community_event(uuid, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.update_community_event(uuid, text, text, text, text, timestamptz, timestamptz, boolean) to authenticated;
revoke execute on function public.cancel_community_event(uuid) from public, anon;
grant execute on function public.cancel_community_event(uuid) to authenticated;

------------------------------------------------------------------------------
-- Your communities, now with the next event.
------------------------------------------------------------------------------
create or replace function public.my_communities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description,
    'code', case when m.role = 'admin' then c.code end,
    'role', m.role,
    'listed', c.listed,
    'member_count', (select count(*) from public.community_members x where x.community_id = c.id),
    'upcoming_rides', (select count(*) from public.rides r
                       where r.community_id = c.id and r.cancelled_at is null and coalesce(r.return_at, r.depart_at) > now()),
    'pending_requests', case when m.role = 'admin'
                          then (select count(*) from public.community_join_requests q where q.community_id = c.id and q.status = 'pending')
                          else 0 end,
    'next_event', (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'all_day', e.all_day)
                   from public.community_events e
                   where e.community_id = c.id and e.cancelled_at is null
                     and not public.event_is_over(e.starts_at, e.ends_at, e.all_day)
                   order by e.starts_at, e.id
                   limit 1)
  ) order by c.name), '[]'::jsonb)
  from public.community_members m
  join public.communities c on c.id = m.community_id
  where m.user_id = auth.uid();
$$;
