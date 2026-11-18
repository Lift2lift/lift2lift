-- Community calendars: admin-only link, URL check, service-role sync of imported events.
\set ON_ERROR_STOP on
reset role;

insert into public.communities (code_hash, name) values
  (public.community_code_hash('CALCLUB22'), 'Calendar Club'),
  (public.community_code_hash('CALOTHER2'), 'Calendar Other');

insert into auth.users (id, email, raw_user_meta_data) values
  ('ca000000-0000-4000-8000-0000000000a1', 'cava@lift2lift.test', '{"full_name":"Cava Admin"}'),
  ('ca000000-0000-4000-8000-0000000000b1', 'cben@lift2lift.test', '{"full_name":"Cben Member"}'),
  ('ca000000-0000-4000-8000-0000000000c1', 'ccal@lift2lift.test', '{"full_name":"Ccal Driver"}');
select public.test_make_ready('ca000000-0000-4000-8000-0000000000a1');
select public.test_make_ready('ca000000-0000-4000-8000-0000000000b1');
select public.test_make_ready('ca000000-0000-4000-8000-0000000000c1');

create temp table cev (name text primary key, id uuid);
grant select, insert, update on cev to authenticated, service_role;
insert into cev values ('club', (select id from public.communities where name = 'Calendar Club')),
                       ('other', (select id from public.communities where name = 'Calendar Other'));

set role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000a1', false);
select public.join_community('CALCLUB22');
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000b1', false);
select public.join_community('CALCLUB22');
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000c1', false);
select public.join_community('CALCLUB22');

-- The URL check.
do $$
begin
  assert public.calendar_url_ok('https://calendar.google.com/calendar/ical/x/basic.ics');
  assert public.calendar_url_ok('https://outlook.office365.com/owa/calendar/a/b/calendar.ics');
  assert public.calendar_url_ok('https://outlook.office.com/owa/calendar/a/calendar.ics');
  assert public.calendar_url_ok('https://outlook.live.com/owa/calendar/a/calendar.ics');
  assert public.calendar_url_ok('https://p12-caldav.icloud.com/published/2/abc');
  assert public.calendar_url_ok('https://CALENDAR.Google.com/x'), 'host case ignored';
  assert not public.calendar_url_ok('http://calendar.google.com/x');
  assert not public.calendar_url_ok('https://calendar.google.com.evil.test/x');
  assert not public.calendar_url_ok('https://evilicloud.com/x');
  assert not public.calendar_url_ok('https://icloud.com.evil.test/x');
  assert not public.calendar_url_ok('https://user:pw@calendar.google.com/x');
  assert not public.calendar_url_ok('https://calendar.google.com:8443/x');
  assert not public.calendar_url_ok('https://169.254.169.254/latest');
  assert not public.calendar_url_ok('https://localhost/x');
  assert not public.calendar_url_ok(null);
  assert not public.calendar_url_ok('');
  assert not public.calendar_url_ok('https:///x');
  assert not public.calendar_url_ok('https://calendar.google.com/x y');
  assert not public.calendar_url_ok(E'https://calendar.google.com/x\n');
  assert not public.calendar_url_ok('https://calendar.google.com@evil.test/x');
  assert not public.calendar_url_ok('https://calendar.google.com\x/x');
  assert not public.calendar_url_ok('https://.icloud.com/x');
  assert public.calendar_url_ok('https://Calendar.Google.com/x');
  assert not public.calendar_url_ok('https://outloo' || U&'\212A' || '.live.com/x'), 'kelvin sign host';
  assert not public.calendar_url_ok('https://calendar.google.com/x' || U&'\00A0'), 'nbsp';
  assert not public.calendar_url_ok('https://calendar.google.com./x'), 'trailing dot';
  assert not public.calendar_url_ok('https://calendar%2egoogle.com/x'), 'percent host';
  assert not public.calendar_url_ok('https://evil.test/?h=calendar.google.com/');
  assert not public.calendar_url_ok('https://evil.test/#https://calendar.google.com/x');
  assert not public.calendar_url_ok('https://calendar.google.com/a' || chr(92) || 'b'), 'backslash in path';
  assert not public.calendar_url_ok('https://icloud.com/x');
  assert not public.calendar_url_ok('ftp://calendar.google.com/x');
