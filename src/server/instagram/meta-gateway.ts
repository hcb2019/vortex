import "server-only";
import { env } from "@/lib/env";
import type { InstagramGateway, InstagramTokenResult } from "@/server/instagram/types";
import { normalizeMetaPagingPath } from "@/server/instagram/pagination";
import {
  INSTAGRAM_PUBLISHED_MEDIA_FIELDS,
  mapPublishedInstagramMedia,
  mapPublishedInstagramMediaList,
  type InstagramGraphMediaItem,
} from "@/server/instagram/media-mapping";

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfter?: number,
    readonly ambiguous = false,
    readonly subcode?: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
  get transient() { return this.status === 429 || this.status >= 500; }
}

function safeMetaMessage(message?: string) {
  if (!message) return "A Meta rejeitou a solicitação.";
  return message
    .replace(/access[_ -]?token[=: ]+\S+/gi, "access token [oculto]")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[dado oculto]")
    .slice(0, 300);
}

type MetaFetchOptions = RequestInit & { accessToken?: string; unversioned?: boolean };

type MetaTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

async function metaFetch<T>(path: string, options: MetaFetchOptions, attempt = 1): Promise<T> {
  const { accessToken, unversioned = false, ...init } = options;
  const endpoint = unversioned
    ? `https://graph.instagram.com${path}`
    : `https://graph.instagram.com/${env.META_GRAPH_API_VERSION}${path}`;
  const response = await fetch(endpoint, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init.headers },
  }).catch((cause) => { throw new MetaApiError(cause instanceof Error && cause.name === "TimeoutError" ? "Tempo limite da Meta excedido." : "Meta indisponível.", 0, "NETWORK", undefined, true); });
  if (response.ok) return await response.json() as T;
  const retryAfter = Number(response.headers.get("retry-after") ?? 0) || undefined;
  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  const error = new MetaApiError(
    safeMetaMessage(body.error?.message),
    response.status,
    String(body.error?.code ?? "HTTP_ERROR"),
    retryAfter,
    false,
    body.error?.error_subcode ? String(body.error.error_subcode) : undefined,
    response.headers.get("x-fb-request-id") ?? undefined,
  );
  if (error.transient && attempt < 3) {
    const delay = Math.min((retryAfter ?? 2 ** attempt) * 1000 + Math.random() * 250, 10_000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return metaFetch<T>(path, options, attempt + 1);
  }
  throw error;
}

async function tokenFetch(path: "/access_token" | "/refresh_access_token", params: URLSearchParams) {
  const endpoint = new URL(path, "https://graph.instagram.com");
  endpoint.search = params.toString();
  const response = await fetch(endpoint, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json" },
  }).catch((cause) => {
    throw new MetaApiError(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "Tempo limite da Meta excedido."
        : "Meta indisponível.",
      0,
      "NETWORK",
      undefined,
      true,
    );
  });
  if (response.ok) {
    const data = await response.json() as MetaTokenResponse;
    if (!data.access_token) throw new MetaApiError("A Meta não devolveu um token válido.", 502, "INVALID_TOKEN_RESPONSE");
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in ?? 5_184_000,
    };
  }
  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  throw new MetaApiError(
    safeMetaMessage(body.error?.message),
    response.status,
    String(body.error?.code ?? "TOKEN_HTTP_ERROR"),
    Number(response.headers.get("retry-after") ?? 0) || undefined,
    false,
    body.error?.error_subcode ? String(body.error.error_subcode) : undefined,
    response.headers.get("x-fb-request-id") ?? undefined,
  );
}

async function exchangeForLongLivedToken(shortLivedToken: string) {
  if (!env.META_APP_SECRET) throw new Error("Meta não configurada.");
  return tokenFetch("/access_token", new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: env.META_APP_SECRET,
    access_token: shortLivedToken,
  }));
}

function isUnsupportedMediaEdge(error: unknown) {
  return error instanceof MetaApiError
    && error.code === "2500"
    && error.message.toLowerCase().includes("path components")
    && error.message.toLowerCase().includes("/media");
}

