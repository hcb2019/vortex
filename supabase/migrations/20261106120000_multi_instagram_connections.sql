-- Multi-conta Instagram: um owner pode manter várias Business/Creator.
-- A linha existente permanece intacta; só sai o UNIQUE(owner_id).

alter table public.instagram_connections
  drop constraint if exists instagram_connections_owner_id_key;

create index if not exists instagram_connections_owner_idx
  on public.instagram_connections(owner_id);

create table if not exists public.owner_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  selected_connection_id uuid references public.instagram_connections(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.owner_settings is
  'Preferência de conta Instagram selecionada no painel. Webhooks continuam a resolver por instagram_user_id.';

alter table public.owner_settings enable row level security;

grant select, insert, update, delete on public.owner_settings to authenticated;
revoke all on public.owner_settings from anon;

drop policy if exists owner_all_settings on public.owner_settings;
create policy owner_all_settings on public.owner_settings for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

insert into public.owner_settings (owner_id, selected_connection_id)
select owner_id, id
from public.instagram_connections
on conflict (owner_id) do nothing;

alter table public.audience_analysis_runs
  add column if not exists connection_id uuid references public.instagram_connections(id) on delete cascade;

create index if not exists audience_analysis_runs_connection_idx
  on public.audience_analysis_runs(connection_id, created_at desc);

update public.audience_analysis_runs as run
set connection_id = connection.id
from public.instagram_connections as connection
where run.connection_id is null
  and connection.owner_id = run.owner_id;