end $$;

-- Members can't reach the link; nobody reads the table.
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000b1', false);
do $$
declare v_club uuid := (select id from cev where name = 'club');
begin
  begin
    perform public.set_community_calendar(v_club, 'https://calendar.google.com/x');
    raise exception 'FAIL: member set the link';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.community_calendar(v_club);
    raise exception 'FAIL: member read the link';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform * from public.community_calendars;
    raise exception 'FAIL: member read the table';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Ava (admin) sets a webcal link.
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  v_club uuid := (select id from cev where name = 'club');
  r jsonb;
begin
  assert public.community_calendar(v_club) is null, 'no link yet';
  begin
    perform public.set_community_calendar(v_club, 'https://evil.test/x.ics');
    raise exception 'FAIL: bad host';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Use a Google, Outlook or iCloud calendar link.', sqlerrm;
  end;
  begin
    perform * from public.community_calendars;
    raise exception 'FAIL: admin read the table';
  exception when insufficient_privilege then null;
  end;
  perform public.set_community_calendar(v_club, '  webcal://calendar.google.com/calendar/ical/club/basic.ics ');
  r := public.community_calendar(v_club);
  assert r->>'ics_url' = 'https://calendar.google.com/calendar/ical/club/basic.ics', r::text;
  assert r->>'last_synced_at' is null and r->>'last_error' is null, r::text;
end $$;

-- Only the service role runs the sync.
do $$
begin
  begin
    perform public.apply_calendar_sync((select id from cev where name = 'club'), '[]'::jsonb, null);
    raise exception 'FAIL: authenticated ran the sync';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.claim_calendars_to_sync();
    raise exception 'FAIL: authenticated claimed calendars';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Other community's imported event and a manual event (made by hand, as the owner).
reset role;
insert into public.community_events (community_id, title, starts_at, ends_at, source, ics_uid)
values ((select id from cev where name = 'other'), 'Other club trip', now() + interval '3 days', now() + interval '3 days 2 hours', 'ics', 'o-1');
insert into public.community_events (community_id, title, starts_at, ends_at, source)
values ((select id from cev where name = 'club'), 'Manual social', now() + interval '4 days', now() + interval '4 days 2 hours', 'manual');

-- First sync.
set role service_role;
do $$
declare
  v_club uuid := (select id from cev where name = 'club');
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
begin
  assert exists (select 1 from public.claim_calendars_to_sync() where community_id = v_club
                 and ics_url = 'https://calendar.google.com/calendar/ical/club/basic.ics'), 'listed for sync';
  perform public.apply_calendar_sync(v_club, jsonb_build_array(
    jsonb_build_object('uid', 'u-1', 'title', 'Season kickoff', 'description', 'Pizza', 'location', 'Brewery', 'resort_id', 'eldora',
      'starts_at', (d + interval '18 hours') at time zone 'America/Denver', 'ends_at', (d + interval '20 hours') at time zone 'America/Denver', 'all_day', false),
    jsonb_build_object('uid', 'u-2', 'title', 'Ski swap', 'description', '', 'location', '', 'resort_id', null,
      'starts_at', (d + interval '1 day') at time zone 'America/Denver', 'ends_at', (d + interval '1 day') at time zone 'America/Denver', 'all_day', true),
    jsonb_build_object('uid', 'u-bad', 'title', 'Slut party', 'description', '', 'location', '', 'resort_id', null,
      'starts_at', (d + interval '2 days') at time zone 'America/Denver', 'ends_at', (d + interval '2 days 1 hour') at time zone 'America/Denver', 'all_day', false),
    jsonb_build_object('uid', 'u-short', 'title', 'x', 'description', '', 'location', '', 'resort_id', null,
      'starts_at', (d + interval '2 days') at time zone 'America/Denver', 'ends_at', (d + interval '2 days 1 hour') at time zone 'America/Denver', 'all_day', false),
    jsonb_build_object('uid', 'u-back', 'title', 'Backwards', 'description', '', 'location', '', 'resort_id', null,
      'starts_at', (d + interval '3 days') at time zone 'America/Denver', 'ends_at', (d + interval '2 days') at time zone 'America/Denver', 'all_day', false)
  ), null);
