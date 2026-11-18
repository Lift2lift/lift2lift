-- Community photos: admins only, files in the community's own folder, shown on all three views.
\set ON_ERROR_STOP on

insert into public.communities (code_hash, name) values (public.community_code_hash('PHOTOCLB2'), 'Photo Club');

insert into auth.users (id, email, raw_user_meta_data) values
  ('a7111111-1111-4111-8111-111111111111', 'pia@lift2lift.test', '{"full_name":"Pia Admin"}'),
  ('b7111111-1111-4111-8111-111111111111', 'pat@lift2lift.test', '{"full_name":"Pat Member"}'),
  ('c7111111-1111-4111-8111-111111111111', 'poe@lift2lift.test', '{"full_name":"Poe Outsider"}');
select public.test_make_ready('a7111111-1111-4111-8111-111111111111');
select public.test_make_ready('b7111111-1111-4111-8111-111111111111');
select public.test_make_ready('c7111111-1111-4111-8111-111111111111');

create temp table pc (id uuid);
grant select on pc to authenticated;
insert into pc values ((select id from public.communities where name = 'Photo Club'));

set role authenticated;

-- Pia joins first and becomes admin; Pat joins as a member.
select set_config('request.jwt.claim.sub', 'a7111111-1111-4111-8111-111111111111', false);
select public.join_community('PHOTOCLB2');
select set_config('request.jwt.claim.sub', 'b7111111-1111-4111-8111-111111111111', false);
select public.join_community('PHOTOCLB2');

-- A member can't upload into the folder or set the photo.
do $$
declare v_id uuid := (select id from pc);
begin
  begin
    insert into storage.objects (bucket_id, name) values ('community-photos', v_id || '/photo-1.jpg');
    raise exception 'member uploaded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_community_photo(v_id, null);
    raise exception 'member set photo';
  exception when raise_exception then
    if sqlerrm = 'member set photo' then raise; end if;
  end;
end $$;

-- The admin uploads, but only photo-<digits>.<ext> in her community's folder.
select set_config('request.jwt.claim.sub', 'a7111111-1111-4111-8111-111111111111', false);
do $$
declare
  v_id uuid := (select id from pc);
  v_old text;
begin
  begin
    insert into storage.objects (bucket_id, name) values ('community-photos', gen_random_uuid() || '/photo-1.jpg');
    raise exception 'uploaded into another folder';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('community-photos', v_id || '/evil.svg');
    raise exception 'uploaded a bad name';
  exception when insufficient_privilege then null;
  end;

  insert into storage.objects (bucket_id, name) values ('community-photos', v_id || '/photo-1.jpg');
  v_old := public.set_community_photo(v_id, v_id || '/photo-1.jpg');
  assert v_old is null, 'no previous photo';

  -- A path that isn't uploaded, or is outside the folder, is refused.
  begin
    perform public.set_community_photo(v_id, v_id || '/photo-9.jpg');
    raise exception 'set a missing file';
  exception when raise_exception then
    if sqlerrm = 'set a missing file' then raise; end if;
  end;

  -- Replacing hands back the old path to remove.
  insert into storage.objects (bucket_id, name) values ('community-photos', v_id || '/photo-2.png');
  v_old := public.set_community_photo(v_id, v_id || '/photo-2.png');
  assert v_old = v_id || '/photo-1.jpg', 'old path returned';
  delete from storage.objects where bucket_id = 'community-photos' and name = v_old;
  assert not exists (select 1 from storage.objects where name = v_old), 'admin removed the old file';

  assert (public.community_page(v_id) ->> 'photo_path') = v_id || '/photo-2.png', 'page shows photo';
  assert (select x ->> 'photo_path' from jsonb_array_elements(public.my_communities()) x where (x ->> 'id')::uuid = v_id) = v_id || '/photo-2.png',
    'your communities shows photo';
end $$;

-- Popular communities shows the photo to outsiders, who can read it but not delete it.
select set_config('request.jwt.claim.sub', 'c7111111-1111-4111-8111-111111111111', false);
do $$
declare v_id uuid := (select id from pc);
begin
  assert (select x ->> 'photo_path' from jsonb_array_elements(public.popular_communities(50)) x where (x ->> 'id')::uuid = v_id) = v_id || '/photo-2.png',
    'popular shows photo';
  assert exists (select 1 from storage.objects where bucket_id = 'community-photos' and name = v_id || '/photo-2.png'), 'outsider can read';
  delete from storage.objects where bucket_id = 'community-photos';
  assert exists (select 1 from storage.objects where bucket_id = 'community-photos' and name = v_id || '/photo-2.png'), 'outsider cannot delete';
end $$;

-- Removing the photo clears it.
select set_config('request.jwt.claim.sub', 'a7111111-1111-4111-8111-111111111111', false);
do $$
declare v_id uuid := (select id from pc);
begin
  assert public.set_community_photo(v_id, null) = v_id || '/photo-2.png', 'remove returns old path';
  assert (public.community_page(v_id) ->> 'photo_path') is null, 'photo cleared';
end $$;

reset role;
