import "server-only";
import { contentSuggestionSchema } from "@/lib/audience";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection } from "@/server/data";
import { demoStore } from "@/server/demo-store";
import type { AudienceEvidence, AudienceInsight, AudienceRadarData, AudienceTheme } from "@/types/audience";
import type { InstagramMedia } from "@/types/domain";
import { humanizeText } from "@/lib/humanizer";

export interface AudienceFilters {
  periodDays: 7 | 30 | 90;
  mediaId: string | null;
}

function humanizeContentSuggestion(value: AudienceInsight["contentSuggestion"]) {
  if (!value) return null;
  return {
    ...value,
    hook: humanizeText(value.hook),
    angle: humanizeText(value.angle),
    outline: value.outline.map(humanizeText),
    cta: humanizeText(value.cta),
    publicReply: humanizeText(value.publicReply),
    dmMessage: humanizeText(value.dmMessage),
  };
}

function humanizeInsight(insight: AudienceInsight): AudienceInsight {
  return {
    ...insight,
    title: humanizeText(insight.title),
    summary: humanizeText(insight.summary),
    recommendation: humanizeText(insight.recommendation),
    contentSuggestion: humanizeContentSuggestion(insight.contentSuggestion),
  };
}

function filterDemoRadar(filters: AudienceFilters): AudienceRadarData {
  const source = demoStore().audience;
  const since = Date.now() - filters.periodDays * 86_400_000;
  const includeEvidence = (item: AudienceEvidence) => new Date(item.publishedAt).getTime() >= since && (!filters.mediaId || item.mediaId === filters.mediaId);
  const insights = source.insights.map((insight) => {
    const evidence = insight.evidence.filter(includeEvidence);
    return humanizeInsight({ ...insight, evidence, evidenceCount: evidence.length, isEarlySignal: evidence.length < 2 });
  }).filter(({ evidenceCount }) => evidenceCount > 0);
  const factor = filters.periodDays === 7 ? 0.42 : filters.periodDays === 90 ? 1.34 : 1;
  const themes = source.themes.map((theme) => {
    const evidence = theme.evidence.filter(includeEvidence);
    return { ...theme, label: humanizeText(theme.label), summary: humanizeText(theme.summary), evidence, volume: Math.max(evidence.length, Math.round(theme.volume * factor)) };
  }).filter(({ evidence }) => evidence.length > 0);
  return {
    metrics: {
      analyzedComments: Math.round(source.metrics.analyzedComments * factor),
      openQuestions: insights.filter(({ category }) => category === "question").reduce((sum, item) => sum + item.evidenceCount, 0),
      purchaseIntent: insights.filter(({ category }) => category === "purchase_intent").reduce((sum, item) => sum + item.evidenceCount, 0),
      contentRequests: insights.filter(({ category }) => category === "content_request").reduce((sum, item) => sum + item.evidenceCount, 0),
      objections: insights.filter(({ category }) => category === "objection").reduce((sum, item) => sum + item.evidenceCount, 0),
      lastUpdatedAt: source.metrics.lastUpdatedAt,
    },
    themes,
    insights,
    ideas: insights.filter(({ contentSuggestion }) => contentSuggestion),
    latestRun: source.latestRun ? { ...source.latestRun, periodDays: filters.periodDays } : null,
  };
}

