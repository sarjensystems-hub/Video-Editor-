-- Sites table
-- Each user can have multiple sites depending on their plan tier.
-- Creative projects and generated videos are scoped to a site.

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text,
  platform text check (platform in ('wordpress', 'shopify', 'other')),
  is_default boolean default false,
  created_at timestamptz default now()
);

-- RLS
alter table sites enable row level security;

create policy "Users can manage their own sites"
  on sites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index
create index if not exists sites_user_id_idx on sites(user_id);
