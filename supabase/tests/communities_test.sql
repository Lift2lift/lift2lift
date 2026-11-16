-- Communities: codes, joining and setting up, members-only rides, admin tools.
\set ON_ERROR_STOP on

-- The migration ships 50 codes; two are already named.
do $$
begin
  assert (select count(*) from public.communities) = 50, 'fifty codes';
  assert (select count(*) from public.communities where name in ('CU Freeride', 'CU Freeski')) = 2, 'two named';
  assert (select count(*) from public.communities where code is not null) = 0, 'no plain-text codes stored';
  assert public.community_code_hash(' abc-def ghj ') = public.community_code_hash('ABCDEFGHJ'), 'codes ignore case, spaces and dashes';
end $$;

-- Two test communities with known codes: one named (no admin yet), one brand new.
insert into public.communities (code_hash, name) values
  (public.community_code_hash('TESTCLUB2'), 'Test Club'),
  (public.community_code_hash('NEWCODE22'), null);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aa111111-1111-4111-8111-111111111111', 'ava@lift2lift.test', '{"full_name":"Ava Admin"}'),
  ('bb111111-1111-4111-8111-111111111111', 'ben@lift2lift.test', '{"full_name":"Ben Member"}'),
  ('cc111111-1111-4111-8111-111111111111', 'cal@lift2lift.test', '{"full_name":"Cal Driver"}'),
  ('dd111111-1111-4111-8111-111111111111', 'dee@lift2lift.test', '{"full_name":"Dee Outsider"}');
insert into public.driver_verifications (user_id, status) values
  ('cc111111-1111-4111-8111-111111111111', 'submitted'),
  ('dd111111-1111-4111-8111-111111111111', 'submitted');
select public.test_make_ready('aa111111-1111-4111-8111-111111111111');
select public.test_make_ready('bb111111-1111-4111-8111-111111111111');
select public.test_make_ready('cc111111-1111-4111-8111-111111111111');
select public.test_make_ready('dd111111-1111-4111-8111-111111111111');

create temp table cm (name text primary key, id uuid);
grant select, insert, update on cm to authenticated;
insert into cm values ('club', (select id from public.communities where name = 'Test Club'));

set role authenticated;

-- Ava is first in with a messy version of the code, so she becomes admin.
select set_config('request.jwt.claim.sub', 'aa111111-1111-4111-8111-111111111111', false);
do $$
declare r jsonb;
begin
  r := public.join_community(' testclub-2 ');
  assert r->>'status' = 'joined' and r->>'role' = 'admin' and r->>'name' = 'Test Club', r::text;
  r := public.join_community('TESTCLUB2');
  assert r->>'status' = 'already', r::text;
  begin
    perform public.join_community('SHORT');
    raise exception 'FAIL: short code accepted';
  exception when raise_exception then
    assert sqlerrm = 'Community codes are 9 characters.', sqlerrm;
  end;
  assert (public.my_communities()->0->>'code') = 'TESTCLUB2', 'the admin sees the code';
end $$;

-- Ben joins as a member; Cal (a driver) joins too.
select set_config('request.jwt.claim.sub', 'bb111111-1111-4111-8111-111111111111', false);
do $$
declare r jsonb;
begin
  r := public.join_community('testclub2');
  assert r->>'status' = 'joined' and r->>'role' = 'member', r::text;
  -- A brand-new code: Ben has to set it up first.
  r := public.join_community('NEWCODE22');
  assert r->>'status' = 'needs_setup', r::text;
  begin
    perform public.setup_community('NEWCODE22', 'x');
    raise exception 'FAIL: one-letter name';
  exception when raise_exception then
    assert sqlerrm like 'Give the community a name%', sqlerrm;
  end;
  r := public.setup_community('newcode22', '  Night   Owls ', 'Dawn patrol crew');
  assert r->>'status' = 'joined' and r->>'role' = 'admin' and r->>'name' = 'Night Owls', r::text;
  insert into cm values ('owls', (r->>'id')::uuid);
  begin
    perform public.setup_community('NEWCODE22', 'Hijack');
    raise exception 'FAIL: set up twice';
  exception when raise_exception then
    assert sqlerrm like 'This community is already set up%', sqlerrm;
  end;
  assert jsonb_array_length(public.my_communities()) = 2, 'Ben is in two';
end $$;

