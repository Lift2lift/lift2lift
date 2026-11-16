-- Ride requests: riders request, drivers confirm or deny, requests expire 2 hours out.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2000000-0000-4000-8000-0000000000a1', 'dana@lift2lift.test', '{"full_name":"Dana Driver"}'),
  ('e2000000-0000-4000-8000-0000000000b1', 'rio@lift2lift.test', '{"full_name":"Rio Rider"}'),
  ('e2000000-0000-4000-8000-0000000000c1', 'sky@lift2lift.test', '{"full_name":"Sky Skier"}'),
  ('e2000000-0000-4000-8000-0000000000d1', 'taz@lift2lift.test', '{"full_name":"Taz Tele"}');
insert into public.driver_verifications (user_id, status) values ('e2000000-0000-4000-8000-0000000000a1', 'submitted');
select public.test_make_ready(id) from (values
  ('e2000000-0000-4000-8000-0000000000a1'::uuid), ('e2000000-0000-4000-8000-0000000000b1'),
  ('e2000000-0000-4000-8000-0000000000c1'), ('e2000000-0000-4000-8000-0000000000d1')) v(id);

-- Drain anything earlier suites left in the outbox, so counts below are ours.
select count(*) from public.claim_due_notifications();

create temp table day25 as select (date_trunc('day', now() at time zone 'America/Denver') + interval '25 days') as d;
grant select on day25 to authenticated;
create temp table rids (name text primary key, id uuid);
grant select, insert on rids to authenticated;

