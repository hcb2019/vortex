import { getOwner } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pipelinePostInputSchema } from "@/lib/pipeline";
import { hashPipelineApiKey } from "@/server/crypto";
import { findOwnedInstagramConnection } from "@/server/instagram/owned-connection";
import { createPipelinePost, PipelineError } from "@/server/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

function readFormHashtags(formData: FormData) {
  const repeated = formData.getAll("hashtags").flatMap((value) => String(value).split(","));
  const indexed = Array.from({ length: 5 }, (_, index) => readString(formData.get(`hashtag${index + 1}`)));
  return [...repeated, ...indexed].map((item) => item.trim()).filter(Boolean);
}

function parseJsonObject(value: string) {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

async function authenticate(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer) {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("pipeline_api_keys")
      .select("id,owner_id")
      .eq("key_hash", hashPipelineApiKey(bearer))
      .is("revoked_at", null)
      .maybeSingle();
    if (!data) return null;
    await supabase.from("pipeline_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return { ownerId: String(data.owner_id), source: "api" as const };
  }
  const owner = await getOwner();
  return owner ? { ownerId: owner.id, source: "ui" as const } : null;
}

async function readMultipartRequest(request: Request, source: "ui" | "api") {
  const formData = await request.formData();
  const rawConversationFlow = readString(formData.get("conversationFlow"));
  const conversationFlow = rawConversationFlow ? parseJsonObject(rawConversationFlow) : { steps: [] };
  const videoValue = formData.get("videoFile");
  const videoFile = videoValue instanceof File && videoValue.size > 0 ? videoValue : undefined;
  const parsed = pipelinePostInputSchema.safeParse({
    caption: readString(formData.get("caption")),
    hashtags: readFormHashtags(formData),
    keyword: readString(formData.get("keyword")),
    deliverableType: readString(formData.get("deliverableType")) || "prompt",
    deliverableUrl: readString(formData.get("deliverableUrl")),
    conversationFlow,
    scheduledAt: readString(formData.get("scheduledAt")) || null,
    source,
  });
  return {
    parsed,
    videoFile,
    videoUrl: readString(formData.get("videoUrl")) || undefined,
  };
}

async function readJsonRequest(request: Request, source: "ui" | "api") {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const rawHashtags = Array.isArray(body.hashtags)
    ? body.hashtags.map(String)
    : typeof body.hashtags === "string"
      ? body.hashtags.split(",")
      : [];
  const parsed = pipelinePostInputSchema.safeParse({
    caption: String(body.caption ?? ""),
    hashtags: rawHashtags,
    keyword: String(body.keyword ?? ""),
    deliverableType: String(body.deliverableType ?? "prompt"),
    deliverableUrl: String(body.deliverableUrl ?? ""),
    conversationFlow: body.conversationFlow ?? { steps: [] },
    scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : null,
    source,
  });
  return {
    parsed,
    videoFile: undefined,
    videoUrl: typeof body.videoUrl === "string" ? body.videoUrl : undefined,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof PipelineError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return Response.json({ error: "Não foi possível iniciar o pipeline de publicação.", code: "PIPELINE_ERROR" }, { status: 500 });
}

export async function POST(request: Request) {
  if (isDemoMode) return Response.json({ error: "O modo demonstração não publica Reels." }, { status: 403 });
  const auth = await authenticate(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const { parsed, videoFile, videoUrl } = contentType.includes("multipart/form-data")
      ? await readMultipartRequest(request, auth.source)
      : await readJsonRequest(request, auth.source);
    if (!parsed.success) {
      return Response.json({
        error: "Revise os campos enviados.",
        fields: parsed.error.flatten().fieldErrors,
      }, { status: 422 });
    }
    const selected = auth.source === "ui" ? await findOwnedInstagramConnection(auth.ownerId) : null;
    const post = await createPipelinePost({
      ownerId: auth.ownerId,
      input: parsed.data,
      videoFile,
      videoUrl,
      connectionId: selected?.id,
    });
    return Response.json({
      id: post.id,
      status: post.status,
      automationId: post.automation_id,
      mediaId: post.media_id,
      instagramMediaId: post.instagram_media_id,
      scheduledAt: post.scheduled_at,
      errorCode: post.error_code,
      errorMessage: post.error_message,
    }, { status: post.status === "failed" ? 502 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