select set_config('request.jwt.claim.sub', 'cc111111-1111-4111-8111-111111111111', false);
do $$
declare d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '20 days'; v_id uuid;
begin
  perform public.join_community('TESTCLUB2');
  -- A members-only ride and an open ride.
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id)
  values ('eldora', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', (select id from cm where name = 'club'))
  returning id into v_id;
  insert into cm values ('club_ride', v_id);
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact)
  values ('loveland', 'round_trip', (d + interval '1 day 7 hours') at time zone 'America/Denver', (d + interval '1 day 15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111')
  returning id into v_id;
  insert into cm values ('open_ride', v_id);
  assert (select community_name from public.ride_board where id = (select id from cm where name = 'club_ride')) = 'Test Club', 'board names the community';
  -- Can't post to a community you're not in.
  begin
    insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id)
    values ('eldora', 'round_trip', (d + interval '2 days 7 hours') at time zone 'America/Denver', (d + interval '2 days 15 hours') at time zone 'America/Denver',
            'Base', 'Farrand Field', 3, 5, '303-555-0111', (select id from cm where name = 'owls'));
    raise exception 'FAIL: posted to a community Cal is not in';
  exception when raise_exception then
    assert sqlerrm = 'You can only post rides to communities you''re in.', sqlerrm;
  end;
end $$;

-- Dee isn't a member: can't see, find or book the club ride, but sees the open one.
select set_config('request.jwt.claim.sub', 'dd111111-1111-4111-8111-111111111111', false);
do $$
declare v_club uuid := (select id from cm where name = 'club_ride');
begin
  assert not exists (select 1 from public.ride_board where id = v_club), 'outsider: not on the board';
  assert not exists (select 1 from public.rides where id = v_club), 'outsider: not in rides';
  assert exists (select 1 from public.ride_board where id = (select id from cm where name = 'open_ride')), 'outsider sees open rides';
  assert not exists (select 1 from public.communities), 'outsider sees no communities';
  assert not exists (select 1 from public.community_members), 'outsider sees no members';
  assert jsonb_array_length(public.profile_page('cc111111-1111-4111-8111-111111111111')->'upcoming') = 1, 'profile hides the club ride';
  begin
    perform public.claim_seat(v_club, 'both', true);
    raise exception 'FAIL: outsider booked a club ride';
  exception when raise_exception then
    assert sqlerrm = 'This ride is only for members of Test Club.', sqlerrm;
  end;
  begin
    perform public.community_page((select id from cm where name = 'club'));
    raise exception 'FAIL: outsider read the community page';
  exception when raise_exception then
    assert sqlerrm like 'You''re not in this community%', sqlerrm;
  end;
  begin
    perform code_hash from public.communities;
    raise exception 'FAIL: code_hash readable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Ben (member) sees it and books it; then everyone can see Ben's seat only if they can see the ride.
select set_config('request.jwt.claim.sub', 'bb111111-1111-4111-8111-111111111111', false);
do $$
declare v_club uuid := (select id from cm where name = 'club_ride');
begin
  assert exists (select 1 from public.ride_board where id = v_club), 'member sees the club ride';
  assert jsonb_array_length(public.profile_page('cc111111-1111-4111-8111-111111111111')->'upcoming') = 2, 'member sees both on the profile';
  perform public.claim_seat(v_club, 'both', true);
  assert (select seats_taken from public.ride_board where id = v_club) = 1, 'booked';
  perform 1 from public.community_page((select id from cm where name = 'club')) p
  where jsonb_array_length(p->'members') = 3 and p->>'my_role' = 'member' and (p->'members'->0->>'role') = 'admin';
  assert found, 'community page lists 3 members, admin first';
end $$;

select set_config('request.jwt.claim.sub', 'dd111111-1111-4111-8111-111111111111', false);
do $$
begin
  assert not exists (select 1 from public.ride_seats where ride_id = (select id from cm where name = 'club_ride')), 'outsider sees no seats on the club ride';
end $$;

-- The driver can't flip the ride to open once someone's booked.
select set_config('request.jwt.claim.sub', 'cc111111-1111-4111-8111-111111111111', false);
do $$
begin
  begin
    update public.rides set community_id = null where id = (select id from cm where name = 'club_ride');
    raise exception 'FAIL: changed community after booking';
  exception when raise_exception then
    assert sqlerrm like 'Riders already booked this trip, so who can see it%', sqlerrm;
  end;
  assert (public.ride_for_edit((select id from cm where name = 'club_ride'))->>'community_id')::uuid = (select id from cm where name = 'club'), 'edit form knows the community';
