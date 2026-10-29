-- Run against plain Postgres after supabase_stub.sql, the migration and seed.sql.
-- Every check raises an exception on failure; the script ends with ALL TESTS PASSED.
\set ON_ERROR_STOP on
\set driver '11111111-1111-4111-8111-111111111111'
\set rider  '22222222-2222-4222-8222-222222222222'

-- A third account signs up through the trigger.
insert into auth.users (id, email, raw_user_meta_data)
values ('33333333-3333-4333-8333-333333333333', 'new@lift2lift.test', '{"full_name":"  New Student  "}');

do $$ begin
  assert (select full_name from public.profiles where id = '33333333-3333-4333-8333-333333333333') = 'New Student',
    'sign-up trigger should create a trimmed profile';
  assert (select count(*) from public.resorts) = 26, 'all 26 resorts loaded';
  assert (select count(*) from public.rides) = 3, 'seed created 3 rides';
end $$;

-- ===== Signed out (anon) =====
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  assert (select count(*) from public.resorts) = 26, 'anon can read resorts';
  begin
    perform 1 from public.ride_board;
    raise exception 'FAIL: anon read ride_board';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_seat(gen_random_uuid());
    raise exception 'FAIL: anon called claim_seat';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ===== New student =====
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
do $$
declare v_board int; v_ride uuid;
begin
  select count(*) into v_board from public.ride_board;
  assert v_board = 3, 'signed-in user sees the 3 upcoming rides, got ' || v_board;

  -- Contact is hidden from the table and from ride_contact() without a seat.
  begin
    perform contact from public.rides limit 1;
    raise exception 'FAIL: read rides.contact directly';
  exception when insufficient_privilege then null;
  end;
  select id into v_ride from public.rides where resort_id = 'copper';
  assert public.ride_contact(v_ride) is null, 'contact hidden before claiming a seat';

  -- Claim a seat, then the contact appears.
  perform public.claim_seat(v_ride);
  perform public.claim_seat(v_ride); -- second call is a no-op
  assert (select seats_taken from public.ride_board where id = v_ride) = 1, 'seat counted once';
  assert public.ride_contact(v_ride) = '@demo.driver', 'contact visible after claiming';
  assert (select rider_names from public.ride_board where id = v_ride) = array['New Student'], 'rider name shown';

  -- Can't edit or cancel someone else's ride (RLS silently matches 0 rows).
  update public.rides set notes = 'hacked' where id = v_ride;
  reset role; set role authenticated;
  assert (select notes from public.rides where id = v_ride) <> 'hacked', 'cannot edit another driver''s ride';

  -- Can't post a ride as someone else.
  begin
    insert into public.rides (driver_id, resort_id, depart_at, leave_from, seats_total, contact)
    values ('11111111-1111-4111-8111-111111111111', 'vail', now() + interval '1 day', 'x', 2, 'x');
    raise exception 'FAIL: set driver_id directly';
  exception when insufficient_privilege then null;
  end;

  -- Can't insert seats directly (must go through claim_seat).
  begin
    insert into public.ride_seats (ride_id) values (v_ride);
    raise exception 'FAIL: inserted seat directly';
  exception when insufficient_privilege then null;
  end;

  -- Post own ride: driver_id defaults to me.
  insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact)
  values ('breck', now() + interval '3 days', 'Williams Village', 1, 10, '720-555-0199');
  assert (select driver_id from public.rides where resort_id = 'breck') = '33333333-3333-4333-8333-333333333333', 'driver_id defaulted';

  -- Rides in the past are rejected.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, contact)
    values ('vail', now() - interval '1 day', 'x', 2, 'x');
    raise exception 'FAIL: posted a ride in the past';
  exception when insufficient_privilege then null; -- RLS with-check violation
  end;

  -- Bad values are rejected by checks.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, contact)
    values ('vail', now() + interval '1 day', 'x', 9, 'x');
    raise exception 'FAIL: 9 seats accepted';
  exception when check_violation then null;
  end;

  -- Can't claim own ride.
  begin
    perform public.claim_seat((select id from public.rides where resort_id = 'breck'));
    raise exception 'FAIL: claimed own ride';
  exception when raise_exception then
    assert sqlerrm = 'You''re driving this one.', sqlerrm;
  end;
end $$;
reset role;

-- ===== Demo rider fills the last seat; new student is then turned away =====
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$ begin
  perform public.claim_seat((select id from public.rides where resort_id = 'breck'));
end $$;
reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ begin
  begin
    perform public.claim_seat((select id from public.rides where resort_id = 'breck'));
    raise exception 'FAIL: claimed a full ride';
  exception when raise_exception then
    assert sqlerrm = 'This ride is full.', sqlerrm;
  end;
end $$;

-- ===== Driver manages their ride =====
do $$
declare v_ride uuid := (select id from public.rides where resort_id = 'copper');
begin
  assert public.ride_contact(v_ride) = '@demo.driver', 'driver sees own contact';
  -- Driver removes the new student from the copper ride.
  delete from public.ride_seats where ride_id = v_ride and rider_id = '33333333-3333-4333-8333-333333333333';
  assert (select seats_taken from public.ride_board where id = v_ride) = 0, 'driver can remove a rider';
  -- Driver cancels: it disappears from the board and can't be claimed.
  update public.rides set cancelled_at = now() where id = v_ride;
  assert not exists (select 1 from public.ride_board where id = v_ride), 'cancelled ride hidden';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
set role authenticated;
do $$ begin
  begin
    perform public.claim_seat((select id from public.rides where resort_id = 'copper'));
    raise exception 'FAIL: claimed cancelled ride';
  exception when raise_exception then
    assert sqlerrm = 'The driver cancelled this ride.', sqlerrm;
  end;
  -- Rider leaves a seat on their own.
  delete from public.ride_seats where rider_id = '22222222-2222-4222-8222-222222222222'
    and ride_id = (select id from public.rides where resort_id = 'abasin');
  assert (select seats_taken from public.ride_board where resort_id = 'abasin') = 0, 'rider can leave';
  -- Rider can't delete someone else's seat.
  delete from public.ride_seats where rider_id <> '22222222-2222-4222-8222-222222222222';
  reset role;
  assert (select count(*) from public.ride_seats) = 1, 'other seats untouched';
end $$;

select 'ALL TESTS PASSED' as result;
