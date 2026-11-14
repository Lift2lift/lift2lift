-- Communities, part 2:
-- * The code is for admins only. Admins send it out as an invitation;
--   members no longer see it.
-- * Popular communities: any signed-in person can see set-up communities
--   (name, description, member and ride counts) and ask to join. Admins
--   approve or decline. A community can be hidden from Popular.
-- * Requests: at most 10 a day per person; after a decline you can ask that
--   community again after 7 days.

alter table public.communities add column listed boolean not null default true;

-- Members can't read the code from the table any more (functions hand it to admins).
revoke select (code) on public.communities from authenticated;

create table public.community_join_requests (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (community_id, user_id)
);

create index community_join_requests_pending_idx on public.community_join_requests (community_id) where status = 'pending';
create index community_join_requests_user_idx on public.community_join_requests (user_id, created_at);

alter table public.community_join_requests enable row level security;
revoke all on public.community_join_requests from anon, authenticated;

-- Joining by any route clears that person's request.
create function public.clear_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.community_join_requests where community_id = new.community_id and user_id = new.user_id;
  return null;
end;
$$;

create trigger community_members_clear_request after insert on public.community_members
  for each row execute function public.clear_join_request();

revoke execute on function public.clear_join_request() from public, anon, authenticated;

------------------------------------------------------------------------------
-- Your communities: the code only for admins, plus how many requests wait.
------------------------------------------------------------------------------
create or replace function public.my_communities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description,
    'code', case when m.role = 'admin' then c.code end,
    'role', m.role,
    'listed', c.listed,
    'member_count', (select count(*) from public.community_members x where x.community_id = c.id),
    'upcoming_rides', (select count(*) from public.rides r
                       where r.community_id = c.id and r.cancelled_at is null and coalesce(r.return_at, r.depart_at) > now()),
    'pending_requests', case when m.role = 'admin'
                          then (select count(*) from public.community_join_requests q where q.community_id = c.id and q.status = 'pending')
                          else 0 end
  ) order by c.name), '[]'::jsonb)
  from public.community_members m
  join public.communities c on c.id = m.community_id
  where m.user_id = auth.uid();
$$;

create or replace function public.community_page(p_community_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
  v_admin boolean := public.is_community_admin(p_community_id);
begin
  if not public.is_community_member(p_community_id) then
    raise exception 'You''re not in this community. Ask a member for its code.' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description,
    'code', case when v_admin then c.code end,
    'listed', c.listed,
    'my_role', (select role from public.community_members where community_id = c.id and user_id = auth.uid()),
    'member_count', (select count(*) from public.community_members x where x.community_id = c.id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_path', p.avatar_path,
                                          'gender', p.gender, 'role', m.role, 'joined_at', m.joined_at)
                       order by (m.role = 'admin') desc, m.joined_at)
      from public.community_members m
      join public.profiles p on p.id = m.user_id
      where m.community_id = c.id
        and (p.id = auth.uid() or not public.is_blocked_between(auth.uid(), p.id))
    ), '[]'::jsonb),
    'requests', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_path', p.avatar_path,
                                          'gender', p.gender, 'requested_at', q.created_at)
                       order by q.created_at)
      from public.community_join_requests q
      join public.profiles p on p.id = q.user_id
      where q.community_id = c.id and q.status = 'pending'
        and not public.is_blocked_between(auth.uid(), p.id)
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into v_out
  from public.communities c
  where c.id = p_community_id;
  return v_out;
end;
$$;

