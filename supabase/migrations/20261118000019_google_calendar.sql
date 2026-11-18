-- Club calendar from Google sign-in (OAuth), next to the pasted ICS link.
--
-- * An admin signs in with Google; the google-calendar edge function keeps the refresh
--   token in Supabase Vault (community_google_accounts points at the secret). Nothing here
--   ever hands the token to an app user.
-- * The admin then picks one of that account's calendars. community_calendars holds either an
--   ICS link (source 'ics') or a Google calendar id (source 'google'), never both.
-- * Syncing is unchanged: the cron claims rows, the function fetches (feed or Google API) and
--   hands events to apply_calendar_sync. Each row's sync_key (the link, or google:<id>) binds a
--   fetch to what was stored when it started.
-- * The connection belongs to the admin who made it: if they stop being an admin, leave or
--   delete their account, the Google calendar is disconnected and the token deleted.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
alter table public.community_calendars
  alter column ics_url drop not null,
  add column source text not null default 'ics' check (source in ('ics', 'google')),
  add column google_calendar_id text,
  add column google_calendar_name text,
  add constraint community_calendars_one_source check (
    (source = 'ics' and ics_url is not null and google_calendar_id is null)
    or (source = 'google' and ics_url is null and google_calendar_id is not null)
  );

create table public.community_google_accounts (
  community_id uuid primary key references public.communities (id) on delete cascade,
  email text not null default '',
  token_secret_id uuid not null, -- vault.secrets id holding the refresh token
  connected_by uuid references public.profiles (id) on delete cascade,
  connected_at timestamptz not null default now()
);
alter table public.community_google_accounts enable row level security;
revoke all on public.community_google_accounts from anon, authenticated;

-- One-time sign-in states, hashed. Lives for 10 minutes.
create table public.google_oauth_states (
  state_hash text primary key,
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  return_to text not null,
  code_verifier text not null,
  expires_at timestamptz not null
);
alter table public.google_oauth_states enable row level security;
revoke all on public.google_oauth_states from anon, authenticated;

