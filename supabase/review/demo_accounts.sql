-- App Review demo accounts for the HOSTED project. Run once before submitting,
-- and again (it resets them) before each new submission:
--
--   psql "$PROD_DB_URL" -v password="'choose-a-strong-password'" -f supabase/review/demo_accounts.sql
--
-- Creates:
--   appreview@lift2lift.test   the account Apple signs in with. Email confirmed,
--                              profile finished, ID and insurance verified, so
--                              Apple can post rides and call shotgun without a
--                              real CU email, license or insurance card.
--   demodriver@lift2lift.test  a second member with one ride a day for the next
--                              10 days, so the board isn't empty and Apple can
--                              book a seat, chat, report and block.
--
-- The CU-email rule only runs when an account is created, so the test domain is
-- allowed just for the moment these two are inserted, then removed again.
-- Delete them after approval with: delete from auth.users where email in ('appreview@lift2lift.test', 'demodriver@lift2lift.test');
\set ON_ERROR_STOP on

begin;

delete from auth.users where email in ('appreview@lift2lift.test', 'demodriver@lift2lift.test');
insert into public.allowed_email_domains (domain) values ('lift2lift.test') on conflict do nothing;

create temp table demo_pw on commit drop as select :password::text as pw;

do $$
declare
  v_review uuid := 'a0000000-0000-4000-8000-00000000a99e';
  v_driver uuid := 'a0000000-0000-4000-8000-00000000d71e';
  v_user record;
  v_day timestamp;
  v_resorts text[] := array['copper', 'abasin', 'eldora', 'keystone', 'wp', 'breck', 'copper', 'abasin', 'eldora', 'keystone'];
  v_ride uuid;
  i int;
begin
  if char_length((select pw from demo_pw)) < 10 then
    raise exception 'Use a password of at least 10 characters.';
  end if;

  for v_user in
    select * from (values
      (v_review, 'appreview@lift2lift.test', 'Alex Review', 'ski'),
      (v_driver, 'demodriver@lift2lift.test', 'Dana Demo', 'snowboard')
    ) as t(id, email, full_name, discipline)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated',
      v_user.email, extensions.crypt((select pw from demo_pw), extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', v_user.full_name, 'terms_version', 'demo', 'terms_accepted_at', now()), now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user.id, v_user.id::text,
            jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true), 'email', now(), now(), now());

    -- Finished profile and verified driver, as if they'd done setup.
    update public.profiles
    set avatar_path = v_user.id::text || '/demo.jpg', gender = 'unspecified', discipline = v_user.discipline, home_resort_id = 'copper', school_year = 'Junior',
        bio = 'Demo account for App Review.', interests = '{powder,coffee,apres}', profile_completed_at = now()
    where id = v_user.id;
    insert into public.driver_verifications (user_id, status, identity_status, identity_verified_at, insurance_status, insurance_expires, biometric_consent_at)
    values (v_user.id, 'submitted', 'verified', now(), 'verified', current_date + 365, now())
    on conflict (user_id) do update set status = 'submitted', identity_status = 'verified', identity_verified_at = now(),
      insurance_status = 'verified', insurance_expires = current_date + 365, biometric_consent_at = now();
  end loop;

  -- Dana posts a round trip every day for the next 10 days, starting the day after tomorrow.
  for i in 2..11 loop
    v_day := date_trunc('day', now() at time zone 'America/Denver') + make_interval(days => i);
    perform set_config('request.jwt.claim.sub', v_driver::text, true);
    insert into public.rides (driver_id, resort_id, trip_type, depart_at, return_at, return_meet, leave_from, seats_total, gas_per_rider, contact, notes)
    values (v_driver, v_resorts[i - 1], 'round_trip', (v_day + interval '7 hours') at time zone 'America/Denver',
            (v_day + interval '16 hours') at time zone 'America/Denver', 'Base area', 'CU Boulder – Kittredge lot', 3, 5,
            '303-555-0199', 'Demo ride for App Review')
    returning id into v_ride;
  end loop;
end $$;

delete from public.allowed_email_domains where domain = 'lift2lift.test';

commit;

select email, email_confirmed_at is not null as confirmed from auth.users where email in ('appreview@lift2lift.test', 'demodriver@lift2lift.test');