end $$;
reset role;
do $$
declare v_club uuid := (select id from cev where name = 'club');
begin
  assert (select count(*) from public.community_events where community_id = v_club and source = 'ics') = 2, 'two imported events';
  assert not exists (select 1 from public.community_events where title in ('Slut party', 'x', 'Backwards')), 'bad elements skipped';
  assert (select all_day from public.community_events where ics_uid = 'u-2'), 'all-day kept';
  assert (select last_synced_at is not null and last_error is null from public.community_calendars where community_id = v_club), 'synced stamp';
  insert into cev values ('u1', (select id from public.community_events where ics_uid = 'u-1')),
                         ('u2', (select id from public.community_events where ics_uid = 'u-2'));
end $$;

-- Ben RSVPs to u-1 and u-2; Cal posts a ride linked to u-1.
update public.driver_verifications set status = 'submitted' where user_id = 'ca000000-0000-4000-8000-0000000000c1';
set role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000b1', false);
select public.set_event_rsvp((select id from cev where name = 'u1'), true);
select public.set_event_rsvp((select id from cev where name = 'u2'), true);
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000c1', false);
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
  v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '7 hours') at time zone 'America/Denver', (d + interval '15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', (select id from cev where name = 'club'), (select id from cev where name = 'u1'))
  returning id into v_id;
  insert into cev values ('ride', v_id);
end $$;

-- Second sync: u-1 retitled and moved a day (ride unlinked), u-2 missing (cancelled).
set role service_role;
do $$
declare
  v_club uuid := (select id from cev where name = 'club');
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '6 days';
begin
  perform public.apply_calendar_sync(v_club, jsonb_build_array(
    jsonb_build_object('uid', 'u-1', 'title', 'Season kickoff party', 'description', 'Pizza', 'location', 'Brewery', 'resort_id', 'eldora',
      'starts_at', (d + interval '18 hours') at time zone 'America/Denver', 'ends_at', (d + interval '20 hours') at time zone 'America/Denver', 'all_day', false)
  ), null);
end $$;
reset role;
do $$
declare v_club uuid := (select id from cev where name = 'club');
begin
  assert (select id from public.community_events where ics_uid = 'u-1') = (select id from cev where name = 'u1'), 'updated in place';
  assert (select title from public.community_events where ics_uid = 'u-1') = 'Season kickoff party', 'title updated';
  assert (select cancelled_at is not null from public.community_events where ics_uid = 'u-2'), 'missing event cancelled';
  assert (select cancelled_at is null from public.community_events where title = 'Manual social'), 'manual untouched';
  assert (select cancelled_at is null from public.community_events where ics_uid = 'o-1'), 'other community untouched';
  assert exists (select 1 from public.community_event_rsvps where event_id = (select id from cev where name = 'u1')
                 and user_id = 'ca000000-0000-4000-8000-0000000000b1'), 'rsvp survives update';
  assert (select event_id from public.rides where id = (select id from cev where name = 'ride')) is null, 'ride unlinked after move';
end $$;

-- Error run leaves events alone.
set role service_role;
select public.apply_calendar_sync((select id from cev where name = 'club'), null, 'Could not read that calendar link');
reset role;
do $$
declare v_club uuid := (select id from cev where name = 'club');
begin
  assert (select last_error from public.community_calendars where community_id = v_club) = 'Could not read that calendar link';
  assert (select count(*) from public.community_events where community_id = v_club and source = 'ics' and cancelled_at is null) = 1, 'events untouched by error';
  assert (select cancelled_at is not null from public.community_events where ics_uid = 'u-2'), 'still cancelled';
end $$;

-- Third sync: u-2 is back, un-cancelled with its RSVP.
set role service_role;
do $$
declare
  v_club uuid := (select id from cev where name = 'club');
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '5 days';
begin
  perform public.apply_calendar_sync(v_club, jsonb_build_array(
    jsonb_build_object('uid', 'u-1', 'title', 'Season kickoff party', 'description', 'Pizza', 'location', 'Brewery', 'resort_id', 'eldora',
      'starts_at', (d + interval '1 day 18 hours') at time zone 'America/Denver', 'ends_at', (d + interval '1 day 20 hours') at time zone 'America/Denver', 'all_day', false),
    jsonb_build_object('uid', 'u-2', 'title', 'Ski swap', 'description', '', 'location', '', 'resort_id', null,
      'starts_at', (d + interval '1 day') at time zone 'America/Denver', 'ends_at', (d + interval '1 day') at time zone 'America/Denver', 'all_day', true),
    jsonb_build_object('uid', 'u-3', 'title', 'Already started', 'description', '', 'location', '', 'resort_id', null,
      'starts_at', now() - interval '2 hours', 'ends_at', now() + interval '1 hour', 'all_day', false)
  ), null);
