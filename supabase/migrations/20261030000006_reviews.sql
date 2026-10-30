-- Ratings and reviews, Airbnb-style.
--
-- After a ride has left, each passenger can review:
--   * the driver: a DRIVING rating and an EXPERIENCE rating (how it was to
--     share the car with them), plus optional text
--   * each other passenger: an EXPERIENCE rating, plus optional text
-- Ratings are 0.5 to 5 stars in half-star steps. One review per reviewer, per
-- person, per ride. Reviews open when the ride leaves and close 14 days later
-- (like Airbnb). Reviews can't be edited after they're posted.

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  -- what the reviewee was on this ride
  reviewee_role text not null check (reviewee_role in ('driver', 'passenger')),
  driving_rating numeric(2, 1) check (driving_rating between 0.5 and 5 and driving_rating * 2 = floor(driving_rating * 2)),
  experience_rating numeric(2, 1) not null check (experience_rating between 0.5 and 5 and experience_rating * 2 = floor(experience_rating * 2)),
  body text not null default '' check (char_length(body) <= 1000),
  created_at timestamptz not null default now(),
  unique (ride_id, reviewer_id, reviewee_id),
  check (reviewer_id <> reviewee_id),
  -- driving is rated only for drivers, and always for drivers
  check ((reviewee_role = 'driver') = (driving_rating is not null))
);

create index reviews_reviewee_idx on public.reviews (reviewee_id, created_at desc);

alter table public.reviews enable row level security;
create policy "Signed-in users read reviews" on public.reviews for select to authenticated using (true);
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to authenticated;

/** Who the signed-in person can still review, for rides in the last 14 days. */
create function public.reviews_to_write()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_rides as (
    select r.*
    from public.rides r
    join public.ride_seats s on s.ride_id = r.id and s.rider_id = auth.uid()
    where r.cancelled_at is null
      and r.depart_at < now()
      and r.depart_at > now() - interval '14 days'
  ),
  people as (
    select m.id as ride_id, m.driver_id as person_id, 'driver' as role from my_rides m
    union all
    select m.id, s.rider_id, 'passenger' from my_rides m join public.ride_seats s on s.ride_id = m.id
    where s.rider_id <> auth.uid()
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

revoke execute on function public.reviews_to_write() from public, anon;
grant execute on function public.reviews_to_write() to authenticated;

/** Post a review. Works out the reviewee's role on the ride and checks every rule. */
create function public.submit_review(
  p_ride_id uuid,
  p_reviewee_id uuid,
  p_experience numeric,
  p_driving numeric default null,
  p_body text default ''
)
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
  if not exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = v_uid) then
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
  elsif exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = p_reviewee_id) then
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

revoke execute on function public.submit_review(uuid, uuid, numeric, numeric, text) from public, anon;
grant execute on function public.submit_review(uuid, uuid, numeric, numeric, text) to authenticated;

/** Averages for a person, split by role. */
create function public.rating_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'driving_avg', round(avg(driving_rating) filter (where reviewee_role = 'driver'), 2),
    'driver_experience_avg', round(avg(experience_rating) filter (where reviewee_role = 'driver'), 2),
    'driver_count', count(*) filter (where reviewee_role = 'driver'),
    'passenger_avg', round(avg(experience_rating) filter (where reviewee_role = 'passenger'), 2),
    'passenger_count', count(*) filter (where reviewee_role = 'passenger')
  )
  from public.reviews
  where reviewee_id = p_user_id;
$$;

grant execute on function public.rating_summary(uuid) to authenticated;

/** Recent reviews about a person, newest first, with the reviewer's name and photo. */
create function public.reviews_for(p_user_id uuid, p_limit int default 20)
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
    order by rv.created_at desc
    limit least(greatest(p_limit, 1), 100)
  ) t;
$$;

revoke execute on function public.reviews_for(uuid, int) from public, anon;
grant execute on function public.reviews_for(uuid, int) to authenticated;

------------------------------------------------------------------------------
-- Board: the driver's ratings on each ride card.
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
  coalesce(s.seats_taken, 0) as seats_taken,
  coalesce(s.rider_ids, '{}') as rider_ids,
  coalesce(s.rider_names, '{}') as rider_names,
  r.ride_date,
  public.gas_cap_dollars(r.resort_id, r.depart_at) as gas_cap,
  public.is_verified_driver(r.driver_id) as driver_verified,
  p.avatar_path as driver_avatar_path,
  p.gender as driver_gender,
  coalesce(s.rider_avatar_paths, '{}') as rider_avatar_paths,
  coalesce(s.rider_genders, '{}') as rider_genders,
  rt.driving_avg as driver_driving_avg,
  rt.experience_avg as driver_experience_avg,
  coalesce(rt.review_count, 0) as driver_review_count
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
left join lateral (
  select round(avg(rv.driving_rating), 2) as driving_avg, round(avg(rv.experience_rating), 2) as experience_avg, count(*)::int as review_count
  from public.reviews rv
  where rv.reviewee_id = r.driver_id and rv.reviewee_role = 'driver'
) rt on true
where r.cancelled_at is null
  and r.depart_at > now() - interval '2 hours';
