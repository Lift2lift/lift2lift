-- Colorado carpool rules (C.R.S. 43-1-127). Times are UTC; 14:00–21:00 UTC is the same Denver day. Run after policies_test.sql's setup
-- (stub, migrations, seed). Raises on any failure; ends with ALL COLORADO TESTS PASSED.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('44444444-4444-4444-8444-444444444444', 'a@lift2lift.test', '{"full_name":"Alex"}'),
  ('55555555-5555-4555-8555-555555555555', 'b@lift2lift.test', '{"full_name":"Blair"}');
insert into public.driver_verifications (user_id, status) values
  ('44444444-4444-4444-8444-444444444444', 'submitted'),
  ('55555555-5555-4555-8555-555555555555', 'submitted');
select public.test_make_ready('44444444-4444-4444-8444-444444444444');
select public.test_make_ready('55555555-5555-4555-8555-555555555555');

do $$ begin
  assert public.gas_cap_dollars('eldora', '2026-12-05 08:00-07') = 30, 'Eldora: 42 mi × 72.5¢ = $30';
  assert public.gas_cap_dollars('wolf', '2026-12-05 08:00-07') = 391, 'Wolf Creek: 540 mi × 72.5¢ = $391';
  assert public.gas_cap_dollars('eldora', '2025-12-05 08:00-07') = 29, 'uses the 2025 rate in 2025';
  assert public.gas_cap_dollars('eldora', '2031-01-05 08:00-07') = 30, 'falls back to the latest rate';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
do $$
declare v_day timestamptz := date_trunc('day', now()) + interval '10 days 15 hours';
begin
  -- 7 seats rejected, 6 allowed.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, contact) values ('vail', v_day, 'x', 7, 'x');
    raise exception 'FAIL: 7 seats accepted';
  exception when check_violation then null;
  end;

  -- Gas over the cap: Eldora $30 cap, 4 seats × $8 = $32.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact) values ('eldora', v_day, 'x', 4, 8, 'x');
    raise exception 'FAIL: gas over cap accepted';
  exception when raise_exception then
    assert sqlerrm like 'Colorado caps gas money for a round trip to Eldora at $30 total. With 4 seats, ask at most $7 per rider.', sqlerrm;
  end;

  -- At the cap is fine: 6 seats × $5 = $30.
  insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact) values ('eldora', v_day, 'Kittredge', 6, 5, '303');

  -- Raising gas on an existing ride past the cap is rejected too.
  begin
    update public.rides set gas_per_rider = 6 where resort_id = 'eldora' and driver_id = auth.uid();
    raise exception 'FAIL: update past cap accepted';
  exception when raise_exception then null;
  end;

  -- Second ride the same day (even a different mountain, different time) is rejected.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, contact) values ('vail', v_day + interval '6 hours', 'x', 2, 'x');
    raise exception 'FAIL: second ride same day accepted';
  exception when raise_exception then
    assert sqlerrm like 'You already have a ride posted that day.%', sqlerrm;
  end;

  -- A different day is fine.
  insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact) values ('vail', v_day + interval '1 day', 'x', 3, 40, '303');

  -- Departing in under 2 hours is rejected.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, contact) values ('loveland', now() + interval '90 minutes', 'x', 2, 'x');
    raise exception 'FAIL: ride under 2 hours out accepted';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- Driver 1 posts on the same day as Alex's Eldora ride, plus a ride leaving soon.
insert into public.rides (driver_id, resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact)
values ('11111111-1111-4111-8111-111111111111', 'copper', date_trunc('day', now()) + interval '10 days 16 hours', 'Table Mesa', 3, 10, '303-555-0142'),
       ('11111111-1111-4111-8111-111111111111', 'keystone', now() + interval '5 days 3 hours', 'Soon lot', 2, 10, '303-555-0142');
-- Move the second ride to 1 hour from now (the trigger would refuse this, so switch it off for the test).
alter table public.rides disable trigger rides_enforce_rules;
update public.rides set depart_at = now() + interval '1 hour', return_at = now() + interval '9 hours' where leave_from = 'Soon lot';
alter table public.rides enable trigger rides_enforce_rules;

set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', false);
do $$
declare
  v_eldora uuid := (select id from public.rides where resort_id = 'eldora' and driver_id = '44444444-4444-4444-8444-444444444444');
  v_vail   uuid := (select id from public.rides where resort_id = 'vail'   and driver_id = '44444444-4444-4444-8444-444444444444');
  v_copper uuid := (select id from public.rides where leave_from = 'Table Mesa');
  v_soon   uuid := (select id from public.rides where leave_from = 'Soon lot');
begin
  assert (select gas_cap from public.ride_board where id = v_eldora) = 30, 'board shows the gas cap';

  perform public.claim_seat(v_eldora, 'both', true);
  perform public.claim_seat(v_vail, 'both', true); -- next day: fine

  -- Second seat on the same day is rejected.
  begin
    perform public.claim_seat(v_copper, 'both', true);
    raise exception 'FAIL: two seats same day';
  exception when raise_exception then
    assert sqlerrm like 'You already have a seat that day.%', sqlerrm;
  end;

  -- Can't post a ride on a day you're riding.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, contact)
    values ('abasin', date_trunc('day', now()) + interval '10 days 14 hours', 'x', 2, 'x');
    raise exception 'FAIL: drove on a day with a seat';
  exception when raise_exception then
    assert sqlerrm like 'You have a seat in someone else''s car that day.%', sqlerrm;
  end;

  -- Booking closes 2 hours before departure.
  begin
    perform public.claim_seat(v_soon, 'both', true);
    raise exception 'FAIL: booked inside 2 hours';
  exception when raise_exception then
    assert sqlerrm like 'Booking closed.%', sqlerrm;
  end;

  -- Bail on Eldora, then the Copper ride that day is open to Blair.
  delete from public.ride_seats where ride_id = v_eldora and rider_id = auth.uid();
  perform public.claim_seat(v_copper, 'both', true);
end $$;
reset role;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
set role authenticated;
do $$
declare
  v_eldora uuid := (select id from public.rides where resort_id = 'eldora' and driver_id = '44444444-4444-4444-8444-444444444444');
  v_copper uuid := (select id from public.rides where leave_from = 'Table Mesa');
begin
  -- Alex is driving that day, so can't take a seat in another car.
  begin
    perform public.claim_seat(v_copper, 'both', true);
    raise exception 'FAIL: rider while driving same day';
  exception when raise_exception then
    assert sqlerrm like 'You''re driving that day.%', sqlerrm;
  end;

  -- Cancelling frees the day for a new post.
  update public.rides set cancelled_at = now() where id = v_eldora;
  insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact)
  values ('loveland', date_trunc('day', now()) + interval '10 days 17 hours', 'Kittredge', 2, 20, '303');
end $$;
reset role;

select 'ALL COLORADO TESTS PASSED' as result;
