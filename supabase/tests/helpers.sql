-- Test-only helper (never part of the migrations): give someone a finished
-- profile and a verified ID, as if they'd completed setup.
create or replace function public.test_make_ready(p_user_id uuid, p_gender text default 'unspecified')
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set avatar_path = p_user_id::text || '/test.jpg', gender = p_gender,
    interests = '{skiing,powder,coffee}', profile_completed_at = now() where id = p_user_id;
  insert into public.driver_verifications (user_id, identity_status, identity_verified_at, insurance_status, insurance_expires)
  values (p_user_id, 'verified', now(), 'verified', current_date + 365)
  on conflict (user_id) do update set identity_status = 'verified', identity_verified_at = now(),
    insurance_status = 'verified', insurance_expires = current_date + 365;
end $$;
