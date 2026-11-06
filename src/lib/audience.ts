import { createHash } from "node:crypto";
import { z } from "zod";
import { audienceCategories, type AnonymousAudienceComment, type AudienceProviderResult } from "@/types/audience";

export const audiencePeriodSchema = z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]));
export const audienceCategorySchema = z.enum(audienceCategories);
export const audienceStatusSchema = z.enum(["new", "reviewed", "converted", "dismissed"]);
export const audienceFeedbackSchema = z.enum(["useful", "not_useful"]);

export const contentSuggestionSchema = z.object({
  hook: z.string().trim().min(1).max(180),
  angle: z.string().trim().min(1).max(500),
  outline: z.array(z.string().trim().min(1).max(240)).min(2).max(6),
  cta: z.string().trim().min(1).max(240),
  keyword: z.string().trim().min(1).max(80),
  publicReply: z.string().trim().min(1).max(500),
  dmMessage: z.string().trim().min(1).max(900),
});

export const audienceInsightOutputSchema = z.object({
  category: audienceCategorySchema,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  recommendation: z.string().trim().min(1).max(700),
  confidence: z.number().min(0).max(1),
  evidenceAliases: z.array(z.string().regex(/^C\d{4}$/)).min(1).max(5),
  priority: z.number().int().min(1).max(100),
  suggestion: contentSuggestionSchema.nullable(),
});

export const audienceModelOutputSchema = z.object({
  classifications: z.array(z.object({
    alias: z.string().regex(/^C\d{4}$/),
    category: audienceCategorySchema,
    sentiment: z.enum(["positive", "neutral", "negative"]),
    urgency: z.number().int().min(1).max(5),
    confidence: z.number().min(0).max(1),
    theme: z.string().trim().min(1).max(100),
    opportunity: z.string().trim().max(500),
  })).max(100),
  insights: z.array(audienceInsightOutputSchema).max(20),
});

export const audienceSynthesisSchema = z.object({ insights: z.array(audienceInsightOutputSchema).max(20) });

export const providerResultSchema: z.ZodType<AudienceProviderResult> = audienceModelOutputSchema.extend({
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
});

export function anonymizeAudienceComments(comments: Array<{ text: string; mediaCaption: string; publishedAt: string }>, offset = 0): AnonymousAudienceComment[] {
  return comments.slice(0, 100).map((comment, index) => ({
    alias: `C${String(offset + index + 1).padStart(4, "0")}`,
    text: comment.text.slice(0, 2200),
    mediaCaption: comment.mediaCaption.slice(0, 500),
    publishedAt: comment.publishedAt,
  }));
}

export function chunkAudienceComments<T>(items: T[], size = 100) {
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error("Lote deve conter entre 1 e 100 comentários.");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export function audienceFingerprint(comments: Array<{ id: string; text: string; publishedAt: string }>, periodDays: number, mediaId: string | null, promptVersion = "", connectionId = "") {
  const stable = comments
    .map(({ id, text, publishedAt }) => `${id}\u0000${text}\u0000${publishedAt}`)
    .sort()
    .join("\u0001");
  return createHash("sha256").update(`${promptVersion}\u0000${periodDays}\u0000${mediaId ?? "all"}\u0000${connectionId}\u0000${stable}`).digest("hex");
}

export function confidenceLabel(value: number) {
  if (value >= 0.8) return "Confiança alta";
  if (value >= 0.6) return "Confiança média";
  return "Sinal inicial";
}

export function categoryLabel(category: (typeof audienceCategories)[number]) {
  return {
    purchase_intent: "Intenção de compra",
    question: "Dúvida",
    objection: "Objeção",
    content_request: "Pedido de conteúdo",
    support: "Suporte",
    praise: "Elogio",
    irrelevant: "Irrelevante",
  }[category];
}