end $$;
reset role;
do $$
declare v_club uuid := (select id from cev where name = 'club');
begin
  assert (select cancelled_at is null from public.community_events where ics_uid = 'u-2'), 'u-2 back';
  assert (select id from public.community_events where ics_uid = 'u-2') = (select id from cev where name = 'u2'), 'same id';
  assert exists (select 1 from public.community_event_rsvps where event_id = (select id from cev where name = 'u2')
                 and user_id = 'ca000000-0000-4000-8000-0000000000b1'), 'rsvp still there';
  assert (select last_error is null from public.community_calendars where community_id = v_club), 'error cleared';
end $$;

-- Same link again changes nothing; a different link drops future imported events only.
set role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000a1', false);
select public.set_community_calendar((select id from cev where name = 'club'), 'webcal://calendar.google.com/calendar/ical/club/basic.ics');
do $$
declare v_club uuid := (select id from cev where name = 'club');
begin
  assert (select count(*) from public.community_events where community_id = v_club and source = 'ics') = 3, 'same link keeps events';
  assert public.community_calendar(v_club)->>'last_synced_at' is not null, 'same link keeps sync stamp';
  perform public.set_community_calendar(v_club, 'https://outlook.office365.com/owa/calendar/a/b/calendar.ics');
  assert (select array_agg(ics_uid order by ics_uid) from public.community_events where community_id = v_club and source = 'ics') = array['u-3'],
    'new link removes imported events that have not started';
  assert (select cancelled_at is not null from public.community_events where community_id = v_club and ics_uid = 'u-3'),
    'new link cancels the imported event that is under way';
  assert public.community_calendar(v_club)->>'ics_url' = 'https://outlook.office365.com/owa/calendar/a/b/calendar.ics';
  assert public.community_calendar(v_club)->>'last_synced_at' is null, 'stamp reset';
end $$;

-- Re-import, then clear.
set role service_role;
select public.apply_calendar_sync((select id from cev where name = 'club'), jsonb_build_array(
  jsonb_build_object('uid', 'n-1', 'title', 'New calendar event', 'description', '', 'location', '', 'resort_id', null,
    'starts_at', now() + interval '10 days', 'ends_at', now() + interval '10 days 1 hour', 'all_day', false)), null);
set role authenticated;
do $$
declare v_club uuid := (select id from cev where name = 'club');
begin
  perform public.set_community_calendar(v_club, null);
  assert public.community_calendar(v_club) is null, 'row gone';
  assert not exists (select 1 from public.community_events where community_id = v_club and ics_uid = 'n-1'), 'future imported gone';
  assert exists (select 1 from public.community_events where community_id = v_club and ics_uid = 'u-3'), 'started imported stays';
  assert exists (select 1 from public.community_events where title = 'Manual social'), 'manual stays';
  perform public.set_community_calendar(v_club, 'https://calendar.google.com/x');
  perform public.set_community_calendar(v_club, '');
  assert public.community_calendar(v_club) is null, 'empty clears';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.community_events where ics_uid = 'o-1'), 'other community stays';
end $$;

-- Fix round: link changed mid-fetch, no-row syncs, cancel path releases rides, anon.
insert into public.community_calendars (community_id, ics_url)
values ((select id from cev where name = 'club'), 'https://calendar.google.com/calendar/ical/fix/basic.ics');
set role service_role;
do $$
declare
  v_club uuid := (select id from cev where name = 'club');
  v_other uuid := (select id from cev where name = 'other');
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '8 days';
  v_payload jsonb := jsonb_build_array(
    jsonb_build_object('uid', 'x-1', 'title', 'Fix one', 'starts_at', (d + interval '9 hours') at time zone 'America/Denver',
      'ends_at', (d + interval '11 hours') at time zone 'America/Denver', 'all_day', false),
    jsonb_build_object('uid', 'x-2', 'title', 'Fix two', 'starts_at', (d + interval '1 day 9 hours') at time zone 'America/Denver',
      'ends_at', (d + interval '1 day 11 hours') at time zone 'America/Denver', 'all_day', false));
