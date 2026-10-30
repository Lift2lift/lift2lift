-- Round trips, one-way rides, Your Rides, chat, check-ins and reminders.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-4111-8111-111111111111', 'up@lift2lift.test', '{"full_name":"Uma Up"}'),
  ('d2222222-2222-4222-8222-222222222222', 'down@lift2lift.test', '{"full_name":"Dev Down"}'),
  ('e1111111-1111-4111-8111-111111111111', 'rider1@lift2lift.test', '{"full_name":"Rae Rider"}'),
  ('e2222222-2222-4222-8222-222222222222', 'rider2@lift2lift.test', '{"full_name":"Rob Rider"}'),
  ('e3333333-3333-4333-8333-333333333333', 'outsider@lift2lift.test', '{"full_name":"Oz Outsider"}');
insert into public.driver_verifications (user_id, status) values
  ('d1111111-1111-4111-8111-111111111111', 'submitted'), ('d2222222-2222-4222-8222-222222222222', 'submitted');
select public.test_make_ready(id) from (values
  ('d1111111-1111-4111-8111-111111111111'::uuid), ('d2222222-2222-4222-8222-222222222222'), ('e1111111-1111-4111-8111-111111111111'),
  ('e2222222-2222-4222-8222-222222222222'), ('e3333333-3333-4333-8333-333333333333')) v(id);

-- Day 20 from now, Mountain Time.
create temp table day20 as select (date_trunc('day', now() at time zone 'America/Denver') + interval '20 days') as d;
grant select on day20 to authenticated;

-- ===== Uma posts a round trip to Breck; Dev posts a one-way ride down from Breck =====
set role authenticated;
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', false);
do $$
declare d timestamp := (select d from day20);
begin
  -- Round trip: Breck is 168 mi round trip → $121 cap. 3 seats × $40 = $120 OK.
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact)
  values ('breck', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '16 hours') at time zone 'America/Denver',
          'Peak 8 base', 'Kittredge', 2, 40, '303');
  -- Return has to be after departure.
  begin
    update public.rides set return_at = depart_at - interval '1 hour' where driver_id = auth.uid();
    raise exception 'FAIL: return before departure';
  exception when check_violation then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', false);
set role authenticated;
do $$
declare d timestamp := (select d from day20);
begin
  -- One way: half the miles → $60 cap. 2 seats × $40 = $80 is over.
  begin
    insert into public.rides (resort_id, trip_type, depart_at, leave_from, seats_total, gas_per_rider, contact)
    values ('breck', 'from_mountain', (d + interval '15 hours') at time zone 'America/Denver', 'Breck Gondola lot', 2, 40, '303');
    raise exception 'FAIL: one-way over cap';
  exception when raise_exception then
    assert sqlerrm like 'Colorado caps gas money for a one-way trip to Breckenridge at $60 total.%', sqlerrm;
  end;
  insert into public.rides (resort_id, trip_type, depart_at, return_at, leave_from, seats_total, gas_per_rider, contact)
  values ('breck', 'from_mountain', (d + interval '15 hours') at time zone 'America/Denver', now(), 'Breck Gondola lot', 2, 30, '303');
  assert (select return_at is null from public.rides where driver_id = auth.uid()), 'one-way drops return_at';
  assert (select gas_cap from public.ride_board where driver_id = auth.uid()) = 60, 'board shows one-way cap';
end $$;
reset role;

-- ===== Rae books just the way up with Uma, then the way down with Dev =====
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$
declare
  v_uma uuid := (select id from public.rides where driver_id = 'd1111111-1111-4111-8111-111111111111');
  v_dev uuid := (select id from public.rides where driver_id = 'd2222222-2222-4222-8222-222222222222');
begin
  perform public.claim_seat(v_uma, 'to');
  assert (select seats_taken_to = 1 and seats_taken_from = 0 from public.ride_board where id = v_uma), 'leg counts';
  -- A second seat going up the same day is blocked...
  begin
    perform public.claim_seat(v_uma, 'from'); -- already has a seat on this ride: no-op
  end;
  assert (select legs from public.ride_seats where ride_id = v_uma and rider_id = auth.uid()) = 'to', 'still up only';
  -- ...but a ride down with someone else works.
  perform public.claim_seat(v_dev);
  assert (select legs from public.ride_seats where ride_id = v_dev and rider_id = auth.uid()) = 'both', 'one-way seat';
  assert jsonb_array_length(public.my_trips()) = 2, 'Your Rides shows both legs';
  assert (public.my_trips()->0->>'role') = 'passenger', 'role';
end $$;
reset role;

-- Rob books the round trip; then the way down is full (2 seats: Rob, Oz) but up still has room.
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', false);
set role authenticated;
do $$ begin
  perform public.claim_seat((select id from public.rides where driver_id = 'd1111111-1111-4111-8111-111111111111'), 'both');
  -- Rob can't also book Dev's ride down (overlaps his round trip's way down).
  begin
    perform public.claim_seat((select id from public.rides where driver_id = 'd2222222-2222-4222-8222-222222222222'));
    raise exception 'FAIL: overlapping legs';
  exception when raise_exception then
    assert sqlerrm like 'You already have a seat that day.%', sqlerrm;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'e3333333-3333-4333-8333-333333333333', false);