async function inspectCommentAccess(mediaId: string, accessToken: string) {
  const [permissionsResult, mediaResult] = await Promise.allSettled([
    metaFetch<{ data?: Array<{ permission?: string; status?: string }> }>(
      "/me/permissions",
      { accessToken },
    ),
    metaFetch<{ comments_count?: number }>(
      `/${encodeURIComponent(mediaId)}?fields=comments_count`,
      { accessToken },
    ),
  ]);
  const grantedPermissions = permissionsResult.status === "fulfilled"
    ? (permissionsResult.value.data ?? [])
      .filter((item) => item.status === "granted" && item.permission)
      .map((item) => item.permission as string)
    : null;
  const commentsCount = mediaResult.status === "fulfilled"
    ? Number(mediaResult.value.comments_count ?? 0)
    : null;
  return { grantedPermissions, commentsCount };
}

type MetaQuickReply = {
  content_type: "text";
  title: string;
  payload: string;
};

type MetaButton =
  | { type: "web_url"; title: string; url: string }
  | { type: "postback"; title: string; payload: string };

function buildQuickReplies(quickReplies?: Array<{ title: string; payload: string }>): MetaQuickReply[] | undefined {
  const replies = quickReplies
    ?.map((reply) => ({ content_type: "text" as const, title: reply.title.trim().slice(0, 20), payload: reply.payload }))
    .filter((reply) => reply.title && reply.payload)
    .slice(0, 13);
  return replies?.length ? replies : undefined;
}

function requireMappedMedia(item: InstagramGraphMediaItem) {
  const mapped = mapPublishedInstagramMedia(item);
  if (!mapped) throw new MetaApiError("A Meta devolveu uma publicação que o Vortex ainda não sincroniza.", 502, "UNSUPPORTED_MEDIA");
  return mapped;
}

async function listPublishedMediaFromExpandedProfile(accessToken: string) {
  const fields = encodeURIComponent(`media.limit(50){${INSTAGRAM_PUBLISHED_MEDIA_FIELDS}}`);
  let data: { media?: { data?: InstagramGraphMediaItem[] } };
  try {
    data = await metaFetch(`/me?fields=${fields}`, { accessToken });
  } catch (error) {
    if (!isUnsupportedMediaEdge(error)) throw error;
    data = await metaFetch(`/me?fields=${fields}`, { accessToken, unversioned: true });
  }
  return mapPublishedInstagramMediaList(data.media?.data ?? []);
}

