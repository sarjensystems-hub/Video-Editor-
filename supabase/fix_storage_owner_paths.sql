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

-- ALTER rather than DROP + CREATE. On the live project, dropping and
-- recreating these policies stalled past a minute three times and rolled back,
-- while ALTER POLICY applied immediately. lock_timeout makes any wait fail fast
-- and retryably instead of hanging.
set lock_timeout = '10s';

alter policy "article_images_owner_insert" on storage.objects
  with check (bucket_id = 'article-images' and public.article_images_path_owner(name) = auth.uid()::text);

alter policy "article_images_owner_update" on storage.objects
  using (bucket_id = 'article-images' and public.article_images_path_owner(name) = auth.uid()::text)
  with check (bucket_id = 'article-images' and public.article_images_path_owner(name) = auth.uid()::text);

alter policy "article_images_owner_delete" on storage.objects
  using (bucket_id = 'article-images' and public.article_images_path_owner(name) = auth.uid()::text);