set role authenticated;
do $$
declare v_uma uuid := (select id from public.rides where driver_id = 'd1111111-1111-4111-8111-111111111111');
begin
  begin
    perform public.claim_seat(v_uma, 'both'); -- up has Rae + Rob = full
    raise exception 'FAIL: overbooked up';
  exception when raise_exception then
    assert sqlerrm = 'The ride up is full.', sqlerrm;
  end;
  perform public.claim_seat(v_uma, 'from'); -- down has only Rob
  assert (select seats_taken_to = 2 and seats_taken_from = 2 from public.ride_board where id = v_uma), 'both legs full now';

  -- Oz isn't on Dev's ride: can't read or post in its chat.
  begin
    insert into public.ride_messages (ride_id, body) values ((select id from public.rides where driver_id = 'd2222222-2222-4222-8222-222222222222'), 'hi');
    raise exception 'FAIL: outsider posted';
  exception when insufficient_privilege then null;
  end;
  -- Oz is on Uma's ride: can chat.
  insert into public.ride_messages (ride_id, body) values (v_uma, 'I''ll be at the Kittredge lot by 6:55.');
  -- Too early to check in.
  begin
    perform public.confirm_my_seat(v_uma, 'from');
    raise exception 'FAIL: early check-in';
  exception when raise_exception then assert sqlerrm like 'Check-in opens 30 minutes%', sqlerrm;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.ride_messages) = 1, 'driver sees the chat';
  -- Can't switch trip type once booked.
  begin
    update public.rides set trip_type = 'to_mountain' where driver_id = auth.uid();
    raise exception 'FAIL: switched type';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- ===== Reminders and check-ins on a ride leaving soon =====
-- Uma's ride, moved (trigger off) to leave in 1h59m, as if it was posted yesterday.
alter table public.rides disable trigger rides_enforce_rules;
update public.rides set depart_at = now() + interval '119 minutes', return_at = now() + interval '9 hours'
where driver_id = 'd1111111-1111-4111-8111-111111111111';
alter table public.rides enable trigger rides_enforce_rules;
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[rae-iphone-123]', 'e1111111-1111-4111-8111-111111111111', 'ios');

do $$
declare n int;
begin
  -- 2 hours out: driver + 2 passengers on the way up (Rae, Rob). Oz is only on the way down.
  select count(*) into n from public.claim_due_notifications() where kind = 'two_hours';
  assert n = 3, 'two-hour reminders: ' || n;
  -- Sent once only.
  select count(*) into n from public.claim_due_notifications();
  assert n = 0, 'no duplicates';
end $$;

-- 4 minutes out: confirm reminders.
alter table public.rides disable trigger rides_enforce_rules;
update public.rides set depart_at = now() + interval '4 minutes' where driver_id = 'd1111111-1111-4111-8111-111111111111';
alter table public.rides enable trigger rides_enforce_rules;
do $$
declare r record; n_ride int := 0; n_pass int := 0; rae_tokens text[];
begin
  for r in select * from public.claim_due_notifications() loop
    if r.kind = 'confirm_ride' then n_ride := n_ride + 1; end if;
    if r.kind = 'confirm_passengers' then n_pass := n_pass + 1; assert r.title = 'Confirm your passengers', r.title; end if;
    if r.user_id = 'e1111111-1111-4111-8111-111111111111' then rae_tokens := r.tokens; end if;
  end loop;
  assert n_ride = 2 and n_pass = 1, format('confirm reminders %s / %s', n_ride, n_pass);
  assert rae_tokens = array['ExponentPushToken[rae-iphone-123]'], 'tokens attached';
end $$;

-- Rae checks in; the driver marks Rae picked up and Rob a no-show.
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ begin
  perform public.confirm_my_seat((select id from public.rides where driver_id = 'd1111111-1111-4111-8111-111111111111'), 'to');
  -- Not on the way up for Dev's ride… and Rae isn't the driver.
  begin
    perform public.confirm_passenger((select id from public.rides where driver_id = 'd1111111-1111-4111-8111-111111111111'), 'to', auth.uid(), 'picked_up');
    raise exception 'FAIL: passenger confirmed as driver';
  exception when raise_exception then assert sqlerrm like 'Only the driver%', sqlerrm;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$
declare v uuid := (select id from public.rides where driver_id = 'd1111111-1111-4111-8111-111111111111');
begin
  perform public.confirm_passenger(v, 'to', 'e1111111-1111-4111-8111-111111111111', 'picked_up');
  perform public.confirm_passenger(v, 'to', 'e2222222-2222-4222-8222-222222222222', 'no_show');
  -- Oz isn't on the way up.
  begin
    perform public.confirm_passenger(v, 'to', 'e3333333-3333-4333-8333-333333333333', 'picked_up');
    raise exception 'FAIL: confirmed someone not on the leg';
  exception when raise_exception then assert sqlerrm like 'That passenger isn''t booked%', sqlerrm;
  end;
  assert (select count(*) from public.ride_checkins where ride_id = v) = 2, 'check-ins saved';
  assert (select rider_confirmed_at is not null and driver_status = 'picked_up' from public.ride_checkins
          where ride_id = v and rider_id = 'e1111111-1111-4111-8111-111111111111'), 'both sides confirmed';
  assert jsonb_array_length(public.my_trips()->0->'checkins') = 2, 'Your Rides shows check-ins';
end $$;
reset role;

select 'ALL TRIP TESTS PASSED' as result;
