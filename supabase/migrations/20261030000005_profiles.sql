-- Profiles for every rider and driver.
--
-- Everyone sets up a profile the first time they post a ride or call shotgun:
--   1. Profile photo = the live selfie from the ID check. Stripe compares that
--      selfie with the license photo, and the webhook saves it as the profile
--      photo, so every profile photo has been matched to a real license.
--      People can't upload their own profile photo.
--   2. About you: gender (shown as a ring around the photo), ski/ride, home
--      mountain, year, hometown, bio, Instagram, and four short prompts.
--   3. Interests: pick at least 3.
-- Drivers also need their insurance card on file (driver_verifications).

------------------------------------------------------------------------------
-- Profile fields
------------------------------------------------------------------------------
alter table public.profiles
  add column avatar_path text,
  add column gender text check (gender in ('man', 'woman', 'nonbinary', 'unspecified')),
  add column bio text not null default '' check (char_length(bio) <= 300),
  add column instagram text check (instagram ~ '^[a-z0-9._]{1,30}$'),
  add column discipline text check (discipline in ('ski', 'snowboard', 'both')),
  add column home_resort_id text references public.resorts (id),
  add column school_year text check (char_length(school_year) <= 40),
  add column hometown text check (char_length(hometown) <= 60),
  add column interests text[] not null default '{}' check (cardinality(interests) <= 12),
  add column prompts jsonb not null default '{}'::jsonb check (jsonb_typeof(prompts) = 'object' and length(prompts::text) <= 1200),
  add column profile_completed_at timestamptz;

-- Interest choices (same list as packages/app/lib/interests.ts).
create table public.interest_options (
  id text primary key,
  label text not null,
  category text not null,
  sort int not null default 0
);
alter table public.interest_options enable row level security;
create policy "Anyone can read interests" on public.interest_options for select to anon, authenticated using (true);
revoke insert, update, delete on public.interest_options from anon, authenticated;

insert into public.interest_options (id, label, category, sort) values
  ('skiing', 'Skiing', 'On the mountain', 1), ('snowboarding', 'Snowboarding', 'On the mountain', 2),
  ('backcountry', 'Backcountry', 'On the mountain', 3), ('park', 'Park & pipe', 'On the mountain', 4),
  ('moguls', 'Moguls', 'On the mountain', 5), ('powder', 'Powder days', 'On the mountain', 6),
  ('groomers', 'Groomers', 'On the mountain', 7), ('apres', 'Après', 'On the mountain', 8),
  ('nordic', 'Nordic', 'On the mountain', 9), ('splitboarding', 'Splitboarding', 'On the mountain', 10),
  ('climbing', 'Climbing', 'Outdoors', 11), ('mtb', 'Mountain biking', 'Outdoors', 12),
  ('hiking', 'Hiking', 'Outdoors', 13), ('trail-running', 'Trail running', 'Outdoors', 14),
  ('camping', 'Camping', 'Outdoors', 15), ('surfing', 'Surfing', 'Outdoors', 16),
  ('fishing', 'Fishing', 'Outdoors', 17), ('skating', 'Skateboarding', 'Outdoors', 18),
  ('photography', 'Photography', 'Creative', 19), ('film', 'Film & video', 'Creative', 20),
  ('music', 'Music', 'Creative', 21), ('art', 'Art & design', 'Creative', 22),
  ('writing', 'Writing', 'Creative', 23), ('fashion', 'Fashion', 'Creative', 24),
  ('concerts', 'Concerts', 'Lifestyle', 25), ('travel', 'Travel', 'Lifestyle', 26),
  ('coffee', 'Coffee', 'Lifestyle', 27), ('food', 'Food & cooking', 'Lifestyle', 28),
  ('fitness', 'Fitness', 'Lifestyle', 29), ('yoga', 'Yoga', 'Lifestyle', 30),
  ('dogs', 'Dogs', 'Lifestyle', 31), ('podcasts', 'Podcasts', 'Lifestyle', 32),
  ('gaming', 'Gaming', 'Lifestyle', 33), ('sports', 'Watching sports', 'Lifestyle', 34),
  ('tech', 'Tech', 'Lifestyle', 35), ('sustainability', 'Sustainability', 'Lifestyle', 36);

-- Prompts (CorePower-style Q&A). Keys must be from this list.
create function public.valid_prompts(p jsonb)
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1 from jsonb_each(p) e
    where e.key not in ('go_to_run', 'aux', 'apres_spot', 'off_mountain')
       or jsonb_typeof(e.value) <> 'string'
       or char_length(e.value #>> '{}') > 140
  );
$$;

alter table public.profiles add constraint profiles_prompts_valid check (public.valid_prompts(prompts));

create function public.valid_interests(p text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(exists (select 1 from public.interest_options o where o.id = i)), true)
  from unnest(p) as i;
$$;

create function public.enforce_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.valid_interests(new.interests) then
    raise exception 'Pick interests from the list.' using errcode = 'P0001';
  end if;
  new.instagram := nullif(lower(regexp_replace(coalesce(new.instagram, ''), '^@', '')), '');
  return new;
end;
$$;

create trigger profiles_enforce_fields
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_fields();

