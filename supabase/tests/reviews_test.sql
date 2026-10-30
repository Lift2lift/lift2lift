-- Ratings and reviews. Run after the other tests.
\set ON_ERROR_STOP on

-- A finished ride from 3 days ago: Demo Driver drove, Demo Rider and the new student rode.
-- (Inserted directly with the trigger off, since rides normally can't be posted in the past.)
alter table public.rides disable trigger rides_enforce_rules;
alter table public.rides disable trigger rides_require_verified_driver;
insert into public.rides (id, driver_id, resort_id, trip_type, depart_at, ride_date, leave_from, seats_total, gas_per_rider, contact)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'loveland', 'to_mountain', now() - interval '3 days', (now() - interval '3 days')::date, 'Kittredge', 3, 10, '303'),
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'vail', 'to_mountain', now() - interval '20 days', (now() - interval '20 days')::date, 'Kittredge', 3, 10, '303');
alter table public.rides enable trigger rides_enforce_rules;
alter table public.rides enable trigger rides_require_verified_driver;
insert into public.ride_seats (ride_id, rider_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222');

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
declare v jsonb;
begin
  -- Demo Rider has the driver and one fellow passenger to review (the 20-day-old ride is closed).
  v := public.reviews_to_write();
  assert jsonb_array_length(v) = 1 and jsonb_array_length(v->0->'people') = 2, v::text;
  assert v->0->'people'->0->>'role' = 'driver', v::text;

  -- Driver needs both ratings.
  begin
    perform public.submit_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 5);
    raise exception 'FAIL: driver review without driving rating';
  exception when raise_exception then assert sqlerrm = 'Rate their driving too.', sqlerrm;
  end;
  -- Half stars only.
  begin
    perform public.submit_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 4.3, 4);
    raise exception 'FAIL: 4.3 stars accepted';
  exception when raise_exception then assert sqlerrm like 'Ratings go from half a star%', sqlerrm;
  end;
  begin
    perform public.submit_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 0, 4);
    raise exception 'FAIL: 0 stars accepted';
  exception when raise_exception then null;
  end;

  perform public.submit_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 5, 4.5, '  Smooth on I-70, great snacks.  ');
  -- Fellow passenger: experience only (a driving rating is ignored).
  perform public.submit_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 4.5, 3);

  assert (select driving_rating is null from public.reviews where reviewee_id = '33333333-3333-4333-8333-333333333333'), 'no driving for passengers';
  assert (select body from public.reviews where reviewee_id = '11111111-1111-4111-8111-111111111111') = 'Smooth on I-70, great snacks.', 'body trimmed';
  assert jsonb_array_length(public.reviews_to_write()) = 0, 'nothing left to review';

  -- Once only.
  begin
    perform public.submit_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 1, 1);
    raise exception 'FAIL: reviewed twice';
  exception when raise_exception then assert sqlerrm like 'You already reviewed%', sqlerrm;
  end;
  -- Closed after 14 days.
  begin
    perform public.submit_review('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 5, 5);
    raise exception 'FAIL: reviewed after 14 days';
  exception when raise_exception then assert sqlerrm like 'Reviews close%', sqlerrm;
  end;
  -- Can't write reviews directly.
  begin
    insert into public.reviews (ride_id, reviewer_id, reviewee_id, reviewee_role, experience_rating)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(), '11111111-1111-4111-8111-111111111111', 'passenger', 5);
    raise exception 'FAIL: direct insert';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The new student reviews the driver too.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
set role authenticated;
do $$ begin
  perform public.submit_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 4, 3.5);
end $$;
reset role;

-- The driver can't review (only passengers write reviews), and outsiders can't either.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$
declare s jsonb;
begin
  begin
    perform public.submit_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 5);
    raise exception 'FAIL: driver wrote a review';
  exception when raise_exception then assert sqlerrm like 'Only passengers%', sqlerrm;
  end;

  s := public.rating_summary('11111111-1111-4111-8111-111111111111');
  assert (s->>'driving_avg')::numeric = 4.00 and (s->>'driver_experience_avg')::numeric = 4.50 and (s->>'driver_count')::int = 2, s::text;
  s := public.rating_summary('33333333-3333-4333-8333-333333333333');
  assert (s->>'passenger_avg')::numeric = 4.50 and (s->>'passenger_count')::int = 1, s::text;
  assert jsonb_array_length(public.reviews_for('11111111-1111-4111-8111-111111111111')) = 2, 'reviews list';
  assert (select driver_review_count from public.ride_board where driver_id = auth.uid() limit 1) = 2, 'board shows count';
end $$;
reset role;

select 'ALL REVIEW TESTS PASSED' as result;
