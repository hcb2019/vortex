"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audienceFeedbackSchema, audiencePeriodSchema, audienceStatusSchema, contentSuggestionSchema } from "@/lib/audience";
import { DEFAULT_FOLLOW_GATE_MESSAGE, DEFAULT_NOT_FOLLOWING_MESSAGE, normalizeKeyword } from "@/lib/domain";
import { requireOwner } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { processAudienceQueueBatch, queueAudienceAnalysis } from "@/server/audience/jobs";
import { getConnection } from "@/server/data";
import { demoStore, saveDemoAutomation } from "@/server/demo-store";

export async function requestAudienceAnalysis(formData: FormData) {
  const owner = await requireOwner();
  const period = audiencePeriodSchema.safeParse(formData.get("period"));
  const mediaValue = String(formData.get("mediaId") ?? "");
  const mediaId = mediaValue || null;
  if (!period.success || (mediaId && !/^[0-9a-f-]{36}$/i.test(mediaId))) redirect("/radar?analysis=invalid");
  if (isDemoMode) {
    const state = demoStore().audience;
    const timestamp = new Date().toISOString();
    if (state.latestRun) { state.latestRun = { ...state.latestRun, periodDays: period.data, status: "succeeded", createdAt: timestamp, completedAt: timestamp, durationMs: 940 }; }
    state.metrics.lastUpdatedAt = timestamp;
    revalidatePath("/radar");
    redirect(`/radar?period=${period.data}&analysis=ready${mediaId ? `&media=${mediaId}` : ""}`);
  }
  const connection = await getConnection();
  const result = await queueAudienceAnalysis(owner.id, period.data, mediaId, connection?.id);
  if (result.outcome === "queued") after(() => processAudienceQueueBatch(1));
  revalidatePath("/radar");
  redirect(`/radar?period=${period.data}&analysis=${result.outcome}${mediaId ? `&media=${mediaId}` : ""}`);
}

export async function updateInsight(formData: FormData) {
  const owner = await requireOwner();
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const status = audienceStatusSchema.safeParse(formData.get("status"));
  const feedback = audienceFeedbackSchema.safeParse(formData.get("feedback"));
  if (!status.success && !feedback.success) return;
  if (isDemoMode) {
    const insight = demoStore().audience.insights.find((item) => item.id === id);
    if (insight) { if (status.success) insight.status = status.data; if (feedback.success) insight.feedback = feedback.data; }
  } else {
    const supabase = await createSupabaseServerClient();
    const payload = { ...(status.success ? { status: status.data } : {}), ...(feedback.success ? { feedback: feedback.data } : {}) };
    await supabase.from("audience_insights").update(payload).eq("id", id).eq("owner_id", owner.id);
  }
  revalidatePath("/radar");
  revalidatePath("/dashboard");
}

export async function createAutomationFromInsight(formData: FormData) {
  const owner = await requireOwner();
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  if (isDemoMode) {
    const insight = demoStore().audience.insights.find((item) => item.id === id);
    const suggestion = insight?.contentSuggestion;
    if (!insight || !suggestion) return;
    if (insight.createdAutomationId) redirect(`/automations/${insight.createdAutomationId}/edit?source=radar`);
    const saved = saveDemoAutomation({
      name: `Radar — ${insight.title}`.slice(0, 80),
      mediaId: insight.mediaIds[0] ?? "",
      keyword: suggestion.keyword,
      keywordVariants: [],
      publicReply: suggestion.publicReply,
      publicReplyVariants: [suggestion.publicReply, "", ""],
      dmMessage: suggestion.dmMessage,
      dmMessageVariants: [suggestion.dmMessage],
      destinationUrl: "",
      conversationFlow: { steps: [] },
      appendUtmToButtons: true,
      requireFollow: false,
      followGateMessage: DEFAULT_FOLLOW_GATE_MESSAGE,
      notFollowingMessage: DEFAULT_NOT_FOLLOWING_MESSAGE,
      status: "draft",
    });
    insight.status = "converted"; insight.createdAutomationId = saved.id;
    revalidatePath("/dashboard", "layout");
    redirect(`/automations/${saved.id}/edit?source=radar`);
  }
  const supabase = await createSupabaseServerClient();
  const { data: insight } = await supabase.from("audience_insights").select("*").eq("id", id).eq("owner_id", owner.id).single();
  if (insight?.created_automation_id) redirect(`/automations/${insight.created_automation_id}/edit?source=radar`);
  const parsedSuggestion = contentSuggestionSchema.safeParse(insight?.content_suggestion);
  if (!insight || !parsedSuggestion.success) return;
  const suggestion = parsedSuggestion.data;
  const mediaId = (insight.media_ids as string[] | null)?.[0] ?? null;
  const connection = await getConnection();
  if (!connection) return;
  const keywordNormalized = normalizeKeyword(suggestion.keyword);
  let existingQuery = supabase.from("automations").select("id").eq("connection_id", connection.id).eq("keyword_normalized", keywordNormalized).is("deleted_at", null);
  existingQuery = mediaId ? existingQuery.eq("media_id", mediaId) : existingQuery.is("media_id", null);
  let { data: automation } = await existingQuery.maybeSingle();
  if (!automation) {
    const result = await supabase.from("automations").insert({ owner_id: owner.id, connection_id: connection.id, media_id: mediaId, name: `Radar — ${insight.title}`.slice(0, 80), keyword: suggestion.keyword, keyword_normalized: keywordNormalized, public_reply: suggestion.publicReply, dm_message: suggestion.dmMessage, destination_url: "", status: "draft" }).select("id").single();
    automation = result.data;
  }
  if (!automation) return;
  await supabase.from("audience_insights").update({ status: "converted", created_automation_id: automation.id }).eq("id", id).eq("owner_id", owner.id);
  revalidatePath("/dashboard", "layout");
  redirect(`/automations/${automation.id}/edit?source=radar`);
}
