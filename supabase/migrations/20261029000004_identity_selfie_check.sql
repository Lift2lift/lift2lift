-- ID + selfie verification through Stripe Identity.
--
-- A driver scans their driver's license and takes a live selfie on Stripe's
-- hosted page. Stripe checks the license is genuine and that the face matches
-- the license photo. Lift2Lift never receives the selfie or any face scan:
-- the webhook stores only the result and the name on the license, then asks
-- Stripe to delete (redact) the images.
--
-- To host, a driver now needs: ID check verified + insurance photo uploaded.
-- (The license photo upload from the previous migration is no longer needed.)

alter table public.driver_verifications
  add column identity_status text not null default 'none'
    check (identity_status in ('none', 'pending', 'processing', 'verified', 'requires_input', 'canceled')),
  add column identity_session_id text,
  add column identity_error text,
  add column identity_verified_at timestamptz,
  add column id_first_name text,
  add column id_last_name text,
  -- Colorado Privacy Act (HB24-1130): consent before collecting biometric data.
  add column biometric_consent_at timestamptz;

------------------------------------------------------------------------------
-- Recompute a driver's overall status from what's on file. Used by the app's
-- status call and by the Stripe webhook.
------------------------------------------------------------------------------
create function public.refresh_driver_verification(p_user_id uuid)
returns public.driver_verifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insurance text;
  v_latest timestamptz;
  v_row public.driver_verifications;
  v_ready boolean;
begin
  select name into v_insurance from storage.objects
  where bucket_id = 'driver-docs' and (storage.foldername(name))[1] = p_user_id::text
    and storage.filename(name) like 'insurance.%'
  order by created_at desc limit 1;

  select max(coalesce(updated_at, created_at)) into v_latest from storage.objects
  where bucket_id = 'driver-docs' and (storage.foldername(name))[1] = p_user_id::text;

  insert into public.driver_verifications (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_row from public.driver_verifications where user_id = p_user_id for update;

  v_ready := v_row.identity_status = 'verified' and v_insurance is not null;

  update public.driver_verifications v set
    insurance_path = v_insurance,
    status = case
      when v.status = 'approved' and v_ready then 'approved'
      when v.status = 'rejected'
        and (v.reviewed_at is null or greatest(v_latest, v.identity_verified_at) is null
             or greatest(v_latest, v.identity_verified_at) <= v.reviewed_at) then 'rejected'
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

-- The app's status call, now including the ID check.
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
    'has_insurance', v_row.insurance_path is not null,
    'insurance_path', v_row.insurance_path,
    'review_note', v_row.review_note
  );
end;
$$;

-- Consent to the selfie check (shown in the app before it starts).
create function public.give_biometric_consent()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  insert into public.driver_verifications (user_id, biometric_consent_at) values (auth.uid(), now())
  on conflict (user_id) do update set biometric_consent_at = coalesce(public.driver_verifications.biometric_consent_at, now()), updated_at = now();
end;
$$;

revoke execute on function public.give_biometric_consent() from public, anon;
grant execute on function public.give_biometric_consent() to authenticated;

------------------------------------------------------------------------------
-- Called by the edge functions with the service role key (never by the app).
------------------------------------------------------------------------------

/** identity-start: remember the Stripe session that was just opened. */
create function public.set_identity_session(p_user_id uuid, p_session_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.driver_verifications
  set identity_session_id = p_session_id,
      identity_status = case when identity_status = 'verified' then 'verified' else 'pending' end,
      identity_error = null,
      updated_at = now()
  where user_id = p_user_id;
$$;

/** identity-webhook: save Stripe's result. Ignores events for an older session. */
create function public.apply_identity_result(
  p_user_id uuid,
  p_session_id text,
  p_status text,
  p_error text default null,
  p_first_name text default null,
  p_last_name text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.driver_verifications;
begin
  select * into v_row from public.driver_verifications where user_id = p_user_id for update;
  if not found or v_row.identity_session_id is distinct from p_session_id then
    return 'ignored';
  end if;
  if v_row.identity_status = 'verified' and p_status <> 'verified' then
    return 'ignored'; -- never downgrade a finished check
  end if;

  update public.driver_verifications set
    identity_status = p_status,
    identity_error = case when p_status = 'requires_input' then p_error end,
    identity_verified_at = case when p_status = 'verified' then now() else identity_verified_at end,
    id_first_name = coalesce(p_first_name, id_first_name),
    id_last_name = coalesce(p_last_name, id_last_name),
    updated_at = now()
  where user_id = p_user_id;

  perform public.refresh_driver_verification(p_user_id);
  return 'updated';
end;
$$;

revoke execute on function public.set_identity_session(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_identity_result(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.set_identity_session(uuid, text) to service_role;
grant execute on function public.apply_identity_result(uuid, text, text, text, text, text) to service_role;
grant execute on function public.refresh_driver_verification(uuid) to service_role;

-- Hosting error now points at the two steps.
create or replace function public.enforce_verified_driver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cancelled_at is null and not public.is_verified_driver(new.driver_id) then
    raise exception 'Verify your ID with a quick selfie and add your insurance card before hosting. It takes about a minute in Account → Driver verification.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
