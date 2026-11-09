import { instagramMediaCaptionFallback } from "@/lib/instagram-media";

export const INSTAGRAM_PUBLISHED_MEDIA_FIELDS =
  "id,caption,media_product_type,media_type,permalink,thumbnail_url,media_url,timestamp,children{media_url,thumbnail_url,media_type}";

export const SUPPORTED_MEDIA_PRODUCT_TYPES = ["REELS", "FEED"] as const;
export const SUPPORTED_MEDIA_TYPES = ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"] as const;

export type InstagramMediaProductType = (typeof SUPPORTED_MEDIA_PRODUCT_TYPES)[number];
export type InstagramMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export interface InstagramGraphMediaChild {
  media_url?: string;
  thumbnail_url?: string;
  media_type?: string;
}

export interface InstagramGraphMediaItem {
  id: string;
  caption?: string;
  media_product_type?: string;
  media_type?: string;
  permalink: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp: string;
  children?: { data?: InstagramGraphMediaChild[] };
}

export interface SyncedInstagramMedia {
  externalId: string;
  caption: string;
  permalink: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  mediaProductType: InstagramMediaProductType;
  mediaType: InstagramMediaType;
}

function isMediaProductType(value: string | undefined): value is InstagramMediaProductType {
  return value === "REELS" || value === "FEED";
}

function isMediaType(value: string | undefined): value is InstagramMediaType {
  return value === "IMAGE" || value === "VIDEO" || value === "CAROUSEL_ALBUM";
}

export function thumbnailUrlForGraphMedia(item: InstagramGraphMediaItem) {
  if (item.thumbnail_url) return item.thumbnail_url;
  const firstChild = item.children?.data?.[0];
  if (firstChild?.thumbnail_url) return firstChild.thumbnail_url;
  if (firstChild?.media_url) return firstChild.media_url;
  if (item.media_url && item.media_type !== "VIDEO") return item.media_url;
  return null;
}

function resolveMediaType(item: InstagramGraphMediaItem): InstagramMediaType | null {
  if (isMediaType(item.media_type)) return item.media_type;
  if (item.media_product_type === "REELS") return "VIDEO";
  return null;
}

function resolveMediaProductType(
  item: InstagramGraphMediaItem,
  mediaType: InstagramMediaType,
): InstagramMediaProductType | null {
  if (item.media_product_type) {
    return isMediaProductType(item.media_product_type) ? item.media_product_type : null;
  }
  if (mediaType === "CAROUSEL_ALBUM" || mediaType === "IMAGE" || mediaType === "VIDEO") return "FEED";
  return null;
}

export function mapPublishedInstagramMedia(item: InstagramGraphMediaItem): SyncedInstagramMedia | null {
  const mediaType = resolveMediaType(item);
  if (!mediaType) return null;
  const mediaProductType = resolveMediaProductType(item, mediaType);
  if (!mediaProductType) return null;
  if (!item.id || !item.permalink || !item.timestamp) return null;

  return {
    externalId: item.id,
    caption: item.caption?.trim() || instagramMediaCaptionFallback({ mediaProductType, mediaType }),
    permalink: item.permalink,
    thumbnailUrl: thumbnailUrlForGraphMedia(item),
    publishedAt: item.timestamp,
    mediaProductType,
    mediaType,
  };
}

export function mapPublishedInstagramMediaList(items: InstagramGraphMediaItem[]) {
  return items.flatMap((item) => {
    const mapped = mapPublishedInstagramMedia(item);
    return mapped ? [mapped] : [];
  });
}
