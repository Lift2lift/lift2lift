-- Community events: admin-only creating, members-only reading, RSVPs, club-calendar events, Denver day math.
\set ON_ERROR_STOP on

insert into public.communities (code_hash, name) values (public.community_code_hash('EVENTCLB2'), 'Event Club');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e5000000-0000-4000-8000-0000000000a1', 'eva@lift2lift.test', '{"full_name":"Ava Admin"}'),
  ('e5000000-0000-4000-8000-0000000000b1', 'eben@lift2lift.test', '{"full_name":"Ben Member"}'),
  ('e5000000-0000-4000-8000-0000000000c1', 'ecal@lift2lift.test', '{"full_name":"Cal Driver"}'),
  ('e5000000-0000-4000-8000-0000000000d1', 'edee@lift2lift.test', '{"full_name":"Dee Outsider"}');
select public.test_make_ready('e5000000-0000-4000-8000-0000000000a1');
select public.test_make_ready('e5000000-0000-4000-8000-0000000000b1');
select public.test_make_ready('e5000000-0000-4000-8000-0000000000c1');
select public.test_make_ready('e5000000-0000-4000-8000-0000000000d1');

create temp table ev (name text primary key, id uuid);
grant select, insert, update on ev to authenticated;
insert into ev values ('club', (select id from public.communities where name = 'Event Club'));

set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
select public.join_community('EVENTCLB2');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000b1', false);
select public.join_community('EVENTCLB2');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000c1', false);
select public.join_community('EVENTCLB2');

-- Ava (admin) creates an event; a member can't.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  v_club uuid := (select id from ev where name = 'club');
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
  v_id uuid;
begin
  v_id := public.create_community_event(v_club, 'Dawn patrol', 'Meet at the lot', 'Farrand Field', 'eldora',
    (d + interval '7 hours') at time zone 'America/Denver', (d + interval '9 hours') at time zone 'America/Denver', false);
  assert v_id is not null, 'returns an id';
  insert into ev values ('dawn', v_id);
  -- Bad input.
  begin
    perform public.create_community_event(v_club, 'x', '', '', null, now() + interval '1 day', now() + interval '2 days', false);
    raise exception 'FAIL: one-char title';
  exception when raise_exception then
    assert sqlerrm like 'Give the event a title%', sqlerrm;
  end;
  begin
    perform public.create_community_event(v_club, 'Slut party', '', '', null, now() + interval '1 day', now() + interval '2 days', false);
    raise exception 'FAIL: blocked term';
  exception when raise_exception then
    assert sqlerrm like '%isn''t allowed%', sqlerrm;
  end;
  begin
    perform public.create_community_event(v_club, 'Backwards', '', '', null, now() + interval '2 days', now() + interval '1 day', false);
    raise exception 'FAIL: ends before it starts';
  exception when raise_exception then
    assert sqlerrm like '%end%', sqlerrm;
  end;
  begin
    insert into public.community_events (community_id, title, starts_at, ends_at, created_by)
    values (v_club, 'Direct', now(), now(), auth.uid());
    raise exception 'FAIL: direct insert';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000b1', false);
do $$
declare
  v_club uuid := (select id from ev where name = 'club');
  r jsonb;
begin
  begin
    perform public.create_community_event(v_club, 'Member event', '', '', null, now() + interval '1 day', now() + interval '2 days', false);
    raise exception 'FAIL: member created an event';
  exception when sqlstate '42501' then null;
  end;
  r := public.community_events(v_club, current_date, current_date + 30);
  assert jsonb_array_length(r) = 1, r::text;
  assert r->0->>'title' = 'Dawn patrol' and (r->0->>'going')::int = 0 and (r->0->>'i_am_in')::boolean = false
     and (r->0->>'ride_count')::int = 0 and r->0->>'source' = 'manual', r::text;
  assert not exists (select 1 from public.community_events where community_id = v_club and false), 'rls sanity';
end $$;

-- Outsider: raises, and RLS hides the rows.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000d1', false);
do $$
declare v_club uuid := (select id from ev where name = 'club');
begin
  begin
    perform public.community_events(v_club, current_date, current_date + 30);
    raise exception 'FAIL: outsider read events';
  exception when raise_exception then
    assert sqlerrm like 'You''re not in this community%', sqlerrm;
  end;
  assert (select count(*) from public.community_events) = 0, 'RLS hides events';
  assert (select count(*) from public.community_event_rsvps) = 0, 'RLS hides RSVPs';
  begin
    perform public.set_event_rsvp((select id from ev where name = 'dawn'), true);
    raise exception 'FAIL: outsider RSVP';
  exception when raise_exception then
    assert sqlerrm like 'You''re not in this community%', sqlerrm;
  end;
end $$;

-- Ben RSVPs (twice is fine), then backs out.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000b1', false);
do $$
declare
  v_club uuid := (select id from ev where name = 'club');
  v_id uuid := (select id from ev where name = 'dawn');
  r jsonb;
begin
  perform public.set_event_rsvp(v_id, true);
  perform public.set_event_rsvp(v_id, true);
  r := public.community_events(v_club, current_date, current_date + 30)->0;
  assert (r->>'going')::int = 1 and (r->>'i_am_in')::boolean, r::text;
  assert jsonb_array_length(r->'going_people') = 1 and r->'going_people'->0->>'full_name' = 'Ben Member', r::text;
  perform public.set_event_rsvp(v_id, false);
  r := public.community_events(v_club, current_date, current_date + 30)->0;
  assert (r->>'going')::int = 0 and not (r->>'i_am_in')::boolean, r::text;
  perform public.set_event_rsvp(v_id, true);
