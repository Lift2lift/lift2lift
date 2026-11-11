-- Safety tools Apple requires for apps with user content (App Review 1.2):
-- blocking, reporting and a filter for objectionable words. Account deletion
-- (App Review 5.1.1(v)) is the delete-account edge function: every table hangs
-- off profiles with "on delete cascade", so deleting the auth user removes
-- everything, and the function also removes the person's stored photos.

------------------------------------------------------------------------------
-- Blocks. Blocking someone ends any friendship, hides their chat messages and
-- reviews, keeps them out of search, and stops either person from booking a
-- seat with the other or sending a friend request. The app also hides their
-- rides and profile (hidden_people below).
------------------------------------------------------------------------------
create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

create policy "People see who they blocked"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

revoke all on public.user_blocks from anon, authenticated;
grant select on public.user_blocks to authenticated;

/** True when either person blocked the other. */
create function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.user_blocks
    where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

create function public.block_user(p_user_id uuid)
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
  if p_user_id = v_uid then
    raise exception 'You can''t block yourself.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'That person isn''t on Lift2Lift.' using errcode = 'P0002';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id) values (v_uid, p_user_id)
  on conflict do nothing;

  delete from public.friendships
  where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id);
end;
$$;

create function public.unblock_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_user_id;
$$;

/** The people I blocked, newest first, for Account → Blocked people. */
create function public.my_blocks()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar_path', p.avatar_path,
                                               'gender', p.gender, 'blocked_at', b.created_at)
                            order by b.created_at desc), '[]'::jsonb)
  from public.user_blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid();
$$;

/** Everyone the app should hide from me: people I blocked and people who blocked me (without saying which). */
create function public.hidden_people()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x), '{}')
  from (
    select blocked_id as x from public.user_blocks where blocker_id = auth.uid()
    union
    select blocker_id from public.user_blocks where blocked_id = auth.uid()
  ) t;
$$;

revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
revoke execute on function public.my_blocks() from public, anon;
revoke execute on function public.hidden_people() from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.my_blocks() to authenticated;
grant execute on function public.hidden_people() to authenticated;

-- No friend requests between blocked people.
create function public.enforce_friend_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_blocked_between(new.user_a, new.user_b) then
    raise exception 'You can''t add this person.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger friendships_no_blocks
  before insert on public.friendships
  for each row execute function public.enforce_friend_blocks();

-- No seat on a ride with someone you blocked (or who blocked you): not the driver, not another rider.
create function public.enforce_seat_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.rides r where r.id = new.ride_id and public.is_blocked_between(r.driver_id, new.rider_id))
     or exists (select 1 from public.ride_seats s
                where s.ride_id = new.ride_id and s.rider_id <> new.rider_id
                  and public.is_blocked_between(s.rider_id, new.rider_id)) then
    raise exception 'This ride isn''t available to you.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger ride_seats_no_blocks
  before insert on public.ride_seats
  for each row execute function public.enforce_seat_blocks();

-- Chat: messages from blocked people are hidden (this also applies to live updates).
drop policy "Ride members read the chat" on public.ride_messages;
create policy "Ride members read the chat"
  on public.ride_messages for select to authenticated
  using (
    public.is_ride_member(ride_id, (select auth.uid()))
    and not public.is_blocked_between((select auth.uid()), sender_id)
  );

-- Reviews: hide reviews written by blocked people.
drop policy "Signed-in users read reviews" on public.reviews;
create policy "Signed-in users read reviews"
  on public.reviews for select to authenticated
  using (not public.is_blocked_between((select auth.uid()), reviewer_id));

create or replace function public.reviews_for(p_user_id uuid, p_limit int default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then '[]'::jsonb else coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]'::jsonb) end
  from (
    select jsonb_build_object(
      'id', rv.id,
      'role', rv.reviewee_role,
      'driving', rv.driving_rating,
      'experience', rv.experience_rating,
      'body', rv.body,
      'created_at', rv.created_at,
      'resort_id', r.resort_id,
      'reviewer_id', rv.reviewer_id,
      'reviewer_name', p.full_name,
      'reviewer_avatar_path', p.avatar_path,
      'reviewer_gender', p.gender
    ) as x
    from public.reviews rv
    join public.rides r on r.id = rv.ride_id
    join public.profiles p on p.id = rv.reviewer_id
    where rv.reviewee_id = p_user_id
      and not public.is_blocked_between(auth.uid(), rv.reviewer_id)
    order by rv.created_at desc
    limit least(greatest(p_limit, 1), 100)
  ) t;
$$;

-- Search: blocked people don't show up, either way.
create or replace function public.search_people(p_query text)
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
      and not public.is_blocked_between(auth.uid(), p.id)
    order by rank, p.full_name
    limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'avatar_path', h.avatar_path, 'gender', h.gender,
                                               'home_resort_id', h.home_resort_id, 'school_year', h.school_year)
                            order by h.rank, h.full_name), '[]'::jsonb)
  from hits h;
