-- Allow Instagram feed posts (carousels, photos and videos) alongside Reels.
-- Existing REELS rows stay intact and receive media_type = VIDEO.

alter table public.instagram_media
  add column if not exists media_type text;

update public.instagram_media
  set media_type = 'VIDEO'
  where media_type is null;

alter table public.instagram_media
  alter column media_type set default 'VIDEO';

alter table public.instagram_media
  alter column media_type set not null;

alter table public.instagram_media
  drop constraint if exists instagram_media_media_product_type_check;

alter table public.instagram_media
  add constraint instagram_media_media_product_type_check
    check (media_product_type in ('REELS', 'FEED'));

alter table public.instagram_media
  drop constraint if exists instagram_media_media_type_check;

alter table public.instagram_media
  add constraint instagram_media_media_type_check
    check (media_type in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'));
