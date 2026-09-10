-- Supabase Storage buckets for the Supabase-only storage path.
--
-- article-images holds generated/uploaded creative media (images, voiceover,
-- music, finished MP4s) when R2 is not configured — see lib/storage.ts.
-- creative-render-snapshots holds the small JSON blob that caches a warm
-- Vercel Sandbox snapshot per deployment, so cold-start renders skip
-- re-bundling the Remotion composition — see lib/creative/render.ts and
-- scripts/create-creative-render-snapshot.mjs. Both are public buckets: the
-- renderer and the connected AI fetch assets over plain HTTPS, the same
-- design R2 used.

insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('creative-render-snapshots', 'creative-render-snapshots', true)
on conflict (id) do nothing;

-- Uploads to article-images go through the user's own session (RLS applies),
-- scoped to a folder named after the uploader so one user can never overwrite
-- or delete another's media. Reads bypass RLS entirely because the bucket is
-- public. Writes to creative-render-snapshots always go through the
-- service-role key (see the build script), which bypasses RLS, so no insert
-- policy is needed for that bucket.
drop policy if exists "article_images_owner_insert" on storage.objects;
drop policy if exists "article_images_owner_update" on storage.objects;
drop policy if exists "article_images_owner_delete" on storage.objects;

create policy "article_images_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'article-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "article_images_owner_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'article-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'article-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "article_images_owner_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'article-images' and (storage.foldername(name))[1] = auth.uid()::text);
