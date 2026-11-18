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

-- Rides linked to events.
reset role;
insert into public.communities (code_hash, name) values (public.community_code_hash('OTHERCLB2'), 'Other Club');
insert into ev values ('other', (select id from public.communities where name = 'Other Club'));
update public.driver_verifications set status = 'submitted' where user_id = 'e5000000-0000-4000-8000-0000000000c1';
set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000c1', false);
select public.join_community('OTHERCLB2');

select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  v_club uuid := (select id from ev where name = 'club');
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
begin
  insert into ev values ('E', public.create_community_event(v_club, 'Dawn patrol', '', '', 'eldora',
    (d + interval '7 hours') at time zone 'America/Denver', (d + interval '9 hours') at time zone 'America/Denver', false));
  insert into ev values ('M', public.create_community_event(v_club, 'Ride camp', '', '', 'eldora',
    (d + interval '7 days 8 hours') at time zone 'America/Denver', (d + interval '9 days 16 hours') at time zone 'America/Denver', false));
end $$;

select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000c1', false);
do $$
declare
  v_club uuid := (select id from ev where name = 'club');
  v_other uuid := (select id from ev where name = 'other');
  v_e uuid := (select id from ev where name = 'E');
  v_m uuid := (select id from ev where name = 'M');
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
  v_id uuid;
begin
  -- A ride on the event's day.
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', v_club, v_e)
  returning id into v_id;
  insert into ev values ('r1', v_id);
  assert (select event_title from public.ride_board where id = v_id) = 'Dawn patrol', 'board shows the event';
  assert (select event_id from public.ride_board where id = v_id) = v_e, 'board shows the event id';
  assert (public.ride_for_edit(v_id)->>'event_id')::uuid = v_e, 'edit view shows the event';
  assert (select (x->>'ride_count')::int from jsonb_array_elements(public.community_events(v_club, current_date, current_date + 30)) x
          where x->>'id' = v_e::text) = 1, public.community_events(v_club, current_date, current_date + 30)::text;

  -- The wrong day.
  begin
    insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
    values ('eldora', 'round_trip', (d + interval '1 day 7 hours') at time zone 'America/Denver', (d + interval '1 day 15 hours') at time zone 'America/Denver',
            'Base', 'Farrand Field', 3, 5, '303-555-0111', v_club, v_e);
    raise exception 'FAIL: wrong day';
  exception when raise_exception then
    assert sqlerrm = 'That event isn''t on this ride''s day.', sqlerrm;
  end;
  -- An open ride.
  begin
    insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, event_id)
    values ('eldora', 'round_trip', (d + interval '4 days 7 hours') at time zone 'America/Denver', (d + interval '4 days 15 hours') at time zone 'America/Denver',
            'Base', 'Farrand Field', 3, 5, '303-555-0111', v_e);
    raise exception 'FAIL: open ride for an event';
  exception when raise_exception then
    assert sqlerrm = 'Only community rides can be for an event.', sqlerrm;
  end;
  -- Another community's ride.
  begin
    insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
    values ('eldora', 'round_trip', (d + interval '3 days 7 hours') at time zone 'America/Denver', (d + interval '3 days 15 hours') at time zone 'America/Denver',
            'Base', 'Farrand Field', 3, 5, '303-555-0111', v_other, v_e);
    raise exception 'FAIL: other community';
  exception when raise_exception then
    assert sqlerrm = 'Pick an event from this ride''s community.', sqlerrm;
  end;
  -- A day inside a multi-day event.
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '8 days 7 hours') at time zone 'America/Denver', (d + interval '8 days 15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', v_club, v_m)
  returning id into v_id;
  insert into ev values ('r2', v_id);

  -- Moving the ride off the event's day unlinks it.
  update public.rides set depart_at = depart_at + interval '2 days', return_at = return_at + interval '2 days'
   where id = (select id from ev where name = 'r1');
  assert (select event_id from public.rides where id = (select id from ev where name = 'r1')) is null, 'moved ride unlinked';
  assert (select (x->>'ride_count')::int from jsonb_array_elements(public.community_events(v_club, current_date, current_date + 30)) x
          where x->>'id' = v_e::text) = 0, 'count drops';

  -- Link a ride again, for the event move below.
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', v_club, v_e)
  returning id into v_id;
  insert into ev values ('r3', v_id);
end $$;

-- Ava moves E to D+3: a ride still on D is unlinked. Then cancels M.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
begin
  perform public.update_community_event((select id from ev where name = 'E'), 'Dawn patrol', '', '', 'eldora',
    (d + interval '3 days 7 hours') at time zone 'America/Denver', (d + interval '3 days 9 hours') at time zone 'America/Denver', false);
  assert (select event_id from public.rides where id = (select id from ev where name = 'r3')) is null, 'ride off the new day unlinked';
  assert (select cancelled_at from public.rides where id = (select id from ev where name = 'r3')) is null, 'ride untouched';

  assert (select event_id from public.rides where id = (select id from ev where name = 'r2')) = (select id from ev where name = 'M'), 'r2 linked';
  perform public.cancel_community_event((select id from ev where name = 'M'));
  assert exists (select 1 from public.rides where id = (select id from ev where name = 'r2') and cancelled_at is null and event_id is null),
    'ride kept, unlinked, when its event is cancelled';
