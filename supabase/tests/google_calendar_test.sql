-- Google Calendar sign-in: one-time states, the token in Vault, picking a calendar, sync keys, disconnecting.
\set ON_ERROR_STOP on
reset role;

insert into public.communities (code_hash, name) values
  (public.community_code_hash('GCALCLUB2'), 'Google Club');

insert into auth.users (id, email, raw_user_meta_data) values
  ('9c000000-0000-4000-8000-0000000000a1', 'gava@lift2lift.test', '{"full_name":"Gava Admin"}'),
  ('9c000000-0000-4000-8000-0000000000a2', 'gamy@lift2lift.test', '{"full_name":"Gamy Admin"}'),
  ('9c000000-0000-4000-8000-0000000000b1', 'gben@lift2lift.test', '{"full_name":"Gben Member"}');
select public.test_make_ready('9c000000-0000-4000-8000-0000000000a1');
select public.test_make_ready('9c000000-0000-4000-8000-0000000000a2');
select public.test_make_ready('9c000000-0000-4000-8000-0000000000b1');

create temp table gcl (name text primary key, id uuid);
grant select on gcl to anon, authenticated, service_role;
insert into gcl values ('club', (select id from public.communities where name = 'Google Club'));

set role authenticated;
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a1', false);
select public.join_community('GCALCLUB2');
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a2', false);
select public.join_community('GCALCLUB2');
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000b1', false);
select public.join_community('GCALCLUB2');
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a1', false);
select public.set_community_role((select id from gcl where name = 'club'), '9c000000-0000-4000-8000-0000000000a2', 'admin');

-- App users can call none of the Google functions and read none of the tables.
do $$
declare v_club uuid := (select id from gcl where name = 'club');
begin
  begin perform public.save_google_oauth_state('h', v_club, auth.uid(), 'x', 'v'); raise exception 'FAIL state';
  exception when insufficient_privilege then null; end;
  begin perform * from public.take_google_oauth_state('h'); raise exception 'FAIL take';
  exception when insufficient_privilege then null; end;
  begin perform public.save_google_account(v_club, auth.uid(), 'a@b.c', 'tok'); raise exception 'FAIL save';
  exception when insufficient_privilege then null; end;
  begin perform public.google_refresh_token(v_club); raise exception 'FAIL token';
  exception when insufficient_privilege then null; end;
  begin perform public.set_google_calendar(v_club, auth.uid(), 'c', 'n'); raise exception 'FAIL set';
  exception when insufficient_privilege then null; end;
  begin perform public.remove_google_calendar(v_club, auth.uid()); raise exception 'FAIL remove';
  exception when insufficient_privilege then null; end;
  begin perform * from public.calendar_sync_target(v_club); raise exception 'FAIL target';
  exception when insufficient_privilege then null; end;
  begin perform * from public.community_google_accounts; raise exception 'FAIL accounts table';
  exception when insufficient_privilege then null; end;
  begin perform * from public.google_oauth_states; raise exception 'FAIL states table';
  exception when insufficient_privilege then null; end;
end $$;

-- States: admins only, one at a time, used once, 10 minutes.
reset role;
set role service_role;
do $$
declare
  v_club uuid := (select id from gcl where name = 'club');
  v_ava uuid := '9c000000-0000-4000-8000-0000000000a1';
  v_ben uuid := '9c000000-0000-4000-8000-0000000000b1';
  r record;
