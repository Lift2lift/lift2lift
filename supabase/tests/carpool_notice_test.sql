-- Colorado carpool notice (C.R.S. 43-1-127(1)(c)): no seat without acknowledging it, and the seat keeps when.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('c8888888-8888-4888-8888-888888888888', 'nell@lift2lift.test', '{"full_name":"Nell Notice"}'),
  ('d8888888-8888-4888-8888-888888888888', 'ozzy@lift2lift.test', '{"full_name":"Ozzy Okay"}');
insert into public.driver_verifications (user_id, status) values ('c8888888-8888-4888-8888-888888888888', 'submitted');
select public.test_make_ready('c8888888-8888-4888-8888-888888888888');
select public.test_make_ready('d8888888-8888-4888-8888-888888888888');

create temp table notice_ids (name text primary key, id uuid);
grant select, insert on notice_ids to authenticated;

-- Nell posts a ride three weeks out.
set role authenticated;
select set_config('request.jwt.claim.sub', 'c8888888-8888-4888-8888-888888888888', false);
do $$
declare d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '22 days'; v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact)
  values ('keystone', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '16 hours') at time zone 'America/Denver',
          'River Run', 'Folsom Field', 3, 8, '303-555-0188')
  returning id into v_id;
  insert into notice_ids values ('ride', v_id);
end $$;

-- Ozzy can't book without acknowledging the notice, and can't skip the check by calling the rules directly.
select set_config('request.jwt.claim.sub', 'd8888888-8888-4888-8888-888888888888', false);
do $$
declare v_id uuid := (select id from notice_ids where name = 'ride'); v_ack timestamptz;
begin
  begin
    perform public.claim_seat(v_id);
    raise exception 'FAIL: booked without acknowledging (default)';
  exception when raise_exception then
    assert sqlerrm = 'Read and acknowledge the Colorado carpool notice to book a seat.', sqlerrm;
  end;
  begin
    perform public.claim_seat(v_id, 'both', false);
    raise exception 'FAIL: booked with p_notice_ack = false';
  exception when raise_exception then
    assert sqlerrm like 'Read and acknowledge%', sqlerrm;
  end;
  begin
    perform public.claim_seat(v_id, 'both', null);
    raise exception 'FAIL: booked with p_notice_ack = null';
  exception when raise_exception then
    assert sqlerrm like 'Read and acknowledge%', sqlerrm;
  end;
  begin
    perform public.claim_seat_rules(v_id, 'both');
    raise exception 'FAIL: called claim_seat_rules directly';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.ride_seats where ride_id = v_id), 'no seat yet';

  -- Acknowledged: booked, with the time on the seat.
  perform public.claim_seat(v_id, 'to', true);
  select notice_ack_at into v_ack from public.ride_seats where ride_id = v_id and rider_id = auth.uid();
  assert v_ack is not null, 'acknowledgment recorded';
  assert v_ack > now() - interval '1 minute', 'acknowledgment is recent';
  assert (select legs from public.ride_seats where ride_id = v_id and rider_id = auth.uid()) = 'to', 'legs passed through';

  -- Booking again is a no-op and keeps the first acknowledgment.
  perform public.claim_seat(v_id, 'both', true);
  assert (select count(*) from public.ride_seats where ride_id = v_id) = 1, 'still one seat';
  assert (select notice_ack_at from public.ride_seats where ride_id = v_id and rider_id = auth.uid()) = v_ack, 'first acknowledgment kept';
end $$;
reset role;

-- Signed out can't call it at all.
set role anon;
do $$
begin
  begin
    perform public.claim_seat(gen_random_uuid(), 'both', true);
    raise exception 'FAIL: anon booked';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL CARPOOL NOTICE TESTS PASSED' as result;
