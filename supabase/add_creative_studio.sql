-- Studio Creative Studio persistence.
-- CreativeDocument remains the canonical JSON source of truth; revisions are
-- immutable snapshots, while creative_projects stores the latest working copy.

create table if not exists public.creative_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  title text not null default 'Untitled creative',
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'rendering', 'archived')),
  document jsonb not null
    check (jsonb_typeof(document) = 'object'),
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creative_project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.creative_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  change_summary text not null default 'Updated creative',
  document jsonb not null
    check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null default now(),
  unique (project_id, sequence)
);

create table if not exists public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  project_id uuid references public.creative_projects(id) on delete set null,
  kind text not null default 'other'
    check (kind in ('image', 'video', 'audio', 'font', 'other')),
  source text not null default 'upload',
  url text not null,
  storage_path text,
  mime_type text,
  filename text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creative_render_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  project_id uuid not null references public.creative_projects(id) on delete cascade,
  revision_id uuid references public.creative_project_revisions(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'rendering', 'completed', 'failed', 'cancelled')),
  renderer text not null default 'remotion-vercel',
  format text not null default 'mp4'
    check (format in ('mp4')),
  progress numeric not null default 0
    check (progress >= 0 and progress <= 1),
  output_url text,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing Creative Studio installs may predate render-job site ownership.
alter table public.creative_render_jobs
  add column if not exists site_id uuid references public.sites(id) on delete set null;

-- Vestigial billing columns. This deployment charges nothing, so both stay at
-- their defaults forever and the refund branch that reads them never fires.
-- They exist because the render-job read path still selects them by name; drop
-- them only alongside those selects.
alter table public.creative_render_jobs
  add column if not exists credits_charged integer not null default 0;
alter table public.creative_render_jobs
  add column if not exists credits_refunded_at timestamptz;

-- Circular relationship is added after revisions exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'creative_projects_current_revision_fk'
  ) then
    alter table public.creative_projects
      add constraint creative_projects_current_revision_fk
      foreign key (current_revision_id)
      references public.creative_project_revisions(id)
      on delete set null
      deferrable initially deferred;
  end if;
end $$;

create index if not exists creative_projects_user_updated_idx
  on public.creative_projects (user_id, updated_at desc);
create index if not exists creative_projects_site_idx
  on public.creative_projects (site_id, updated_at desc);
create index if not exists creative_revisions_project_sequence_idx
  on public.creative_project_revisions (project_id, sequence desc);
create index if not exists creative_assets_user_created_idx
  on public.creative_assets (user_id, created_at desc);
create index if not exists creative_assets_project_idx
  on public.creative_assets (project_id, created_at desc);
create index if not exists creative_render_jobs_project_created_idx
  on public.creative_render_jobs (project_id, created_at desc);
create index if not exists creative_render_jobs_status_idx
  on public.creative_render_jobs (status, created_at desc);

alter table public.creative_projects enable row level security;
alter table public.creative_project_revisions enable row level security;
alter table public.creative_assets enable row level security;
alter table public.creative_render_jobs enable row level security;

drop policy if exists creative_projects_owner_select on public.creative_projects;
drop policy if exists creative_projects_owner_insert on public.creative_projects;
drop policy if exists creative_projects_owner_update on public.creative_projects;
drop policy if exists creative_projects_owner_delete on public.creative_projects;
create policy creative_projects_owner_select on public.creative_projects for select using (auth.uid() = user_id);
create policy creative_projects_owner_insert on public.creative_projects for insert with check (auth.uid() = user_id);
create policy creative_projects_owner_update on public.creative_projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creative_projects_owner_delete on public.creative_projects for delete using (auth.uid() = user_id);

drop policy if exists creative_revisions_owner_select on public.creative_project_revisions;
drop policy if exists creative_revisions_owner_insert on public.creative_project_revisions;
create policy creative_revisions_owner_select on public.creative_project_revisions for select using (auth.uid() = user_id);
create policy creative_revisions_owner_insert on public.creative_project_revisions for insert with check (auth.uid() = user_id);
-- Revisions are intentionally immutable through end-user sessions. Service-role
-- maintenance can still bypass RLS when required.

drop policy if exists creative_assets_owner_select on public.creative_assets;
drop policy if exists creative_assets_owner_insert on public.creative_assets;
drop policy if exists creative_assets_owner_update on public.creative_assets;
drop policy if exists creative_assets_owner_delete on public.creative_assets;
create policy creative_assets_owner_select on public.creative_assets for select using (auth.uid() = user_id);
create policy creative_assets_owner_insert on public.creative_assets for insert with check (auth.uid() = user_id);
create policy creative_assets_owner_update on public.creative_assets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creative_assets_owner_delete on public.creative_assets for delete using (auth.uid() = user_id);

drop policy if exists creative_render_jobs_owner_select on public.creative_render_jobs;
drop policy if exists creative_render_jobs_owner_insert on public.creative_render_jobs;
drop policy if exists creative_render_jobs_owner_update on public.creative_render_jobs;
drop policy if exists creative_render_jobs_owner_delete on public.creative_render_jobs;
create policy creative_render_jobs_owner_select on public.creative_render_jobs for select using (auth.uid() = user_id);
create policy creative_render_jobs_owner_insert on public.creative_render_jobs for insert with check (auth.uid() = user_id);
create policy creative_render_jobs_owner_update on public.creative_render_jobs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creative_render_jobs_owner_delete on public.creative_render_jobs for delete using (auth.uid() = user_id);

comment on table public.creative_projects is 'Latest editable CreativeDocument state for Studio Creative Studio.';
comment on table public.creative_project_revisions is 'Immutable CreativeDocument revision snapshots used for undo/history/AI edit provenance.';
comment on table public.creative_assets is 'Reusable owner-scoped media registry for generated and uploaded creative assets.';
comment on table public.creative_render_jobs is 'Deterministic render lifecycle for CreativeDocument outputs.';
