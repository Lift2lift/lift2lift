-- Editing a ride: what can change once riders are booked, chat updates, pushes, and reminder resets.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('a7777777-7777-4777-8777-777777777777', 'kit@lift2lift.test', '{"full_name":"Kit Keys"}'),
  ('b7777777-7777-4777-8777-777777777777', 'lou@lift2lift.test', '{"full_name":"Lou Lift"}');
insert into public.driver_verifications (user_id, status) values ('a7777777-7777-4777-8777-777777777777', 'submitted');
select public.test_make_ready('a7777777-7777-4777-8777-777777777777');
select public.test_make_ready('b7777777-7777-4777-8777-777777777777');

create temp table day21 as select (date_trunc('day', now() at time zone 'America/Denver') + interval '21 days') as d;
grant select on day21 to authenticated;
create temp table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;

-- ===== Kit posts, then edits freely while nobody's booked =====
set role authenticated;
select set_config('request.jwt.claim.sub', 'a7777777-7777-4777-8777-777777777777', false);
do $$
declare d timestamp := (select d from day21); v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact)
  values ('copper', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '16 hours') at time zone 'America/Denver',
          'Center Village', 'Kittredge', 3, 10, '303-555-0100')
  returning id into v_id;
  insert into ids values ('ride', v_id);

  -- No riders yet: mountain, day and gas can all change.
  update public.rides set resort_id = 'abasin', depart_at = depart_at + interval '1 day', return_at = return_at + interval '1 day', gas_per_rider = 12
  where id = v_id;
  update public.rides set resort_id = 'copper', depart_at = depart_at - interval '1 day', return_at = return_at - interval '1 day', gas_per_rider = 10
  where id = v_id;
  assert (public.ride_for_edit(v_id)->>'contact') = '303-555-0100', 'driver gets the edit form';
  assert (select count(*) from public.ride_messages where ride_id = v_id) = 0, 'no update messages without riders';
end $$;
reset role;

-- ===== Lou books both ways =====
select set_config('request.jwt.claim.sub', 'b7777777-7777-4777-8777-777777777777', false);
set role authenticated;
do $$
declare v_id uuid := (select id from ids where name = 'ride');
begin
  perform public.claim_seat(v_id, 'both');
  assert public.ride_for_edit(v_id) is null, 'riders can''t open the edit form';
  update public.rides set notes = 'hacked' where id = v_id;
  assert (select notes from public.rides where id = v_id) = '', 'riders can''t edit the ride';
  begin
    insert into public.ride_messages (ride_id, body, kind) values (v_id, 'fake update', 'update');
    raise exception 'FAIL: rider posted an update line';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ===== Kit edits with a rider booked =====
select set_config('request.jwt.claim.sub', 'a7777777-7777-4777-8777-777777777777', false);
-- A reminder already went out for the ride up; a new time should send it again.
insert into public.ride_notifications_sent (ride_id, leg, user_id, kind)
select id, 'to', 'b7777777-7777-4777-8777-777777777777', 'two_hours' from ids where name = 'ride';
insert into public.ride_notifications_sent (ride_id, leg, user_id, kind)
select id, 'from', 'b7777777-7777-4777-8777-777777777777', 'two_hours' from ids where name = 'ride';
set role authenticated;
do $$
declare v_id uuid := (select id from ids where name = 'ride'); m text;
begin
  begin
    update public.rides set resort_id = 'abasin' where id = v_id;
    raise exception 'FAIL: changed mountain with a rider';
  exception when raise_exception then assert sqlerrm like 'Riders already booked this trip, so the mountain can''t change.%', sqlerrm;
  end;
  begin
    update public.rides set depart_at = depart_at + interval '1 day', return_at = return_at + interval '1 day' where id = v_id;
    raise exception 'FAIL: moved day with a rider';
  exception when raise_exception then assert sqlerrm like 'Riders are booked for %, so the ride can''t move to another day.%', sqlerrm;
  end;
  begin
    update public.rides set gas_per_rider = 11 where id = v_id;
    raise exception 'FAIL: raised gas with a rider';
  exception when raise_exception then assert sqlerrm = 'Riders already agreed to $10 for gas. You can lower it, but not raise it.', sqlerrm;
  end;

  -- Same day, new time, cheaper gas, new spot: fine, and the car hears about it.
  update public.rides set depart_at = depart_at + interval '30 minutes', gas_per_rider = 8, leave_from = 'Williams Village' where id = v_id;
  m := 'Kit changed the ride: leaves at 7:30 AM (was 7:00 AM), meet at Williams Village, gas is now $8 (was $10).';
  assert exists (select 1 from public.ride_messages where ride_id = v_id and kind = 'update' and body = m),
    (select string_agg(body, ' | ') from public.ride_messages where ride_id = v_id);

  update public.rides set return_at = return_at + interval '30 minutes', return_meet = 'Copper Station' where id = v_id;
  m := 'Kit changed the ride: heads back at 4:30 PM (was 4:00 PM), the ride back meets at Copper Station.';
  assert exists (select 1 from public.ride_messages where ride_id = v_id and kind = 'update' and body = m),
    (select string_agg(body, ' | ') from public.ride_messages where ride_id = v_id);

  -- A save that changes nothing posts nothing.
  update public.rides set notes = notes where id = v_id;
  assert (select count(*) from public.ride_messages where ride_id = v_id and kind = 'update') = 2, 'no-op save is quiet';

