-- Community photos: admins give their group a profile picture. It shows on
-- the community page, in Your communities and in Popular communities.

alter table public.communities add column photo_path text;

------------------------------------------------------------------------------
-- Storage: private bucket, readable by any signed-in user (Popular
-- communities shows photos to non-members). Admins write into their
-- community's folder: <community id>/<name>.<ext>.
------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-photos', 'community-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

-- True when the signed-in user is an admin of the community whose id is the
-- object's folder. Text comparison, so a folder that isn't a uuid is just false.
create function public.is_admin_of_photo_folder(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_members
    where community_id::text = (storage.foldername(p_name))[1]
      and user_id = auth.uid() and role = 'admin'
  );
$$;

revoke execute on function public.is_admin_of_photo_folder(text) from public, anon;
grant execute on function public.is_admin_of_photo_folder(text) to authenticated;

create policy "Signed-in users see community photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'community-photos');

create policy "Community admins upload photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'community-photos'
    and storage.filename(name) ~ '^photo-[0-9]+\.(jpg|png|webp|heic)$'
    and public.is_admin_of_photo_folder(name)
  );

create policy "Community admins remove photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'community-photos' and public.is_admin_of_photo_folder(name));

------------------------------------------------------------------------------
-- Set or clear the photo. Admins only. The file must already be uploaded to
-- the community's folder. Returns the previous path (or null) so the app can
-- remove the old file.
------------------------------------------------------------------------------
create function public.set_community_photo(p_community_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if not public.is_community_admin(p_community_id) then
    raise exception 'Only admins can change the community photo.' using errcode = 'P0001';
  end if;
  if p_path is not null then
    if p_path !~ ('^' || p_community_id::text || '/photo-[0-9]+\.(jpg|png|webp|heic)$') then
      raise exception 'That photo didn''t upload properly. Try again.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'community-photos' and name = p_path) then
      raise exception 'That photo didn''t upload properly. Try again.' using errcode = 'P0001';
    end if;
  end if;
  select photo_path into v_old from public.communities where id = p_community_id for update;
  update public.communities set photo_path = p_path where id = p_community_id;
  return case when v_old is distinct from p_path then v_old end;
end;
$$;

revoke execute on function public.set_community_photo(uuid, text) from public, anon;
grant execute on function public.set_community_photo(uuid, text) to authenticated;

------------------------------------------------------------------------------
-- The three community views, now with photo_path.
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
    'photo_path', c.photo_path,
    'code', case when m.role = 'admin' then c.code end,
    'role', m.role,
    'listed', c.listed,
    'member_count', (select count(*) from public.community_members x where x.community_id = c.id),
    'upcoming_rides', (select count(*) from public.rides r
                       where r.community_id = c.id and r.cancelled_at is null and coalesce(r.return_at, r.depart_at) > now()),
    'pending_requests', case when m.role = 'admin'
                          then (select count(*) from public.community_join_requests q where q.community_id = c.id and q.status = 'pending')
                          else 0 end,
    'next_event', (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'all_day', e.all_day)
                   from public.community_events e
                   where e.community_id = c.id and e.cancelled_at is null
                     and not public.event_is_over(e.starts_at, e.ends_at, e.all_day)
                   order by e.starts_at, e.id
                   limit 1)
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
    'photo_path', c.photo_path,
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

create or replace function public.popular_communities(p_limit int default 20)
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
        'photo_path', c.photo_path,
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
