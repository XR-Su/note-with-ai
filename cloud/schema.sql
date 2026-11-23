-- Private PG metadata: browser anon/authenticated roles get no direct access.
create table if not exists public.little_days_sync (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  version bigint not null check (version >= 1),
  object_key text not null,
  operation_id text not null,
  content_hash text not null
);
alter table public.little_days_sync enable row level security;
revoke all on public.little_days_sync from anon, authenticated;
grant select, insert, update on public.little_days_sync to service_role;

insert into storage.buckets (id, name, public)
values ('little-days-private', 'little-days-private', false)
on conflict (id) do nothing;
-- No anon/authenticated storage.objects allow policies are created.
-- Existing broad policies must not grant access to this bucket.
