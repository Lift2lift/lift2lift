-- Safety: blocking, reporting, the word filter and deleting an account.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('c8888888-8888-4888-8888-888888888881', 'dee@lift2lift.test', '{"full_name":"Dee Driver"}'),
  ('c8888888-8888-4888-8888-888888888882', 'max@lift2lift.test', '{"full_name":"Max Mogul"}'),
  ('c8888888-8888-4888-8888-888888888883', 'ola@lift2lift.test', '{"full_name":"Ola Ollie"}');
insert into public.driver_verifications (user_id, status) values ('c8888888-8888-4888-8888-888888888881', 'submitted');
select public.test_make_ready('c8888888-8888-4888-8888-888888888881');
select public.test_make_ready('c8888888-8888-4888-8888-888888888882');
select public.test_make_ready('c8888888-8888-4888-8888-888888888883');
insert into storage.objects (bucket_id, name) values ('avatars', 'c8888888-8888-4888-8888-888888888881/test.jpg');

create temp table day22 as select (date_trunc('day', now() at time zone 'America/Denver') + interval '22 days') as d;
grant select on day22 to authenticated;
create temp table sids (name text primary key, id uuid);
grant select, insert on sids to authenticated;

-- ===== Dee posts a ride; Max books it and chats =====
set role authenticated;
select set_config('request.jwt.claim.sub', 'c8888888-8888-4888-8888-888888888881', false);
do $$
declare d timestamp := (select d from day22); v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact)
  values ('copper', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '16 hours') at time zone 'America/Denver',
          'Center Village', 'Kittredge', 3, 10, '303-555-0101')
  returning id into v_id;
  insert into sids values ('ride', v_id);
end $$;

select set_config('request.jwt.claim.sub', 'c8888888-8888-4888-8888-888888888882', false);
do $$
declare v_ride uuid := (select id from sids where name = 'ride'); v_msg uuid;
begin
  perform public.claim_seat(v_ride, 'both', true);
  insert into public.ride_messages (ride_id, body) values (v_ride, 'See you at Kittredge') returning id into v_msg;
  insert into sids values ('msg', v_msg);

  -- The word filter, whole words only and any case.
  begin
    insert into public.ride_messages (ride_id, body) values (v_ride, 'you are a RETARD');
    raise exception 'FAIL: slur in chat';
  exception when raise_exception then assert sqlerrm like 'That includes language%', sqlerrm;
  end;
  begin
    insert into public.ride_messages (ride_id, body) values (v_ride, 'just kill   yourself');
    raise exception 'FAIL: phrase in chat';
  exception when raise_exception then assert sqlerrm like 'That includes language%', sqlerrm;
  end;
  insert into public.ride_messages (ride_id, body) values (v_ride, 'Grape juice for the drive, and Scunthorpe slush');
  begin
    update public.profiles set bio = 'total slut' where id = auth.uid();
    raise exception 'FAIL: slur in bio';
  exception when raise_exception then null;
  end;
  update public.profiles set bio = 'Park rat' where id = auth.uid();

  -- Nobody writes the tables directly.
  begin
    insert into public.user_blocks (blocker_id, blocked_id) values (auth.uid(), 'c8888888-8888-4888-8888-888888888883');
    raise exception 'FAIL: direct block insert';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.reports (reported_user_id, kind, reason) values ('c8888888-8888-4888-8888-888888888883', 'profile', 'spam');
    raise exception 'FAIL: direct report insert';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ===== Dee reports Max's message and blocks him =====
