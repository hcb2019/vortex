import "server-only";
import { requireOwner } from "@/lib/auth";
import { INSTAGRAM_TREND_LIMIT, type StudioIdea, type StudioIdeaSignals } from "@/lib/studio-ideas";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAudienceRadarData } from "@/server/audience/data";
import { getCreatorProfile } from "@/server/content-studio/data";
import { ContentStudioProvider } from "@/server/content-studio/provider";
import { demoStore } from "@/server/demo-store";
import { getConnection, listMedia } from "@/server/data";
import type { InstagramMedia } from "@/types/domain";

async function listOwnReelsWithInsights(): Promise<{ connected: boolean; media: InstagramMedia[] }> {
  const owner = await requireOwner();
  if (isDemoMode) {
    return {
      connected: true,
      media: demoStore().media.map((item, index) => ({
        ...item,
        insights: {
          comments: 64 - index * 11,
          views: 18200 - index * 3100,
          reach: 13900 - index * 2200,
          shares: 312 - index * 48,
          saved: 528 - index * 73,
          totalInteractions: 1840 - index * 260,
        },
      })),
    };
  }

  const supabase = await createSupabaseServerClient();
  const connection = await getConnection();
  const media = await listMedia(connection?.id);
  if (!connection || connection.status === "disconnected") return { connected: false, media };

  const { data: snapshots } = await supabase
    .from("media_insight_snapshots")
    .select("media_id,comments,views,shares,saved,captured_on")
    .eq("owner_id", owner.id)
    .order("captured_on", { ascending: false });

  const latest = new Map<string, { comments: number; views: number; shares: number; saved: number }>();
  for (const row of snapshots ?? []) {
    const mediaId = String(row.media_id);
    if (latest.has(mediaId)) continue;
    latest.set(mediaId, {
      comments: Number(row.comments ?? 0),
      views: Number(row.views ?? 0),
      shares: Number(row.shares ?? 0),
      saved: Number(row.saved ?? 0),
    });
  }

  return {
    connected: true,
    media: media.map((item) => {
      const insight = latest.get(item.id);
      return insight ? { ...item, insights: { ...insight, reach: 0, totalInteractions: insight.comments + insight.shares + insight.saved } } : item;
    }),
  };
}

export async function getStudioIdeaSignals(): Promise<StudioIdeaSignals> {
  const [{ connected, media }, radar] = await Promise.all([
    listOwnReelsWithInsights(),
    getAudienceRadarData({ periodDays: 30, mediaId: null }),
  ]);
  const ranked = [...media].sort((left, right) => {
    const leftScore = (left.insights?.saved ?? 0) * 3 + (left.insights?.comments ?? 0) * 2 + (left.insights?.views ?? 0) / 100;
    const rightScore = (right.insights?.saved ?? 0) * 3 + (right.insights?.comments ?? 0) * 2 + (right.insights?.views ?? 0) / 100;
    return rightScore - leftScore;
  });
  return {
    connected,
    reels: ranked.slice(0, 8).map((item) => ({
      caption: item.caption.slice(0, 220),
      views: item.insights?.views ?? 0,
      comments: item.insights?.comments ?? 0,
      saved: item.insights?.saved ?? 0,
      shares: item.insights?.shares ?? 0,
      publishedAt: item.publishedAt,
    })),
    audienceThemes: radar.themes.slice(0, 6).map((theme) => theme.label),
    audienceRequests: radar.insights
      .filter((insight) => insight.category === "content_request" || insight.category === "question")
      .slice(0, 6)
      .map((insight) => insight.title),
    limitNote: INSTAGRAM_TREND_LIMIT,
  };
}

export async function generateStudioIdeas(): Promise<{ ideas: StudioIdea[]; limitNote: string; connected: boolean }> {
  const [signals, profile] = await Promise.all([getStudioIdeaSignals(), getCreatorProfile()]);
  const result = await new ContentStudioProvider().generateIdeas(profile, signals);
  return { ...result, connected: signals.connected };
}
