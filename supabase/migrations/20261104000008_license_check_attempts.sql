-- license-check calls paid AWS APIs, so each person gets 5 tries per Mountain Time day.
alter table public.driver_verifications
  add column license_attempts int not null default 0,
  add column license_attempts_day date;

create function public.claim_license_attempt(p_user_id uuid)
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
  set license_attempts = case when license_attempts_day = v_today then license_attempts + 1 else 1 end,
      license_attempts_day = v_today
  where user_id = p_user_id
    and (license_attempts_day is distinct from v_today or license_attempts < 5)
  returning license_attempts into v_count;
  return v_count is not null;
end;
$$;

revoke execute on function public.claim_license_attempt(uuid) from public, anon, authenticated;
grant execute on function public.claim_license_attempt(uuid) to service_role;