begin
  -- Link changed while fetching: nothing changes, not even the error or stamp.
  perform public.apply_calendar_sync(v_club, v_payload, null, 'https://calendar.google.com/calendar/ical/old/basic.ics');
  perform public.apply_calendar_sync(v_club, null, 'stale error', 'https://calendar.google.com/calendar/ical/old/basic.ics');
  -- A community with no link gets nothing.
  perform public.apply_calendar_sync(v_other, v_payload, null);
  perform public.apply_calendar_sync(v_other, v_payload, null, 'https://calendar.google.com/x');
  -- Matching url applies.
  perform public.apply_calendar_sync(v_club, v_payload, null, 'https://calendar.google.com/calendar/ical/fix/basic.ics');
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.community_events where ics_uid in ('x-1', 'x-2')) = 2, 'only the matching-url sync applied, and only for the club';
  assert not exists (select 1 from public.community_events where community_id = (select id from cev where name = 'other') and ics_uid in ('x-1', 'x-2')), 'no-row sync inserted nothing';
  assert (select last_error is null and last_synced_at is not null from public.community_calendars where community_id = (select id from cev where name = 'club')), 'stale error ignored';
end $$;
-- A stale url with an error or payload leaves the stamps alone.
update public.community_calendars set last_synced_at = null where community_id = (select id from cev where name = 'club');
set role service_role;
select public.apply_calendar_sync((select id from cev where name = 'club'), '[]'::jsonb, null, 'https://calendar.google.com/old');
select public.apply_calendar_sync((select id from cev where name = 'club'), null, 'nope', 'https://calendar.google.com/old');
reset role;
do $$
begin
  assert (select last_synced_at is null and last_error is null from public.community_calendars where community_id = (select id from cev where name = 'club')), 'stale url changes nothing';
  assert (select count(*) from public.community_events where ics_uid in ('x-1', 'x-2') and cancelled_at is null) = 2, 'stale empty payload cancelled nothing';
end $$;

-- A ride on x-1; a sync without x-1 cancels it and releases the ride.
set role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000c1', false);
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '8 days';
  v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '8 hours') at time zone 'America/Denver', (d + interval '15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', (select id from cev where name = 'club'),
          (select id from public.community_events where ics_uid = 'x-1'))
  returning id into v_id;
  assert (select event_id from public.rides where id = v_id) is not null, 'linked';
  insert into cev values ('ride2', v_id);
end $$;
set role service_role;
do $$
declare d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '8 days';
begin
  perform public.apply_calendar_sync((select id from cev where name = 'club'), jsonb_build_array(
    jsonb_build_object('uid', 'x-2', 'title', 'Fix two', 'starts_at', (d + interval '1 day 9 hours') at time zone 'America/Denver',
      'ends_at', (d + interval '1 day 11 hours') at time zone 'America/Denver', 'all_day', false)), null);
end $$;
reset role;
do $$
begin
  assert (select cancelled_at is not null from public.community_events where ics_uid = 'x-1'), 'x-1 cancelled';
  assert (select event_id from public.rides where id = (select id from cev where name = 'ride2')) is null, 'cancel path releases the ride';
end $$;

-- Clearing the link: an imported event under way is cancelled and its ride released; one that is over stays.
set role service_role;
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver');
begin
  perform public.apply_calendar_sync((select id from cev where name = 'club'), jsonb_build_array(
    jsonb_build_object('uid', 'x-2', 'title', 'Fix two', 'starts_at', (d + interval '9 days 9 hours') at time zone 'America/Denver',
      'ends_at', (d + interval '9 days 11 hours') at time zone 'America/Denver', 'all_day', false),
    jsonb_build_object('uid', 'w-1', 'title', 'Week-long camp', 'starts_at', now() - interval '2 hours',
      'ends_at', now() + interval '4 days', 'all_day', false),
    jsonb_build_object('uid', 'w-old', 'title', 'Earlier clinic', 'starts_at', now() - interval '3 hours',
      'ends_at', now() - interval '1 hour', 'all_day', false)), null);
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000c1', false);
do $$
declare
  d timestamp := date_trunc('day', now() at time zone 'America/Denver') + interval '2 days';
  v_id uuid;
