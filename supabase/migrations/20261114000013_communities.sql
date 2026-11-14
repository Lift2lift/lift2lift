-- Communities: clubs (CU Freeride, CU Freeski, ...) get a private group with
-- its own rides. You get in with a 9-character community code.
--
-- * Codes are handed out by Lift2Lift. Only a SHA-256 hash of each code is
--   stored here, so the codes themselves are not in this repo.
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
create function public.community_code_hash(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex');
$$;

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
-- The first 50 codes (hashes only). CU Freeride and CU Freeski are named;
-- the first person to enter each becomes its admin.
------------------------------------------------------------------------------
insert into public.communities (code_hash, name) values
  ('47f7358402a6796b8fede56bbf797a5d165e351683bb20bcd11d6dd6c6540afd', 'CU Freeride'),
  ('c1f68afbdbbb73c07f670aea558bebfe52732724cd2666539a29ea065a0459c7', 'CU Freeski'),
  ('0759a7a63ec75a68eb52bb82b88afded1f1efd51af4076201fb3c7be65f0e6bf', null),
  ('668df4b5af7d36986987c2ecaa3672de107f4e9f7aa3191f92ad8cf0a249e293', null),
  ('7332093e8b193cae6a407da27abb54d10925aeeeea24126139a36093dabedb16', null),
  ('2a6b634c6389efadbcc62c42e6f1aedfeb6e4396457e108722921bbf0001c14d', null),
  ('4ef51f6559ab37e579a9aaa76a5ad300564132a1f502a6163a76db76c62ef4f2', null),
  ('e0736f8f4be99c8f1c2110575f438572e4a5a74c08fc3e0d7e74620147988f33', null),
  ('d39b3d4d759edef83de4ed47b38f7476a51e28e19a74ce1f128ac7f88ddfc645', null),
  ('e1846bce89a98a2ecfec96c56a1f3213d446b0f844d18887b4beec707ebb35d2', null),
  ('8a9c44e73feea682cbd1e6ae7f08a6bd8def81a551f5c4b3f33e5fdadbde0600', null),
  ('b2b3418236a741b23581b5c05cf4297e95f8de91676a6af78bc583c3a83eeca6', null),
  ('335ebe0cd272c1e277a532fefbe8cb7e06cd7cfba6c2b46e3a065bf8733d9511', null),
  ('f062fd60f9f092b922048385f9c790a9c94370fd426f8eea350dc970f91123d7', null),
  ('18cd54a0bcfde27c41147d775ecbed3b6fb3bd7b0edc5bbb81631b53256d8e2f', null),
  ('bae2bc3ff68aba05b8619a3a46bf0c8d4ecccde1c8839d5d2b3091455bf8a788', null),
  ('0eed097eb2ee8cd2cdf532d64204aaabb26809318534d8a74302f4dbee3d60b0', null),
  ('2c7b0653c22f2fb31229cd64288504ce5ffd3c17d27922435b8a233007f19184', null),
  ('9777d5f7e2ca5c9a0a8fa015f2d301adbfcd05f4aa5b8dc635361c6c98081ed5', null),
  ('bea8251f71314d02e18a1ee757d2d844a40eb363902ebbe3c5635e75ab5ff8bb', null),
  ('79b6014d4bb1f337f40ac92c8712fc513158fba0d0475cf90543ee46209ba2fd', null),
  ('a71db01b78cd82fe41cca0cc56c0fbf7bc001fccc69b54fb437e410c6a264842', null),
  ('298e369dab33c517d52bf5b6473710ccbb515830cbc815f35886a2a8cd2d208a', null),
  ('8dd8cc5c5eccf2b251db8e5b59cd78787088923dd46ea86c342a8c3e191421f4', null),
  ('360b4ba5ad976cd3664d8c3df66829073a8d63e179043a7017d1efb573d99030', null),
  ('79bbefc622c9d88f5bfcecb097ad766554688d3fe1bb2ef336bc0101a6567dcc', null),
  ('4ff3374a52808a203ea174507ea7bcb249628da20101193c2c3b76648e18601b', null),
  ('ad49c422498507bcfe917db028240d6a0d157414b4929ff7ceeeefdfc0bacfbe', null),
  ('faa05af9d8ca2bca9698ce7b800a38ddda593f131a171c8f98f344fdd41aa0ee', null),
  ('1b3d866acdb24ba95fae4e5cc2fcde140d43e2692a1eb940816787a9d3d72f40', null),
  ('c0eb4e71181f5b01ccffb8d33e7846a1e916f2e3fb3242c46636287d60b8a4d1', null),
  ('e648a7ce94ae46ff44236bbc3af82705c16b84b24d79914c7a3728561f875696', null),
  ('a635c188f5c0b15e550da59b40557230b77b9d05dfb6c72c851634d461da2093', null),
  ('1055a88ebf217040b23cfd34cfd083850a327ada3bff980f0f5c24d087518ba3', null),
  ('adb06205c060072c768d683bc9c2ddd03098900cff423a9df414a8e956d1c901', null),
  ('de151e6b0116d59b1d589562925b709e3f09405cb12cf4e281972b96af11bf00', null),
  ('ffd3e76d0a9cb8f92c0e1b087924966bbd720d939f0e0fb2ec49c76dd81b9549', null),
  ('08b155de903c2848e829a3807942424ed29a7425c22f8093d5a8665cf205d333', null),
  ('6d930e8293a1522ebd7a9e4a78f0e84deff083e7596a7bbeee61d732d00c01c9', null),
  ('89955fcb0080897c36624dece2bc0b39740313b6e9d0965ba75dd4dc4fd76542', null),
  ('9ec6315d996aeeefc914ac8f06818693b177b7cb61b01ac6155f99611d646d35', null),
  ('9511df76035a50ec3fa12b486a72b510ac61f32a6e19a8661a05049493487fb6', null),
  ('1831c0650d303a7d4d63ba6806c1d6142b179633e204377e266348f9001672c9', null),
  ('b9166b7fcf8d304dfe99bc170ba50006abb49f10d715110e0a5065a212f7dff5', null),
  ('ba390b77391a3056e22617b13753309f7f74ab1ad3b8e3831fac0902ed8eaf8f', null),
  ('82bfd57a7bbe7958b0dfecdd031722c0ac193303e8cfafbe82aa2bb201f80c07', null),
  ('ca1042c9408e66091bb6290bf2eb24a39cdf7885377bc8880d7c8cde338f5216', null),
  ('b52254b240150a25af57169357c207cc1bba93330ff3494195334bbbc8c400e2', null),
  ('c114b06a0e14f5e5e19b91eec47d5050f1ad1b6e7715762372781c1e424dcf55', null),
  ('f89d47354a0331c8e437b9c78ecdd44a498659b3919cd7a2b0253b285f41ffe8', null);
