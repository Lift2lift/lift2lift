-- Communities: clubs (CU Freeride, CU Freeski, ...) get a private group with
-- its own rides. You get in with a 9-character community code.
--
-- * Codes are handed out by Lift2Lift. Only a slow bcrypt hash of each code is
--   stored here, so the codes themselves are not in this repo and can't be
--   recovered from it by guessing (see community_code_hash below).
-- * The first person to enter a brand-new code names the community and
--   becomes its admin. A code that already has a name (CU Freeride and
--   CU Freeski below) makes the first person in its admin.
-- * A ride posted to a community is seen and booked only by its members (and
--   by the driver and anyone already booked). Everything else about rides,
--   including Colorado's carpool rules, is unchanged.
-- * Ten wrong codes in an hour locks code entry for that person for the hour.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  -- The code in plain text, filled in once someone uses it, so members can share it.
  code text,
  name text check (name is null or char_length(name) between 2 and 40),
  description text not null default '' check (char_length(description) <= 280),
  created_at timestamptz not null default now(),
  set_up_at timestamptz
);

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index community_members_user_idx on public.community_members (user_id);

create table public.community_code_attempts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);

create index community_code_attempts_idx on public.community_code_attempts (user_id, at);

alter table public.rides add column community_id uuid references public.communities (id) on delete restrict;
create index rides_community_idx on public.rides (community_id) where community_id is not null;

grant select (community_id) on public.rides to authenticated;
grant insert (community_id) on public.rides to authenticated;
grant update (community_id) on public.rides to authenticated;

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
-- Codes are compared without spaces or dashes, in capitals.
--
-- The hash is bcrypt at cost 12 with one fixed salt. A fixed salt keeps it
-- deterministic, so a code can still be looked up by its hash, and each guess
-- costs about 0.2 seconds. This repo is public, so the shipped hashes are too:
-- a fast hash (like SHA-256) of a 9-character code could be cracked on one
-- graphics card in minutes, while bcrypt at cost 12 would take centuries.
create function public.community_code_hash(p_code text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select extensions.crypt(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), '$2a$12$9tMiPfwSsueWwymDksShIe');
$fn$;

create function public.is_community_member(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = auth.uid()
  );
$$;

