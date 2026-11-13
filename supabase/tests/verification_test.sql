-- CU email requirement and driver verification. Run after the other tests.
\set ON_ERROR_STOP on

-- ===== CU Boulder email only =====
do $$ begin
  begin
    insert into auth.users (id, email) values ('66666666-6666-4666-8666-666666666666', 'someone@gmail.com');
    raise exception 'FAIL: gmail sign-up accepted';
  exception when raise_exception then
    assert sqlerrm like 'Lift2Lift is for CU Boulder students.%', sqlerrm;
  end;
  begin
    insert into auth.users (id, email) values ('66666666-6666-4666-8666-666666666666', 'sneaky@colorado.edu.evil.com');
    raise exception 'FAIL: look-alike domain accepted';
  exception when raise_exception then null;
  end;
  begin
    insert into auth.users (id, email) values ('66666666-6666-4666-8666-666666666666', 'x@notcolorado.edu');
    raise exception 'FAIL: notcolorado.edu accepted';
  exception when raise_exception then null;
  end;
end $$;

-- These are CU addresses: plain, uppercase, and a department subdomain.
insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-6666-4666-8666-666666666666', 'casey.driver@colorado.edu', '{"full_name":"Casey"}'),
  ('77777777-7777-4777-8777-777777777777', 'Dana.Rider@Colorado.EDU', '{"full_name":"Dana"}'),
  ('88888888-8888-4888-8888-888888888888', 'eli@cs.colorado.edu', '{"full_name":"Eli"}');

do $$ begin
  begin
    update auth.users set email = 'casey@gmail.com' where id = '66666666-6666-4666-8666-666666666666';
    raise exception 'FAIL: email changed to gmail';
  exception when raise_exception then null;
  end;
end $$;

-- ===== Driver verification: ID + selfie (Stripe) and insurance photo =====
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', false);
do $$
declare v jsonb;
begin
  -- Nothing done: can't host.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact)
    values ('keystone', date_trunc('day', now()) + interval '12 days 15 hours', 'Kittredge', 3, 10, '303');
    raise exception 'FAIL: unverified driver posted';
  exception when raise_exception then
    assert sqlerrm like 'Set up your profile first%', sqlerrm;
  end;

  v := public.driver_verification_status();
  assert v->>'status' = 'incomplete' and v->>'identity_status' = 'none' and not (v->>'consented')::boolean, v::text;

  -- Consent is recorded before the selfie check.
  perform public.give_biometric_consent();
  assert (public.driver_verification_status()->>'consented')::boolean, 'consent recorded';

  -- The app can't write Stripe results itself.
  begin
    perform public.apply_identity_result(auth.uid(), 'vs_fake', 'verified');
    raise exception 'FAIL: app wrote its own ID result';
  exception when insufficient_privilege then null;
  end;

  -- Can't upload into someone else's folder, or with a random file name.
  begin
    insert into storage.objects (bucket_id, name) values ('driver-docs', '77777777-7777-4777-8777-777777777777/insurance.jpg');
    raise exception 'FAIL: uploaded into another user''s folder';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('driver-docs', '66666666-6666-4666-8666-666666666666/selfie.jpg');
    raise exception 'FAIL: uploaded a non-document file name';
  exception when insufficient_privilege then null;
  end;

  -- Insurance alone isn't enough.
  v := public.driver_verification_status();
  assert v->>'status' = 'incomplete' and not (v->>'has_insurance')::boolean, v::text;

  -- The app can't write its own insurance result.
  begin
    perform public.set_insurance_result(auth.uid(), 'verified', null, 'Fake', current_date + 30, '1234', 'Casey Driver');
    raise exception 'FAIL: app wrote its own insurance result';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Insurance scan: expired and name-mismatch cards don't count, a good one does.
do $$ begin
  perform public.set_insurance_result('66666666-6666-4666-8666-666666666666', 'requires_input', 'insurance_expired', null, null, null, null);
  assert not exists (select 1 from public.driver_verifications where user_id = '66666666-6666-4666-8666-666666666666' and insurance_expires is not null), 'failed scan saves no expiry';
  perform public.set_insurance_result('66666666-6666-4666-8666-666666666666', 'verified', null, 'Acme', current_date + 30, '1234', 'Casey Driver');