export async function getAudienceRadarData(filters: AudienceFilters): Promise<AudienceRadarData> {
  if (isDemoMode) return filterDemoRadar(filters);
  const supabase = await createSupabaseServerClient();
  const connection = await getConnection();
  if (!connection) return { metrics: { analyzedComments: 0, openQuestions: 0, purchaseIntent: 0, contentRequests: 0, objections: 0, lastUpdatedAt: null }, themes: [], insights: [], ideas: [], latestRun: null };
  const since = new Date(Date.now() - filters.periodDays * 86_400_000).toISOString();
  const { data: mediaRows } = await supabase.from("instagram_media").select("id,external_id,caption").eq("connection_id", connection.id);
  const media = (mediaRows ?? []) as Array<{ id: string; external_id: string; caption: string }>;
  const selected = filters.mediaId ? media.find(({ id }) => id === filters.mediaId) : null;

  let runQuery = supabase.from("audience_analysis_runs").select("*").eq("period_days", filters.periodDays).eq("connection_id", connection.id).order("created_at", { ascending: false }).limit(1);
  runQuery = filters.mediaId ? runQuery.eq("media_id", filters.mediaId) : runQuery.is("media_id", null);
  const { data: runRows } = await runQuery;
  const run = runRows?.[0] ?? null;

  let eventQuery = supabase.from("comment_events").select("id,comment_text,commenter_username,published_at,media_external_id").eq("connection_id", connection.id).gte("published_at", since).limit(2000);
  if (selected) eventQuery = eventQuery.eq("media_external_id", selected.external_id);
  const { data: eventRows } = await eventQuery;
  const events = (eventRows ?? []) as Array<{ id: string; comment_text: string; commenter_username: string; published_at: string; media_external_id: string }>;
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const mediaByExternal = new Map(media.map((item) => [item.external_id, item]));

  if (!run) return { metrics: { analyzedComments: 0, openQuestions: 0, purchaseIntent: 0, contentRequests: 0, objections: 0, lastUpdatedAt: null }, themes: [], insights: [], ideas: [], latestRun: null };
  const [{ data: classificationRows }, { data: insightRows }] = await Promise.all([
    supabase.from("comment_classifications").select("*").eq("analysis_run_id", run.id),
    supabase.from("audience_insights").select("*").eq("analysis_run_id", run.id).order("priority", { ascending: false }),
  ]);
  const classifications = (classificationRows ?? []) as Array<{ comment_event_id: string; category: AudienceInsight["category"]; confidence: number; theme: string }>;

  const toEvidence = (id: string): AudienceEvidence | null => {
    const event = eventMap.get(id);
    if (!event) return null;
    const reel = mediaByExternal.get(event.media_external_id);
    return { id: event.id, text: event.comment_text, username: event.commenter_username, mediaId: reel?.id ?? "", mediaCaption: reel?.caption ?? "Reel", publishedAt: event.published_at };
  };
  const insights: AudienceInsight[] = ((insightRows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const evidence = ((row.evidence_ids as string[] | null) ?? []).map(toEvidence).filter((item): item is AudienceEvidence => Boolean(item));
    const suggestion = contentSuggestionSchema.safeParse(row.content_suggestion);
    return {
      id: String(row.id), category: row.category as AudienceInsight["category"], title: humanizeText(String(row.title)), summary: humanizeText(String(row.summary)), recommendation: humanizeText(String(row.recommendation)), confidence: Number(row.confidence), evidenceCount: evidence.length, isEarlySignal: evidence.length < 2, status: row.status as AudienceInsight["status"], feedback: row.feedback as AudienceInsight["feedback"], priority: Number(row.priority), mediaIds: (row.media_ids as string[] | null) ?? [], evidence, contentSuggestion: suggestion.success ? humanizeContentSuggestion(suggestion.data) : null, createdAutomationId: row.created_automation_id ? String(row.created_automation_id) : null, createdAt: String(row.created_at),
    };
  });

  const grouped = Map.groupBy(classifications.filter(({ category }) => category !== "irrelevant"), ({ theme }) => theme);
  const themes: AudienceTheme[] = Array.from(grouped, ([label, items], index) => {
    const evidence = items.map(({ comment_event_id }) => toEvidence(comment_event_id)).filter((item): item is AudienceEvidence => Boolean(item)).slice(0, 3);
    const relatedMediaIds = [...new Set(evidence.map(({ mediaId }) => mediaId).filter(Boolean))];
    return { id: `theme-${index}-${label}`, label: humanizeText(label), summary: insights.find((insight) => insight.evidence.some(({ id }) => items.some(({ comment_event_id }) => comment_event_id === id)))?.summary ?? "Esse assunto apareceu várias vezes nos comentários.", volume: items.length, share: classifications.length ? items.length / classifications.length : 0, trend: 0, confidence: items.reduce((sum, item) => sum + Number(item.confidence), 0) / items.length, relatedMediaIds, evidence };
  }).sort((a, b) => b.volume - a.volume);
  const count = (category: AudienceInsight["category"]) => classifications.filter((item) => item.category === category).length;
  return {
    metrics: { analyzedComments: classifications.length, openQuestions: count("question"), purchaseIntent: count("purchase_intent"), contentRequests: count("content_request"), objections: count("objection"), lastUpdatedAt: run.completed_at ?? run.created_at },
    themes,
    insights,
    ideas: insights.filter(({ contentSuggestion }) => contentSuggestion),
    latestRun: { id: run.id, status: run.status, model: run.model, promptVersion: run.prompt_version, periodDays: run.period_days, commentCount: run.comment_count, inputTokens: run.input_tokens, outputTokens: run.output_tokens, durationMs: run.duration_ms, createdAt: run.created_at, completedAt: run.completed_at },
  };
}

export async function getAudienceMedia(): Promise<InstagramMedia[]> {
  const { listMedia } = await import("@/server/data");
  return listMedia();
}
