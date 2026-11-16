-- Communities, part 2: admin-only codes, Popular communities, requests to join.
\set ON_ERROR_STOP on

insert into public.communities (code_hash, name) values
  (public.community_code_hash('LISTCLUB2'), 'Listed Club'),
  (public.community_code_hash('NOADMIN22'), 'No Admin Club');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-0000000000a1', 'ada@lift2lift.test', '{"full_name":"Ada Admin"}'),
  ('e1000000-0000-4000-8000-0000000000b1', 'bo@lift2lift.test', '{"full_name":"Bo Asker"}'),
  ('e1000000-0000-4000-8000-0000000000c1', 'cy@lift2lift.test', '{"full_name":"Cy Other"}'),
  ('e1000000-0000-4000-8000-0000000000d1', 'di@lift2lift.test', '{"full_name":"Di Blocked"}');

create temp table rq (name text primary key, id uuid);
grant select on rq to authenticated;
insert into rq values
  ('listed', (select id from public.communities where name = 'Listed Club')),
  ('noadmin', (select id from public.communities where name = 'No Admin Club'));

set role authenticated;

-- Ada claims Listed Club and sees its code; nobody has asked yet.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000a1', false);
do $$
declare r jsonb;
begin
  r := public.join_community('LISTCLUB2');
  assert r->>'role' = 'admin', r::text;
  r := (select x from jsonb_array_elements(public.my_communities()) x where x->>'name' = 'Listed Club');
  assert r->>'code' = 'LISTCLUB2' and (r->>'pending_requests')::int = 0, r::text;
end $$;

-- Bo finds it in Popular (not the admin-less or unset ones) and asks to join.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000b1', false);
do $$
declare v_pop jsonb := public.popular_communities(); v_listed uuid := (select id from rq where name = 'listed');
begin
  assert exists (select 1 from jsonb_array_elements(v_pop) x where (x->>'id')::uuid = v_listed and x->>'my_status' = 'none'
                 and (x->>'member_count')::int = 1 and x->>'description' is not null), 'listed club in Popular: ' || v_pop::text;
  assert not exists (select 1 from jsonb_array_elements(v_pop) x where (x->>'id')::uuid = (select id from rq where name = 'noadmin')), 'no-admin club hidden';
  assert not exists (select 1 from jsonb_array_elements(v_pop) x where x->>'name' is null or x->>'name' in ('CU Freeride', 'CU Freeski')), 'unclaimed codes hidden';
  assert not exists (select 1 from jsonb_array_elements(v_pop) x where x ? 'code'), 'Popular never shows codes';
  assert public.request_to_join(v_listed) = 'requested', 'asked';
  assert public.request_to_join(v_listed) = 'requested', 'asking twice is fine';
  assert (select x->>'my_status' from jsonb_array_elements(public.popular_communities()) x where (x->>'id')::uuid = v_listed) = 'requested', 'shows Requested';
  begin
    perform public.request_to_join((select id from rq where name = 'noadmin'));
    raise exception 'FAIL: asked a club with no admin';
  exception when raise_exception then
    assert sqlerrm like 'This community isn''t taking requests%', sqlerrm;
  end;
  begin
    perform 1 from public.community_join_requests;
    raise exception 'FAIL: requests table readable';
  exception when insufficient_privilege then null;
  end;
  -- Cancel, then ask again.
  perform public.cancel_join_request(v_listed);
  assert (select x->>'my_status' from jsonb_array_elements(public.popular_communities()) x where (x->>'id')::uuid = v_listed) = 'none', 'cancelled';
  assert public.request_to_join(v_listed) = 'requested', 'asked again';
end $$;

-- Di asks too, then Ada blocks Di: Di's request drops out of Ada's list.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000d1', false);
select public.request_to_join((select id from rq where name = 'listed'));
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000a1', false);
do $$
declare v_listed uuid := (select id from rq where name = 'listed'); p jsonb;
begin
  p := public.community_page(v_listed);
  assert jsonb_array_length(p->'requests') = 2, 'two requests: ' || (p->'requests')::text;
  assert (select (x->>'pending_requests')::int from jsonb_array_elements(public.my_communities()) x where (x->>'id')::uuid = v_listed) = 2, 'count for admin';
  perform public.block_user('e1000000-0000-4000-8000-0000000000d1');
  p := public.community_page(v_listed);
  assert jsonb_array_length(p->'requests') = 1 and p->'requests'->0->>'full_name' = 'Bo Asker', 'blocked requester hidden';
end $$;

