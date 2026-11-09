import { describe, expect, it } from "vitest";
import { automationSchema, buildKeywordVariants, formatPercent, keywordMatches, normalizeKeyword, selectReplyVariant } from "@/lib/domain";

describe("keyword normalization", () => {
  it("normaliza caixa, unicode e espaços", () => {
    expect(normalizeKeyword("  GUIA   RÁPIDO  ")).toBe("guia rápido");
    expect(keywordMatches("  １９９１ ", "1991")).toBe(true);
  });

  it("aceita pontuação final sem abrir correspondência parcial", () => {
    expect(keywordMatches("1991!", "1991")).toBe(true);
    expect(keywordMatches("quero 1991", "1991")).toBe(false);
  });

  it("gera plural, pontuação e erros simples com uma letra ausente", () => {
    const variants = buildKeywordVariants("Guia");
    expect(variants).toEqual(expect.arrayContaining(["guia.", "guia!", "guia?", "guias"]));
    const longerVariants = buildKeywordVariants("Material");
    expect(longerVariants).toContain("materia");
    expect(keywordMatches("materia", "material", longerVariants)).toBe(true);
  });

  it("seleciona uma variação estável para o mesmo comentário", () => {
    const replies = ["Primeira", "Segunda", "Terceira"];
    expect(selectReplyVariant("comment-123", replies)).toBe(selectReplyVariant("comment-123", replies));
    expect(replies).toContain(selectReplyVariant("comment-456", replies));
    expect(selectReplyVariant("comment-1", ["", "Única"])).toBe("Única");
  });
});

describe("automation validation", () => {
  it("permite rascunho incompleto", () => {
    expect(automationSchema.safeParse({ name: "", mediaId: "", keyword: "", publicReply: "", dmMessage: "", destinationUrl: "", intent: "draft" }).success).toBe(true);
  });

  it("exige todos os campos e HTTPS na ativação", () => {
    const invalid = automationSchema.safeParse({ name: "A", mediaId: "id", keyword: "x", publicReply: "ok", publicReplyVariants: ["a", "b", "c"], dmMessage: "ok", dmMessageVariants: ["ok"], destinationUrl: "http://example.com", intent: "active" });
    expect(invalid.success).toBe(false);
    const missingMedia = automationSchema.safeParse({ name: "A", mediaId: "", keyword: "x", publicReply: "a", publicReplyVariants: ["a", "b", "c"], dmMessage: "ok", dmMessageVariants: ["ok"], destinationUrl: "https://example.com", intent: "active" });
    expect(missingMedia.success).toBe(false);
    if (!missingMedia.success) {
      expect(missingMedia.error.issues.some((issue) => issue.message === "Selecione uma publicação.")).toBe(true);
    }
    const valid = automationSchema.safeParse({ name: "A", mediaId: "id", keyword: "x", publicReply: "a", publicReplyVariants: ["a", "b", "c"], dmMessage: "ok", dmMessageVariants: ["ok", "aqui está"], destinationUrl: "https://example.com", intent: "active" });
    expect(valid.success).toBe(true);
  });

  it("aceita fluxo de conversa como destino da automação", () => {
    const valid = automationSchema.safeParse({
      name: "A",
      mediaId: "id",
      keyword: "x",
      publicReply: "a",
      publicReplyVariants: ["a", "b", "c"],
      dmMessage: "ok",
      dmMessageVariants: ["ok"],
      destinationUrl: "",
      conversationFlow: {
        steps: [
          { id: "inicio", text: "Qual material você quer?", buttons: [{ id: "guia", label: "Guia", nextStepId: "final", url: null }] },
          { id: "final", text: "Aqui está:", buttons: [{ id: "abrir", label: "Abrir guia", nextStepId: null, url: "https://example.com/guia" }] },
        ],
      },
      intent: "active",
    });
    expect(valid.success).toBe(true);
  });

  it("rejeita fluxo com botão de URL misturado com próximo passo", () => {
    const invalid = automationSchema.safeParse({
      name: "A",
      mediaId: "id",
      keyword: "x",
      publicReply: "a",
      publicReplyVariants: ["a", "b", "c"],
      dmMessage: "ok",
      dmMessageVariants: ["ok"],
      destinationUrl: "",
      conversationFlow: {
        steps: [{
          id: "inicio",
          text: "Escolha",
          buttons: [
            { id: "um", label: "Um", nextStepId: "dois", url: null },
            { id: "link", label: "Link", nextStepId: null, url: "https://example.com" },
          ],
        }, { id: "dois", text: "Final", buttons: [{ id: "abrir", label: "Abrir", nextStepId: null, url: "https://example.com/final" }] }],
      },
      intent: "active",
    });
    expect(invalid.success).toBe(false);
  });

  it("calcula taxas sem divisão por zero", () => {
    expect(formatPercent(0, 0)).toBe("0%");
    expect(formatPercent(1, 4)).toBe("25%");
  });

  it("exige as duas mensagens quando a confirmação de seguidor está ativa", () => {
    const invalid = automationSchema.safeParse({
      name: "A", mediaId: "id", keyword: "x", publicReply: "ok", publicReplyVariants: ["a", "b", "c"], dmMessage: "ok", dmMessageVariants: ["ok"],
      destinationUrl: "https://example.com", requireFollow: true,
      followGateMessage: "", notFollowingMessage: "", intent: "active",
    });
    expect(invalid.success).toBe(false);
  });
});
