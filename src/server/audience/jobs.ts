import "server-only";
import { anonymizeAudienceComments, audienceFingerprint, chunkAudienceComments } from "@/lib/audience";
import { env, isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { audienceIntelligenceProvider } from "@/server/audience";
import type { AudienceProviderResult } from "@/types/audience";

const PROMPT_VERSION = "audience-v2-humanizer";

export async function queueAudienceAnalysis(ownerId: string, periodDays: 7 | 30 | 90, mediaId: string | null, connectionId?: string | null) {
  if (isDemoMode) return { id: "70000000-0000-4000-8000-000000000001", outcome: "queued" as const };
  const supabase = createSupabaseAdminClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { count: dailyCount } = await supabase.from("audience_analysis_runs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).gte("created_at", today.toISOString());
  if ((dailyCount ?? 0) >= env.AI_MAX_DAILY_RUNS) return { id: null, outcome: "daily_limit" as const };

  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();
  let mediaExternalId: string | null = null;
  if (mediaId) {
    let mediaQuery = supabase.from("instagram_media").select("external_id,connection_id").eq("id", mediaId).eq("owner_id", ownerId);
    if (connectionId) mediaQuery = mediaQuery.eq("connection_id", connectionId);
    const { data: media } = await mediaQuery.maybeSingle();
    if (!media) return { id: null, outcome: "invalid_media" as const };
    mediaExternalId = media.external_id;
    connectionId ??= media.connection_id;
  }
  let query = supabase.from("comment_events").select("id,comment_text,published_at").eq("owner_id", ownerId).gte("published_at", since).order("published_at", { ascending: false }).limit(env.AI_MAX_COMMENTS_PER_RUN);
  if (connectionId) query = query.eq("connection_id", connectionId);
  if (mediaExternalId) query = query.eq("media_external_id", mediaExternalId);
  const { data: comments, error } = await query;
  if (error) throw new Error("Não foi possível preparar a análise.");
  if (!comments?.length) return { id: null, outcome: "no_comments" as const };
  const fingerprint = audienceFingerprint(comments.map((item) => ({ id: item.id, text: item.comment_text, publishedAt: item.published_at })), periodDays, mediaId, PROMPT_VERSION, connectionId ?? "");
  const { data: existing } = await supabase.from("audience_analysis_runs").select("id,status").eq("owner_id", ownerId).eq("fingerprint", fingerprint).maybeSingle();
  if (existing) return { id: existing.id, outcome: "duplicate" as const };
  const { data: run, error: insertError } = await supabase.from("audience_analysis_runs").insert({ owner_id: ownerId, connection_id: connectionId, media_id: mediaId, period_days: periodDays, model: env.OPENAI_AUDIENCE_MODEL, prompt_version: PROMPT_VERSION, fingerprint, comment_count: comments.length, status: "queued" }).select("id").single();
  if (insertError || !run) throw new Error("Não foi possível criar a análise.");
  const { error: queueError } = await supabase.rpc("enqueue_audience_analysis", { run_id: run.id });
  if (queueError) {
    await supabase.from("audience_analysis_runs").update({ status: "failed", error_code: "QUEUE_FAILED", error_message: "Não foi possível enfileirar a análise.", completed_at: new Date().toISOString() }).eq("id", run.id);
    throw new Error("Não foi possível enfileirar a análise.");
  }
  await supabase.from("comment_events").update({ analysis_status: "queued" }).in("id", comments.map(({ id }) => id));
  return { id: run.id, outcome: "queued" as const };
}

export async function processAudienceQueueBatch(batchSize = 2) {
  if (isDemoMode) return { processed: 0 };
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("claim_audience_analysis_batch", { batch_size: Math.min(Math.max(batchSize, 1), 5) });
  if (error) throw new Error("Falha ao consumir a fila de análise.");
  const messages = (data ?? []) as Array<{ msg_id: number; run_id: string }>;
  let processed = 0;
  for (const message of messages) {
    try {
      await processAudienceRun(message.run_id);
      await supabase.rpc("complete_audience_analysis_message", { queue_message_id: message.msg_id });
      processed += 1;
    } catch {
      // O visibility timeout libera a mensagem para recuperação posterior.
    }
  }
  return { processed };
}

export async function queueScheduledAudienceAnalyses(minimumPending = 20) {
  if (isDemoMode || !env.OPENAI_API_KEY) return { queued: 0 };
  const supabase = createSupabaseAdminClient();
  const { data: connections } = await supabase.from("instagram_connections").select("id,owner_id").eq("status", "connected");
  let queued = 0;
  for (const connection of connections ?? []) {
    const { count } = await supabase.from("comment_events").select("id", { count: "exact", head: true }).eq("connection_id", connection.id).in("analysis_status", ["pending", "failed"]);
    if ((count ?? 0) < minimumPending) continue;
    const result = await queueAudienceAnalysis(connection.owner_id, 30, null, connection.id);
    if (result.outcome === "queued") queued += 1;
  }
  return { queued };
}

async function processAudienceRun(runId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: run } = await supabase.from("audience_analysis_runs").select("*").eq("id", runId).single();
  if (!run || ["succeeded", "failed", "skipped"].includes(run.status)) return;
  const startedAt = Date.now();
  await supabase.from("audience_analysis_runs").update({ status: "running", started_at: new Date().toISOString(), error_code: null, error_message: null }).eq("id", runId);
  try {
    const since = new Date(Date.now() - run.period_days * 86_400_000).toISOString();
    let mediaExternalId: string | null = null;
    if (run.media_id) {
      const { data: selectedMedia } = await supabase.from("instagram_media").select("external_id").eq("id", run.media_id).single();
      mediaExternalId = selectedMedia?.external_id ?? null;
    }
    let mediaQuery = supabase.from("instagram_media").select("id,external_id,caption").eq("owner_id", run.owner_id);
    if (run.connection_id) mediaQuery = mediaQuery.eq("connection_id", run.connection_id);
    const { data: mediaRows } = await mediaQuery;
    const mediaByExternal = new Map((mediaRows ?? []).map((item) => [item.external_id, item]));
    let query = supabase.from("comment_events").select("id,comment_text,published_at,media_external_id").eq("owner_id", run.owner_id).gte("published_at", since).order("published_at", { ascending: false }).limit(env.AI_MAX_COMMENTS_PER_RUN);
    if (run.connection_id) query = query.eq("connection_id", run.connection_id);
    if (mediaExternalId) query = query.eq("media_external_id", mediaExternalId);
    const { data: commentRows } = await query;
    const comments = commentRows ?? [];
    if (!comments.length) {
      await supabase.from("audience_analysis_runs").update({ status: "skipped", comment_count: 0, duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString() }).eq("id", runId);
      return;
    }
    const provider = audienceIntelligenceProvider();
    const batches = chunkAudienceComments(comments, 100);
    const aliasToComment = new Map<string, (typeof comments)[number]>();
    const results: AudienceProviderResult[] = [];
    for (const [batchIndex, batch] of batches.entries()) {
      const anonymous = anonymizeAudienceComments(batch.map((comment) => ({ text: comment.comment_text, mediaCaption: mediaByExternal.get(comment.media_external_id)?.caption ?? "Reel", publishedAt: comment.published_at })), batchIndex * 100);
      anonymous.forEach((item, index) => { const source = batch[index]; if (source) aliasToComment.set(item.alias, source); });
      results.push(await provider.analyze({ comments: anonymous, periodDays: run.period_days, context: { analyzedComments: comments.length, reelCount: new Set(comments.map(({ media_external_id }) => media_external_id)).size } }));
    }
    const synthesis = await provider.synthesize({ results, periodDays: run.period_days });
    const classifications = results.flatMap(({ classifications }) => classifications).flatMap((classification) => {
      const source = aliasToComment.get(classification.alias);
      return source ? [{ owner_id: run.owner_id, analysis_run_id: runId, comment_event_id: source.id, category: classification.category, sentiment: classification.sentiment, urgency: classification.urgency, confidence: classification.confidence, theme: classification.theme, opportunity: classification.opportunity }] : [];
    });
    if (classifications.length) {
      const { error: classificationError } = await supabase.from("comment_classifications").insert(classifications);
      if (classificationError) throw new Error("Falha ao persistir classificações.");
    }
    const insightRows = synthesis.insights.flatMap((insight) => {
      const evidence = insight.evidenceAliases.map((alias) => aliasToComment.get(alias)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (!evidence.length) return [];
      const mediaIds = [...new Set(evidence.map(({ media_external_id }) => mediaByExternal.get(media_external_id)?.id).filter((id): id is string => Boolean(id)))];
      return [{ owner_id: run.owner_id, analysis_run_id: runId, category: insight.category, title: insight.title, summary: insight.summary, recommendation: insight.recommendation, confidence: insight.confidence, priority: insight.priority, evidence_ids: evidence.slice(0, 5).map(({ id }) => id), media_ids: mediaIds, content_suggestion: insight.suggestion }];
    });
    if (insightRows.length) {
      const { error: insightError } = await supabase.from("audience_insights").insert(insightRows);
      if (insightError) throw new Error("Falha ao persistir insights.");
    }
    const inputTokens = results.reduce((sum, result) => sum + result.usage.inputTokens, synthesis.usage.inputTokens);
    const outputTokens = results.reduce((sum, result) => sum + result.usage.outputTokens, synthesis.usage.outputTokens);
    const completedAt = new Date().toISOString();
    await Promise.all([
      supabase.from("audience_analysis_runs").update({ status: "succeeded", comment_count: comments.length, input_tokens: inputTokens, output_tokens: outputTokens, duration_ms: Date.now() - startedAt, completed_at: completedAt }).eq("id", runId),
      supabase.from("comment_events").update({ analysis_status: "analyzed" }).in("id", comments.map(({ id }) => id)),
    ]);
  } catch {
    await supabase.from("audience_analysis_runs").update({ status: "failed", error_code: "ANALYSIS_FAILED", error_message: "A análise não pôde ser concluída. Consulte os logs operacionais.", duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString() }).eq("id", runId);
  }
}
