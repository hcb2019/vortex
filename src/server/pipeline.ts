import "server-only";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildCaptionWithHashtags,
  buildPipelineKeywordVariants,
  isScheduledForFuture,
  normalizePipelineConversationFlow,
  PIPELINE_VIDEO_BUCKET,
  type PipelinePostInput,
  type PipelineStatus,
} from "@/lib/pipeline";
import { normalizeKeyword, readConversationFlow } from "@/lib/domain";
import { decryptSecret } from "@/server/crypto";
import { instagramGateway } from "@/server/instagram";
import { findOwnedInstagramConnection } from "@/server/instagram/owned-connection";
import { MetaApiError } from "@/server/instagram/meta-gateway";

const VIDEO_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_POLL_ATTEMPTS = 6;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export interface PipelinePostRow {
  id: string;
  owner_id: string;
  connection_id: string | null;
  automation_id: string | null;
  media_id: string | null;
  status: PipelineStatus;
  caption: string;
  hashtags: string[];
  keyword: string;
  keyword_normalized: string;
  deliverable_type: string;
  deliverable_url: string;
  dm_conversation_flow: unknown;
  scheduled_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  video_url: string | null;
  instagram_container_id: string | null;
  instagram_media_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface InstagramConnectionRow {
  id: string;
  owner_id: string;
  instagram_user_id: string;
  token_ciphertext: string;
  token_iv: string;
  token_tag: string;
  status: string;
}

export interface CreatePipelinePostOptions {
  ownerId: string;
  input: PipelinePostInput;
  videoFile?: File;
  videoUrl?: string;
  publishImmediately?: boolean;
  connectionId?: string | null;
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly code = "PIPELINE_ERROR",
    readonly status = 400,
  ) {
    super(message);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFilename(name: string) {
  const clean = name.normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "reel.mp4";
}

function metaErrorCode(error: unknown) {
  if (error instanceof MetaApiError) return error.subcode ? `${error.code ?? error.status}/${error.subcode}` : error.code ?? `HTTP_${error.status}`;
  if (error instanceof PipelineError) return error.code;
  return "PIPELINE_ERROR";
}

function metaErrorMessage(error: unknown) {
  if (error instanceof PipelineError) return error.message;
  if (error instanceof MetaApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Não foi possível concluir a publicação.";
}

async function updatePipelineFailure(postId: string, error: unknown) {
  const supabase = createSupabaseAdminClient();
  await supabase.from("content_pipeline_posts").update({
    status: "failed",
    error_code: metaErrorCode(error).slice(0, 120),
    error_message: metaErrorMessage(error).slice(0, 500),
  }).eq("id", postId);
}

async function uploadVideoForMeta(ownerId: string, postId: string, file: File) {
  if (!file.type.startsWith("video/")) {
    throw new PipelineError("Envie um arquivo de vídeo compatível com Reels.", "INVALID_VIDEO", 422);
  }
  const supabase = createSupabaseAdminClient();
  const storagePath = `${ownerId}/${postId}/${sanitizeFilename(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from(PIPELINE_VIDEO_BUCKET)
    .upload(storagePath, file, { contentType: file.type || "video/mp4", upsert: true });
  if (uploadError) throw new PipelineError("Não foi possível armazenar o vídeo no Supabase Storage.", "VIDEO_UPLOAD_FAILED", 502);
  const { data, error: signedUrlError } = await supabase.storage
    .from(PIPELINE_VIDEO_BUCKET)
    .createSignedUrl(storagePath, VIDEO_SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !data?.signedUrl) {
    throw new PipelineError("Não foi possível gerar uma URL temporária para a Meta.", "VIDEO_SIGNED_URL_FAILED", 502);
  }
  return { storageBucket: PIPELINE_VIDEO_BUCKET, storagePath, videoUrl: data.signedUrl };
}

async function getConnectedInstagramAccount(ownerId: string, connectionId: string | null) {
  const data = await findOwnedInstagramConnection(ownerId, connectionId);
  if (!data || data.status !== "connected") throw new PipelineError("Reconecte o Instagram antes de publicar.", "CONNECTION_UNAVAILABLE", 409);
  return data as InstagramConnectionRow;
}

async function ensureContentPublishPermission(accessToken: string) {
  const permissions = await instagramGateway().listGrantedPermissions(accessToken);
  if (permissions && !permissions.includes("instagram_business_content_publish")) {
    throw new PipelineError(
      "Reconecte o Instagram e aceite a permissão instagram_business_content_publish para publicar Reels pelo Vortex.",
      "MISSING_CONTENT_PUBLISH",
      403,
    );
  }
}

async function loadPipelinePost(postId: string) {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("content_pipeline_posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle();
  if (!data) throw new PipelineError("Publicação não encontrada.", "POST_NOT_FOUND", 404);
  return data as PipelinePostRow;
}

async function updatePostStatus(postId: string, status: PipelineStatus, patch: Record<string, unknown> = {}) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("content_pipeline_posts")
    .update({ status, ...patch })
    .eq("id", postId);
  if (error) throw new PipelineError("Não foi possível atualizar o status do pipeline.", "POST_UPDATE_FAILED", 502);
}

async function upsertPublishedMedia(post: PipelinePostRow, connection: InstagramConnectionRow, accessToken: string) {
  if (!post.instagram_media_id) throw new PipelineError("A Meta não retornou o ID do Reel publicado.", "MISSING_MEDIA_ID", 502);
  const gateway = instagramGateway();
  const media = await gateway.getMedia(post.instagram_media_id, accessToken);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("instagram_media")
    .upsert({
      owner_id: post.owner_id,
      connection_id: connection.id,
      external_id: media.externalId,
      media_product_type: "REELS",
      caption: media.caption,
      permalink: media.permalink,
      thumbnail_url: media.thumbnailUrl,
      published_at: media.publishedAt,
      synced_at: new Date().toISOString(),
    }, { onConflict: "connection_id,external_id" })
    .select("id")
    .single();
  if (error || !data) throw new PipelineError("O Reel foi publicado, mas não foi gravado na lista de mídias.", "MEDIA_SYNC_FAILED", 502);
  return String(data.id);
}

async function createAutomationForPublishedPost(post: PipelinePostRow, connection: InstagramConnectionRow, mediaId: string) {
  if (post.automation_id) return post.automation_id;
  const flow = normalizePipelineConversationFlow(readConversationFlow(post.dm_conversation_flow), post.deliverable_url);
  const publicReplies = [
    "Pronto, enviei o material no seu direct.",
    "Acabei de mandar no direct. Confere lá.",
    "Está no seu direct agora. Depois me conta se chegou.",
  ];
  const dmMessages = ["Como prometido, aqui está o material:"];
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("automations")
    .insert({
      owner_id: post.owner_id,
      connection_id: connection.id,
      media_id: mediaId,
      name: `Novo conteúdo - ${post.keyword}`.slice(0, 80),
      keyword: post.keyword,
      keyword_normalized: post.keyword_normalized,
      keyword_variants: buildPipelineKeywordVariants(post.keyword),
      public_reply: publicReplies[0],
      public_reply_variants: publicReplies,
      dm_message: dmMessages[0],
      dm_message_variants: dmMessages,
      destination_url: post.deliverable_url,
      dm_conversation_flow: flow,
      append_utm_to_buttons: true,
      require_follow: false,
      follow_gate_message: "",
      not_following_message: "",
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) throw new PipelineError("O Reel foi publicado, mas a automação não pôde ser ativada.", "AUTOMATION_CREATE_FAILED", 502);
  return String(data.id);
}

async function publishPostThroughMeta(post: PipelinePostRow, connection: InstagramConnectionRow, accessToken: string, maxStatusChecks: number) {
  if (!post.video_url) throw new PipelineError("Informe uma URL pública ou temporária do vídeo.", "VIDEO_URL_REQUIRED", 422);
  const gateway = instagramGateway();
  let containerId = post.instagram_container_id;
  if (!containerId) {
    const caption = buildCaptionWithHashtags(post.caption, post.hashtags);
    const container = await gateway.createReelContainer(connection.instagram_user_id, post.video_url, caption, accessToken);
    containerId = container.id;
    await updatePostStatus(post.id, "processing", {
      instagram_container_id: containerId,
      connection_id: connection.id,
      error_code: null,
      error_message: null,
    });
  }

  for (let attempt = 0; attempt < maxStatusChecks; attempt += 1) {
    const status = await gateway.getMediaContainerStatus(containerId, accessToken);
    if (status.statusCode === "FINISHED") {
      const media = await gateway.publishMedia(connection.instagram_user_id, containerId, accessToken);
      await updatePostStatus(post.id, "published", {
        instagram_media_id: media.id,
        published_at: new Date().toISOString(),
      });
      return media.id;
    }
    if (status.statusCode === "ERROR" || status.statusCode === "EXPIRED") {
      throw new PipelineError(`A Meta marcou o container como ${status.statusCode}.`, "META_CONTAINER_FAILED", 502);
    }
    if (status.statusCode === "PUBLISHED" && post.instagram_media_id) return post.instagram_media_id;
    if (attempt < maxStatusChecks - 1) await wait(DEFAULT_POLL_INTERVAL_MS);
  }
  return null;
}

export async function createPipelinePost({ ownerId, input, videoFile, videoUrl, publishImmediately = true, connectionId = null }: CreatePipelinePostOptions) {
  if (!videoFile && !videoUrl) throw new PipelineError("Envie um vídeo ou informe uma URL HTTPS do vídeo.", "VIDEO_REQUIRED", 422);
  if (videoUrl) {
    try {
      if (new URL(videoUrl).protocol !== "https:") throw new Error("invalid protocol");
    } catch {
      throw new PipelineError("A URL do vídeo precisa ser HTTPS e acessível pela Meta.", "INVALID_VIDEO_URL", 422);
    }
  }
  const supabase = createSupabaseAdminClient();
  const id = crypto.randomUUID();
  const scheduledForFuture = isScheduledForFuture(input.scheduledAt);
  const connection = await getConnectedInstagramAccount(ownerId, connectionId);
  const { error } = await supabase.from("content_pipeline_posts").insert({
    id,
    owner_id: ownerId,
    connection_id: connection.id,
    status: videoFile ? "uploading" : scheduledForFuture ? "draft" : "processing",
    caption: input.caption,
    hashtags: input.hashtags,
    keyword: input.keyword,
    keyword_normalized: normalizeKeyword(input.keyword),
    deliverable_type: input.deliverableType,
    deliverable_url: input.deliverableUrl,
    dm_conversation_flow: normalizePipelineConversationFlow(input.conversationFlow, input.deliverableUrl),
    scheduled_at: input.scheduledAt,
    source: input.source,
    video_url: videoUrl ?? null,
  });
  if (error) throw new PipelineError("Não foi possível criar o job de publicação.", "POST_CREATE_FAILED", 502);

  try {
    if (videoFile) {
      const upload = await uploadVideoForMeta(ownerId, id, videoFile);
      await updatePostStatus(id, scheduledForFuture ? "draft" : "processing", {
        storage_bucket: upload.storageBucket,
        storage_path: upload.storagePath,
        video_url: upload.videoUrl,
      });
    }
    if (publishImmediately && !scheduledForFuture) {
      return await publishPipelinePost(id);
    }
    return await loadPipelinePost(id);
  } catch (pipelineError) {
    await updatePipelineFailure(id, pipelineError);
    throw pipelineError;
  }
}

export async function publishPipelinePost(postId: string, maxStatusChecks = DEFAULT_POLL_ATTEMPTS) {
  const originalPost = await loadPipelinePost(postId);
  if (originalPost.status === "automation_created") return originalPost;
  if (originalPost.status === "failed") throw new PipelineError("Este job está marcado como falho.", "POST_FAILED", 409);
  if (isScheduledForFuture(originalPost.scheduled_at)) return originalPost;
  const connection = await getConnectedInstagramAccount(originalPost.owner_id, originalPost.connection_id);
  const accessToken = decryptSecret({
    ciphertext: connection.token_ciphertext,
    iv: connection.token_iv,
    tag: connection.token_tag,
  });

  try {
    await ensureContentPublishPermission(accessToken);
    let post = originalPost;
    if (!post.instagram_media_id) {
      const publishedMediaId = await publishPostThroughMeta(post, connection, accessToken, maxStatusChecks);
      if (!publishedMediaId) return await loadPipelinePost(post.id);
      post = { ...post, instagram_media_id: publishedMediaId, status: "published" };
    }
    const mediaId = post.media_id ?? await upsertPublishedMedia(post, connection, accessToken);
    const automationId = await createAutomationForPublishedPost(post, connection, mediaId);
    await updatePostStatus(post.id, "automation_created", {
      media_id: mediaId,
      automation_id: automationId,
      automation_created_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    });
    revalidatePath("/dashboard", "layout");
    return await loadPipelinePost(post.id);
  } catch (error) {
    await updatePipelineFailure(postId, error);
    throw error;
  }
}

export async function processDuePipelinePosts(limit = 5) {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("content_pipeline_posts")
    .select("id")
    .in("status", ["draft", "processing", "published"])
    .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
    .order("updated_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 10));
  let processed = 0;
  let failed = 0;
  for (const item of data ?? []) {
    try {
      await publishPipelinePost(String(item.id), 1);
      processed += 1;
    } catch {
      failed += 1;
    }
  }
  return { pipelineProcessed: processed, pipelineFailed: failed };
}

export function createPipelineApiKeySecret() {
  return `vx_${randomBytes(24).toString("base64url")}`;
}
