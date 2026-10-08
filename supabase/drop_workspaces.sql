-- Workspaces ("sites") are gone. Every project, asset, folder, render and
-- video now belongs to its owner alone, scoped by user_id and RLS.
--
-- Only needed on a database created before the removal. Safe to re-run.

alter table if exists public.video_generations   drop column if exists site_id;
alter table if exists public.creative_projects   drop column if exists site_id;
alter table if exists public.creative_assets     drop column if exists site_id;
alter table if exists public.creative_folders    drop column if exists site_id;
alter table if exists public.creative_render_jobs drop column if exists site_id;

drop table if exists public.sites;