end $$;
reset role;

do $$
declare v_id uuid := (select id from ids where name = 'ride');
begin
  assert not exists (select 1 from public.ride_notifications_sent where ride_id = v_id), 'new times reset both legs'' reminders';
end $$;

select set_config('request.jwt.claim.sub', 'b7777777-7777-4777-8777-777777777777', false);
set role authenticated;
do $$
declare v_id uuid := (select id from ids where name = 'ride');
begin
  assert (select count(*) from public.ride_messages where ride_id = v_id and kind = 'update') = 2, 'rider sees update lines';
end $$;
reset role;

-- ===== Pushes: each update goes to the rider once =====
do $$
declare v_id uuid := (select id from ids where name = 'ride'); n int; r record;
begin
  select count(*) into n from public.claim_due_notifications() where kind = 'ride_changed';
  assert n = 2, 'two update pushes, got ' || n;
  select count(*) into n from public.claim_due_notifications() where kind = 'ride_changed';
  assert n = 0, 'pushed once';
end $$;

-- ===== Cancel tells everyone =====
select set_config('request.jwt.claim.sub', 'a7777777-7777-4777-8777-777777777777', false);
set role authenticated;
do $$
declare v_id uuid := (select id from ids where name = 'ride');
begin
  update public.rides set cancelled_at = now() where id = v_id;
  assert public.ride_for_edit(v_id) is null, 'cancelled rides aren''t editable';
end $$;
reset role;
do $$
declare r record; n int := 0;
begin
  for r in select * from public.claim_due_notifications() where kind = 'ride_changed' loop
    n := n + 1;
    assert r.title = 'Ride cancelled' and r.body = 'Kit cancelled this ride.' and r.user_id = 'b7777777-7777-4777-8777-777777777777', r::text;
  end loop;
  assert n = 1, 'one cancel push';
end $$;

-- ===== Finished rides can't be edited =====
select set_config('request.jwt.claim.sub', 'a7777777-7777-4777-8777-777777777777', false);
set role authenticated;
do $$
declare d timestamp := (select d from day21) + interval '3 days'; v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, leave_from, seats_total, gas_per_rider, contact)
  values ('eldora', 'to_mountain', (d + interval '8 hours') at time zone 'America/Denver', 'Kittredge', 2, 5, '303')
  returning id into v_id;
  insert into ids values ('old', v_id);
end $$;
reset role;
alter table public.rides disable trigger rides_enforce_rules;
update public.rides set depart_at = now() - interval '3 hours', ride_date = (now() at time zone 'America/Denver')::date
where id = (select id from ids where name = 'old');
alter table public.rides enable trigger rides_enforce_rules;
set role authenticated;
do $$
declare v_id uuid := (select id from ids where name = 'old');
begin
  begin
    update public.rides set notes = 'late edit' where id = v_id;
    raise exception 'FAIL: edited a finished ride';
  exception when raise_exception then assert sqlerrm = 'This ride is over, so it can''t be edited.', sqlerrm;
  end;
end $$;
reset role;

select 'ALL RIDE EDIT TESTS PASSED' as result;
