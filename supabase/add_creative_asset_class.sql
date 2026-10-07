-- What each Creative Studio asset is for, beside what format it is in.
-- `kind` is image/video/audio; `asset_class` is logo, narration, music, ...
-- Classes are defined in lib/creative/asset-class.ts and must match this list.

alter table public.creative_assets
  add column if not exists asset_class text not null default 'other';

update public.creative_assets set asset_class = case
  when source = 'render' then 'render'
  when kind = 'video' then 'footage'
  when kind = 'audio' and metadata->>'worker' = 'music' then 'music'
  when kind = 'audio' and metadata->>'worker' = 'builtin-sfx' then 'sfx'
  when kind = 'audio' then 'narration'
  when kind = 'image' and metadata->>'role' in ('product','logo') then metadata->>'role'
  when kind = 'image' then 'image'
  when kind = 'font' then 'font'
  else 'other' end
where asset_class = 'other';

alter table public.creative_assets drop constraint if exists creative_assets_asset_class_check;
alter table public.creative_assets add constraint creative_assets_asset_class_check
  check (asset_class in ('footage','render','image','product','logo','character','background','narration','music','sfx','font','other'));