-- Seats that already existed (or the service adds by hand) are confirmed.
do $$ begin
  assert (select column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'ride_seats' and column_name = 'status') = '''confirmed''::text',
         'existing seats default to confirmed';
end $$;

-- ===== Dana posts a round trip to Copper with 2 seats =====
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000a1', false);
do $$
declare d timestamp := (select d from day25); v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact)
  values ('copper', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '16 hours') at time zone 'America/Denver',
          'Center Village', 'Kittredge', 2, 10, '303-555-0142')
  returning id into v_id;
  insert into rids values ('ride', v_id);
end $$;

-- ===== Rio requests both ways =====
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000b1', false);
do $$
declare v uuid := (select id from rids where name = 'ride'); b record; t jsonb;
begin
  perform public.claim_seat(v, 'both', true);
  assert (select status from public.ride_seats where ride_id = v and rider_id = auth.uid()) = 'pending', 'booking makes a request';

  -- The request holds a seat, but Rio isn't in the car yet.
  select * into b from public.ride_board where id = v;
  assert b.seats_taken = 1 and b.seats_pending = 1, format('board counts %s / %s', b.seats_taken, b.seats_pending);
  assert b.rider_ids = '{}' and b.rider_names = '{}', 'pending riders aren''t shown in the car';
  assert b.my_seat_status = 'pending' and b.my_seat_legs = 'both', 'Rio sees his own request';

  -- No contact, chat or passenger list until Dana says yes.
  assert public.ride_contact(v) is null, 'contact hidden while pending';
  begin
    insert into public.ride_messages (ride_id, body) values (v, 'hey');
    raise exception 'FAIL: pending rider chatted';
  exception when insufficient_privilege then null;
  end;
  t := public.my_trips()->0;
  assert t->>'my_status' = 'pending' and t->>'role' = 'passenger', 'Your Rides shows the request';
  assert t->>'contact' = '' and jsonb_array_length(t->'passengers') = 0, 'request hides contact and passengers';
  assert (t->>'expires_at')::timestamptz = (t->>'depart_at')::timestamptz - interval '2 hours', 'expires 2 hours before it leaves';

  -- Only the driver answers.
  begin
    perform public.respond_seat_request(v, auth.uid(), true);
    raise exception 'FAIL: rider confirmed himself';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ===== Sky requests the ride up, which fills it; Taz is turned away =====
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000c1', false);
do $$ begin
  perform public.claim_seat((select id from rids where name = 'ride'), 'to', true);
end $$;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000d1', false);
do $$ begin
  begin
    perform public.claim_seat((select id from rids where name = 'ride'), 'to', true);
    raise exception 'FAIL: requests didn''t hold seats';
  exception when raise_exception then assert sqlerrm = 'The ride up is full.', sqlerrm;
  end;
end $$;
reset role;

-- The driver got a push for each request.
do $$
declare o record; n int := 0;
begin
  for o in select * from public.push_outbox where kind = 'seat_request' and ride_id = (select id from rids where name = 'ride') order by id loop
    n := n + 1;
    assert o.user_id = 'e2000000-0000-4000-8000-0000000000a1', 'request push goes to the driver';
    if n = 1 then
      assert o.title = 'New ride request', o.title;
      assert o.body like 'Rio wants a round-trip seat to Copper Mountain on ___, ___ %. Confirm or deny by 5:00 AM.', o.body;
      assert o.url like 'lift2lift:///rides?ride=%&leg=to', o.url;
    else
      assert o.body like 'Sky wants a seat up to Copper Mountain on %', o.body;
    end if;
  end loop;
  assert n = 2, 'two request pushes, got ' || n;
end $$;

-- ===== Dana sees both requests, denies Sky and confirms Rio =====
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000a1', false);
do $$
declare v uuid := (select id from rids where name = 'ride'); t jsonb;
begin
  t := public.my_trips()->0;
  assert t->>'role' = 'driver', 'driver trip';
  assert jsonb_array_length(t->'requests') = 2, 'driver sees 2 requests';
  assert t->'requests'->0->>'name' = 'Rio Rider' and t->'requests'->0->>'legs' = 'both', 'Rio first';
  assert t->'requests'->1->>'legs' = 'to', 'Sky wants the ride up';
  assert jsonb_array_length(t->'passengers') = 0, 'no passengers yet';

  perform public.respond_seat_request(v, 'e2000000-0000-4000-8000-0000000000c1', false);
  assert not exists (select 1 from public.ride_seats where ride_id = v and rider_id = 'e2000000-0000-4000-8000-0000000000c1'), 'denied seat freed';
  assert (select seats_taken_to from public.ride_board where id = v) = 1, 'the ride up has room again';

  perform public.respond_seat_request(v, 'e2000000-0000-4000-8000-0000000000b1', true);
  perform public.respond_seat_request(v, 'e2000000-0000-4000-8000-0000000000b1', true); -- double tap: no-op
  assert (select status from public.ride_seats where ride_id = v and rider_id = 'e2000000-0000-4000-8000-0000000000b1') = 'confirmed', 'Rio confirmed';
  assert (select rider_names from public.ride_board where id = v) = array['Rio Rider'], 'Rio is in the car';

  begin
    perform public.respond_seat_request(v, 'e2000000-0000-4000-8000-0000000000b1', false);
    raise exception 'FAIL: denied a confirmed rider';
  exception when raise_exception then assert sqlerrm like 'They''re already confirmed.%', sqlerrm;
  end;
  begin
    perform public.respond_seat_request(v, 'e2000000-0000-4000-8000-0000000000c1', true);
    raise exception 'FAIL: answered a request that''s gone';
  exception when no_data_found then assert sqlerrm like 'That request is gone.%', sqlerrm;
  end;
end $$;

-- ===== Rio is in; Sky can't ask again =====
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000b1', false);
do $$
declare v uuid := (select id from rids where name = 'ride'); t jsonb;
begin
  assert public.ride_contact(v) = '303-555-0142', 'contact once confirmed';
  insert into public.ride_messages (ride_id, body) values (v, 'Thanks Dana! See you at Kittredge.');
  t := public.my_trips()->0;
  assert t->>'my_status' = 'confirmed' and t->>'contact' = '303-555-0142', 'Your Rides shows the confirmed seat';
  assert t->'expires_at' = 'null'::jsonb, 'confirmed seats don''t expire';
  assert jsonb_array_length(t->'requests') = 0, 'riders don''t see requests';
end $$;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000c1', false);
do $$ begin
  begin
    perform public.claim_seat((select id from rids where name = 'ride'), 'to', true);
    raise exception 'FAIL: re-requested after a denial';
  exception when raise_exception then assert sqlerrm like 'The driver turned down your request%', sqlerrm;
  end;
end $$;

-- ===== Taz requests, then cancels before the push goes out =====
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000d1', false);
do $$ begin
  perform public.claim_seat((select id from rids where name = 'ride'), 'to', true);
  delete from public.ride_seats where ride_id = (select id from rids where name = 'ride') and rider_id = auth.uid();
end $$;
reset role;

-- ===== The push job sends each step once =====
do $$
declare r record; kinds text[] := '{}';
begin
  for r in select * from public.claim_due_notifications() where ride_id = (select id from rids where name = 'ride') order by kind, user_id loop
    kinds := kinds || r.kind;
    if r.kind = 'seat_confirmed' then
      assert r.user_id = 'e2000000-0000-4000-8000-0000000000b1', 'confirm push to Rio';
      assert r.title = 'You''re in!', r.title;
      assert r.body like 'Dana confirmed your round-trip seat to Copper Mountain on %. Meet at Kittredge at 7:00 AM.', r.body;
      assert r.url like 'lift2lift:///rides?ride=%&leg=to', r.url;
      assert r.leg = 'to' and r.leg_at is not null, 'leg time for the countdown';
    elsif r.kind = 'seat_denied' then
      assert r.user_id = 'e2000000-0000-4000-8000-0000000000c1', 'deny push to Sky';
      assert r.title = 'Request declined', r.title;
      assert r.body like 'Dana declined your request for a seat up to Copper Mountain on %. Tap to find another ride.', r.body;
      assert r.url like 'lift2lift:///?resort=copper&day=____-__-__', r.url;
    end if;
  end loop;
  -- Dana answered Rio and Sky before the job ran and Taz cancelled, so the request
  -- pushes are dropped; the riders hear the answers.
  assert kinds = array['seat_confirmed', 'seat_denied'], kinds::text;
  assert not exists (select 1 from public.claim_due_notifications() where ride_id = (select id from rids where name = 'ride')), 'sent once';
end $$;

-- ===== Cancel and re-request doesn't spam the driver =====
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000d1', false);
do $$ begin
  perform public.claim_seat((select id from rids where name = 'ride'), 'to', true);
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.claim_due_notifications() where kind = 'seat_request') = 1, 'first request pushes';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000d1', false);
do $$ begin
  delete from public.ride_seats where ride_id = (select id from rids where name = 'ride') and rider_id = auth.uid();
  perform public.claim_seat((select id from rids where name = 'ride'), 'to', true);
  assert (select status from public.ride_seats where ride_id = (select id from rids where name = 'ride') and rider_id = auth.uid()) = 'pending', 'request is back';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.claim_due_notifications() where kind = 'seat_request') = 0, 'no second push within 30 minutes';
end $$;

-- ===== Someone in the car blocks the requester: Dana can't confirm, only deny =====
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000b1', false);
do $$ begin perform public.block_user('e2000000-0000-4000-8000-0000000000d1'); end $$;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000a1', false);
do $$
declare v uuid := (select id from rids where name = 'ride');
begin
  begin
    perform public.respond_seat_request(v, 'e2000000-0000-4000-8000-0000000000d1', true);
    raise exception 'FAIL: confirmed someone a passenger blocked';
  exception when raise_exception then assert sqlerrm like 'This request can''t be confirmed.%', sqlerrm;
  end;
  perform public.respond_seat_request(v, 'e2000000-0000-4000-8000-0000000000d1', false);
end $$;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000b1', false);
do $$ begin perform public.unblock_user('e2000000-0000-4000-8000-0000000000d1'); end $$;
reset role;
select count(*) from public.claim_due_notifications();

-- ===== Ride changes still reach a pending rider =====
-- Sky asks for a seat on a second ride of Dana's, a week later; Dana moves the meeting spot.
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000a1', false);
do $$
declare d timestamp := (select d from day25) + interval '7 days'; v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, leave_from, seats_total, gas_per_rider, contact)
  values ('eldora', 'to_mountain', (d + interval '8 hours') at time zone 'America/Denver', 'Basemar', 3, 0, '303-555-0142')
  returning id into v_id;
  insert into rids values ('later', v_id);
end $$;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000c1', false);
do $$ begin perform public.claim_seat((select id from rids where name = 'later'), 'both', true); end $$;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000a1', false);
do $$ begin update public.rides set leave_from = 'Table Mesa' where id = (select id from rids where name = 'later'); end $$;
reset role;
do $$
declare r record; n int := 0;
begin
  for r in select * from public.claim_due_notifications() where kind = 'ride_changed' loop
    n := n + 1;
    assert r.user_id = 'e2000000-0000-4000-8000-0000000000c1' and r.body like 'Dana changed the ride: meet at Table Mesa.', r::text;
  end loop;
  assert n = 1, 'pending rider hears about changes, got ' || n;
end $$;

-- ===== A request nobody answers expires 2 hours before it leaves =====
-- Taz requests the later ride; then it's moved (trigger off) to leave in 1h59m.
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000d1', false);
do $$ begin perform public.claim_seat((select id from rids where name = 'later'), 'both', true); end $$;
reset role;
select count(*) from public.claim_due_notifications();
alter table public.rides disable trigger rides_enforce_rules;
alter table public.rides disable trigger rides_announce_changes;
update public.rides set depart_at = now() + interval '119 minutes' where id = (select id from rids where name = 'later');
alter table public.rides enable trigger rides_announce_changes;
alter table public.rides enable trigger rides_enforce_rules;
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[taz-iphone-0001]', 'e2000000-0000-4000-8000-0000000000d1', 'ios');

set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000d1', false);
do $$
declare v uuid := (select id from rids where name = 'later');
begin
  -- Even before the job runs, a stale request doesn't hold a seat or show in Your Rides.
  assert (select seats_taken from public.ride_board where id = v) = 0, 'expired request holds no seat';
  assert not exists (select 1 from jsonb_array_elements(public.my_trips()) e where e->>'id' = v::text), 'expired request left Your Rides';
end $$;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000a1', false);
do $$
declare v uuid := (select id from rids where name = 'later'); t jsonb;
begin
  -- Sky's and Taz's requests both ran out.
  select e into t from jsonb_array_elements(public.my_trips()) e where e->>'id' = v::text;
  assert jsonb_array_length(t->'requests') = 0, 'expired requests left the driver''s list';
  begin
    perform public.respond_seat_request(v, 'e2000000-0000-4000-8000-0000000000d1', true);
    raise exception 'FAIL: confirmed an expired request';
  exception when no_data_found then assert sqlerrm like 'That request is gone.%', sqlerrm;
  end;
end $$;
reset role;

do $$
declare v uuid := (select id from rids where name = 'later'); r record; n int := 0;
begin
  for r in select * from public.claim_due_notifications() where ride_id = v loop
    n := n + 1;
    assert r.kind = 'request_expired' and r.title = 'Request expired', r::text;
    assert r.body like 'Dana didn''t confirm your seat to Eldora on %, so the request expired. Tap to find another ride.', r.body;
    assert r.url like 'lift2lift:///?resort=eldora&day=%', r.url;
    if r.user_id = 'e2000000-0000-4000-8000-0000000000d1' then
      assert r.tokens = array['ExponentPushToken[taz-iphone-0001]'], 'Taz''s phone';
    end if;
  end loop;
  assert n = 2, 'Sky and Taz hear their requests expired, got ' || n;
  assert not exists (select 1 from public.ride_seats where ride_id = v), 'expired seats freed';
  assert (select count(*) from public.claim_due_notifications() where ride_id = v) = 0, 'expiry sent once';
end $$;

-- Too late to ask again: booking closes 2 hours out.
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-0000000000d1', false);
do $$ begin
  begin
    perform public.claim_seat((select id from rids where name = 'later'), 'both', true);
    raise exception 'FAIL: booked inside 2 hours';
  exception when raise_exception then assert sqlerrm like 'Booking closed.%', sqlerrm;
  end;
end $$;
reset role;

-- Nobody reads the outbox or the denials directly.
set role authenticated;
do $$ begin
  begin
    perform 1 from public.push_outbox;
    raise exception 'FAIL: read the outbox';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.ride_seat_denials;
    raise exception 'FAIL: read denials';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.expire_seat_requests();
    raise exception 'FAIL: ran the expiry job';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL RIDE REQUEST TESTS PASSED';
