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

-- ===== Driver verification =====
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', false);
do $$
declare v jsonb;
begin
  -- Nothing uploaded: can't host.
  begin
    insert into public.rides (resort_id, depart_at, leave_from, seats_total, gas_per_rider, contact)
    values ('keystone', date_trunc('day', now()) + interval '12 days 15 hours', 'Kittredge', 3, 10, '303');
    raise exception 'FAIL: unverified driver posted';
  exception when raise_exception then
    assert sqlerrm like 'Add photos of your driver''s license and insurance card%', sqlerrm;
  end;

  v := public.driver_verification_status();
  assert v->>'status' = 'incomplete', v::text;

  -- Can't upload into someone else's folder, or with a random file name.
  begin
    insert into storage.objects (bucket_id, name) values ('driver-docs', '77777777-7777-4777-8777-777777777777/license.jpg');
    raise exception 'FAIL: uploaded into another user''s folder';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('driver-docs', '66666666-6666-4666-8666-666666666666/selfie.jpg');
    raise exception 'FAIL: uploaded a non-document file name';
  exception when insufficient_privilege then null;
  end;

  -- License only: still incomplete.
  insert into storage.objects (bucket_id, name) values ('driver-docs', '66666666-6666-4666-8666-666666666666/license.jpg');
  v := public.driver_verification_status();
  assert v->>'status' = 'incomplete' and (v->>'has_license')::boolean and not (v->>'has_insurance')::boolean, v::text;

  -- Insurance too: submitted, and hosting works right away.
  insert into storage.objects (bucket_id, name) values ('driver-docs', '66666666-6666-4666-8666-666666666666/insurance.heic');
  v := public.driver_verification_status();
  assert v->>'status' = 'submitted', v::text;

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
update storage.objects set updated_at = now() + interval '5 seconds'
where name = '66666666-6666-4666-8666-666666666666/insurance.heic';
set role authenticated;
do $$ begin
  assert public.driver_verification_status()->>'status' = 'submitted', 're-upload resubmits';
end $$;
reset role;

select 'ALL VERIFICATION TESTS PASSED' as result;