end $$;

-- Unlinking never gets in the way: finished rides, lapsed drivers, no chatter.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
  v_id uuid;
begin
  insert into ev values ('F', public.create_community_event((select id from ev where name = 'club'), 'Event F', '', '', 'eldora',
    (d + interval '10 days 7 hours') at time zone 'America/Denver', (d + interval '10 days 9 hours') at time zone 'America/Denver', false));
  insert into ev values ('G', public.create_community_event((select id from ev where name = 'club'), 'Event G', '', '', 'eldora',
    (d + interval '12 days 7 hours') at time zone 'America/Denver', (d + interval '12 days 9 hours') at time zone 'America/Denver', false));
  insert into ev values ('H', public.create_community_event((select id from ev where name = 'club'), 'Event H', '', '', 'eldora',
    (d + interval '14 days 7 hours') at time zone 'America/Denver', (d + interval '14 days 9 hours') at time zone 'America/Denver', false));
end $$;

select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000c1', false);
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
  v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '10 days 7 hours') at time zone 'America/Denver', (d + interval '10 days 15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', (select id from ev where name = 'club'), (select id from ev where name = 'F'))
  returning id into v_id;
  insert into ev values ('f1', v_id);
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '12 days 7 hours') at time zone 'America/Denver', (d + interval '12 days 15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', (select id from ev where name = 'club'), (select id from ev where name = 'G'))
  returning id into v_id;
  insert into ev values ('g1', v_id);
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '14 days 7 hours') at time zone 'America/Denver', (d + interval '14 days 15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', (select id from ev where name = 'club'), (select id from ev where name = 'H'))
  returning id into v_id;
  insert into ev values ('h1', v_id);
end $$;

-- 1. A finished ride: backdate it as the owner, then the admin cancels its event.
reset role;
alter table public.rides disable trigger rides_enforce_rules;
alter table public.rides disable trigger rides_event;
update public.rides set depart_at = now() - interval '5 hours', return_at = now() - interval '1 hour',
  ride_date = (now() at time zone 'America/Denver')::date where id = (select id from ev where name = 'f1');
alter table public.rides enable trigger rides_event;
alter table public.rides enable trigger rides_enforce_rules;
set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
begin
  perform public.cancel_community_event((select id from ev where name = 'F'));
  assert exists (select 1 from public.rides where id = (select id from ev where name = 'f1') and cancelled_at is null and event_id is null),
    'finished ride kept and unlinked when its event is cancelled';
end $$;
-- 4. A normal edit of that finished ride still fails.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000c1', false);
do $$
begin
  begin
    update public.rides set notes = 'late edit' where id = (select id from ev where name = 'f1');
    raise exception 'FAIL: edited a finished ride';
  exception when raise_exception then
    assert sqlerrm = 'This ride is over, so it can''t be edited.', sqlerrm;
  end;
end $$;

-- 2. Cal's verification lapses; moving the event still unlinks his ride.
reset role;
update public.driver_verifications set status = 'rejected' where user_id = 'e5000000-0000-4000-8000-0000000000c1';
set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
  v_id uuid;
begin
  perform public.update_community_event((select id from ev where name = 'G'), 'Event G', '', '', 'eldora',
    (d + interval '13 days 7 hours') at time zone 'America/Denver', (d + interval '13 days 9 hours') at time zone 'America/Denver', false);
  assert (select event_id from public.rides where id = (select id from ev where name = 'g1')) is null, 'lapsed driver: ride unlinked';
end $$;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000c1', false);
do $$
begin
  begin
    update public.rides set notes = 'edit' where id = (select id from ev where name = 'g1');
    raise exception 'FAIL: lapsed driver edited a ride';
  exception when raise_exception then
    assert sqlerrm like 'Set up your profile first%' or sqlerrm like 'Add your insurance card%', sqlerrm;
  end;
end $$;
reset role;
update public.driver_verifications set status = 'submitted' where user_id = 'e5000000-0000-4000-8000-0000000000c1';

-- 3. A ride with a rider: unlinking adds no chat line and queues nothing.
insert into public.ride_seats (ride_id, rider_id) values ((select id from ev where name = 'h1'), 'e5000000-0000-4000-8000-0000000000a1');
create temp table before_counts as
  select (select count(*) from public.ride_messages) as msgs, (select count(*) from public.ride_notifications_sent) as notes;
set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
  v_id uuid;
begin
  perform public.update_community_event((select id from ev where name = 'H'), 'Event H', '', '', 'eldora',
    (d + interval '15 days 7 hours') at time zone 'America/Denver', (d + interval '15 days 9 hours') at time zone 'America/Denver', false);
  assert (select event_id from public.rides where id = (select id from ev where name = 'h1')) is null, 'booked ride unlinked';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.ride_messages) = (select msgs from before_counts), 'no chat line for an unlink';
  assert (select count(*) from public.ride_notifications_sent) = (select notes from before_counts), 'no notification for an unlink';
end $$;

reset role;

select 'ALL COMMUNITY EVENT TESTS PASSED' as result;