begin
  begin
    perform public.save_google_oauth_state('hash-ben', v_club, v_ben, 'lift2lift://google-calendar', 'ver');
    raise exception 'FAIL: member made a state';
  exception when sqlstate '42501' then null;
  end;
  perform public.save_google_oauth_state('hash-1', v_club, v_ava, 'lift2lift://google-calendar', 'ver-1');
  perform public.save_google_oauth_state('hash-2', v_club, v_ava, 'http://localhost:3000/community?id=x', 'ver-2');
  assert not exists (select 1 from public.take_google_oauth_state('hash-1')), 'a newer sign-in replaces the older state';
  select * into r from public.take_google_oauth_state('hash-2');
  assert r.community_id = v_club and r.user_id = v_ava and r.code_verifier = 'ver-2'
     and r.return_to = 'http://localhost:3000/community?id=x', 'state comes back';
  assert not exists (select 1 from public.take_google_oauth_state('hash-2')), 'used once';

  perform public.save_google_oauth_state('hash-old', v_club, v_ava, 'lift2lift://google-calendar', 'ver');
  update public.google_oauth_states set expires_at = now() - interval '1 second' where state_hash = 'hash-old';
  assert not exists (select 1 from public.take_google_oauth_state('hash-old')), 'expired';
  assert not exists (select 1 from public.google_oauth_states where state_hash = 'hash-old'), 'expired state deleted too';
end $$;

-- An ICS link and one imported event, before Google.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a1', false);
select public.set_community_calendar((select id from gcl where name = 'club'), 'https://calendar.google.com/calendar/ical/gclub/basic.ics');
reset role;
insert into public.community_events (community_id, title, starts_at, ends_at, source, ics_uid)
values ((select id from gcl where name = 'club'), 'Old feed trip', now() + interval '3 days', now() + interval '3 days 2 hours', 'ics', 'feed-1'),
       ((select id from gcl where name = 'club'), 'Manual social', now() + interval '4 days', now() + interval '4 days 2 hours', 'manual', null);

-- Signing in keeps the ICS link until a Google calendar is picked; the token is only in Vault.
set role service_role;
do $$
declare
  v_club uuid := (select id from gcl where name = 'club');
  v_ava uuid := '9c000000-0000-4000-8000-0000000000a1';
  v_ben uuid := '9c000000-0000-4000-8000-0000000000b1';
begin
  begin
    perform public.save_google_account(v_club, v_ben, 'ben@gmail.com', 'tok-ben');
    raise exception 'FAIL: member saved an account';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.save_google_account(v_club, v_ava, 'ava@gmail.com', '');
    raise exception 'FAIL: empty token';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.save_google_account(v_club, v_ava, 'ava@gmail.com', 'tok-1');
  assert public.google_refresh_token(v_club) = 'tok-1', 'token readable by the service role';
  assert (select source from public.community_calendars where community_id = v_club) = 'ics', 'ICS link still set';
  assert exists (select 1 from public.community_events where community_id = v_club and ics_uid = 'feed-1'), 'feed event still there';

  begin
    perform public.set_google_calendar(v_club, v_ben, 'club@group.calendar.google.com', 'Club');
    raise exception 'FAIL: member picked a calendar';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.set_google_calendar(v_club, v_ava, '  ', 'Club');
    raise exception 'FAIL: blank calendar';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a1', false);
do $$
declare
  v_club uuid := (select id from gcl where name = 'club');
  r jsonb;
begin
  r := public.community_calendar(v_club);
  assert r->>'source' = 'ics' and r->>'google_email' = 'ava@gmail.com' and (r->>'google_pending')::boolean = false, r::text;
  assert r::text not like '%tok-1%', 'no token in the card data';
  begin
    perform public.set_community_calendar(v_club, null);
    raise exception 'FAIL: removed the link while Google is signed in';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Disconnect Google Calendar first.', sqlerrm;
  end;
end $$;

-- Picking a Google calendar replaces the ICS link and drops what the feed imported.
reset role;
set role service_role;
do $$
declare
  v_club uuid := (select id from gcl where name = 'club');
  v_ava uuid := '9c000000-0000-4000-8000-0000000000a1';
  r record;