------------------------------------------------------------------------------
-- Shared cleanup
------------------------------------------------------------------------------
-- What a club's calendar imported, when the calendar goes or changes: not started yet, it goes;
-- under way, it is cancelled and its rides are released; already over, it stays as it was.
create function public.drop_imported_calendar_events(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  delete from public.community_events
   where community_id = p_community_id and source = 'ics' and starts_at > now();
  for v_id in
    update public.community_events e
       set cancelled_at = now(), updated_at = now()
     where e.community_id = p_community_id and e.source = 'ics' and e.cancelled_at is null
       and e.starts_at <= now() and not public.event_is_over(e.starts_at, e.ends_at, e.all_day)
    returning e.id
  loop
    perform public.release_event_rides(v_id);
  end loop;
end;
$$;

-- Removes the Google calendar (if one is chosen) and the account. Caller holds no lock; this takes it.
create function public.drop_google_connection(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
begin
  select source into v_source from public.community_calendars where community_id = p_community_id for update;
  if v_source = 'google' then
    perform public.drop_imported_calendar_events(p_community_id);
    delete from public.community_calendars where community_id = p_community_id;
  end if;
  delete from public.community_google_accounts where community_id = p_community_id;
end;
$$;

-- The token goes when its account row goes (disconnect, community deleted, admin gone), and so
-- does a Google calendar that nothing can read anymore (the row can also go by cascade, when the
-- admin who connected it deletes their account).
create function public.community_google_accounts_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.token_secret_id;
  if exists (select 1 from public.communities where id = old.community_id)
     and exists (select 1 from public.community_calendars where community_id = old.community_id and source = 'google') then
    perform 1 from public.community_calendars where community_id = old.community_id for update;
    perform public.drop_imported_calendar_events(old.community_id);
    delete from public.community_calendars where community_id = old.community_id and source = 'google';
  end if;
  return old;
end;
$$;
create trigger community_google_accounts_drop_secret after delete on public.community_google_accounts
  for each row execute function public.community_google_accounts_drop_secret();

-- The admin who connected Google stops being an admin (or leaves, or deletes their account).
create function public.community_members_drop_google()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'admin' or (tg_op = 'UPDATE' and new.role = 'admin') then
    return null;
  end if;
  -- The whole community is being deleted: its rows go by cascade.
  if not exists (select 1 from public.communities where id = old.community_id) then
    return null;
  end if;
  if exists (select 1 from public.community_google_accounts
              where community_id = old.community_id and connected_by = old.user_id) then
    perform public.drop_google_connection(old.community_id);
  end if;
  return null;
end;
$$;
create trigger community_members_drop_google after delete or update of role on public.community_members
  for each row execute function public.community_members_drop_google();

------------------------------------------------------------------------------
-- Admin tools (as the signed-in user)
------------------------------------------------------------------------------
-- What the admin card shows. Null when nothing is connected or signed in.
create or replace function public.community_calendar(p_community_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only community admins can see the calendar link.' using errcode = '42501';
  end if;
  return (
    select case when c.community_id is null and g.community_id is null then null else jsonb_build_object(
      'source', c.source,
      'ics_url', c.ics_url,
      'google_calendar_name', c.google_calendar_name,
      'google_email', g.email,
      'google_pending', c.community_id is null,
      'last_synced_at', c.last_synced_at,
      'last_error', c.last_error) end
    from (select p_community_id as id) k
    left join public.community_calendars c on c.community_id = k.id
    left join public.community_google_accounts g on g.community_id = k.id
  );
end;
$$;

create or replace function public.set_community_calendar(p_community_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_old text;
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only community admins can set the calendar link.' using errcode = '42501';
  end if;
  -- Lock the row so this and a running sync take turns.
  select ics_url into v_old from public.community_calendars where community_id = p_community_id for update;
  -- Google has to be disconnected through the function, which also revokes the token at Google.
  if exists (select 1 from public.community_google_accounts where community_id = p_community_id) then
    raise exception 'Disconnect Google Calendar first.' using errcode = 'P0001';
  end if;

  if v_url <> '' then
    v_url := regexp_replace(v_url, '^[wW][eE][bB][cC][aA][lL][sS]?://', 'https://');
    if not public.calendar_url_ok(v_url) then
      raise exception 'Use a Google, Outlook or iCloud calendar link.' using errcode = 'P0001';
    end if;
    if v_old = v_url then
      return;
    end if;
  end if;

  perform public.drop_imported_calendar_events(p_community_id);

  if v_url = '' then
    delete from public.community_calendars where community_id = p_community_id;
    return;
  end if;

  insert into public.community_calendars (community_id, source, ics_url, set_by, set_at)
  values (p_community_id, 'ics', v_url, auth.uid(), now())
  on conflict (community_id) do update
    set source = 'ics', ics_url = excluded.ics_url, google_calendar_id = null, google_calendar_name = null,
        last_synced_at = null, last_error = null, last_attempt_at = null,
        set_by = excluded.set_by, set_at = excluded.set_at;
end;
$$;

------------------------------------------------------------------------------
-- Google sign-in (service role only, called by the google-calendar function)
------------------------------------------------------------------------------
create function public.is_admin_of(p_community_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.community_members
                  where community_id = p_community_id and user_id = p_user_id and role = 'admin');
$$;

create function public.save_google_oauth_state(p_state_hash text, p_community_id uuid, p_user_id uuid, p_return_to text, p_code_verifier text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_of(p_community_id, p_user_id) then
    raise exception 'Only community admins can connect a calendar.' using errcode = '42501';
  end if;
  delete from public.google_oauth_states where expires_at < now();
  -- One sign-in at a time per admin and community.
  delete from public.google_oauth_states where community_id = p_community_id and user_id = p_user_id;
  insert into public.google_oauth_states (state_hash, community_id, user_id, return_to, code_verifier, expires_at)
  values (p_state_hash, p_community_id, p_user_id, p_return_to, p_code_verifier, now() + interval '10 minutes');
end;
$$;

-- Uses up a state: it is deleted whether or not it is still valid. No row when unknown or expired.
create function public.take_google_oauth_state(p_state_hash text)
returns table (community_id uuid, user_id uuid, return_to text, code_verifier text)
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.google_oauth_states s where s.state_hash = p_state_hash returning s.*
  )
  select g.community_id, g.user_id, g.return_to, g.code_verifier from gone g where g.expires_at >= now();
$$;

-- Stores (or replaces) the account's refresh token. Signing in with a different Google account
-- drops the calendar chosen from the old one.
create function public.save_google_account(p_community_id uuid, p_user_id uuid, p_email text, p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.community_google_accounts;
  v_secret uuid;
begin
  if coalesce(p_refresh_token, '') = '' then
    raise exception 'Missing token.' using errcode = 'P0001';
  end if;
  perform 1 from public.community_calendars where community_id = p_community_id for update;
  if not public.is_admin_of(p_community_id, p_user_id) then
    raise exception 'Only community admins can connect a calendar.' using errcode = '42501';
  end if;
  select * into v_old from public.community_google_accounts where community_id = p_community_id for update;
  if found and lower(v_old.email) = lower(coalesce(p_email, '')) then
    perform vault.update_secret(v_old.token_secret_id, p_refresh_token);
    update public.community_google_accounts
       set connected_by = p_user_id, connected_at = now()
     where community_id = p_community_id;
    update public.community_calendars set last_error = null, last_attempt_at = null
     where community_id = p_community_id and source = 'google';
    return;
  end if;
  if found then
    perform public.drop_google_connection(p_community_id);
  end if;
  v_secret := vault.create_secret(p_refresh_token, null, 'Google Calendar refresh token for a Lift2Lift community');
  insert into public.community_google_accounts (community_id, email, token_secret_id, connected_by, connected_at)
  values (p_community_id, left(coalesce(p_email, ''), 320), v_secret, p_user_id, now());
end;
$$;

create function public.google_refresh_token(p_community_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
    from public.community_google_accounts g
    join vault.decrypted_secrets d on d.id = g.token_secret_id
   where g.community_id = p_community_id;
$$;

-- Makes a calendar of the signed-in account the club calendar. The function has checked that the
-- account can read it. Replacing an ICS link (or another Google calendar) drops what it imported.
create function public.set_google_calendar(p_community_id uuid, p_user_id uuid, p_calendar_id text, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.community_calendars;
  v_name text := left(btrim(coalesce(p_name, '')), 120);
begin
  if coalesce(btrim(p_calendar_id), '') = '' or char_length(p_calendar_id) > 1024 then
    raise exception 'Pick a calendar.' using errcode = 'P0001';
  end if;
  select * into v_row from public.community_calendars where community_id = p_community_id for update;
  if not public.is_admin_of(p_community_id, p_user_id) then
    raise exception 'Only community admins can set the calendar.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.community_google_accounts where community_id = p_community_id) then
    raise exception 'Sign in with Google first.' using errcode = 'P0001';
  end if;
  if v_row.source = 'google' and v_row.google_calendar_id = p_calendar_id then
    update public.community_calendars set google_calendar_name = v_name where community_id = p_community_id;
    return;
  end if;
  if v_row.community_id is not null then
    perform public.drop_imported_calendar_events(p_community_id);
  end if;
  insert into public.community_calendars (community_id, source, ics_url, google_calendar_id, google_calendar_name, set_by, set_at)
  values (p_community_id, 'google', null, p_calendar_id, v_name, p_user_id, now())
  on conflict (community_id) do update
    set source = 'google', ics_url = null, google_calendar_id = excluded.google_calendar_id,
        google_calendar_name = excluded.google_calendar_name,
        last_synced_at = null, last_error = null, last_attempt_at = null,
        set_by = excluded.set_by, set_at = excluded.set_at;
end;
$$;

-- Disconnect: the calendar (if it is the Google one), its events as above, the account and the token.
create function public.remove_google_calendar(p_community_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_of(p_community_id, p_user_id) then
    raise exception 'Only community admins can disconnect the calendar.' using errcode = '42501';
  end if;
  perform public.drop_google_connection(p_community_id);
end;
$$;

------------------------------------------------------------------------------
-- Sync (service role only)
------------------------------------------------------------------------------
create function public.calendar_sync_key(p_source text, p_ics_url text, p_google_calendar_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_source = 'google' then 'google:' || p_google_calendar_id else p_ics_url end;
$$;

drop function public.claim_calendars_to_sync(integer);
create function public.claim_calendars_to_sync(p_limit integer default 20)
returns table (community_id uuid, source text, sync_key text, ics_url text, google_calendar_id text)
language sql
security definer
set search_path = ''
as $$
  update public.community_calendars c
     set last_attempt_at = now()
    from (select x.community_id
            from public.community_calendars x
           order by x.last_attempt_at asc nulls first, x.community_id
           limit greatest(coalesce(p_limit, 20), 0)
             for update skip locked) pick
   where c.community_id = pick.community_id
  returning c.community_id, c.source, public.calendar_sync_key(c.source, c.ics_url, c.google_calendar_id),
            c.ics_url, c.google_calendar_id;
$$;

-- The same row for one community (Sync now). The function has checked the caller is an admin.
create function public.calendar_sync_target(p_community_id uuid)
returns table (community_id uuid, source text, sync_key text, ics_url text, google_calendar_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.community_id, c.source, public.calendar_sync_key(c.source, c.ics_url, c.google_calendar_id),
         c.ics_url, c.google_calendar_id
    from public.community_calendars c where c.community_id = p_community_id;
$$;

-- As before, except p_url is now the row's sync key (the link, or google:<calendar id>).
create or replace function public.apply_calendar_sync(p_community_id uuid, p_events jsonb, p_error text, p_url text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  el jsonb;
  v_uids text[] := '{}';
  v_touched uuid[] := '{}';
  v_id uuid;
  v_uid text;
  v_title text;
  v_desc text;
  v_loc text;
  v_resort text;
  v_start timestamptz;
  v_end timestamptz;
  v_all_day boolean;
  v_stored text;
begin
  -- Lock the row first: syncs and calendar changes then run one at a time.
  select public.calendar_sync_key(source, ics_url, google_calendar_id) into v_stored
    from public.community_calendars where community_id = p_community_id for update;
  if not found then
    return;
  end if;
  -- The calendar changed while the caller was fetching the old one.
  if p_url is not null and p_url is distinct from v_stored then
    return;
  end if;
  if p_error is not null then
    update public.community_calendars set last_error = p_error where community_id = p_community_id;
    return;
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array.' using errcode = 'P0001';
  end if;

  for el in select value from jsonb_array_elements(p_events) loop
    begin
      v_uid := nullif(btrim(el->>'uid'), '');
      if v_uid is null then
        continue;
      end if;
      -- Anything in the payload counts as still on the calendar, even if we skip it.
      v_uids := v_uids || v_uid;

      v_title := btrim(coalesce(el->>'title', ''));
      v_desc := coalesce(el->>'description', '');
      v_loc := coalesce(el->>'location', '');
      v_start := (el->>'starts_at')::timestamptz;
      v_end := (el->>'ends_at')::timestamptz;
      v_all_day := coalesce((el->>'all_day')::boolean, false);
      v_resort := nullif(el->>'resort_id', '');

      if char_length(v_title) not between 2 and 80
         or char_length(v_desc) > 1000 or char_length(v_loc) > 120
         or v_start is null or v_end is null or v_end < v_start
         or public.has_blocked_term(v_title) or public.has_blocked_term(v_desc) or public.has_blocked_term(v_loc) then
        continue;
      end if;
      if v_resort is not null and not exists (select 1 from public.resorts where id = v_resort) then
        v_resort := null;
      end if;

      insert into public.community_events (community_id, title, description, location, resort_id, starts_at, ends_at, all_day, source, ics_uid)
      values (p_community_id, v_title, v_desc, v_loc, v_resort, v_start, v_end, v_all_day, 'ics', v_uid)
      on conflict (community_id, ics_uid) do update
        set title = excluded.title, description = excluded.description, location = excluded.location,
            resort_id = excluded.resort_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
            all_day = excluded.all_day, cancelled_at = null, updated_at = now()
        where public.community_events.source = 'ics'
      returning id into v_id;
      if v_id is not null then
        v_touched := v_touched || v_id;
      end if;
    exception when others then
      continue; -- one bad event never stops the rest
    end;
  end loop;

  -- Imported events in the window that the calendar no longer has.
  with gone as (
    update public.community_events e
       set cancelled_at = now(), updated_at = now()
     where e.community_id = p_community_id and e.source = 'ics' and e.cancelled_at is null
       and e.ends_at > now() - interval '1 day' and e.starts_at < now() + interval '180 days'
       and not (e.ics_uid = any (v_uids))
    returning e.id
  )
  select v_touched || coalesce(array_agg(id), '{}') into v_touched from gone;

  foreach v_id in array v_touched loop
    perform public.release_event_rides(v_id);
  end loop;

  update public.community_calendars
     set last_synced_at = now(), last_error = null
   where community_id = p_community_id;
end;
$$;

------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------
revoke execute on function public.community_google_accounts_drop_secret() from public, anon, authenticated;
revoke execute on function public.community_members_drop_google() from public, anon, authenticated;
revoke execute on function public.drop_imported_calendar_events(uuid) from public, anon, authenticated;
revoke execute on function public.drop_google_connection(uuid) from public, anon, authenticated;
revoke execute on function public.calendar_sync_key(text, text, text) from public, anon, authenticated;
grant execute on function public.calendar_sync_key(text, text, text) to service_role;

revoke execute on function public.community_calendar(uuid) from public, anon;
grant execute on function public.community_calendar(uuid) to authenticated;
revoke execute on function public.set_community_calendar(uuid, text) from public, anon;
grant execute on function public.set_community_calendar(uuid, text) to authenticated;

revoke execute on function public.is_admin_of(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_admin_of(uuid, uuid) to service_role;
revoke execute on function public.save_google_oauth_state(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_google_oauth_state(text, uuid, uuid, text, text) to service_role;
revoke execute on function public.take_google_oauth_state(text) from public, anon, authenticated;
grant execute on function public.take_google_oauth_state(text) to service_role;
revoke execute on function public.save_google_account(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_google_account(uuid, uuid, text, text) to service_role;
revoke execute on function public.google_refresh_token(uuid) from public, anon, authenticated;
grant execute on function public.google_refresh_token(uuid) to service_role;
revoke execute on function public.set_google_calendar(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_google_calendar(uuid, uuid, text, text) to service_role;
revoke execute on function public.remove_google_calendar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_google_calendar(uuid, uuid) to service_role;

revoke execute on function public.claim_calendars_to_sync(integer) from public, anon, authenticated;
grant execute on function public.claim_calendars_to_sync(integer) to service_role;
revoke execute on function public.calendar_sync_target(uuid) from public, anon, authenticated;
grant execute on function public.calendar_sync_target(uuid) to service_role;
revoke execute on function public.apply_calendar_sync(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.apply_calendar_sync(uuid, jsonb, text, text) to service_role;
