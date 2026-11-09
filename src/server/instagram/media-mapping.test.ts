import { describe, expect, it } from "vitest";
import {
  mapPublishedInstagramMedia,
  mapPublishedInstagramMediaList,
  thumbnailUrlForGraphMedia,
} from "@/server/instagram/media-mapping";

const reel = {
  id: "reel-1",
  caption: "Comente 1991",
  media_product_type: "REELS",
  media_type: "VIDEO",
  permalink: "https://www.instagram.com/reel/demo-1991/",
  thumbnail_url: "https://scontent.cdninstagram.com/reel-cover.jpg",
  timestamp: "2026-11-01T12:00:00+0000",
};

const carousel = {
  id: "carousel-1",
  caption: "Carrossel de ofertas",
  media_product_type: "FEED",
  media_type: "CAROUSEL_ALBUM",
  permalink: "https://www.instagram.com/p/demo-carrossel/",
  timestamp: "2026-11-02T15:30:00+0000",
  children: {
    data: [
      { media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/slide-1.jpg" },
      { media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/slide-2.jpg" },
    ],
  },
};

describe("Instagram published media mapping", () => {
  it("mapeia um Reel com capa, tipo e metadados", () => {
    expect(mapPublishedInstagramMedia(reel)).toEqual({
      externalId: "reel-1",
      caption: "Comente 1991",
      permalink: "https://www.instagram.com/reel/demo-1991/",
      thumbnailUrl: "https://scontent.cdninstagram.com/reel-cover.jpg",
      publishedAt: "2026-11-01T12:00:00+0000",
      mediaProductType: "REELS",
      mediaType: "VIDEO",
    });
  });

  it("mapeia um carrossel usando a capa do primeiro filho", () => {
    expect(mapPublishedInstagramMedia(carousel)).toEqual({
      externalId: "carousel-1",
      caption: "Carrossel de ofertas",
      permalink: "https://www.instagram.com/p/demo-carrossel/",
      thumbnailUrl: "https://scontent.cdninstagram.com/slide-1.jpg",
      publishedAt: "2026-11-02T15:30:00+0000",
      mediaProductType: "FEED",
      mediaType: "CAROUSEL_ALBUM",
    });
  });

  it("usa thumbnail_url do primeiro filho quando o carrossel começa com vídeo", () => {
    expect(thumbnailUrlForGraphMedia({
      ...carousel,
      children: {
        data: [{ media_type: "VIDEO", thumbnail_url: "https://scontent.cdninstagram.com/slide-video.jpg" }],
      },
    })).toBe("https://scontent.cdninstagram.com/slide-video.jpg");
  });

  it("mapeia foto e vídeo do feed e ignora stories e anúncios", () => {
    const mapped = mapPublishedInstagramMediaList([
      reel,
      carousel,
      {
        id: "photo-1",
        media_product_type: "FEED",
        media_type: "IMAGE",
        permalink: "https://www.instagram.com/p/demo-foto/",
        media_url: "https://scontent.cdninstagram.com/photo.jpg",
        timestamp: "2026-11-03T10:00:00+0000",
      },
      {
        id: "video-1",
        media_product_type: "FEED",
        media_type: "VIDEO",
        permalink: "https://www.instagram.com/p/demo-video/",
        thumbnail_url: "https://scontent.cdninstagram.com/video-cover.jpg",
        timestamp: "2026-11-03T11:00:00+0000",
      },
      {
        id: "story-1",
        media_product_type: "STORY",
        media_type: "IMAGE",
        permalink: "https://www.instagram.com/stories/demo/",
        timestamp: "2026-11-03T12:00:00+0000",
      },
      {
        id: "ad-1",
        media_product_type: "AD",
        media_type: "VIDEO",
        permalink: "https://www.instagram.com/reel/demo-ad/",
        timestamp: "2026-11-03T13:00:00+0000",
      },
    ]);

    expect(mapped.map((item) => item.externalId)).toEqual(["reel-1", "carousel-1", "photo-1", "video-1"]);
    expect(mapped.find((item) => item.externalId === "photo-1")).toMatchObject({
      mediaProductType: "FEED",
      mediaType: "IMAGE",
      thumbnailUrl: "https://scontent.cdninstagram.com/photo.jpg",
      caption: "Foto sem legenda",
    });
  });

  it("infere FEED quando a Meta omite media_product_type em um vídeo", () => {
    expect(mapPublishedInstagramMedia({
      id: "video-sem-produto",
      media_type: "VIDEO",
      permalink: "https://www.instagram.com/p/demo-video-feed/",
      thumbnail_url: "https://scontent.cdninstagram.com/video-cover.jpg",
      timestamp: "2026-11-04T10:00:00+0000",
    })).toMatchObject({
      mediaProductType: "FEED",
      mediaType: "VIDEO",
    });
  });
});
