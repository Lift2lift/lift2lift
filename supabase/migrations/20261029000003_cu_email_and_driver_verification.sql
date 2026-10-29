-- 1. Only CU Boulder students: every account must use a @colorado.edu email.
--    Confirming the emailed code proves the person can read that inbox.
-- 2. Driver verification: before hosting a ride, a driver uploads a photo of
--    their driver's license and insurance card. Uploading both is enough to
--    host right away; the team can review later and reject if needed.

------------------------------------------------------------------------------
-- Allowed email domains
------------------------------------------------------------------------------
create table public.allowed_email_domains (
  domain text primary key check (domain = lower(domain))
);

alter table public.allowed_email_domains enable row level security;
create policy "Anyone can read allowed domains" on public.allowed_email_domains for select to anon, authenticated using (true);
revoke insert, update, delete on public.allowed_email_domains from anon, authenticated;

insert into public.allowed_email_domains (domain) values ('colorado.edu');

create function public.is_school_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_email_domains d
    where lower(split_part(p_email, '@', 2)) = d.domain
       or lower(split_part(p_email, '@', 2)) like '%.' || d.domain
  );
$$;

create function public.enforce_school_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or not public.is_school_email(new.email) then
    raise exception 'Lift2Lift is for CU Boulder students. Sign up with your @colorado.edu email.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger auth_users_school_email
  before insert or update of email on auth.users
  for each row execute function public.enforce_school_email();

------------------------------------------------------------------------------
-- Private storage for license and insurance photos.
-- Files live at driver-docs/<user id>/license.<ext> and /insurance.<ext>.
-- Only the owner can upload or view them; the team reviews in the dashboard.
------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-docs', 'driver-docs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do nothing;

create policy "Drivers upload their own documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'driver-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) ~ '^(license|insurance)\.(jpg|jpeg|png|heic|heif|webp)$'
  );

create policy "Drivers see their own documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Drivers replace their own documents"
  on storage.objects for update to authenticated
  using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Drivers delete their own documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = (select auth.uid())::text);

------------------------------------------------------------------------------
-- Verification status, one row per driver. Written only by the function
-- below (and by the team with the service role), never directly by the app.
--   incomplete: one or both photos missing
--   submitted:  both photos uploaded, can host
--   approved:   the team checked the photos
--   rejected:   the team found a problem (review_note says what); re-upload to resubmit
------------------------------------------------------------------------------
create table public.driver_verifications (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null default 'incomplete' check (status in ('incomplete', 'submitted', 'approved', 'rejected')),
  license_path text,
  insurance_path text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  updated_at timestamptz not null default now()
);

alter table public.driver_verifications enable row level security;
create policy "Drivers see their own verification" on public.driver_verifications for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.driver_verifications from anon, authenticated;

/** Can this person host rides? */
create function public.is_verified_driver(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.driver_verifications v
    where v.user_id = p_user_id and v.status in ('submitted', 'approved')
  );
$$;

grant execute on function public.is_verified_driver(uuid) to authenticated;

/**
 * Looks at what the signed-in person has uploaded, updates their status,
 * and returns it. The app calls this after each upload and when it opens
 * the verification screen.
 */
create function public.driver_verification_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_license text;
  v_insurance text;
  v_latest timestamptz;
  v_row public.driver_verifications;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  select name into v_license from storage.objects
  where bucket_id = 'driver-docs' and (storage.foldername(name))[1] = v_uid::text
    and storage.filename(name) like 'license.%'
  order by created_at desc limit 1;

  select name into v_insurance from storage.objects
  where bucket_id = 'driver-docs' and (storage.foldername(name))[1] = v_uid::text
    and storage.filename(name) like 'insurance.%'
  order by created_at desc limit 1;

  select max(coalesce(updated_at, created_at)) into v_latest from storage.objects
  where bucket_id = 'driver-docs' and (storage.foldername(name))[1] = v_uid::text;

  insert into public.driver_verifications as v (user_id, license_path, insurance_path, status, submitted_at)
  values (
    v_uid, v_license, v_insurance,
    case when v_license is not null and v_insurance is not null then 'submitted' else 'incomplete' end,
    case when v_license is not null and v_insurance is not null then now() end
  )
  on conflict (user_id) do update set
    license_path = excluded.license_path,
    insurance_path = excluded.insurance_path,
    status = case
      when excluded.license_path is null or excluded.insurance_path is null then
        case when v.status = 'rejected' then 'rejected' else 'incomplete' end
      when v.status = 'approved' then 'approved'
      -- a rejected driver resubmits by uploading a new photo after the review
      when v.status = 'rejected' and (v.reviewed_at is null or v_latest is null or v_latest <= v.reviewed_at) then 'rejected'
      else 'submitted'
    end,
    submitted_at = case when v.status in ('incomplete', 'rejected') and excluded.status = 'submitted' then now() else v.submitted_at end,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'status', v_row.status,
    'has_license', v_row.license_path is not null,
    'has_insurance', v_row.insurance_path is not null,
    'license_path', v_row.license_path,
    'insurance_path', v_row.insurance_path,
    'review_note', v_row.review_note
  );
end;
$$;

revoke execute on function public.driver_verification_status() from public, anon;
grant execute on function public.driver_verification_status() to authenticated;

------------------------------------------------------------------------------
-- Hosting requires a verified driver. Checked after the Colorado rules, so
-- people see the most specific problem first.
------------------------------------------------------------------------------
create function public.enforce_verified_driver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cancelled_at is null and not public.is_verified_driver(new.driver_id) then
    raise exception 'Add photos of your driver''s license and insurance card before hosting. It takes about a minute in Account → Driver verification.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Trigger names fire alphabetically: rides_enforce_rules runs first.
create trigger rides_require_verified_driver
  before insert or update on public.rides
  for each row execute function public.enforce_verified_driver();

------------------------------------------------------------------------------
-- Board: show riders that the driver has a license and insurance on file.
------------------------------------------------------------------------------
create or replace view public.ride_board
with (security_invoker = on)
as
select
  r.id,
  r.driver_id,
  p.full_name as driver_name,
  r.resort_id,
  r.depart_at,
  r.leave_from,
  r.seats_total,
  r.gas_per_rider,
  r.gear,
  r.notes,
  r.created_at,
  coalesce(s.seats_taken, 0) as seats_taken,
  coalesce(s.rider_ids, '{}') as rider_ids,
  coalesce(s.rider_names, '{}') as rider_names,
  r.ride_date,
  public.gas_cap_dollars(r.resort_id, r.depart_at) as gas_cap,
  public.is_verified_driver(r.driver_id) as driver_verified
from public.rides r
join public.profiles p on p.id = r.driver_id
left join lateral (
  select
    count(*)::int as seats_taken,
    array_agg(rs.rider_id order by rs.created_at) as rider_ids,
    array_agg(rp.full_name order by rs.created_at) as rider_names
  from public.ride_seats rs
  join public.profiles rp on rp.id = rs.rider_id
  where rs.ride_id = r.id
) s on true
where r.cancelled_at is null
  and r.depart_at > now() - interval '2 hours';