begin
  perform public.set_google_calendar(v_club, v_ava, 'club@group.calendar.google.com', 'CU Freeride');
  select * into r from public.community_calendars where community_id = v_club;
  assert r.source = 'google' and r.ics_url is null and r.google_calendar_id = 'club@group.calendar.google.com'
     and r.google_calendar_name = 'CU Freeride', 'google calendar stored';
  assert not exists (select 1 from public.community_events where community_id = v_club and ics_uid = 'feed-1'), 'feed event dropped';
  assert exists (select 1 from public.community_events where community_id = v_club and source = 'manual'), 'manual event kept';

  select * into r from public.calendar_sync_target(v_club);
  assert r.source = 'google' and r.sync_key = 'google:club@group.calendar.google.com' and r.ics_url is null, 'sync target';
  assert exists (select 1 from public.claim_calendars_to_sync() c where c.community_id = v_club
                 and c.sync_key = 'google:club@group.calendar.google.com'
                 and c.google_calendar_id = 'club@group.calendar.google.com'), 'claimed with its key';

  -- A sync bound to a calendar that is no longer the club's does nothing.
  perform public.apply_calendar_sync(v_club, jsonb_build_array(jsonb_build_object('uid', 'g-stale', 'title', 'Stale',
    'starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 1 hour', 'all_day', false)), null,
    'https://calendar.google.com/calendar/ical/gclub/basic.ics');
  assert not exists (select 1 from public.community_events where ics_uid = 'g-stale'), 'stale sync ignored';

  perform public.apply_calendar_sync(v_club, jsonb_build_array(jsonb_build_object('uid', 'g-1|2026-12-01', 'title', 'Powder day',
    'starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 1 hour', 'all_day', false)), null,
    'google:club@group.calendar.google.com');
  assert exists (select 1 from public.community_events where community_id = v_club and ics_uid = 'g-1|2026-12-01'
                 and source = 'ics' and cancelled_at is null), 'google event imported';
  assert (select last_synced_at is not null from public.community_calendars where community_id = v_club), 'sync time recorded';

  perform public.apply_calendar_sync(v_club, null, 'Google Calendar access ended. Connect it again.', 'google:club@group.calendar.google.com');
  assert (select last_error from public.community_calendars where community_id = v_club) = 'Google Calendar access ended. Connect it again.', 'error recorded';

  -- Signing in again with the same account swaps the token, keeps the calendar and clears the error.
  perform public.save_google_account(v_club, v_ava, 'AVA@gmail.com', 'tok-2');
  assert public.google_refresh_token(v_club) = 'tok-2', 'token replaced';
  select * into r from public.community_calendars where community_id = v_club;
  assert r.source = 'google' and r.last_error is null, 'calendar kept, error cleared';
  assert exists (select 1 from public.community_events where ics_uid = 'g-1|2026-12-01'), 'events kept';

  -- A different account drops the calendar chosen from the old one.
  perform public.save_google_account(v_club, v_ava, 'other@gmail.com', 'tok-3');
  assert not exists (select 1 from public.community_calendars where community_id = v_club), 'calendar dropped';
  assert not exists (select 1 from public.community_events where ics_uid = 'g-1|2026-12-01'), 'its events dropped';
  assert (select email from public.community_google_accounts where community_id = v_club) = 'other@gmail.com', 'new account';
end $$;
reset role;
do $$
begin
  assert (select count(*) from vault.secrets where secret like 'tok-%') = 1, 'only the newest secret is left';
end $$;

-- Signed in, no calendar yet: the card shows the picker.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a1', false);
do $$
declare r jsonb := public.community_calendar((select id from gcl where name = 'club'));
begin
  assert (r->>'google_pending')::boolean and r->>'google_email' = 'other@gmail.com' and r->>'source' is null, r::text;
end $$;
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000b1', false);
do $$
begin
  perform public.community_calendar((select id from gcl where name = 'club'));
  raise exception 'FAIL: member read the calendar';
exception when sqlstate '42501' then null;
end $$;