end $$;

-- Stripe flow, as the edge functions would call it with the service role.
select public.set_identity_session('66666666-6666-4666-8666-666666666666', 'vs_1');
do $$ begin
  assert public.apply_identity_result('66666666-6666-4666-8666-666666666666', 'vs_old', 'verified') = 'ignored', 'stale session ignored';
  assert public.apply_identity_result('66666666-6666-4666-8666-666666666666', 'vs_1', 'requires_input', 'selfie_face_mismatch') = 'updated', 'mismatch saved';
  assert (select identity_status = 'requires_input' and identity_error = 'selfie_face_mismatch' and status = 'incomplete'
          from public.driver_verifications where user_id = '66666666-6666-4666-8666-666666666666'), 'face mismatch blocks hosting';
  -- Retry succeeds.
  perform public.set_identity_session('66666666-6666-4666-8666-666666666666', 'vs_2');
  assert public.apply_identity_result('66666666-6666-4666-8666-666666666666', 'vs_2', 'verified', null, 'Casey', 'Driver') = 'updated', 'verified saved';
  -- A late "processing" event can't undo a finished check.
  assert public.apply_identity_result('66666666-6666-4666-8666-666666666666', 'vs_2', 'processing') = 'ignored', 'no downgrade';
  -- The webhook saves the verified selfie as the profile photo (only for the current, verified session).
  assert public.set_verified_avatar('66666666-6666-4666-8666-666666666666', 'vs_1', 'x/old.jpg') = 'ignored', 'old session photo ignored';
  assert public.set_verified_avatar('66666666-6666-4666-8666-666666666666', 'vs_2', '66666666-6666-4666-8666-666666666666/a1.jpg') = 'updated', 'photo saved';
end $$;

select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', false);
set role authenticated;
do $$
declare v jsonb;
begin
  v := public.driver_verification_status();
  assert v->>'status' = 'submitted' and v->>'identity_status' = 'verified' and v->>'id_name' = 'Casey Driver', v::text;

  -- Verified ID + insurance isn't enough: the profile has to be finished too.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact)
    values ('keystone', date_trunc('day', now()) + interval '12 days 15 hours', 'Kittredge', 3, 10, '303');
    raise exception 'FAIL: posted without a finished profile';
  exception when raise_exception then
    assert sqlerrm like 'Set up your profile first%', sqlerrm;
  end;
  assert public.complete_profile() = '["gender", "interests"]'::jsonb, public.complete_profile()::text;

  -- Can't set your own photo (it has to be the verified selfie), or pick made-up interests.
  begin
    update public.profiles set avatar_path = 'someone-else.jpg' where id = auth.uid();
    raise exception 'FAIL: set own photo';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set interests = '{skiing,crime}' where id = auth.uid();
    raise exception 'FAIL: made-up interest';
  exception when raise_exception then null;
  end;
  begin
    update public.profiles set instagram = 'bad handle!' where id = auth.uid();
    raise exception 'FAIL: bad instagram';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set prompts = '{"favorite_crime": "x"}' where id = auth.uid();
    raise exception 'FAIL: unknown prompt';
  exception when check_violation then null;
  end;

  update public.profiles set gender = 'man', interests = '{skiing,backcountry,photography}', instagram = '@Eli_Zatz',
    bio = 'Photographer.', prompts = '{"go_to_run": "Pali"}' where id = auth.uid();
  assert (select instagram from public.profiles where id = auth.uid()) = 'eli_zatz', 'instagram normalized';
  assert public.complete_profile() = '[]'::jsonb, 'profile complete';

  insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact)
  values ('keystone', date_trunc('day', now()) + interval '12 days 15 hours', 'Kittredge', 3, 10, '303');
  assert (select driver_verified from public.ride_board where driver_id = auth.uid()), 'board shows the verified badge';

  -- The app can't mark itself approved.
  begin
    update public.driver_verifications set status = 'approved' where user_id = auth.uid();
    raise exception 'FAIL: self-approved';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Another student can't see Casey's photos or verification row.
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', false);
set role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'driver-docs') = 0, 'cannot list other drivers'' photos';
  assert (select count(*) from public.driver_verifications) = 0, 'cannot read other verifications';
  -- ...but does see that Casey is verified on the board.
  assert (select driver_verified from public.ride_board where driver_name = 'Casey'), 'others see the badge';
  assert (select driver_gender = 'man' and driver_avatar_path is not null from public.ride_board where driver_name = 'Casey'), 'board shows photo + ring';
  -- Profile page: visible to signed-in users, with badges, Instagram and upcoming rides.
  assert (public.profile_page('66666666-6666-4666-8666-666666666666')->>'instagram') = 'eli_zatz', 'profile page instagram';
  assert (public.profile_page('66666666-6666-4666-8666-666666666666')->>'id_verified')::boolean, 'profile page badge';
  assert jsonb_array_length(public.profile_page('66666666-6666-4666-8666-666666666666')->'upcoming') = 1, 'profile page rides';
  -- Can't claim a seat without a finished profile.
  begin
    perform public.claim_seat((select id from public.rides where driver_id = '66666666-6666-4666-8666-666666666666' and cancelled_at is null), 'both', true);
    raise exception 'FAIL: rider without profile claimed';
  exception when raise_exception then
    assert sqlerrm like 'Set up your profile first%', sqlerrm;
  end;
