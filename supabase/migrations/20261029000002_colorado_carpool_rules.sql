-- Colorado carpooling-app rules (C.R.S. 43-1-127). Keeping Lift2Lift inside
-- these limits is what keeps it a carpool app instead of a regulated
-- transportation network company:
--   * a driver collects no more than miles driven × the IRS business mileage rate
--   * each rider pays an equal share
--   * no more than 6 passengers per car
--   * one trip per driver per day (we apply it to everyone: one ride per person per day)
--   * seats are reserved at least 2 hours in advance

------------------------------------------------------------------------------
-- Round-trip miles from Boulder for each mountain (used for the gas cap).
-- Conservative estimates of the usual winter route; verify before launch.
------------------------------------------------------------------------------
alter table public.resorts add column round_trip_miles int;

update public.resorts r
set round_trip_miles = v.miles
from (values
  ('eldora', 42), ('echo', 90), ('loveland', 124), ('abasin', 144), ('keystone', 148),
  ('wp', 130), ('copper', 164), ('breck', 168), ('granby', 160), ('vail', 200),
  ('cooper', 216), ('bc', 224), ('steamboat', 300), ('howelsen', 300), ('monarch', 330),
  ('sunlight', 330), ('snowmass', 390), ('ajax', 380), ('highlands', 384), ('buttermilk', 384),
  ('powderhorn', 450), ('cb', 450), ('wolf', 540), ('telluride', 680), ('purg', 690),
  ('silverton', 700)
) as v(id, miles)
where r.id = v.id;

alter table public.resorts alter column round_trip_miles set not null;
alter table public.resorts add constraint resorts_round_trip_miles_check check (round_trip_miles > 0);

------------------------------------------------------------------------------
-- IRS business mileage rate by year. Add a row each January when the IRS
-- announces the new rate.
------------------------------------------------------------------------------
create table public.mileage_rates (
  year int primary key,
  cents_per_mile numeric(5, 1) not null check (cents_per_mile > 0)
);

alter table public.mileage_rates enable row level security;
create policy "Anyone can read mileage rates" on public.mileage_rates for select to anon, authenticated using (true);
revoke insert, update, delete on public.mileage_rates from anon, authenticated;

insert into public.mileage_rates (year, cents_per_mile) values (2025, 70.0), (2026, 72.5);

/** Most a driver may collect for a trip to this mountain, in whole dollars. */
create function public.gas_cap_dollars(p_resort_id text, p_depart_at timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select floor(r.round_trip_miles * (
    select m.cents_per_mile
    from public.mileage_rates m
    order by (m.year <= extract(year from p_depart_at at time zone 'America/Denver')) desc, m.year desc
    limit 1
  ) / 100)::int
  from public.resorts r
  where r.id = p_resort_id;
$$;

grant execute on function public.gas_cap_dollars(text, timestamptz) to anon, authenticated;

------------------------------------------------------------------------------
-- Rides: 6 seats max, a Mountain Time calendar day, and the rules above.
------------------------------------------------------------------------------
alter table public.rides drop constraint rides_seats_total_check;
alter table public.rides add constraint rides_seats_total_check check (seats_total between 1 and 6);

alter table public.rides add column ride_date date;
update public.rides set ride_date = (depart_at at time zone 'America/Denver')::date;
alter table public.rides alter column ride_date set not null;
grant select (ride_date) on public.rides to authenticated;

-- The time check moves from the insert policy into the trigger below.
drop policy "Drivers post their own rides" on public.rides;
create policy "Drivers post their own rides"
  on public.rides for insert to authenticated
  with check (driver_id = (select auth.uid()));

create function public.enforce_ride_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap int;
  v_name text;
  v_taken int;
begin
  new.ride_date := (new.depart_at at time zone 'America/Denver')::date;

  if tg_op = 'INSERT' or new.depart_at is distinct from old.depart_at then
    if new.depart_at < now() + interval '2 hours' then
      raise exception 'Rides have to leave at least 2 hours from now so riders can book ahead.' using errcode = 'P0001';
    end if;
  end if;

  if new.cancelled_at is not null then
    return new; -- cancelling is always allowed
  end if;

  -- Gas cap: every seat filled can't add up to more than the legal maximum.
  v_cap := public.gas_cap_dollars(new.resort_id, new.depart_at);
  if new.gas_per_rider * new.seats_total > v_cap then
    select name into v_name from public.resorts where id = new.resort_id;
    raise exception 'Colorado caps gas money for a trip to % at $% total. With % seat%, ask at most $% per rider.',
      v_name, v_cap, new.seats_total, case when new.seats_total = 1 then '' else 's' end, floor(v_cap / new.seats_total)
      using errcode = 'P0001';
  end if;

  -- Can't drop below the seats already claimed.
  if tg_op = 'UPDATE' then
    select count(*) into v_taken from public.ride_seats where ride_id = new.id;
    if new.seats_total < v_taken then
      raise exception '% riders already have seats. Remove someone before lowering the seat count.', v_taken using errcode = 'P0001';
    end if;
  end if;

  -- One ride per person per day (driving or riding). The lock serializes
  -- this person's posts and seat claims so two at once can't both slip through.
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

create trigger rides_enforce_rules
  before insert or update on public.rides
  for each row execute function public.enforce_ride_rules();

-- Backstop for the one-trip-per-day rule.
create unique index rides_one_per_driver_per_day on public.rides (driver_id, ride_date) where cancelled_at is null;

------------------------------------------------------------------------------
-- Claiming a seat: 2-hour booking window and one ride per person per day.
------------------------------------------------------------------------------
create or replace function public.claim_seat(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_taken int;
begin
  if v_uid is null then
    raise exception 'Sign in to claim a seat.' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 43127));

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

  if exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = v_uid) then
    return; -- already have a seat
  end if;

  if v_ride.depart_at < now() + interval '2 hours' then
    raise exception 'Booking closed. Seats have to be claimed at least 2 hours before the ride leaves.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.rides r
    where r.driver_id = v_uid and r.ride_date = v_ride.ride_date and r.cancelled_at is null
  ) then
    raise exception 'You''re driving that day. It''s one ride per person per day.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.ride_seats s
    join public.rides r on r.id = s.ride_id
    where s.rider_id = v_uid and r.ride_date = v_ride.ride_date and r.cancelled_at is null
  ) then
    raise exception 'You already have a seat that day. It''s one ride per person per day, so bail on the other one first.' using errcode = 'P0001';
  end if;

  select count(*) into v_taken from public.ride_seats where ride_id = p_ride_id;
  if v_taken >= v_ride.seats_total then
    raise exception 'This ride is full.' using errcode = 'P0001';
  end if;

  insert into public.ride_seats (ride_id, rider_id) values (p_ride_id, v_uid);
end;
$$;

------------------------------------------------------------------------------
-- Board: add the calendar day and the trip's legal gas cap.
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
  public.gas_cap_dollars(r.resort_id, r.depart_at) as gas_cap
from public.rides r
join public.profiles p on p.id = r.driver_id
left join lateral (
  select
    count(*)::int as seats_taken,
    array_agg(rs.rider_id order by rs.created_at) as rider_ids,
    array_agg(rp.full_name order by rs.created_at) as rider_names
  from public.ride_seats rs
  join public.profiles rp on rp.id = rs.rider_id
  where rs.ride_id = r.id
) s on true
where r.cancelled_at is null
  and r.depart_at > now() - interval '2 hours';