begin
  insert into public.rides (resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, community_id, event_id)
  values ('eldora', 'round_trip', (d + interval '8 hours') at time zone 'America/Denver', (d + interval '15 hours') at time zone 'America/Denver',
          'Base', 'Farrand Field', 3, 5, '303-555-0111', (select id from cev where name = 'club'),
          (select id from public.community_events where ics_uid = 'w-1'))
  returning id into v_id;
  assert (select event_id from public.rides where id = v_id) is not null, 'linked to the camp';
  insert into cev values ('ride3', v_id);
end $$;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  v_club uuid := (select id from cev where name = 'club');
  r jsonb;
begin
  perform public.set_community_calendar(v_club, null);
  r := public.community_events(v_club, current_date - 1, current_date + 30);
  assert not exists (select 1 from jsonb_array_elements(r) e where e->>'title' = 'Week-long camp'), 'under-way imported event no longer listed';
  assert (select cancelled_at is not null from public.community_events where ics_uid = 'w-1'), 'under-way imported event cancelled';
  assert (select event_id is null and cancelled_at is null from public.rides where id = (select id from cev where name = 'ride3')),
    'its ride is kept and unlinked';
  assert (select cancelled_at is null from public.community_events where ics_uid = 'w-old'), 'an imported event that is over stays as it was';
  assert not exists (select 1 from public.community_events where ics_uid = 'x-2'), 'not started yet: removed';
end $$;

-- Cron claims: never attempted first, stamped, and the next claim takes the next one.
reset role;
insert into public.community_calendars (community_id, ics_url, last_attempt_at) values
  ((select id from cev where name = 'club'), 'https://calendar.google.com/calendar/ical/club2/basic.ics', now() - interval '1 hour'),
  ((select id from cev where name = 'other'), 'https://calendar.google.com/calendar/ical/other/basic.ics', null);
set role service_role;
do $$
declare
  v_club uuid := (select id from cev where name = 'club');
  v_other uuid := (select id from cev where name = 'other');
  v_ids uuid[];
begin
  select array_agg(community_id) into v_ids from public.claim_calendars_to_sync(1);
  assert v_ids = array[v_other], 'never-attempted calendar first: ' || coalesce(v_ids::text, 'none');
  assert (select last_attempt_at is not null from public.community_calendars where community_id = v_other), 'claimed row stamped';
  assert (select last_attempt_at < now() - interval '30 minutes' from public.community_calendars where community_id = v_club), 'unclaimed row untouched';
  select array_agg(community_id) into v_ids from public.claim_calendars_to_sync(1);
  assert v_ids = array[v_club], 'then the least recently attempted: ' || coalesce(v_ids::text, 'none');
  assert (select last_attempt_at = now() from public.community_calendars where community_id = v_club), 'second claim stamped';
  assert (select count(*) from public.claim_calendars_to_sync()) = 2, 'default claims both';
end $$;
reset role;
delete from public.community_calendars where community_id in ((select id from cev where name = 'club'), (select id from cev where name = 'other'));

-- anon can run none of them.
grant select on cev to anon;
set role anon;
do $$
declare v_club uuid := (select id from cev where name = 'club');
begin
  begin perform public.apply_calendar_sync(v_club, '[]'::jsonb, null); raise exception 'FAIL anon sync';
  exception when insufficient_privilege then null; end;
  begin perform * from public.claim_calendars_to_sync(); raise exception 'FAIL anon claim';
  exception when insufficient_privilege then null; end;
  begin perform * from public.claim_calendars_to_sync(1); raise exception 'FAIL anon claim one';
  exception when insufficient_privilege then null; end;
  begin perform public.community_calendar(v_club); raise exception 'FAIL anon read';
  exception when insufficient_privilege then null; end;
  begin perform public.set_community_calendar(v_club, null); raise exception 'FAIL anon set';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
