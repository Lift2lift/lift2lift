-- Lift2Lift: accounts, mountains, rides and seats.
-- Applied automatically by `supabase start` / `supabase db reset`.

------------------------------------------------------------------------------
-- Profiles: one row per account, created by a trigger on sign-up.
------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Signed-in users can read profiles"
  on public.profiles for select to authenticated
  using (true);

create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(left(trim(new.raw_user_meta_data ->> 'full_name'), 80), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------------------------
-- Resorts: reference data for every Colorado ski area.
------------------------------------------------------------------------------
create table public.resorts (
  id text primary key,
  name text not null,
  region text not null,
  drive_minutes int not null, -- rough no-traffic drive from Boulder
  lat double precision not null,
  lon double precision not null
);

alter table public.resorts enable row level security;

create policy "Anyone can read resorts"
  on public.resorts for select to anon, authenticated
  using (true);

revoke insert, update, delete on public.resorts from anon, authenticated;

insert into public.resorts (id, name, region, drive_minutes, lat, lon) values
  ('eldora',     'Eldora',             'Front Range',               45, 39.937, -105.583),
  ('echo',       'Echo Mountain',      'Front Range',               60, 39.685, -105.519),
  ('loveland',   'Loveland',           'I-70 · Continental Divide', 75, 39.680, -105.898),
  ('abasin',     'Arapahoe Basin',     'Summit County',             90, 39.642, -105.872),
  ('keystone',   'Keystone',           'Summit County',             95, 39.605, -105.954),
  ('wp',         'Winter Park',        'Grand County',             100, 39.887, -105.763),
  ('copper',     'Copper Mountain',    'Summit County',            105, 39.502, -106.151),
  ('breck',      'Breckenridge',       'Summit County',            110, 39.480, -106.067),
  ('granby',     'Granby Ranch',       'Grand County',             120, 40.044, -105.906),
  ('vail',       'Vail',               'Vail Valley',              120, 39.606, -106.355),
  ('cooper',     'Ski Cooper',         'Leadville',                135, 39.362, -106.301),
  ('bc',         'Beaver Creek',       'Vail Valley',              140, 39.604, -106.517),
  ('steamboat',  'Steamboat',          'Routt County',             180, 40.457, -106.804),
  ('howelsen',   'Howelsen Hill',      'Routt County',             180, 40.483, -106.838),
  ('monarch',    'Monarch',            'Monarch Pass',             195, 38.512, -106.332),
  ('sunlight',   'Sunlight',           'Glenwood Springs',         195, 39.399, -107.338),
  ('snowmass',   'Snowmass',           'Aspen',                    225, 39.209, -106.950),
  ('ajax',       'Aspen Mountain',     'Aspen',                    225, 39.186, -106.818),
  ('highlands',  'Aspen Highlands',    'Aspen',                    225, 39.182, -106.856),
  ('buttermilk', 'Buttermilk',         'Aspen',                    225, 39.206, -106.861),
  ('powderhorn', 'Powderhorn',         'Grand Mesa',               255, 39.069, -108.150),
  ('cb',         'Crested Butte',      'Gunnison Valley',          270, 38.899, -106.965),
  ('wolf',       'Wolf Creek',         'San Juans',                315, 37.475, -106.793),
  ('telluride',  'Telluride',          'San Juans',                390, 37.937, -107.812),
  ('purg',       'Purgatory',          'San Juans',                390, 37.630, -107.814),
  ('silverton',  'Silverton Mountain', 'San Juans',                405, 37.885, -107.666);

------------------------------------------------------------------------------
-- Rides: posted by a driver. The contact column is hidden from everyone
-- except the driver and people who claimed a seat (see ride_contact()).
------------------------------------------------------------------------------
create table public.rides (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  resort_id text not null references public.resorts (id),
  depart_at timestamptz not null,
  leave_from text not null check (char_length(trim(leave_from)) between 1 and 80),
  seats_total smallint not null check (seats_total between 1 and 7),
  gas_per_rider smallint not null default 0 check (gas_per_rider between 0 and 200),
  gear text not null default 'Skis and boards fit' check (char_length(gear) <= 40),
  notes text not null default '' check (char_length(notes) <= 280),
  contact text not null check (char_length(trim(contact)) between 1 and 60),
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create index rides_upcoming_idx on public.rides (depart_at) where cancelled_at is null;
create index rides_driver_idx on public.rides (driver_id);

alter table public.rides enable row level security;

create policy "Signed-in users can see rides"
  on public.rides for select to authenticated
  using (true);

create policy "Drivers post their own rides"
  on public.rides for insert to authenticated
  with check (driver_id = (select auth.uid()) and depart_at > now() - interval '1 hour');

create policy "Drivers edit their own rides"
  on public.rides for update to authenticated
  using (driver_id = (select auth.uid()))
  with check (driver_id = (select auth.uid()));

create policy "Drivers delete their own rides"
  on public.rides for delete to authenticated
  using (driver_id = (select auth.uid()));

-- Column-level privileges: nobody reads `contact` directly, and nobody sets
-- driver_id themselves (it defaults to the signed-in user).
revoke all on public.rides from anon, authenticated;
grant select (id, driver_id, resort_id, depart_at, leave_from, seats_total, gas_per_rider, gear, notes, cancelled_at, created_at)
  on public.rides to authenticated;
grant insert (resort_id, depart_at, leave_from, seats_total, gas_per_rider, gear, notes, contact)
  on public.rides to authenticated;
grant update (resort_id, depart_at, leave_from, seats_total, gas_per_rider, gear, notes, contact, cancelled_at)
  on public.rides to authenticated;
grant delete on public.rides to authenticated;

------------------------------------------------------------------------------
-- Seats: one row per rider per ride. Created only through claim_seat(),
-- which locks the ride so two people can't grab the last seat at once.
------------------------------------------------------------------------------
create table public.ride_seats (
  ride_id uuid not null references public.rides (id) on delete cascade,
  rider_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (ride_id, rider_id)
);

create index ride_seats_rider_idx on public.ride_seats (rider_id);

alter table public.ride_seats enable row level security;

create policy "Signed-in users can see seats"
  on public.ride_seats for select to authenticated
  using (true);

create policy "Riders leave, drivers remove riders"
  on public.ride_seats for delete to authenticated
  using (
    rider_id = (select auth.uid())
    or exists (select 1 from public.rides r where r.id = ride_id and r.driver_id = (select auth.uid()))
  );

revoke all on public.ride_seats from anon, authenticated;
grant select, delete on public.ride_seats to authenticated;

create function public.claim_seat(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_taken int;
begin
  if v_uid is null then
    raise exception 'Sign in to claim a seat.' using errcode = '28000';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'That ride no longer exists.' using errcode = 'P0002';
  end if;
  if v_ride.cancelled_at is not null then
    raise exception 'The driver cancelled this ride.' using errcode = 'P0001';
  end if;
  if v_ride.depart_at < now() then
    raise exception 'This ride already left.' using errcode = 'P0001';
  end if;
  if v_ride.driver_id = v_uid then
    raise exception 'You''re driving this one.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.ride_seats where ride_id = p_ride_id and rider_id = v_uid) then
    return; -- already have a seat
  end if;

  select count(*) into v_taken from public.ride_seats where ride_id = p_ride_id;
  if v_taken >= v_ride.seats_total then
    raise exception 'This ride is full.' using errcode = 'P0001';
  end if;

  insert into public.ride_seats (ride_id, rider_id) values (p_ride_id, v_uid);
end;
$$;

revoke execute on function public.claim_seat(uuid) from public, anon;
grant execute on function public.claim_seat(uuid) to authenticated;

-- The driver's contact, only for the driver and riders with a seat.
create function public.ride_contact(p_ride_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.contact
  from public.rides r
  where r.id = p_ride_id
    and (
      r.driver_id = auth.uid()
      or exists (select 1 from public.ride_seats s where s.ride_id = r.id and s.rider_id = auth.uid())
    );
$$;

revoke execute on function public.ride_contact(uuid) from public, anon;
grant execute on function public.ride_contact(uuid) to authenticated;

------------------------------------------------------------------------------
-- The board: upcoming, not-cancelled rides with seat counts and names.
-- security_invoker makes the view obey the caller's RLS and column grants.
------------------------------------------------------------------------------
create view public.ride_board
with (security_invoker = on)
as
select
  r.id,
  r.driver_id,
  p.full_name as driver_name,
  r.resort_id,
  r.depart_at,
  r.leave_from,
  r.seats_total,
  r.gas_per_rider,
  r.gear,
  r.notes,
  r.created_at,
  coalesce(s.seats_taken, 0) as seats_taken,
  coalesce(s.rider_ids, '{}') as rider_ids,
  coalesce(s.rider_names, '{}') as rider_names
from public.rides r
join public.profiles p on p.id = r.driver_id
left join lateral (
  select
    count(*)::int as seats_taken,
    array_agg(rs.rider_id order by rs.created_at) as rider_ids,
    array_agg(rp.full_name order by rs.created_at) as rider_names
  from public.ride_seats rs
  join public.profiles rp on rp.id = rs.rider_id
  where rs.ride_id = r.id
) s on true
where r.cancelled_at is null
  and r.depart_at > now() - interval '2 hours';

revoke all on public.ride_board from anon, authenticated;
grant select on public.ride_board to authenticated;
