export function instagramMediaKindLabel(media: {
  mediaProductType?: string | null;
  mediaType?: string | null;
}) {
  if (media.mediaType === "CAROUSEL_ALBUM") return "Carrossel";
  if (media.mediaProductType === "REELS") return "Reel";
  if (media.mediaType === "IMAGE") return "Foto";
  if (media.mediaType === "VIDEO") return "Vídeo";
  return "Publicação";
}

export function instagramMediaCaptionFallback(media: {
  mediaProductType?: string | null;
  mediaType?: string | null;
}) {
  return `${instagramMediaKindLabel(media)} sem legenda`;
}

export function instagramMediaCaption(media: {
  caption?: string | null;
  mediaProductType?: string | null;
  mediaType?: string | null;
}) {
  return media.caption?.trim() || instagramMediaCaptionFallback(media);
}
