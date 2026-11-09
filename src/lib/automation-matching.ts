import { buildKeywordVariants, keywordMatches } from "@/lib/domain";

export interface AutomationKeywordCandidate {
  id: string;
  keyword: string;
  mediaId?: string | null;
  media_id?: string | null;
  keywordVariants?: unknown;
  keyword_variants?: unknown;
}

export type AutomationMatchResult<T extends AutomationKeywordCandidate> =
  | { outcome: "wrong_media" }
  | { outcome: "not_matched" }
  | { outcome: "matched"; automation: T };

function variantsOf(item: AutomationKeywordCandidate) {
  const raw = Array.isArray(item.keyword_variants)
    ? item.keyword_variants
    : Array.isArray(item.keywordVariants)
      ? item.keywordVariants
      : [];
  return raw.length ? raw.map(String) : buildKeywordVariants(item.keyword);
}

function mediaIdOf(item: AutomationKeywordCandidate) {
  return item.mediaId ?? item.media_id ?? null;
}

export function matchAutomationForComment<T extends AutomationKeywordCandidate>(
  media: { id: string } | null,
  automations: T[],
  commentText: string,
): AutomationMatchResult<T> {
  if (!media) return { outcome: "wrong_media" };
  const automation = automations.find((item) =>
    mediaIdOf(item) === media.id
    && keywordMatches(commentText, item.keyword, variantsOf(item)),
  );
  if (!automation) return { outcome: "not_matched" };
  return { outcome: "matched", automation };
}