export class MetaInstagramGateway implements InstagramGateway {
  async exchangeCode(code: string, redirectUri: string): Promise<InstagramTokenResult> {
    if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error("Meta não configurada.");
    const body = new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, grant_type: "authorization_code", redirect_uri: redirectUri, code });
    const response = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new MetaApiError("Não foi possível concluir o OAuth.", response.status);
    const data = await response.json() as { access_token: string; user_id: number; expires_in?: number; permissions?: string[] };
    const longLived = await exchangeForLongLivedToken(data.access_token);
    return {
      accessToken: longLived.accessToken,
      userId: String(data.user_id),
      expiresIn: longLived.expiresIn,
      permissions: Array.isArray(data.permissions) ? data.permissions : null,
    };
  }

  async renewAccessToken(accessToken: string) {
    try {
      return await tokenFetch("/refresh_access_token", new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: accessToken,
      }));
    } catch (refreshError) {
      // Connections created by older Vortex versions may still contain the
      // short-lived OAuth token. Give those installations one safe upgrade
      // attempt before requiring the owner to reconnect.
      if (refreshError instanceof MetaApiError && !refreshError.transient) {
        try {
          return await exchangeForLongLivedToken(accessToken);
        } catch {
          throw refreshError;
        }
      }
      throw refreshError;
    }
  }

  getProfile(accessToken: string) {
    return metaFetch<{ id: string; username: string }>("/me?fields=id,username", { accessToken }).then((data) => ({ userId: data.id, username: data.username }));
  }

  async listGrantedPermissions(accessToken: string) {
    try {
      const data = await metaFetch<{ data?: Array<{ permission?: string; status?: string }> }>(
        "/me/permissions",
        { accessToken },
      );
      return (data.data ?? [])
        .filter((item) => item.status === "granted" && item.permission)
        .map((item) => item.permission as string);
    } catch (error) {
      if (error instanceof MetaApiError && !error.transient) return null;
      throw error;
    }
  }

  async subscribeToComments(userId: string, accessToken: string) {
    const query = "?subscribed_fields=comments,messages";
    try {
      await metaFetch(`/${encodeURIComponent(userId)}/subscribed_apps${query}`, { method: "POST", accessToken });
    } catch (error) {
      if (!(error instanceof MetaApiError) || error.transient) throw error;
      await metaFetch(`/me/subscribed_apps${query}`, { method: "POST", accessToken });
    }
  }

  async hasCommentSubscription(userId: string, accessToken: string) {
    let result: { data?: Array<{ subscribed_fields?: string[] }> };
    try {
      result = await metaFetch(
        `/${encodeURIComponent(userId)}/subscribed_apps`,
        { method: "GET", accessToken },
      );
    } catch (error) {
      if (!(error instanceof MetaApiError) || error.transient) throw error;
      result = await metaFetch("/me/subscribed_apps", { method: "GET", accessToken });
    }
    return (result.data ?? []).some((subscription) =>
      subscription.subscribed_fields?.includes("comments")
      && subscription.subscribed_fields.includes("messages"),
    );
  }

  async listPublishedMedia(_userId: string, accessToken: string) {
    const items: ReturnType<typeof mapPublishedInstagramMediaList> = [];
    // Instagram Login resolves the authenticated professional account through
    // "me". An explicit account ID on graph.instagram.com can be interpreted as
    // an object without the media edge and returns Meta error 2500.
    let path: string | null = `/me/media?fields=${encodeURIComponent(INSTAGRAM_PUBLISHED_MEDIA_FIELDS)}&limit=50`;
    let unversioned = false;
    while (path && items.length < 250) {
      let data: { data: InstagramGraphMediaItem[]; paging?: { next?: string } };
      try {
        data = await metaFetch(path, { accessToken, unversioned });
      } catch (error) {
        if (unversioned || items.length > 0 || !isUnsupportedMediaEdge(error)) throw error;
        unversioned = true;
        try {
          data = await metaFetch(path, { accessToken, unversioned: true });
        } catch (fallbackError) {
          if (!isUnsupportedMediaEdge(fallbackError)) throw fallbackError;
          return listPublishedMediaFromExpandedProfile(accessToken);
        }
      }
      items.push(...mapPublishedInstagramMediaList(data.data));
      path = data.paging?.next ? normalizeMetaPagingPath(data.paging.next, env.META_GRAPH_API_VERSION) : null;
    }
    return items;
  }

  async createReelContainer(userId: string, videoUrl: string, caption: string, accessToken: string) {
    const body = new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
    });
    return metaFetch<{ id: string }>(
      `/${encodeURIComponent(userId)}/media`,
      { method: "POST", accessToken, body, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
  }

  async getMediaContainerStatus(containerId: string, accessToken: string) {
    const data = await metaFetch<{ status_code?: string }>(
      `/${encodeURIComponent(containerId)}?fields=status_code`,
      { accessToken },
    );
    return { statusCode: data.status_code ?? "UNKNOWN" };
  }

  async publishMedia(userId: string, creationId: string, accessToken: string) {
    const body = new URLSearchParams({ creation_id: creationId });
    return metaFetch<{ id: string }>(
      `/${encodeURIComponent(userId)}/media_publish`,
      { method: "POST", accessToken, body, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
  }

  async getMedia(mediaId: string, accessToken: string) {
    const data = await metaFetch<InstagramGraphMediaItem>(
      `/${encodeURIComponent(mediaId)}?fields=${encodeURIComponent(INSTAGRAM_PUBLISHED_MEDIA_FIELDS)}`,
      { accessToken },
    );
    return requireMappedMedia(data);
  }

  async listComments(mediaId: string, accessToken: string, since: Date, limit: number) {
    const items: Array<{ commentId: string; commenterScopedId: string; commenterUsername: string; text: string; publishedAt: string }> = [];
    // Keep this field list identical to Meta's documented request for
    // Instagram API with Instagram Login. The comment ID is returned
    // automatically and some Graph API versions reject extra requested fields.
    let path: string | null = `/${encodeURIComponent(mediaId)}/comments?fields=from%2Ctext&limit=100`;
    while (path && items.length < limit) {
      const data: {
        data: Array<{
          id: string;
          from?: { id?: string; username?: string };
          username?: string;
          text?: string;
          timestamp?: string;
        }>;
        paging?: { next?: string };
      } = await metaFetch(path, { accessToken });
      if (data.data.length === 0 && items.length === 0) {
        const access = await inspectCommentAccess(mediaId, accessToken);
        console.info("Instagram empty comments access diagnostic", {
          commentsCount: access.commentsCount,
          permissionsInspectable: access.grantedPermissions !== null,
          hasBasicPermission: access.grantedPermissions?.includes("instagram_business_basic") ?? null,
          hasManageCommentsPermission: access.grantedPermissions?.includes("instagram_business_manage_comments") ?? null,
        });
        if (
          access.grantedPermissions !== null
          && !access.grantedPermissions.includes("instagram_business_manage_comments")
        ) {
          throw new MetaApiError(
            "O token conectado não possui instagram_business_manage_comments. Reautorize o Instagram e aceite essa permissão.",
            403,
            "MISSING_MANAGE_COMMENTS",
          );
        }
        if (access.commentsCount !== null && access.commentsCount > 0) {
          throw new MetaApiError(
            `A Meta informa ${access.commentsCount} comentário(s) nesta publicação, mas não os disponibilizou para este token.`,
            200,
            "COMMENTS_FILTERED_BY_META",
          );
        }
      }
      let accepted = 0;
      for (const item of data.data) {
        const publishedAt = item.timestamp ?? new Date().toISOString();
        if (new Date(publishedAt) < since) return items;
        if (!item.text) continue;

        // Depending on the Instagram Login response and app access level, Meta
        // may omit the commenter's scoped ID while still returning the username.
        // Keep a stable, non-secret deduplication key instead of silently
        // discarding an otherwise valid comment.
        const commenterUsername = item.from?.username?.trim() || item.username?.trim() || "instagram_user";
        const normalizedUsername = commenterUsername.normalize("NFKC").toLocaleLowerCase("en-US");
        const commenterScopedId = item.from?.id
          ?? (normalizedUsername !== "instagram_user" ? `username:${normalizedUsername}` : `comment:${item.id}`);

        items.push({
          commentId: item.id,
          commenterScopedId,
          commenterUsername,
          text: item.text,
          publishedAt,
        });
        accepted += 1;
        if (items.length >= limit) break;
      }
      console.info("Instagram comments page read", {
        received: data.data.length,
        accepted,
      });
      path = data.paging?.next ? normalizeMetaPagingPath(data.paging.next, env.META_GRAPH_API_VERSION) : null;
    }
    return items;
  }

  async getMediaInsights(mediaId: string, accessToken: string) {
    const names = ["comments", "views", "reach", "shares", "saved", "total_interactions"] as const;
    const read = async (metrics: string) => {
      const path = `/${encodeURIComponent(mediaId)}/insights?metric=${metrics}`;
      const data: { data: Array<{ name: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }> } = await metaFetch(path, { accessToken });
      return Object.fromEntries(data.data.map((metric) => [metric.name, Number(metric.total_value?.value ?? metric.values?.[0]?.value ?? 0)]));
    };
    let raw: Record<string, number>;
    try {
      raw = await read(names.join(","));
    } catch (error) {
      if (!(error instanceof MetaApiError) || error.transient) throw error;
      const results = await Promise.allSettled(names.map(async (name) => [name, (await read(name))[name] ?? 0] as const));
      raw = Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
    }
    return { comments: raw.comments ?? 0, views: raw.views ?? 0, reach: raw.reach ?? 0, shares: raw.shares ?? 0, saved: raw.saved ?? 0, totalInteractions: raw.total_interactions ?? 0, raw };
  }

  replyToComment(commentId: string, message: string, accessToken: string) {
    return metaFetch<{ id: string }>(`/${encodeURIComponent(commentId)}/replies`, { method: "POST", accessToken, body: JSON.stringify({ message }) });
  }

  async sendPrivateReply(userId: string, commentId: string, message: string, accessToken: string, options?: { quickReplies?: Array<{ title: string; payload: string }> }) {
    const quickReplies = buildQuickReplies(options?.quickReplies);
    const data = await metaFetch<{ recipient_id: string; message_id: string }>(
      `/${encodeURIComponent(userId)}/messages`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          recipient: { comment_id: commentId },
          message: quickReplies ? { text: message, quick_replies: quickReplies } : { text: message },
        }),
      },
    );
    return { recipientId: data.recipient_id, messageId: data.message_id };
  }

  async getUserFollowStatus(scopedUserId: string, accessToken: string) {
    const data = await metaFetch<{ is_user_follow_business?: boolean }>(
      `/${encodeURIComponent(scopedUserId)}?fields=is_user_follow_business`,
      { accessToken },
    );
    return data.is_user_follow_business === true;
  }

  async sendTextMessage(instagramUserId: string, recipientId: string, message: string, accessToken: string, options?: { quickReplies?: Array<{ title: string; payload: string }> }) {
    const quickReplies = buildQuickReplies(options?.quickReplies);
    const data = await metaFetch<{ recipient_id: string; message_id: string }>(
      `/${encodeURIComponent(instagramUserId)}/messages`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: quickReplies ? { text: message, quick_replies: quickReplies } : { text: message },
        }),
      },
    );
    return { recipientId: data.recipient_id, messageId: data.message_id };
  }

  async sendButtonTemplateMessage(
    instagramUserId: string,
    recipientId: string,
    message: string,
    buttons: Array<
      | { type: "web_url"; title: string; url: string }
      | { type: "postback"; title: string; payload: string }
    >,
    accessToken: string,
  ) {
    const normalizedButtons: MetaButton[] = buttons
      .map((button) => button.type === "web_url"
        ? { type: "web_url" as const, title: button.title.trim().slice(0, 20), url: button.url }
        : { type: "postback" as const, title: button.title.trim().slice(0, 20), payload: button.payload })
      .filter((button) => button.title)
      .slice(0, 3);
    const data = await metaFetch<{ recipient_id: string; message_id: string }>(
      `/${encodeURIComponent(instagramUserId)}/messages`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: message,
                buttons: normalizedButtons,
              },
            },
          },
        }),
      },
    );
    return { recipientId: data.recipient_id, messageId: data.message_id };
  }

  async listRecentInboundMessages(
    instagramUserId: string,
    scopedUserId: string,
    since: Date,
    accessToken: string,
  ) {
    const conversationQuery = new URLSearchParams({
      user_id: scopedUserId,
      limit: "1",
    });
    const conversations = await metaFetch<{
      data?: Array<{ id: string }>;
    }>(
      `/${encodeURIComponent(instagramUserId)}/conversations?${conversationQuery}`,
      { accessToken },
    );
    const conversationId = conversations.data?.[0]?.id;
    if (!conversationId) return [];

    const fields = encodeURIComponent("messages.limit(20){id,created_time,from,to,message}");
    const conversation = await metaFetch<{
      messages?: {
        data?: Array<{
          id?: string;
          created_time?: string;
          from?: { id?: string };
          message?: string;
        }>;
      };
    }>(
      `/${encodeURIComponent(conversationId)}?fields=${fields}`,
      { accessToken },
    );
    const sinceTime = since.getTime();
    return (conversation.messages?.data ?? [])
      .filter((message) =>
        Boolean(message.id)
        && message.from?.id === scopedUserId
        && Boolean(message.message?.trim())
        && new Date(message.created_time ?? 0).getTime() >= sinceTime,
      )
      .map((message) => ({
        messageId: message.id!,
        text: message.message!.slice(0, 1000),
        createdAt: new Date(message.created_time!).toISOString(),
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}
