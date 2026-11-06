import { describe, expect, it } from "vitest";
import { anonymizeAudienceComments, audienceFingerprint, audienceModelOutputSchema, chunkAudienceComments, confidenceLabel } from "@/lib/audience";

const comments = [
  { id: "comment-2", text: "Quanto custa?", mediaCaption: "Reel dois", publishedAt: "2026-07-17T12:00:00.000Z", username: "maria", externalId: "1789" },
  { id: "comment-1", text: "Faz um vídeo sobre isso", mediaCaption: "Reel um", publishedAt: "2026-07-16T12:00:00.000Z", username: "joao", externalId: "1790" },
];

describe("inteligência de audiência", () => {
  it("anonimiza identificadores e preserva somente o contexto necessário", () => {
    const result = anonymizeAudienceComments(comments, 100);
    expect(result).toEqual([
      { alias: "C0101", text: "Quanto custa?", mediaCaption: "Reel dois", publishedAt: "2026-07-17T12:00:00.000Z" },
      { alias: "C0102", text: "Faz um vídeo sobre isso", mediaCaption: "Reel um", publishedAt: "2026-07-16T12:00:00.000Z" },
    ]);
    expect(JSON.stringify(result)).not.toContain("maria");
    expect(JSON.stringify(result)).not.toContain("1789");
  });

  it("divide lotes em no máximo cem comentários", () => {
    const items = Array.from({ length: 201 }, (_, index) => index);
    expect(chunkAudienceComments(items)).toHaveLength(3);
    expect(chunkAudienceComments(items).map((item) => item.length)).toEqual([100, 100, 1]);
    expect(() => chunkAudienceComments(items, 101)).toThrow();
  });

  it("gera fingerprint estável, mas sensível ao escopo e conteúdo", () => {
    const source = comments.map(({ id, text, publishedAt }) => ({ id, text, publishedAt }));
    expect(audienceFingerprint(source, 30, null)).toBe(audienceFingerprint([...source].reverse(), 30, null));
    expect(audienceFingerprint(source, 30, null)).not.toBe(audienceFingerprint(source, 7, null));
    expect(audienceFingerprint(source, 30, null)).not.toBe(audienceFingerprint(source, 30, "reel-1"));
    expect(audienceFingerprint(source, 30, null, "prompt-v1")).not.toBe(audienceFingerprint(source, 30, null, "prompt-v2"));
    expect(audienceFingerprint(source, 30, null)).not.toBe(audienceFingerprint([{ ...source[0]!, text: "Outro" }], 30, null));
    expect(audienceFingerprint(source, 30, null, "", "conn-a")).not.toBe(audienceFingerprint(source, 30, null, "", "conn-b"));
  });

  it("rejeita categorias e evidências fora do schema estruturado", () => {
    const invalid = audienceModelOutputSchema.safeParse({ classifications: [{ alias: "comentario-1", category: "lead", sentiment: "happy", urgency: 9, confidence: 2, theme: "Preço", opportunity: "Venda" }], insights: [] });
    expect(invalid.success).toBe(false);
  });

  it("expõe confiança sem depender apenas de cor", () => {
    expect(confidenceLabel(0.9)).toBe("Confiança alta");
    expect(confidenceLabel(0.7)).toBe("Confiança média");
    expect(confidenceLabel(0.4)).toBe("Sinal inicial");
  });
});