$$;

------------------------------------------------------------------------------
-- Reports. Anyone can report a person, a chat message, a review or a ride.
-- Reports are read in the Supabase dashboard (or sent on by a database
-- webhook, see README) and must be acted on within 24 hours.
------------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid default auth.uid() references public.profiles (id) on delete set null,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('profile', 'message', 'review', 'ride')),
  target_id uuid,
  reason text not null check (reason in ('harassment', 'hate', 'sexual', 'spam', 'unsafe_driving', 'fake_profile', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  -- a copy of the reported text, so it survives if the author deletes it
  snapshot text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  check (reporter_id is null or reporter_id <> reported_user_id)
);

create index reports_open_idx on public.reports (created_at) where resolved_at is null;

alter table public.reports enable row level security;

create policy "People see their own reports"
  on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));

revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

/** File a report. Returns its id. */
create function public.report_content(p_user_id uuid, p_kind text, p_target_id uuid, p_reason text, p_details text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_snapshot text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_user_id = v_uid then
    raise exception 'You can''t report yourself.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'That person isn''t on Lift2Lift.' using errcode = 'P0002';
  end if;
  -- Ten reports an hour is plenty for a real person.
  if (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You''ve sent a lot of reports. Try again later.' using errcode = 'P0001';
  end if;

  if p_kind = 'message' then
    select m.body into v_snapshot from public.ride_messages m
    where m.id = p_target_id and m.sender_id = p_user_id and public.is_ride_member(m.ride_id, v_uid);
    if not found then raise exception 'That message isn''t available.' using errcode = 'P0002'; end if;
  elsif p_kind = 'review' then
    select rv.body into v_snapshot from public.reviews rv where rv.id = p_target_id and rv.reviewer_id = p_user_id;
    if not found then raise exception 'That review isn''t available.' using errcode = 'P0002'; end if;
  elsif p_kind = 'ride' then
    select coalesce(r.notes, '') into v_snapshot from public.rides r where r.id = p_target_id and r.driver_id = p_user_id;
    if not found then raise exception 'That ride isn''t available.' using errcode = 'P0002'; end if;
  elsif p_kind = 'profile' then
    select concat_ws(E'\n', p.full_name, p.bio, p.instagram, p.prompts::text) into v_snapshot
    from public.profiles p where p.id = p_user_id;
  end if;

  insert into public.reports (reporter_id, reported_user_id, kind, target_id, reason, details, snapshot)
  values (v_uid, p_user_id, p_kind, case when p_kind = 'profile' then null else p_target_id end, p_reason,
          left(trim(coalesce(p_details, '')), 1000), v_snapshot)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.report_content(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.report_content(uuid, text, uuid, text, text) to authenticated;

------------------------------------------------------------------------------
-- Objectionable words. Chat messages, reviews and profile text that contain a
-- listed word are rejected. Add words with a new migration (lowercase letters
-- and spaces only; matched as whole words, any case).
------------------------------------------------------------------------------
create table public.blocked_terms (
  term text primary key check (term ~ '^[a-z]+( [a-z]+)*$')
);

alter table public.blocked_terms enable row level security;
revoke all on public.blocked_terms from anon, authenticated;

insert into public.blocked_terms (term) values
  ('nigger'), ('nigga'), ('faggot'), ('fag'), ('retard'), ('tranny'), ('kike'), ('spic'), ('chink'), ('wetback'),
  ('cunt'), ('whore'), ('slut'), ('rape'), ('rapist'), ('kill yourself'), ('kys')
on conflict do nothing;

create function public.has_blocked_term(p_text text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_text, '') <> '' and exists (
    select 1 from public.blocked_terms t
    where lower(p_text) ~ ('\m' || replace(t.term, ' ', '\s+') || '\M')
  );
$$;

revoke execute on function public.has_blocked_term(text) from public, anon;
grant execute on function public.has_blocked_term(text) to authenticated;

create function public.reject_blocked_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad boolean;
begin
  -- Separate branches: each table has different columns.
  if tg_table_name = 'profiles' then
    v_bad := public.has_blocked_term(new.full_name) or public.has_blocked_term(new.bio)
          or public.has_blocked_term(new.hometown) or public.has_blocked_term(new.prompts::text);
  else
    v_bad := public.has_blocked_term(new.body);
  end if;
  if v_bad then
    raise exception 'That includes language that isn''t allowed on Lift2Lift. Please reword it.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger ride_messages_language before insert on public.ride_messages
  for each row execute function public.reject_blocked_terms();
create trigger reviews_language before insert on public.reviews
  for each row execute function public.reject_blocked_terms();
create trigger profiles_language before update of full_name, bio, hometown, prompts on public.profiles
  for each row execute function public.reject_blocked_terms();
