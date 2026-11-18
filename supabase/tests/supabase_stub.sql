-- Minimal stand-in for the parts of Supabase the migration relies on, so the
-- schema and its security rules can be tested on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema extensions;
create extension pgcrypto schema extensions;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz,
  confirmation_token text, email_change text, email_change_token_new text, recovery_token text
);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text,
  identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to anon, authenticated;
-- Supabase grants everything on new public tables to these roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Storage (just what the driver-docs bucket needs).
create schema if not exists storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as
$$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.filename(name text) returns text language sql immutable as
$$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;

-- Vault (just what the Google calendar token needs). Real Vault encrypts; the stub only stores.
create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(), name text unique, description text not null default '',
  secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
returns uuid language sql as
$$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, coalesce(new_description, '')) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
returns void language sql as
$$ update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
     description = coalesce(new_description, description), updated_at = now() where id = secret_id $$;
