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
    const [exchangeUrl, exchangeInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(String(exchangeUrl)).toBe("https://graph.instagram.com/access_token");
    expect(exchangeInit.method).toBe("POST");
    const exchangeBody = tokenBody(exchangeInit);
    expect(exchangeBody.get("grant_type")).toBe("ig_exchange_token");
    expect(exchangeBody.get("access_token")).toBe("short-lived-token");
    expect(exchangeBody.get("client_secret")).toBe("instagram-app-secret");
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
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(refreshUrl)).toBe("https://graph.instagram.com/refresh_access_token");
    expect(refreshInit.method).toBe("POST");
    const refreshBody = tokenBody(refreshInit);
    expect(refreshBody.get("grant_type")).toBe("ig_refresh_token");
    expect(refreshBody.get("access_token")).toBe("current-long-token");
  });

  it("cai para GET quando o Graph recusa o POST de troca de token", async () => {
    env.META_APP_ID = "instagram-app-id";
    env.META_APP_SECRET = "instagram-app-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "short-lived-token",
        user_id: 123,
        permissions: ["instagram_business_basic"],
      }), { status: 200 }))
      .mockResolvedValueOnce(metaErrorResponse("Unsupported request - method type: post", 100))
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [getUrl, getInit] = fetchMock.mock.calls[2] as [URL, RequestInit];
    expect(getInit.method).toBe("GET");
    expect(getUrl.origin + getUrl.pathname).toBe("https://graph.instagram.com/access_token");
    expect(getUrl.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(getUrl.searchParams.get("access_token")).toBe("short-lived-token");
  });

  it("não tenta GET quando o POST falha por outro motivo", async () => {
    env.META_APP_ID = "instagram-app-id";
    env.META_APP_SECRET = "instagram-app-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "short-lived-token",
        user_id: 123,
      }), { status: 200 }))
      .mockResolvedValueOnce(metaErrorResponse("Invalid OAuth access token", 190));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new MetaInstagramGateway().exchangeCode(
      "oauth-code",
      "https://example.com/api/meta/oauth/callback",
    )).rejects.toMatchObject({ name: "MetaApiError", code: "190" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propaga code 100 quando POST e GET de troca de token são recusados", async () => {
    env.META_APP_ID = "instagram-app-id";
    env.META_APP_SECRET = "instagram-app-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "short-lived-token",
        user_id: 123,
      }), { status: 200 }))
      .mockResolvedValueOnce(metaErrorResponse("Unsupported request - method type: post", 100))
      .mockResolvedValueOnce(metaErrorResponse("Unsupported request - method type: get", 100));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new MetaInstagramGateway().exchangeCode(
      "oauth-code",
      "https://example.com/api/meta/oauth/callback",
    )).rejects.toMatchObject({
      name: "MetaApiError",
      code: "100",
      message: "Unsupported request - method type: get",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
});

function tokenBody(init: RequestInit) {
  const body = init.body;
  if (body instanceof URLSearchParams) return body;
  return new URLSearchParams(String(body ?? ""));
}

function metaErrorResponse(message: string, code: number) {
  return new Response(JSON.stringify({
    error: { message, type: "IGApiException", code },
  }), { status: 400, headers: { "Content-Type": "application/json" } });
}
