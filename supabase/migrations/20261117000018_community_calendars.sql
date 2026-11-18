-- Club calendar import, database side.
--
-- * An admin saves the ICS link of the club's Google, Outlook or iCloud calendar.
--   Only admins can read or set it. The table has no grants for app users.
-- * A server job (service role only) lists the links and hands the parsed events
--   back to apply_calendar_sync, which adds, updates and cancels imported events.
-- * Imported events keep their id when they change, so RSVPs and ride links stay.
--   Rides that no longer fit an imported event are released.

create table public.community_calendars (
  community_id uuid primary key references public.communities (id) on delete cascade,
  ics_url text not null,
  last_synced_at timestamptz,
  last_error text,
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now()
);

alter table public.community_calendars enable row level security;
revoke all on public.community_calendars from anon, authenticated;

------------------------------------------------------------------------------
-- The link check (no network, just the text).
------------------------------------------------------------------------------
create function public.calendar_url_ok(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_m text[];
  v_host text;
begin
  -- Printable ASCII only: no spaces, control, NBSP, zero-width or look-alike characters.
  if p_url is null or p_url ~ '[^\x21-\x7e]' or p_url ~ '\\' then
    return false;
  end if;
  v_m := regexp_match(p_url, '^[hH][tT][tT][pP][sS]://([^/?#@:]+)/');
  if v_m is null then
    return false;
  end if;
  if v_m[1] !~ '^[A-Za-z0-9.-]+$' then
    return false;
  end if;
  v_host := lower(v_m[1]);
  return v_host in ('calendar.google.com', 'outlook.office365.com', 'outlook.office.com', 'outlook.live.com')
      or v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.icloud\.com$';
end;
$$;

------------------------------------------------------------------------------
-- Admin tools
------------------------------------------------------------------------------
create function public.community_calendar(p_community_id uuid)
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
  return (select jsonb_build_object('ics_url', c.ics_url, 'last_synced_at', c.last_synced_at, 'last_error', c.last_error)
          from public.community_calendars c where c.community_id = p_community_id);
end;
$$;

create function public.set_community_calendar(p_community_id uuid, p_url text)
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

  if v_url = '' then
    delete from public.community_events
     where community_id = p_community_id and source = 'ics' and starts_at > now();
    delete from public.community_calendars where community_id = p_community_id;
    return;
  end if;

  v_url := regexp_replace(v_url, '^[wW][eE][bB][cC][aA][lL][sS]?://', 'https://');
  if not public.calendar_url_ok(v_url) then
    raise exception 'Use a Google, Outlook or iCloud calendar link.' using errcode = 'P0001';
  end if;
  if v_old = v_url then
    return;
  end if;

  -- A different calendar: what we imported from the old one that hasn't started goes.
  delete from public.community_events
   where community_id = p_community_id and source = 'ics' and starts_at > now();
  insert into public.community_calendars (community_id, ics_url, set_by, set_at)
  values (p_community_id, v_url, auth.uid(), now())
  on conflict (community_id) do update
    set ics_url = excluded.ics_url, last_synced_at = null, last_error = null,
        set_by = excluded.set_by, set_at = excluded.set_at;
end;
$$;

------------------------------------------------------------------------------
-- Sync (service role only)
------------------------------------------------------------------------------
create function public.calendars_to_sync()
returns table (community_id uuid, ics_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.community_id, c.ics_url from public.community_calendars c order by c.set_at;
$$;

create function public.apply_calendar_sync(p_community_id uuid, p_events jsonb, p_error text, p_url text default null)
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
  -- Lock the link row first: syncs and link changes then run one at a time.
  select ics_url into v_stored from public.community_calendars where community_id = p_community_id for update;
  if not found then
    return;
  end if;
  -- The link changed while the caller was fetching the old one.
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

revoke execute on function public.calendar_url_ok(text) from public, anon;
grant execute on function public.calendar_url_ok(text) to authenticated;
revoke execute on function public.community_calendar(uuid) from public, anon;
grant execute on function public.community_calendar(uuid) to authenticated;
revoke execute on function public.set_community_calendar(uuid, text) from public, anon;
grant execute on function public.set_community_calendar(uuid, text) to authenticated;
revoke execute on function public.calendars_to_sync() from public, anon, authenticated;
grant execute on function public.calendars_to_sync() to service_role;
revoke execute on function public.apply_calendar_sync(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.apply_calendar_sync(uuid, jsonb, text, text) to service_role;