-- Disconnect removes the calendar, the account and the token.
reset role;
set role service_role;
do $$
declare
  v_club uuid := (select id from gcl where name = 'club');
  v_ava uuid := '9c000000-0000-4000-8000-0000000000a1';
  v_ben uuid := '9c000000-0000-4000-8000-0000000000b1';
begin
  perform public.set_google_calendar(v_club, v_ava, 'club@group.calendar.google.com', 'CU Freeride');
  begin
    perform public.remove_google_calendar(v_club, v_ben);
    raise exception 'FAIL: member disconnected';
  exception when sqlstate '42501' then null;
  end;
  perform public.remove_google_calendar(v_club, v_ava);
  assert not exists (select 1 from public.community_calendars where community_id = v_club), 'calendar gone';
  assert not exists (select 1 from public.community_google_accounts where community_id = v_club), 'account gone';
  assert public.google_refresh_token(v_club) is null, 'no token';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from vault.secrets where secret = 'tok-3'), 'secret gone';
end $$;
set role service_role;

-- The admin who connected stops being an admin: Google is disconnected. Another admin stepping down is not.
do $$
declare
  v_club uuid := (select id from gcl where name = 'club');
  v_ava uuid := '9c000000-0000-4000-8000-0000000000a1';
begin
  perform public.save_google_account(v_club, v_ava, 'ava@gmail.com', 'tok-4');
  perform public.set_google_calendar(v_club, v_ava, 'club@group.calendar.google.com', 'CU Freeride');
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a1', false);
select public.set_community_role((select id from gcl where name = 'club'), '9c000000-0000-4000-8000-0000000000a2', 'member');
reset role;
do $$
begin
  assert exists (select 1 from public.community_google_accounts where community_id = (select id from gcl where name = 'club')), 'kept';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a1', false);
select public.set_community_role((select id from gcl where name = 'club'), '9c000000-0000-4000-8000-0000000000a2', 'admin');
select set_config('request.jwt.claim.sub', '9c000000-0000-4000-8000-0000000000a2', false);
select public.set_community_role((select id from gcl where name = 'club'), '9c000000-0000-4000-8000-0000000000a1', 'member');
reset role;
do $$
declare v_club uuid := (select id from gcl where name = 'club');
begin
  assert not exists (select 1 from public.community_google_accounts where community_id = v_club), 'account dropped with admin';
  assert not exists (select 1 from public.community_calendars where community_id = v_club), 'calendar dropped with admin';
  assert not exists (select 1 from vault.secrets where secret = 'tok-4'), 'secret dropped with admin';
end $$;

-- Deleting the account of the admin who connected does the same.
set role service_role;
select public.save_google_account((select id from gcl where name = 'club'), '9c000000-0000-4000-8000-0000000000a2', 'amy@gmail.com', 'tok-5');
select public.set_google_calendar((select id from gcl where name = 'club'), '9c000000-0000-4000-8000-0000000000a2', 'amy@gmail.com', 'Amy');
reset role;
delete from auth.users where id = '9c000000-0000-4000-8000-0000000000a2';
do $$
declare v_club uuid := (select id from gcl where name = 'club');
begin
  assert not exists (select 1 from public.community_google_accounts where community_id = v_club), 'account dropped with user';
  assert not exists (select 1 from public.community_calendars where community_id = v_club), 'calendar dropped with user';
  assert not exists (select 1 from vault.secrets where secret = 'tok-5'), 'secret dropped with user';
end $$;

-- Deleting the community deletes the token.
set role service_role;
select public.save_google_account((select id from gcl where name = 'club'), '9c000000-0000-4000-8000-0000000000a1', 'ava@gmail.com', 'tok-6');
select public.set_google_calendar((select id from gcl where name = 'club'), '9c000000-0000-4000-8000-0000000000a1', 'club@group.calendar.google.com', 'CU Freeride');
reset role;
delete from public.communities where id = (select id from gcl where name = 'club');
do $$
begin
  assert not exists (select 1 from vault.secrets where secret = 'tok-6'), 'secret dropped with community';
end $$;