create function public.is_community_admin(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Who can see a ride: everyone for an open ride; for a community ride, its
-- members, the driver, and anyone booked on it (even after leaving the community).
create function public.can_see_ride(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rides r
    where r.id = p_ride_id
      and (
        r.community_id is null
        or r.driver_id = auth.uid()
        or public.is_community_member(r.community_id)
        or exists (select 1 from public.ride_seats s where s.ride_id = r.id and s.rider_id = auth.uid())
      )
  );
$$;

-- Booked on this ride (kept separate so the rides and seats policies don't call each other).
create function public.is_on_ride(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = auth.uid());
$$;

-- A new 9-character code from the same 31 symbols (no 0/O or 1/I/L), using
-- the database's strong random source (gen_random_uuid).
create function public.new_community_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_byte int;
  v_code text;
begin
  loop
    v_code := '';
    while char_length(v_code) < 9 loop
      v_bytes := uuid_send(gen_random_uuid());
      for i in 0..15 loop
        continue when i in (6, 8); -- UUID version and variant bits aren't random
        v_byte := get_byte(v_bytes, i);
        continue when v_byte >= 248; -- 248 = 31 * 8, so every symbol is equally likely
        v_code := v_code || substr(v_alpha, (v_byte % 31) + 1, 1);
        exit when char_length(v_code) = 9;
      end loop;
    end loop;
    exit when not exists (select 1 from public.communities where code_hash = public.community_code_hash(v_code));
  end loop;
  return v_code;
end;
$$;

revoke execute on function public.is_community_member(uuid) from public, anon;
grant execute on function public.is_community_member(uuid) to authenticated;
revoke execute on function public.is_community_admin(uuid) from public, anon;
grant execute on function public.is_community_admin(uuid) to authenticated;
revoke execute on function public.is_on_ride(uuid) from public, anon;
grant execute on function public.is_on_ride(uuid) to authenticated;
revoke execute on function public.can_see_ride(uuid) from public, anon;
grant execute on function public.can_see_ride(uuid) to authenticated;
revoke execute on function public.new_community_code() from public, anon, authenticated;

------------------------------------------------------------------------------
-- Privacy: members see their communities; community rides only reach members.
------------------------------------------------------------------------------
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_code_attempts enable row level security;

create policy "Members see their communities"
  on public.communities for select to authenticated
  using (public.is_community_member(id));

create policy "Members see who's in their communities"
  on public.community_members for select to authenticated
  using (public.is_community_member(community_id));

revoke all on public.communities from anon, authenticated;
grant select (id, name, description, code, created_at) on public.communities to authenticated;
revoke all on public.community_members from anon, authenticated;
grant select on public.community_members to authenticated;
revoke all on public.community_code_attempts from anon, authenticated;

drop policy "Signed-in users can see rides" on public.rides;
-- Uses the row's own columns (not a lookup by id), so a driver's just-posted ride passes too.
create policy "Signed-in users can see open rides and their communities' rides"
  on public.rides for select to authenticated
  using (
    community_id is null
    or driver_id = (select auth.uid())
    or public.is_community_member(community_id)
    or public.is_on_ride(id)
  );

drop policy "Signed-in users can see seats" on public.ride_seats;
create policy "Signed-in users can see seats on rides they can see"
  on public.ride_seats for select to authenticated
  using (public.can_see_ride(ride_id));

------------------------------------------------------------------------------
-- Posting and booking
------------------------------------------------------------------------------
create function public.enforce_ride_community()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.community_id is not null and (tg_op = 'INSERT' or new.community_id is distinct from old.community_id) then
    if not exists (select 1 from public.community_members where community_id = new.community_id and user_id = new.driver_id) then
      raise exception 'You can only post rides to communities you''re in.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.community_id is distinct from old.community_id
     and exists (select 1 from public.ride_seats where ride_id = new.id) then
    raise exception 'Riders already booked this trip, so who can see it can''t change.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger rides_community before insert or update of community_id on public.rides
  for each row execute function public.enforce_ride_community();

create or replace function public.claim_seat(p_ride_id uuid, p_legs text default 'both', p_notice_ack boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to claim a seat.' using errcode = '28000';
  end if;
  if not coalesce(p_notice_ack, false) then
    raise exception 'Read and acknowledge the Colorado carpool notice to book a seat.' using errcode = 'P0001';
  end if;

  -- Community rides are for that community's members.
  select r.community_id, c.name into v_community, v_name
  from public.rides r left join public.communities c on c.id = r.community_id
  where r.id = p_ride_id;
  if v_community is not null and not public.is_community_member(v_community)
     and not exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = auth.uid()) then
    raise exception 'This ride is only for members of %.', coalesce(v_name, 'a community') using errcode = 'P0001';
  end if;

  perform public.claim_seat_rules(p_ride_id, p_legs);

  -- Booking again on a ride you're already on is a no-op, so only stamp a seat that has no acknowledgment yet.
  update public.ride_seats
  set notice_ack_at = now()
  where ride_id = p_ride_id and rider_id = auth.uid() and notice_ack_at is null;
end;
$$;

-- Editing: the driver sees which community a ride is posted to.
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
    'gear', r.gear, 'notes', r.notes, 'contact', r.contact, 'ride_date', r.ride_date, 'community_id', r.community_id,
    'riders', (select count(*) from public.ride_seats s where s.ride_id = r.id),
    'seats_taken_to', (select count(*) from public.ride_seats s where s.ride_id = r.id and 'to' = any (public.seat_legs(r.trip_type, s.legs))),
    'seats_taken_from', (select count(*) from public.ride_seats s where s.ride_id = r.id and 'from' = any (public.seat_legs(r.trip_type, s.legs)))
  )
  from public.rides r
  where r.id = p_ride_id and r.driver_id = auth.uid() and r.cancelled_at is null;
$$;

-- Profiles list a driver's upcoming rides: leave out community rides the viewer can't see.
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
                    where s.rider_id = p.id and r.cancelled_at is null and r.depart_at < now()),
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

------------------------------------------------------------------------------
-- The board shows which community a ride belongs to.
------------------------------------------------------------------------------
create or replace view public.ride_board
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
  coalesce(s.rider_legs, '{}') as rider_legs,
  r.community_id,
  c.name as community_name
from public.rides r
join public.profiles p on p.id = r.driver_id
left join public.communities c on c.id = r.community_id
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