end $$;
reset role;

-- The team rejects Casey's insurance photo: no new rides until a new photo is uploaded.
update public.driver_verifications set status = 'rejected', reviewed_at = now() + interval '1 second', review_note = 'Insurance card is blurry.'
where user_id = '66666666-6666-4666-8666-666666666666';

select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', false);
set role authenticated;
do $$
declare v jsonb;
begin
  v := public.driver_verification_status(); -- no new upload since review: still rejected
  assert v->>'status' = 'rejected' and v->>'review_note' = 'Insurance card is blurry.', v::text;
  assert not (select driver_verified from public.ride_board where driver_id = auth.uid()), 'badge removed after rejection';
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact)
    values ('vail', date_trunc('day', now()) + interval '13 days 15 hours', 'Kittredge', 3, 10, '303');
    raise exception 'FAIL: rejected driver posted';
  exception when raise_exception then null;
  end;
  -- Cancelling an existing ride still works after a rejection.
  update public.rides set cancelled_at = now() where driver_id = auth.uid();
  assert not exists (select 1 from public.ride_board where driver_id = auth.uid()), 'cancel works';
end $$;
reset role;

-- New upload after the review → resubmitted.
update public.driver_verifications set insurance_checked_at = now() + interval '5 seconds'
where user_id = '66666666-6666-4666-8666-666666666666';
set role authenticated;
do $$ begin
  assert public.driver_verification_status()->>'status' = 'submitted', 're-upload resubmits';
end $$;
reset role;

select 'ALL VERIFICATION TESTS PASSED' as result;

-- Expired insurance stops hosting even though the status row hasn't refreshed.
update public.driver_verifications set insurance_expires = (now() at time zone 'America/Denver')::date - 1 where user_id = '66666666-6666-4666-8666-666666666666';
do $$ begin
  assert not public.is_verified_driver('66666666-6666-4666-8666-666666666666'), 'expired insurance blocks hosting';
end $$;
update public.driver_verifications set insurance_expires = (now() at time zone 'America/Denver')::date + 30 where user_id = '66666666-6666-4666-8666-666666666666';

-- license-check attempts: 5 a day, then blocked.
do $$
declare v_user uuid; i int;
begin
  insert into public.driver_verifications (user_id) select id from auth.users where id not in (select user_id from public.driver_verifications) limit 1 returning user_id into v_user;
  if v_user is null then select user_id into v_user from public.driver_verifications limit 1; update public.driver_verifications set license_attempts = 0, license_attempts_day = null where user_id = v_user; end if;
  for i in 1..5 loop
    if not public.claim_license_attempt(v_user) then raise exception 'attempt % should pass', i; end if;
  end loop;
  if public.claim_license_attempt(v_user) then raise exception 'attempt 6 should be blocked'; end if;
end $$;