select set_config('request.jwt.claim.sub', 'c8888888-8888-4888-8888-888888888881', false);
do $$
declare v_ride uuid := (select id from sids where name = 'ride'); v_msg uuid := (select id from sids where name = 'msg'); v_rep uuid;
begin
  assert (select count(*) from public.ride_messages where ride_id = v_ride) = 2, 'Dee sees both of Max''s messages';
  assert public.friend_request('c8888888-8888-4888-8888-888888888882') = 'sent', 'friend request before block';

  begin
    perform public.report_content(auth.uid(), 'profile', null, 'spam');
    raise exception 'FAIL: reported self';
  exception when raise_exception then null;
  end;
  begin
    perform public.report_content('c8888888-8888-4888-8888-888888888882', 'message', gen_random_uuid(), 'harassment');
    raise exception 'FAIL: reported a missing message';
  exception when no_data_found then null;
  end;
  begin
    perform public.report_content('c8888888-8888-4888-8888-888888888882', 'profile', null, 'not_a_reason');
    raise exception 'FAIL: bad reason';
  exception when check_violation then null;
  end;

  v_rep := public.report_content('c8888888-8888-4888-8888-888888888882', 'message', v_msg, 'harassment', 'Rude');
  assert (select snapshot from public.reports where id = v_rep) = 'See you at Kittredge', 'report keeps a copy of the message';
  assert (select count(*) from public.reports) = 1, 'reporter sees only their own reports';

  perform public.block_user('c8888888-8888-4888-8888-888888888882');
  perform public.block_user('c8888888-8888-4888-8888-888888888882'); -- twice is harmless
  assert (select count(*) from public.ride_messages where ride_id = v_ride) = 0, 'blocked messages are hidden';
  assert (select count(*) from public.friendships) = 0, 'blocking ends the friend request';
  assert public.hidden_people() = array['c8888888-8888-4888-8888-888888888882'::uuid], 'hidden people';
  assert jsonb_array_length(public.my_blocks()) = 1, 'my blocks';
  assert jsonb_array_length(public.search_people('Max')) = 0, 'blocked people are not in search';
  begin
    perform public.friend_request('c8888888-8888-4888-8888-888888888882');
    raise exception 'FAIL: friend request while blocked';
  exception when raise_exception then null;
  end;
end $$;

-- ===== Max is hidden from Dee, and Dee from Max, without being told who blocked whom =====
select set_config('request.jwt.claim.sub', 'c8888888-8888-4888-8888-888888888882', false);
do $$
begin
  assert public.hidden_people() = array['c8888888-8888-4888-8888-888888888881'::uuid], 'blocked person also hides the blocker';
  assert jsonb_array_length(public.my_blocks()) = 0, 'Max blocked nobody';
  assert (select count(*) from public.user_blocks) = 0, 'Max can''t see who blocked him';
  assert jsonb_array_length(public.search_people('Dee')) = 0, 'blocker is not in search either';
  begin
    perform public.friend_request('c8888888-8888-4888-8888-888888888881');
    raise exception 'FAIL: friend request to blocker';
  exception when raise_exception then null;
  end;
end $$;

-- ===== Ola can't book next to Max once she blocks him =====
select set_config('request.jwt.claim.sub', 'c8888888-8888-4888-8888-888888888883', false);
do $$
declare v_ride uuid := (select id from sids where name = 'ride');
begin
  perform public.block_user('c8888888-8888-4888-8888-888888888882');
  begin
    perform public.claim_seat(v_ride, 'both', true);
    raise exception 'FAIL: booked a ride with someone she blocked';
  exception when raise_exception then assert sqlerrm like 'This ride isn''t available%', sqlerrm;
  end;
  perform public.unblock_user('c8888888-8888-4888-8888-888888888882');
  assert public.hidden_people() = '{}', 'unblocked';
  perform public.claim_seat(v_ride, 'both', true);
end $$;
reset role;

-- ===== Deleting Dee's account removes her rides, seats, chat, blocks and friendships =====
do $$
declare v_ride uuid := (select id from sids where name = 'ride');
begin
  delete from auth.users where id = 'c8888888-8888-4888-8888-888888888881';
  assert not exists (select 1 from public.profiles where id = 'c8888888-8888-4888-8888-888888888881'), 'profile gone';
  assert not exists (select 1 from public.rides where id = v_ride), 'her ride is gone';
  assert not exists (select 1 from public.ride_seats where ride_id = v_ride), 'its seats are gone';
  assert not exists (select 1 from public.ride_messages where ride_id = v_ride), 'its chat is gone';
  assert not exists (select 1 from public.user_blocks where blocker_id = 'c8888888-8888-4888-8888-888888888881'), 'her blocks are gone';
  assert not exists (select 1 from public.driver_verifications where user_id = 'c8888888-8888-4888-8888-888888888881'), 'verification gone';
  assert (select reporter_id from public.reports limit 1) is null, 'her report stays for moderators, without her';
end $$;

select 'ALL SAFETY TESTS PASSED' as result;