------------------------------------------------------------------------------
-- Joining, setting up, leaving
------------------------------------------------------------------------------
-- Enter a code. Returns {status}: 'joined' (with id, name, role), 'already'
-- (with id, name), 'needs_setup' (a brand-new code: call setup_community), or
-- 'not_found'. Wrong codes are counted (not raised) so the limit sticks.
create function public.join_community(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_c public.communities;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Sign in to join a community.' using errcode = '28000';
  end if;
  if char_length(v_norm) <> 9 then
    raise exception 'Community codes are 9 characters.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.community_code_attempts where user_id = v_uid and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes. Wait an hour and try again.' using errcode = 'P0001';
  end if;

  select * into v_c from public.communities where code_hash = public.community_code_hash(v_norm) for update;
  if not found then
    insert into public.community_code_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'not_found');
  end if;

  if exists (select 1 from public.community_members where community_id = v_c.id and user_id = v_uid) then
    return jsonb_build_object('status', 'already', 'id', v_c.id, 'name', v_c.name);
  end if;

  if v_c.name is null then
    return jsonb_build_object('status', 'needs_setup');
  end if;

  -- No admin yet (a named code nobody has used, or everyone left): the first person in runs it.
  v_role := case when exists (select 1 from public.community_members where community_id = v_c.id and role = 'admin')
                 then 'member' else 'admin' end;
  insert into public.community_members (community_id, user_id, role) values (v_c.id, v_uid, v_role);
  update public.communities set code = coalesce(code, v_norm), set_up_at = coalesce(set_up_at, now()) where id = v_c.id;

  return jsonb_build_object('status', 'joined', 'id', v_c.id, 'name', v_c.name, 'role', v_role);
end;
$$;

-- A brand-new code: name the community and become its admin.
create function public.setup_community(p_code text, p_name text, p_description text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_desc text := trim(coalesce(p_description, ''));
  v_c public.communities;
begin
  if v_uid is null then
    raise exception 'Sign in to set up a community.' using errcode = '28000';
  end if;
  if (select count(*) from public.community_code_attempts where user_id = v_uid and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes. Wait an hour and try again.' using errcode = 'P0001';
  end if;
  select * into v_c from public.communities where code_hash = public.community_code_hash(v_norm) for update;
  if not found then
    insert into public.community_code_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_c.name is not null then
    raise exception 'This community is already set up. Enter the code to join it.' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 2 and 40 then
    raise exception 'Give the community a name between 2 and 40 characters.' using errcode = 'P0001';
  end if;
  if char_length(v_desc) > 280 then
    raise exception 'Keep the description under 280 characters.' using errcode = 'P0001';
  end if;
  if public.has_blocked_term(v_name) or public.has_blocked_term(v_desc) then
    raise exception 'That includes language that isn''t allowed on Lift2Lift. Please reword it.' using errcode = 'P0001';
  end if;

  update public.communities set name = v_name, description = v_desc, code = v_norm, set_up_at = now() where id = v_c.id;
  insert into public.community_members (community_id, user_id, role) values (v_c.id, v_uid, 'admin');
  return jsonb_build_object('status', 'joined', 'id', v_c.id, 'name', v_name, 'role', 'admin');
end;
$$;

-- The communities you're in, for the Communities tab.
create function public.my_communities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'code', c.code, 'role', m.role,
    'member_count', (select count(*) from public.community_members x where x.community_id = c.id),
    'upcoming_rides', (select count(*) from public.rides r
                       where r.community_id = c.id and r.cancelled_at is null and coalesce(r.return_at, r.depart_at) > now())
  ) order by c.name), '[]'::jsonb)
  from public.community_members m
  join public.communities c on c.id = m.community_id
  where m.user_id = auth.uid();
$$;

-- One community's page: details and members (admins first). Members only.
create function public.community_page(p_community_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.is_community_member(p_community_id) then
    raise exception 'You''re not in this community. Ask a member for its code.' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'code', c.code,
    'my_role', (select role from public.community_members where community_id = c.id and user_id = auth.uid()),
    'member_count', (select count(*) from public.community_members x where x.community_id = c.id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_path', p.avatar_path,
                                          'gender', p.gender, 'role', m.role, 'joined_at', m.joined_at)
                       order by (m.role = 'admin') desc, m.joined_at)
      from public.community_members m
      join public.profiles p on p.id = m.user_id
      where m.community_id = c.id
        and (p.id = auth.uid() or not public.is_blocked_between(auth.uid(), p.id))
    ), '[]'::jsonb)
  ) into v_out
  from public.communities c
  where c.id = p_community_id;
  return v_out;
