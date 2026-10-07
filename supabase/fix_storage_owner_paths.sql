-- Let owners write to the namespaced paths the app actually uses.
--
-- The original policies (add_storage_buckets.sql) only allowed uploads whose
-- FIRST folder was the uploader's id: `<uid>/file`. But most of the app writes
-- under a namespace first — `creative-audio/<uid>/…`, `creative-renders/<uid>/…`,
-- `creative-assets/<uid>/…`, `creative-previews/<uid>/…` — a layout inherited
-- from Cloudflare R2, which has no row-level security and so never cared. On
-- Supabase every one of those uploads was refused, and the bucket held zero
-- objects as a result.
--
-- Ownership stays exact: a path is yours if your id is the first folder, or the
-- second folder directly under one of the app's known namespaces. Nobody can
-- write into another user's folder, and an unknown first folder is refused, so
-- the namespace list cannot be used to smuggle writes elsewhere.

create or replace function public.article_images_path_owner(object_name text)
returns text
language sql
immutable
as $$
  select case
    when (storage.foldername(object_name))[1] in (
      'creative-audio', 'creative-renders', 'creative-assets', 'creative-previews', 'creative-frames'
    )
      then (storage.foldername(object_name))[2]
    else (storage.foldername(object_name))[1]
  end
$$;

drop policy if exists "article_images_owner_insert" on storage.objects;
drop policy if exists "article_images_owner_update" on storage.objects;
drop policy if exists "article_images_owner_delete" on storage.objects;

create policy "article_images_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'article-images' and public.article_images_path_owner(name) = auth.uid()::text);

create policy "article_images_owner_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'article-images' and public.article_images_path_owner(name) = auth.uid()::text)
  with check (bucket_id = 'article-images' and public.article_images_path_owner(name) = auth.uid()::text);

create policy "article_images_owner_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'article-images' and public.article_images_path_owner(name) = auth.uid()::text);
