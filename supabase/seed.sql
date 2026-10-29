-- Local development only: two demo accounts and a few sample rides.
-- `supabase db reset` runs this after the migrations. Never run it in production.
--
--   driver@lift2lift.test / password123   (posts rides)
--   rider@lift2lift.test  / password123   (claims seats)

do $$
declare
  v_driver uuid := '11111111-1111-4111-8111-111111111111';
  v_rider  uuid := '22222222-2222-4222-8222-222222222222';
  v_user   record;
begin
  for v_user in
    select * from (values
      (v_driver, 'driver@lift2lift.test', 'Demo Driver'),
      (v_rider,  'rider@lift2lift.test',  'Demo Rider')
    ) as t(id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated',
      v_user.email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', v_user.full_name), now(), now(), '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_user.id, v_user.id::text,
      jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;

  -- Sample rides, dated relative to today so they always show as upcoming.
  insert into public.rides (driver_id, resort_id, depart_at, leave_from, seats_total, gas_per_rider, gear, notes, contact) values
    (v_driver, 'abasin',  date_trunc('day', now()) + interval '2 days 6 hours 30 minutes', 'CU Boulder – Kittredge lot', 3, 15, 'Skis and boards fit', 'Sample ride. AWD with snow tires, back by 4.', '(303) 555-0142'),
    (v_driver, 'copper',  date_trunc('day', now()) + interval '3 days 7 hours',            'Boulder – Table Mesa Park-n-Ride', 2, 20, 'Roof box / rack', 'Sample ride. Leaving early to beat I-70.', '@demo.driver'),
    (v_driver, 'eldora',  date_trunc('day', now()) + interval '1 day 15 hours',            'Boulder – The Hill (13th & College)', 4, 5, 'Boards only', 'Sample ride. Night skiing, quick lap after class.', '(303) 555-0142');

  -- The demo rider already has a seat on the first ride.
  insert into public.ride_seats (ride_id, rider_id)
  select id, v_rider from public.rides where resort_id = 'abasin' and driver_id = v_driver;
end;
$$;