------------------------------------------------------------------------------
-- Popular communities and requests to join
------------------------------------------------------------------------------
-- Set-up, listed communities with at least one admin (someone to approve
-- requests), most members first. my_status: member, requested or none.
create function public.popular_communities(p_limit int default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_json order by member_count desc, name), '[]'::jsonb)
  from (
    select c.name, mc.n as member_count,
      jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description, 'member_count', mc.n,
        'upcoming_rides', (select count(*) from public.rides r
                           where r.community_id = c.id and r.cancelled_at is null and coalesce(r.return_at, r.depart_at) > now()),
        'my_status', case
          when exists (select 1 from public.community_members x where x.community_id = c.id and x.user_id = auth.uid()) then 'member'
          when exists (select 1 from public.community_join_requests q
                       where q.community_id = c.id and q.user_id = auth.uid() and q.status = 'pending') then 'requested'
          else 'none' end
      ) as row_json
    from public.communities c
    cross join lateral (select count(*)::int as n from public.community_members m where m.community_id = c.id) mc
    where auth.uid() is not null
      and c.name is not null
      and c.listed
      and exists (select 1 from public.community_members a where a.community_id = c.id and a.role = 'admin')
    order by mc.n desc, c.name
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ) t;
$$;

-- Ask to join. Returns 'requested', or 'member' if you're already in.
create function public.request_to_join(p_community_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_c public.communities;
  v_req public.community_join_requests;
begin
  if v_uid is null then
    raise exception 'Sign in to ask to join.' using errcode = '28000';
  end if;
  select * into v_c from public.communities where id = p_community_id;
  if not found or v_c.name is null or not v_c.listed
     or not exists (select 1 from public.community_members where community_id = v_c.id and role = 'admin') then
    raise exception 'This community isn''t taking requests. Ask a member for an invite.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.community_members where community_id = v_c.id and user_id = v_uid) then
    return 'member';
  end if;

  select * into v_req from public.community_join_requests where community_id = v_c.id and user_id = v_uid for update;
  if found and v_req.status = 'pending' then
    return 'requested';
  end if;
  if found and v_req.status = 'declined' and v_req.decided_at > now() - interval '7 days' then
    raise exception 'Your last request wasn''t approved. You can ask again after %.',
      to_char((v_req.decided_at + interval '7 days') at time zone 'America/Denver', 'FMDay, Mon FMDD') using errcode = 'P0001';
  end if;
  if (select count(*) from public.community_join_requests where user_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s a lot of requests for one day. Try again tomorrow.' using errcode = 'P0001';
  end if;

  insert into public.community_join_requests (community_id, user_id) values (v_c.id, v_uid)
  on conflict (community_id, user_id) do update set status = 'pending', created_at = now(), decided_at = null;
  return 'requested';
end;
$$;

create function public.cancel_join_request(p_community_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.community_join_requests
  where community_id = p_community_id and user_id = auth.uid() and status = 'pending';
$$;

create function public.respond_join_request(p_community_id uuid, p_user_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only the community''s admins can answer requests.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.community_join_requests
                 where community_id = p_community_id and user_id = p_user_id and status = 'pending') then
    raise exception 'That request isn''t waiting any more.' using errcode = 'P0001';
  end if;
  if coalesce(p_approve, false) then
    insert into public.community_members (community_id, user_id, role) values (p_community_id, p_user_id, 'member')
    on conflict do nothing; -- the trigger clears the request
  else
    update public.community_join_requests set status = 'declined', decided_at = now()
    where community_id = p_community_id and user_id = p_user_id;
  end if;
end;
$$;

-- Admins choose whether the community shows in Popular communities.
create function public.set_community_listed(p_community_id uuid, p_listed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only the community''s admins can change this.' using errcode = '42501';
  end if;
  update public.communities set listed = coalesce(p_listed, true) where id = p_community_id;
end;
$$;

revoke execute on function public.popular_communities(int) from public, anon;
grant execute on function public.popular_communities(int) to authenticated;
revoke execute on function public.request_to_join(uuid) from public, anon;
grant execute on function public.request_to_join(uuid) to authenticated;
revoke execute on function public.cancel_join_request(uuid) from public, anon;
grant execute on function public.cancel_join_request(uuid) to authenticated;
revoke execute on function public.respond_join_request(uuid, uuid, boolean) from public, anon;
grant execute on function public.respond_join_request(uuid, uuid, boolean) to authenticated;
revoke execute on function public.set_community_listed(uuid, boolean) from public, anon;
grant execute on function public.set_community_listed(uuid, boolean) to authenticated;
