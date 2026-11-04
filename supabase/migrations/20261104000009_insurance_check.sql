-- Insurance cards are now read by the insurance-check edge function and never
-- stored. Hosting needs a verified card that hasn't expired.
--   none / requires_input: nothing usable yet
--   review: name doesn't match the license. The team sets insurance_status to
--           'verified' after checking insurance_named_insured.
--   verified: good through insurance_expires
alter table public.driver_verifications
  add column insurance_status text not null default 'none'
    check (insurance_status in ('none', 'verified', 'review', 'requires_input')),
  add column insurance_error text,
  add column insurer text,
  add column insurance_expires date,
  add column insurance_policy_last4 text,
  add column insurance_named_insured text,
  add column insurance_checked_at timestamptz,
  add column insurance_attempts int not null default 0,
  add column insurance_attempts_day date;

drop policy "Drivers upload their own documents" on storage.objects;
drop policy "Drivers replace their own documents" on storage.objects;

create function public.insurance_is_valid(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.driver_verifications v
    where v.user_id = p_user_id and v.insurance_status = 'verified'
      and v.insurance_expires >= (now() at time zone 'America/Denver')::date
  );
$$;
revoke execute on function public.insurance_is_valid(uuid) from public, anon;
grant execute on function public.insurance_is_valid(uuid) to authenticated, service_role;

-- Checks expiry directly, so a card stops counting the day after it expires.
create or replace function public.is_verified_driver(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.driver_verifications v
    where v.user_id = p_user_id and v.status in ('submitted', 'approved')
  ) and public.insurance_is_valid(p_user_id);
$$;

create or replace function public.refresh_driver_verification(p_user_id uuid)
returns public.driver_verifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.driver_verifications;
  v_ready boolean;
begin
  insert into public.driver_verifications (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_row from public.driver_verifications where user_id = p_user_id for update;

  v_ready := v_row.identity_status = 'verified' and public.insurance_is_valid(p_user_id);

  update public.driver_verifications v set
    status = case
      when v.status = 'approved' and v_ready then 'approved'
      when v.status = 'rejected'
        and (v.reviewed_at is null or greatest(v.insurance_checked_at, v.identity_verified_at) is null
             or greatest(v.insurance_checked_at, v.identity_verified_at) <= v.reviewed_at) then 'rejected'
      when v_ready then 'submitted'
      else 'incomplete'
    end,
    submitted_at = case when v_ready and v.status not in ('submitted', 'approved') then now() else v.submitted_at end,
    updated_at = now()
  where v.user_id = p_user_id
  returning * into v_row;

  return v_row;
end;
$$;
revoke execute on function public.refresh_driver_verification(uuid) from public, anon, authenticated;

create or replace function public.driver_verification_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.driver_verifications;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  v_row := public.refresh_driver_verification(v_uid);
  return jsonb_build_object(
    'status', v_row.status,
    'identity_status', v_row.identity_status,
    'identity_error', v_row.identity_error,
    'id_name', nullif(trim(coalesce(v_row.id_first_name, '') || ' ' || coalesce(v_row.id_last_name, '')), ''),
    'consented', v_row.biometric_consent_at is not null,
    'has_insurance', public.insurance_is_valid(v_uid),
    'insurance_status', v_row.insurance_status,
    'insurance_error', v_row.insurance_error,
    'insurer', v_row.insurer,
    'insurance_expires', v_row.insurance_expires,
    'review_note', v_row.review_note
  );
end;
$$;

create function public.set_insurance_result(
  p_user_id uuid, p_status text, p_error text, p_insurer text, p_expires date, p_policy_last4 text, p_named_insured text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.driver_verifications set
    insurance_status = p_status,
    insurance_error = p_error,
    insurer = p_insurer,
    insurance_expires = p_expires,
    insurance_policy_last4 = p_policy_last4,
    insurance_named_insured = p_named_insured,
    insurance_checked_at = now(),
    updated_at = now()
  where user_id = p_user_id;
  perform public.refresh_driver_verification(p_user_id);
end;
$$;
revoke execute on function public.set_insurance_result(uuid, text, text, text, date, text, text) from public, anon, authenticated;
grant execute on function public.set_insurance_result(uuid, text, text, text, date, text, text) to service_role;

create function public.claim_insurance_attempt(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Denver')::date;
  v_count int;
begin
  update public.driver_verifications
  set insurance_attempts = case when insurance_attempts_day = v_today then insurance_attempts + 1 else 1 end,
      insurance_attempts_day = v_today
  where user_id = p_user_id
    and (insurance_attempts_day is distinct from v_today or insurance_attempts < 5)
  returning insurance_attempts into v_count;
  return v_count is not null;
end;
$$;
revoke execute on function public.claim_insurance_attempt(uuid) from public, anon, authenticated;
grant execute on function public.claim_insurance_attempt(uuid) to service_role;