end;
$$;

create function public.leave_community(p_community_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.community_members where community_id = p_community_id and user_id = auth.uid();
$$;

-- When the last admin leaves (or deletes their account), the longest-standing member takes over.
create function public.keep_a_community_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and not exists (select 1 from public.community_members where community_id = old.community_id and role = 'admin') then
    update public.community_members set role = 'admin'
    where (community_id, user_id) = (
      select community_id, user_id from public.community_members
      where community_id = old.community_id
      order by joined_at, user_id
      limit 1
    );
  end if;
  return null;
end;
$$;

create trigger community_members_keep_admin after delete on public.community_members
  for each row execute function public.keep_a_community_admin();

------------------------------------------------------------------------------
-- Admin tools
------------------------------------------------------------------------------
create function public.update_community(p_community_id uuid, p_name text, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_desc text := trim(coalesce(p_description, ''));
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only the community''s admins can change it.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 40 then
    raise exception 'Give the community a name between 2 and 40 characters.' using errcode = 'P0001';
  end if;
  if char_length(v_desc) > 280 then
    raise exception 'Keep the description under 280 characters.' using errcode = 'P0001';
  end if;
  if public.has_blocked_term(v_name) or public.has_blocked_term(v_desc) then
    raise exception 'That includes language that isn''t allowed on Lift2Lift. Please reword it.' using errcode = 'P0001';
  end if;
  update public.communities set name = v_name, description = v_desc where id = p_community_id;
end;
$$;

create function public.remove_community_member(p_community_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only the community''s admins can remove people.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'To leave, use Leave community.' using errcode = 'P0001';
  end if;
  delete from public.community_members where community_id = p_community_id and user_id = p_user_id;
end;
$$;

create function public.set_community_role(p_community_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only the community''s admins can change roles.' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Role has to be admin or member.' using errcode = '22023';
  end if;
  if p_role = 'member' and p_user_id = auth.uid()
     and not exists (select 1 from public.community_members
                     where community_id = p_community_id and role = 'admin' and user_id <> auth.uid()) then
    raise exception 'Make someone else an admin first.' using errcode = 'P0001';
  end if;
  update public.community_members set role = p_role where community_id = p_community_id and user_id = p_user_id;
end;
$$;

-- A leaked code: make a new one. The old code stops working right away.
create function public.reset_community_code(p_community_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only the community''s admins can change the code.' using errcode = '42501';
  end if;
  v_code := public.new_community_code();
  update public.communities set code_hash = public.community_code_hash(v_code), code = v_code where id = p_community_id;
  return v_code;
end;
$$;

revoke execute on function public.join_community(text) from public, anon;
grant execute on function public.join_community(text) to authenticated;
revoke execute on function public.setup_community(text, text, text) from public, anon;
grant execute on function public.setup_community(text, text, text) to authenticated;
revoke execute on function public.my_communities() from public, anon;
grant execute on function public.my_communities() to authenticated;
revoke execute on function public.community_page(uuid) from public, anon;
grant execute on function public.community_page(uuid) to authenticated;
revoke execute on function public.leave_community(uuid) from public, anon;
grant execute on function public.leave_community(uuid) to authenticated;
revoke execute on function public.update_community(uuid, text, text) from public, anon;
grant execute on function public.update_community(uuid, text, text) to authenticated;
revoke execute on function public.remove_community_member(uuid, uuid) from public, anon;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated;
revoke execute on function public.set_community_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_community_role(uuid, uuid, text) to authenticated;
revoke execute on function public.reset_community_code(uuid) from public, anon;
grant execute on function public.reset_community_code(uuid) to authenticated;
revoke execute on function public.keep_a_community_admin() from public, anon, authenticated;
revoke execute on function public.enforce_ride_community() from public, anon, authenticated;

------------------------------------------------------------------------------
-- The first 50 codes (bcrypt hashes only). CU Freeride and CU Freeski are named;
-- the first person to enter each becomes its admin.
------------------------------------------------------------------------------
insert into public.communities (code_hash, name) values
  ('$2a$12$9tMiPfwSsueWwymDksShIehdSkrd./U8wwgOyQwxZRHpIE44JqqIO', 'CU Freeride'),
  ('$2a$12$9tMiPfwSsueWwymDksShIejeZQObIoObB8lsgQSzhBQSxUiH7rqw2', 'CU Freeski'),
  ('$2a$12$9tMiPfwSsueWwymDksShIecM.mnhzT976ADmrBL1cbcDEneEuTN9q', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeCgAO5O1p57P90o9UjmE.J8IakriejFC', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeACVqxTe2Z6Q46VIa07UuZWAHooqDbiu', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe7AhcQVkpMMz2yDH27F9qK67j0oc6qSe', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe.HSlwH7gXVI8GMd7SiAWQnmh1A88dUe', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIedfHCnTESN9g34IpnvtNf3mdRdVTaGnK', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeaI2Sl3qid2sn8dE7dIh6WkL1o5j.mxe', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeUsXn1I6NkfpyzjWfGb5SgY.85mKKC.C', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe.tJbzqCHJ5HAsfmHd821Cgb5DqNwvrC', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeuhqTQuBSPrtS1PSIy0H3ec/4cjvXPam', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeXaEbnC9kr5iLaYHh8rnQ0Bn1/Qh1Pbe', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeWgV8zsoS8lDc8lupv9lGAS4QK/ioxBW', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeneshCDOvIG7RzSJlY67rtcm.OBtj4qW', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeSQ1nZ1W7LtWtax9MGRHe3EY92G5ThOu', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeGIuzz.N9qXk2FA4BxU2yZ6BwL4FNNDG', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeEDLZjyUlC94sP994yLgrlLu6/6Fcclu', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIep9BqzzCF/.C28O7Ju0Dv910XxcbkFCW', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeojEGtFtVO08HVxLMDSc4lbinsH1b.hG', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe8ksoh18gZUQ24tlgNOKbWB2OL1XEEXa', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe8KLMeWtQ457XT1JBRBO4A0b8mex61j2', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeetZYTcjVAuZuvvmh8C2RWfQDfgQ7H7K', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeffgN652XxNf2vVKDPP8Xg9c5j28hM5e', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeVBg7l2CN2VGqZyAGhYdWIQ.1KKAdQnu', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeWgJtzPqvwQCII7NPs9VFNfvHgZI4II2', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeA/TuNXiOE1c/LrAg/jsUzHJdg7h1tP.', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe6qxy7pAymtAgcr2xfxsqSnxd54GFnzC', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeHKMEKKdCKkpeTsgkIXmKGtIN6x0rp9e', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe3BLQFWRGeiMw.95SY39FtcJRmmJdDPq', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeJkaQi6o9EaDA2Qeg2dgqU7fx3LUC4YK', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeqKcJpob9f2MRv2gyJMHU.3Vhu9J9Wxm', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeOLJY9Y.ndf4qx7LfJ6CZPNzPNqXla9y', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe6/kji9DU3zZAQXJci8E6tJyiLCsZuvu', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe9PA6adIAp64kSezfD5r/7kb6EEzrCda', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe3cCWZSsEHLOptbC7hPbAutquoglQ9eu', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeAXsW59QX.g/Wj2p0zDtqHPpRWxoqSDy', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe05zfVhC9vGApMo9Se4ovaIR1UBmdcLS', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe1aeYKs9SkDidHCEhwCpxBFWkurKYGEW', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeUMoSEMORksXoNvwpqfOWo0YcMVNQOMW', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeIBiUxwr.z4pjY1WKuQtQaSwOG13Tg/a', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe.N4QQZjZJN3jQQGuW5Qh//pQtc.viPe', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeoalCCVmykIl5dviH6dlp9HZMFSKmYU2', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIedovkUT02M//w9w3P6dTB4R3qoC7O49e', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe8tbAW58I65BWkvfmh/hFvnLMYklZItu', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeInxsbdZekCt8o/Oe04iGgbkh.wz.MIK', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIeNTDy3r3JgJhD4ce359.HfOGYd5tsfjO', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe/JBNMzgjMqyHP5Yp3jfn.qzplTtD1MS', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe1pO9GtTuA5DljXv4jtkMgsP5K.M6Jgi', null),
  ('$2a$12$9tMiPfwSsueWwymDksShIe./ViLljwn0pdI3TVPDmUaTQIJAHYAcq', null);
