-- Flat, single-level folders for organizing Creative Studio projects.
-- A project belongs to at most one folder; deleting a folder never deletes
-- its projects, it just uncategorizes them (folder_id -> null), the same way
-- creative_assets already survives its project being deleted.

create table if not exists public.creative_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  name text not null default 'Untitled folder'
    check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.creative_projects
  add column if not exists folder_id uuid references public.creative_folders(id) on delete set null;

create index if not exists creative_folders_user_updated_idx
  on public.creative_folders (user_id, updated_at desc);
create index if not exists creative_projects_folder_idx
  on public.creative_projects (folder_id, updated_at desc);

alter table public.creative_folders enable row level security;

drop policy if exists creative_folders_owner_select on public.creative_folders;
drop policy if exists creative_folders_owner_insert on public.creative_folders;
drop policy if exists creative_folders_owner_update on public.creative_folders;
drop policy if exists creative_folders_owner_delete on public.creative_folders;
create policy creative_folders_owner_select on public.creative_folders for select using (auth.uid() = user_id);
create policy creative_folders_owner_insert on public.creative_folders for insert with check (auth.uid() = user_id);
create policy creative_folders_owner_update on public.creative_folders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creative_folders_owner_delete on public.creative_folders for delete using (auth.uid() = user_id);

comment on table public.creative_folders is 'Flat, user-defined grouping for Creative Studio projects.';