-- Only admins answer requests.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000c1', false);
do $$
begin
  begin
    perform public.respond_join_request((select id from rq where name = 'listed'), 'e1000000-0000-4000-8000-0000000000b1', true);
    raise exception 'FAIL: non-admin approved';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_community_listed((select id from rq where name = 'listed'), false);
    raise exception 'FAIL: non-admin unlisted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Ada declines Bo.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000a1', false);
select public.respond_join_request((select id from rq where name = 'listed'), 'e1000000-0000-4000-8000-0000000000b1', false);

-- Bo can't ask again for a week.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000b1', false);
do $$
begin
  begin
    perform public.request_to_join((select id from rq where name = 'listed'));
    raise exception 'FAIL: asked again right after a decline';
  exception when raise_exception then
    assert sqlerrm like 'Your last request wasn''t approved. You can ask again after %', sqlerrm;
  end;
  assert (select x->>'my_status' from jsonb_array_elements(public.popular_communities()) x
          where (x->>'id')::uuid = (select id from rq where name = 'listed')) = 'none', 'declined shows as not joined';
end $$;
reset role;
update public.community_join_requests set decided_at = now() - interval '8 days'
where user_id = 'e1000000-0000-4000-8000-0000000000b1';
set role authenticated;

-- A week later Bo asks again and Ada approves: Bo's a member, without seeing the code.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000b1', false);
select public.request_to_join((select id from rq where name = 'listed'));
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000a1', false);
select public.respond_join_request((select id from rq where name = 'listed'), 'e1000000-0000-4000-8000-0000000000b1', true);
do $$
begin
  begin
    perform public.respond_join_request((select id from rq where name = 'listed'), 'e1000000-0000-4000-8000-0000000000b1', true);
    raise exception 'FAIL: answered twice';
  exception when raise_exception then
    assert sqlerrm = 'That request isn''t waiting any more.', sqlerrm;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000b1', false);
do $$
declare v_listed uuid := (select id from rq where name = 'listed'); p jsonb;
begin
  p := public.community_page(v_listed);
  assert p->>'my_role' = 'member' and p->>'code' is null and jsonb_array_length(p->'requests') = 0, 'member: no code, no requests: ' || p::text;
  assert (select x->>'code' from jsonb_array_elements(public.my_communities()) x where (x->>'id')::uuid = v_listed) is null, 'member list: no code';
  assert (select x->>'my_status' from jsonb_array_elements(public.popular_communities()) x where (x->>'id')::uuid = v_listed) = 'member', 'shows Joined';
  begin
    perform code from public.communities;
    raise exception 'FAIL: member read the code column';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Hidden from Popular: no listing, no requests.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000a1', false);
select public.set_community_listed((select id from rq where name = 'listed'), false);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000c1', false);
do $$
declare v_listed uuid := (select id from rq where name = 'listed');
begin
  assert not exists (select 1 from jsonb_array_elements(public.popular_communities()) x where (x->>'id')::uuid = v_listed), 'hidden';
  begin
    perform public.request_to_join(v_listed);
    raise exception 'FAIL: asked a hidden club';
  exception when raise_exception then
    assert sqlerrm like 'This community isn''t taking requests%', sqlerrm;
  end;
end $$;

-- Ten requests a day at most.
reset role;
insert into public.community_join_requests (community_id, user_id)
select id, 'e1000000-0000-4000-8000-0000000000c1' from public.communities where name is null limit 10;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000a1', false);
set role authenticated;
select public.set_community_listed((select id from rq where name = 'listed'), true);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000c1', false);
do $$
begin
  begin
    perform public.request_to_join((select id from rq where name = 'listed'));
    raise exception 'FAIL: no daily limit';
  exception when raise_exception then
    assert sqlerrm like 'That''s a lot of requests for one day%', sqlerrm;
  end;
end $$;
reset role;
delete from public.community_join_requests where user_id = 'e1000000-0000-4000-8000-0000000000c1';
set role authenticated;

-- Joining with the code (an invitation) clears a waiting request.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-0000000000c1', false);
select public.request_to_join((select id from rq where name = 'listed'));
select public.join_community('LIST-CLUB-2');
reset role;
do $$
begin
  assert not exists (select 1 from public.community_join_requests
                     where user_id = 'e1000000-0000-4000-8000-0000000000c1' and community_id = (select id from rq where name = 'listed')),
         'request cleared after joining by code';
end $$;

-- Signed out: nothing.
set role anon;
do $$
begin
  begin
    perform public.popular_communities();
    raise exception 'FAIL: anon listed communities';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL COMMUNITY REQUEST TESTS PASSED' as result;
