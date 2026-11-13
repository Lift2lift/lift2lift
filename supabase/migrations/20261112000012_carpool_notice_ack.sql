-- Riders acknowledge Colorado's carpool notice (C.R.S. 43-1-127(1)(c)) before
-- every booking. The app shows the statutory disclaimer in a pop-up with an
-- "Acknowledge and book" button; the database refuses a seat without that
-- acknowledgment and keeps when it happened on the seat.

alter table public.ride_seats add column notice_ack_at timestamptz;

comment on column public.ride_seats.notice_ack_at is
  'When the rider acknowledged the Colorado carpool notice (C.R.S. 43-1-127(1)(c)) for this booking.';

-- The existing booking rules move behind a wrapper that checks the acknowledgment first.
alter function public.claim_seat(uuid, text) rename to claim_seat_rules;
revoke execute on function public.claim_seat_rules(uuid, text) from public, anon, authenticated;

create function public.claim_seat(p_ride_id uuid, p_legs text default 'both', p_notice_ack boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to claim a seat.' using errcode = '28000';
  end if;
  if not coalesce(p_notice_ack, false) then
    raise exception 'Read and acknowledge the Colorado carpool notice to book a seat.' using errcode = 'P0001';
  end if;

  perform public.claim_seat_rules(p_ride_id, p_legs);

  -- Booking again on a ride you're already on is a no-op, so only stamp a seat that has no acknowledgment yet.
  update public.ride_seats
  set notice_ack_at = now()
  where ride_id = p_ride_id and rider_id = auth.uid() and notice_ack_at is null;
end;
$$;

revoke execute on function public.claim_seat(uuid, text, boolean) from public, anon;
grant execute on function public.claim_seat(uuid, text, boolean) to authenticated;