end $$;

-- Ben leaves the club but keeps seeing the ride he's booked on.
select set_config('request.jwt.claim.sub', 'bb111111-1111-4111-8111-111111111111', false);
do $$
begin
  perform public.leave_community((select id from cm where name = 'club'));
  assert exists (select 1 from public.ride_board where id = (select id from cm where name = 'club_ride')), 'booked rider still sees it after leaving';
  assert jsonb_array_length(public.my_communities()) = 1, 'Ben is now in one';
  begin
    perform public.remove_community_member((select id from cm where name = 'club'), 'cc111111-1111-4111-8111-111111111111');
    raise exception 'FAIL: non-admin removed someone';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Ava (admin) tools: rename, make Cal an admin, new code.
select set_config('request.jwt.claim.sub', 'aa111111-1111-4111-8111-111111111111', false);
do $$
declare v_c uuid := (select id from cm where name = 'club'); v_code text;
begin
  perform public.update_community(v_c, 'Test Club 2', 'Weekend laps');
  assert (select name from public.communities where id = v_c) = 'Test Club 2', 'renamed';
  begin
    perform public.set_community_role(v_c, 'aa111111-1111-4111-8111-111111111111', 'member');
    raise exception 'FAIL: last admin stepped down';
  exception when raise_exception then
    assert sqlerrm = 'Make someone else an admin first.', sqlerrm;
  end;
  v_code := public.reset_community_code(v_c);
  assert v_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{9}$', 'new code looks right: ' || v_code;
  assert (public.community_page(v_c)->>'code') = v_code, 'the admin sees the new code';
  update cm set id = null where name = 'club'; -- keep the club id below via the row
  insert into cm values ('newcode:' || v_code, v_c);
end $$;

-- The old code stops working; the new one lets Dee in. Wrong codes are counted.
select set_config('request.jwt.claim.sub', 'dd111111-1111-4111-8111-111111111111', false);
do $$
declare r jsonb; v_new text := (select substr(name, 9) from cm where name like 'newcode:%'); v_c uuid := (select id from cm where name like 'newcode:%');
begin
  r := public.join_community('TESTCLUB2');
  assert r->>'status' = 'not_found', 'old code is dead: ' || r::text;
  r := public.join_community(v_new);
  assert r->>'status' = 'joined' and r->>'role' = 'member', r::text;
  update cm set id = v_c where name = 'club';
  for i in 1..9 loop
    r := public.join_community('ZZZZZZZZZ');
    assert r->>'status' = 'not_found', r::text;
  end loop;
  begin
    perform public.join_community(v_new);
    raise exception 'FAIL: no limit on wrong codes';
  exception when raise_exception then
    assert sqlerrm = 'Too many wrong codes. Wait an hour and try again.', sqlerrm;
  end;
end $$;

-- Ava leaves: the longest-standing member (Cal) becomes admin.
select set_config('request.jwt.claim.sub', 'aa111111-1111-4111-8111-111111111111', false);
do $$
begin
  perform public.leave_community((select id from cm where name = 'club'));
end $$;
reset role;
do $$
begin
  assert (select role from public.community_members
          where community_id = (select id from cm where name = 'club') and user_id = 'cc111111-1111-4111-8111-111111111111') = 'admin',
         'Cal took over as admin';
  assert (select count(*) from public.community_members where community_id = (select id from cm where name = 'club') and role = 'admin') = 1, 'one admin';
end $$;

-- Deleting Cal's account (the only admin) hands the club to Dee.
delete from auth.users where id = 'cc111111-1111-4111-8111-111111111111';
do $$
begin
  assert (select role from public.community_members
          where community_id = (select id from cm where name = 'club') and user_id = 'dd111111-1111-4111-8111-111111111111') = 'admin',
         'Dee took over after Cal''s account was deleted';
end $$;

-- Signed out: nothing.
set role anon;
do $$
begin
  begin
    perform public.join_community('TESTCLUB2');
    raise exception 'FAIL: anon joined';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL COMMUNITY TESTS PASSED' as result;
