-- Friends: requests, accepting, declining, unfriending, profiles and search.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('f1111111-1111-4111-8111-111111111111', 'fran@lift2lift.test', '{"full_name":"Fran Friend"}'),
  ('f2222222-2222-4222-8222-222222222222', 'gus@lift2lift.test', '{"full_name":"Gus Gondola"}'),
  ('f3333333-3333-4333-8333-333333333333', 'hal@lift2lift.test', '{"full_name":"Hal Halfpipe"}'),
  ('f4444444-4444-4444-8444-444444444444', 'ivy@lift2lift.test', '{"full_name":"Ivy 100%_Powder"}');
update public.profiles set instagram = 'gus.sends' where id = 'f2222222-2222-4222-8222-222222222222';

-- Nobody writes the table directly.
set role authenticated;
select set_config('request.jwt.claim.sub', 'f1111111-1111-4111-8111-111111111111', false);
do $$ begin
  begin
    insert into public.friendships (user_a, user_b, requested_by)
    values ('f1111111-1111-4111-8111-111111111111', 'f2222222-2222-4222-8222-222222222222', 'f1111111-1111-4111-8111-111111111111');
    raise exception 'FAIL: direct insert';
  exception when insufficient_privilege then null;
  end;

  -- Can't friend yourself or someone who doesn't exist.
  begin
    perform public.friend_request(auth.uid());
    raise exception 'FAIL: self friend';
  exception when raise_exception then assert sqlerrm like 'You can''t add yourself%', sqlerrm;
  end;
  begin
    perform public.friend_request('00000000-0000-4000-8000-000000000000');
    raise exception 'FAIL: unknown person';
  exception when no_data_found then null;
  end;

  -- Fran asks Gus and Hal.
  assert public.friend_request('f2222222-2222-4222-8222-222222222222') = 'sent', 'request sent';
  assert public.friend_request('f2222222-2222-4222-8222-222222222222') = 'sent', 'asking twice is harmless';
  assert public.friend_request('f3333333-3333-4333-8333-333333333333') = 'sent', 'second request';
  assert jsonb_array_length(public.my_friends()->'outgoing') = 2, 'two outgoing';
  assert public.profile_friends('f2222222-2222-4222-8222-222222222222')->>'state' = 'sent', 'state sent';

  -- Fran can't accept her own request.
  begin
    perform public.friend_respond('f2222222-2222-4222-8222-222222222222', true);
    raise exception 'FAIL: accepted own request';
  exception when no_data_found then null;
  end;
end $$;
reset role;

-- Gus sees it waiting and accepts. Hal declines.
select set_config('request.jwt.claim.sub', 'f2222222-2222-4222-8222-222222222222', false);
set role authenticated;
do $$ begin
  assert jsonb_array_length(public.my_friends()->'incoming') = 1, 'Gus has one request';
  assert public.profile_friends('f1111111-1111-4111-8111-111111111111')->>'state' = 'received', 'state received';
  perform public.friend_respond('f1111111-1111-4111-8111-111111111111', true);
  assert public.my_friends()->'friends'->0->>'name' = 'Fran Friend', 'Gus is friends with Fran';
  assert (select count(*) from public.friendships) = 1, 'Gus only sees his own rows';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'f3333333-3333-4333-8333-333333333333', false);
set role authenticated;
do $$ begin
  perform public.friend_respond('f1111111-1111-4111-8111-111111111111', false);
  assert jsonb_array_length(public.my_friends()->'incoming') = 0, 'declined request is gone';
  assert public.profile_friends('f1111111-1111-4111-8111-111111111111')->>'state' = 'none', 'Hal and Fran are not friends';

  -- Hal asks Gus; Gus already being friends with Fran gives them one mutual later.
  perform public.friend_request('f2222222-2222-4222-8222-222222222222');
end $$;
reset role;

-- Gus accepts Hal by sending a request back.
select set_config('request.jwt.claim.sub', 'f2222222-2222-4222-8222-222222222222', false);
set role authenticated;
do $$ begin
  assert public.friend_request('f3333333-3333-4333-8333-333333333333') = 'friends', 'asking back accepts';
  assert (public.profile_friends(auth.uid())->>'count')::int = 2, 'Gus has two friends';
  assert public.profile_friends(auth.uid())->>'state' = 'self', 'own profile';
end $$;
reset role;

-- Fran looks at Hal's profile: Gus is a mutual friend and listed first.
select set_config('request.jwt.claim.sub', 'f1111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$
declare p jsonb := public.profile_friends('f3333333-3333-4333-8333-333333333333');
begin
  assert (p->>'count')::int = 1 and (p->>'mutual')::int = 1, 'one friend, one mutual: ' || p::text;
  assert p->'friends'->0->>'name' = 'Gus Gondola' and (p->'friends'->0->>'mutual')::boolean, 'mutual first';

  -- Search by name, by Instagram, and with wildcard characters taken literally.
  assert public.search_people('gus')->0->>'name' = 'Gus Gondola', 'name search';
  assert public.search_people('@gus.se')->0->>'name' = 'Gus Gondola', 'instagram search';
  assert jsonb_array_length(public.search_people('g')) = 0, 'needs 2 characters';
  assert jsonb_array_length(public.search_people('fran')) = 0, 'you are not in your own results';
  -- '_u' as a pattern would match Gus; taken literally it matches nobody.
  assert jsonb_array_length(public.search_people('_u')) = 0, 'wildcards are literal';
  assert public.search_people('100%_')->0->>'name' = 'Ivy 100%_Powder', 'literal match still works';

  -- Unfriend.
  perform public.friend_remove('f2222222-2222-4222-8222-222222222222');
  assert jsonb_array_length(public.my_friends()->'friends') = 0, 'unfriended';
  assert (public.profile_friends('f3333333-3333-4333-8333-333333333333')->>'mutual')::int = 0, 'no more mutual';
end $$;
reset role;

-- Signed out: nothing.
set role anon;
do $$ begin
  begin
    perform public.my_friends();
    raise exception 'FAIL: anon read friends';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL FRIEND TESTS PASSED' as result;
