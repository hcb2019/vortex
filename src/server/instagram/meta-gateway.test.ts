import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { MetaInstagramGateway } from "@/server/instagram/meta-gateway";

const originalAppId = env.META_APP_ID;
const originalAppSecret = env.META_APP_SECRET;

afterEach(() => {
  env.META_APP_ID = originalAppId;
  env.META_APP_SECRET = originalAppSecret;
  vi.unstubAllGlobals();
});

describe("MetaInstagramGateway token lifecycle", () => {
  it("troca o token curto por um token de longa duração no OAuth", async () => {
    env.META_APP_ID = "instagram-app-id";
    env.META_APP_SECRET = "instagram-app-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "short-lived-token",
        user_id: 123,
        permissions: ["instagram_business_basic"],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "long-lived-token",
        token_type: "bearer",
        expires_in: 5_184_000,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MetaInstagramGateway().exchangeCode(
      "oauth-code",
      "https://example.com/api/meta/oauth/callback",
    );

    expect(result.accessToken).toBe("long-lived-token");
    expect(result.expiresIn).toBe(5_184_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const exchangeUrl = fetchMock.mock.calls[1]?.[0] as URL;
    expect(exchangeUrl.origin + exchangeUrl.pathname).toBe("https://graph.instagram.com/access_token");
    expect(exchangeUrl.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(exchangeUrl.searchParams.get("access_token")).toBe("short-lived-token");
  });

  it("renova o token de longa duração antes do vencimento", async () => {
    env.META_APP_SECRET = "instagram-app-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "renewed-token",
      expires_in: 5_184_000,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MetaInstagramGateway().renewAccessToken("current-long-token");

    expect(result).toEqual({ accessToken: "renewed-token", expiresIn: 5_184_000 });
    const refreshUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(refreshUrl.origin + refreshUrl.pathname).toBe("https://graph.instagram.com/refresh_access_token");
    expect(refreshUrl.searchParams.get("grant_type")).toBe("ig_refresh_token");
    expect(refreshUrl.searchParams.get("access_token")).toBe("current-long-token");
  });

  it("cria container de Reel, consulta status e publica via media_publish", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "container-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "media-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new MetaInstagramGateway();

    await gateway.createReelContainer("ig-user", "https://cdn.example.com/reel.mp4", "Legenda", "token");
    await gateway.getMediaContainerStatus("container-1", "token");
    await gateway.publishMedia("ig-user", "container-1", "token");

    const createBody = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/ig-user/media");
    expect(createBody.get("media_type")).toBe("REELS");
    expect(createBody.get("video_url")).toBe("https://cdn.example.com/reel.mp4");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/container-1?fields=status_code");
    const publishBody = fetchMock.mock.calls[2]?.[1]?.body as URLSearchParams;
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/ig-user/media_publish");
    expect(publishBody.get("creation_id")).toBe("container-1");
  });

  it("lista Reels, carrosséis e posts do feed e ignora stories", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        {
          id: "reel-1",
          caption: "Reel",
          media_product_type: "REELS",
          media_type: "VIDEO",
          permalink: "https://www.instagram.com/reel/demo/",
          thumbnail_url: "https://scontent.cdninstagram.com/reel.jpg",
          timestamp: "2026-11-01T12:00:00+0000",
        },
        {
          id: "carousel-1",
          caption: "Carrossel",
          media_product_type: "FEED",
          media_type: "CAROUSEL_ALBUM",
          permalink: "https://www.instagram.com/p/demo-carrossel/",
          timestamp: "2026-11-02T12:00:00+0000",
          children: { data: [{ media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/slide.jpg" }] },
        },
        {
          id: "story-1",
          media_product_type: "STORY",
          media_type: "IMAGE",
          permalink: "https://www.instagram.com/stories/demo/",
          timestamp: "2026-11-03T12:00:00+0000",
        },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MetaInstagramGateway().listPublishedMedia("ig-user", "token");

    expect(result.map((item) => item.externalId)).toEqual(["reel-1", "carousel-1"]);
    expect(result[1]).toMatchObject({
      mediaProductType: "FEED",
      mediaType: "CAROUSEL_ALBUM",
      thumbnailUrl: "https://scontent.cdninstagram.com/slide.jpg",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("children");
  });
});