-- People edit their own profile fields, but never their photo or completion date.
revoke update on public.profiles from authenticated;
grant update (full_name, gender, bio, instagram, discipline, home_resort_id, school_year, hometown, interests, prompts)
  on public.profiles to authenticated;

------------------------------------------------------------------------------
-- Profile photos: private bucket, readable by any signed-in user (riders
-- should see who's picking them up), written only by the server.
------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Signed-in users see profile photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

------------------------------------------------------------------------------
-- Readiness
------------------------------------------------------------------------------

/** Photo (verified selfie) + ID verified + gender + 3 interests. */
create function public.is_profile_ready(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.driver_verifications v on v.user_id = p.id
    where p.id = p_user_id
      and p.avatar_path is not null
      and v.identity_status = 'verified'
      and v.status <> 'rejected'
      and p.gender is not null
      and cardinality(p.interests) >= 3
      and char_length(trim(p.full_name)) > 0
  );
$$;

grant execute on function public.is_profile_ready(uuid) to authenticated;

/** Called by the app at the end of setup. Returns what's still missing, or [] when done. */
create function public.complete_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_id text;
  v_missing text[] := '{}';
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select * into v_p from public.profiles where id = v_uid;
  select identity_status into v_id from public.driver_verifications where user_id = v_uid;

  if v_p.avatar_path is null or v_id is distinct from 'verified' then v_missing := array_append(v_missing, 'photo'); end if;
  if char_length(trim(v_p.full_name)) = 0 then v_missing := array_append(v_missing, 'name'); end if;
  if v_p.gender is null then v_missing := array_append(v_missing, 'gender'); end if;
  if cardinality(v_p.interests) < 3 then v_missing := array_append(v_missing, 'interests'); end if;

  if cardinality(v_missing) = 0 and v_p.profile_completed_at is null then
    update public.profiles set profile_completed_at = now() where id = v_uid;
  end if;
  return to_jsonb(v_missing);
end;
$$;

revoke execute on function public.complete_profile() from public, anon;
grant execute on function public.complete_profile() to authenticated;

------------------------------------------------------------------------------
-- Gates: posting and claiming seats need a finished profile.
------------------------------------------------------------------------------
create or replace function public.enforce_verified_driver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

-- Wrap claim_seat: profile check first, then the existing rules.
alter function public.claim_seat(uuid) rename to claim_seat_rules;
revoke execute on function public.claim_seat_rules(uuid) from public, anon, authenticated;

create function public.claim_seat(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_profile_ready(auth.uid()) then
    raise exception 'Set up your profile first: a verified selfie, a few details and your interests. It takes about two minutes.'
      using errcode = 'P0001';
  end if;
  perform public.claim_seat_rules(p_ride_id);
end;
$$;

revoke execute on function public.claim_seat(uuid) from public, anon;
grant execute on function public.claim_seat(uuid) to authenticated;

------------------------------------------------------------------------------
-- Webhook: save the verified selfie as the profile photo.
------------------------------------------------------------------------------
create function public.set_verified_avatar(p_user_id uuid, p_session_id text, p_avatar_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.driver_verifications
    where user_id = p_user_id and identity_session_id = p_session_id and identity_status = 'verified'
  ) then
    return 'ignored';
  end if;
  update public.profiles set avatar_path = p_avatar_path where id = p_user_id;
  return 'updated';
end;
$$;

revoke execute on function public.set_verified_avatar(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_verified_avatar(uuid, text, text) to service_role;

------------------------------------------------------------------------------
-- Public profile (CorePower-style page): details, badges, stats, upcoming rides.
------------------------------------------------------------------------------
create function public.profile_page(p_user_id uuid)
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
    ), '[]'::jsonb)
  ) end
  from public.profiles p
  left join public.driver_verifications v on v.user_id = p.id
  where p.id = p_user_id;
$$;

revoke execute on function public.profile_page(uuid) from public, anon;
grant execute on function public.profile_page(uuid) to authenticated;

------------------------------------------------------------------------------
-- Board: driver photo + gender ring, rider photos.
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
  coalesce(s.seats_taken, 0) as seats_taken,
  coalesce(s.rider_ids, '{}') as rider_ids,
  coalesce(s.rider_names, '{}') as rider_names,
  r.ride_date,
  public.gas_cap_dollars(r.resort_id, r.depart_at) as gas_cap,
  public.is_verified_driver(r.driver_id) as driver_verified,
  p.avatar_path as driver_avatar_path,
  p.gender as driver_gender,
  coalesce(s.rider_avatar_paths, '{}') as rider_avatar_paths,
  coalesce(s.rider_genders, '{}') as rider_genders
from public.rides r
join public.profiles p on p.id = r.driver_id
left join lateral (
  select
    count(*)::int as seats_taken,
    array_agg(rs.rider_id order by rs.created_at) as rider_ids,
    array_agg(rp.full_name order by rs.created_at) as rider_names,
    array_agg(rp.avatar_path order by rs.created_at) as rider_avatar_paths,
    array_agg(rp.gender order by rs.created_at) as rider_genders
  from public.ride_seats rs
  join public.profiles rp on rp.id = rs.rider_id
  where rs.ride_id = r.id
) s on true
where r.cancelled_at is null
  and r.depart_at > now() - interval '2 hours';

revoke all on public.ride_board from anon, authenticated;
grant select on public.ride_board to authenticated;
