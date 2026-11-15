-- BuyersAgent-EV: catalog table used by src/server.js
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.custom_evs (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Row Level Security: anyone may read, nobody may write with the
-- publishable/anon key. The server writes with the secret (service role)
-- key, which bypasses RLS, and only after the admin has logged in.
alter table public.custom_evs enable row level security;

drop policy if exists "Public read" on public.custom_evs;
create policy "Public read" on public.custom_evs
  for select
  to anon, authenticated
  using (true);

-- Remove the permissive policy suggested by older versions of the app, if present.
drop policy if exists "Admin write" on public.custom_evs;