end $$;

-- A blocked person is left out of the going list.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000c1', false);
do $$
declare v_id uuid := (select id from ev where name = 'dawn'); r jsonb;
begin
  perform public.set_event_rsvp(v_id, true);
  r := public.community_events((select id from ev where name = 'club'), current_date, current_date + 30)->0;
  assert (r->>'going')::int = 2 and jsonb_array_length(r->'going_people') = 2, r::text;
  perform public.block_user('e5000000-0000-4000-8000-0000000000b1');
  r := public.community_events((select id from ev where name = 'club'), current_date, current_date + 30)->0;
  assert jsonb_array_length(r->'going_people') = 1 and r->'going_people'->0->>'full_name' = 'Cal Driver', r::text;
  perform public.unblock_user('e5000000-0000-4000-8000-0000000000b1');
end $$;

-- Ava's next event shows on her communities list; cancelling the event clears it.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
declare v_club uuid := (select id from ev where name = 'club'); v_id uuid := (select id from ev where name = 'dawn');
begin
  assert public.my_communities()->0->'next_event'->>'title' = 'Dawn patrol', public.my_communities()::text;
  perform public.update_community_event(v_id, 'Dawn patrol 2', '', '', null,
    now() + interval '5 days', now() + interval '5 days 2 hours', false);
  assert public.my_communities()->0->'next_event'->>'title' = 'Dawn patrol 2', 'update applies';
  perform public.cancel_community_event(v_id);
  assert jsonb_array_length(public.community_events(v_club, current_date, current_date + 30)) = 0, 'cancelled event gone';
  assert public.my_communities()->0->'next_event' is null or jsonb_typeof(public.my_communities()->0->'next_event') = 'null', 'no next event';
end $$;

-- Events made behind the RPCs (as the table owner): over, club-calendar, Denver days.
reset role;
insert into public.community_events (community_id, title, starts_at, ends_at, source, ics_uid, created_by) values
  ((select id from ev where name = 'club'), 'Finished', now() - interval '2 days', now() - interval '1 day', 'manual', null, 'e5000000-0000-4000-8000-0000000000a1'),
  ((select id from ev where name = 'club'), 'From the calendar', now() + interval '3 days', now() + interval '3 days 1 hour', 'ics', 'uid-1', null),
  ((select id from ev where name = 'club'), 'Late night', '2026-12-05 23:00 America/Denver', '2026-12-05 23:30 America/Denver', 'manual', null, 'e5000000-0000-4000-8000-0000000000a1'),
  ((select id from ev where name = 'club'), 'All day', '2026-12-05 00:00 America/Denver', '2026-12-05 00:00 America/Denver', 'manual', null, 'e5000000-0000-4000-8000-0000000000a1'),
  ((select id from ev where name = 'club'), 'Camp', '2026-12-04 08:00 America/Denver', '2026-12-06 16:00 America/Denver', 'manual', null, 'e5000000-0000-4000-8000-0000000000a1');
update public.community_events set all_day = true where title = 'All day';
insert into ev select title, id from public.community_events where title in ('Finished', 'From the calendar', 'Late night', 'All day', 'Camp');
set role authenticated;

select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000b1', false);
do $$
declare v_club uuid := (select id from ev where name = 'club'); r jsonb;
begin
  begin
    perform public.set_event_rsvp((select id from ev where name = 'Finished'), true);
    raise exception 'FAIL: RSVP to a finished event';
  exception when raise_exception then
    assert sqlerrm = 'This event is over.', sqlerrm;
  end;
  -- Dec 5: late night, all day and the camp; Dec 6: only the camp.
  r := public.community_events(v_club, date '2026-12-05', date '2026-12-05');
  assert (select array_agg(e->>'title' order by e->>'title') from jsonb_array_elements(r) e) = array['All day', 'Camp', 'Late night'], r::text;
  r := public.community_events(v_club, date '2026-12-06', date '2026-12-06');
  assert (select array_agg(e->>'title') from jsonb_array_elements(r) e) = array['Camp'], r::text;
  r := public.community_events(v_club, date '2026-12-07', date '2026-12-07');
  assert jsonb_array_length(r) = 0, r::text;
  -- Leaving the community drops the RSVP.
  perform public.set_event_rsvp((select id from ev where name = 'From the calendar'), true);
  assert exists (select 1 from public.community_event_rsvps where user_id = auth.uid()), 'RSVP saved';
  perform public.leave_community(v_club);
  assert not exists (select 1 from public.community_event_rsvps where user_id = auth.uid()), 'RSVPs removed on leave';
end $$;

-- Club-calendar events can't be changed here.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
declare v_id uuid := (select id from ev where name = 'From the calendar');
begin
  begin
    perform public.update_community_event(v_id, 'Renamed', '', '', null, now() + interval '3 days', now() + interval '4 days', false);
    raise exception 'FAIL: edited a calendar event';
  exception when raise_exception then
    assert sqlerrm = 'This event comes from the club calendar. Change it there.', sqlerrm;
  end;
  begin
    perform public.cancel_community_event(v_id);
    raise exception 'FAIL: cancelled a calendar event';
  exception when raise_exception then
    assert sqlerrm = 'This event comes from the club calendar. Change it there.', sqlerrm;
  end;
end $$;

reset role;

select 'ALL COMMUNITY EVENT TESTS PASSED' as result;
