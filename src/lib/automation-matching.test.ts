import { describe, expect, it } from "vitest";
import { matchAutomationForComment } from "@/lib/automation-matching";

const carouselMedia = { id: "media-carousel", mediaProductType: "FEED", mediaType: "CAROUSEL_ALBUM" };
const reelMedia = { id: "media-reel", mediaProductType: "REELS", mediaType: "VIDEO" };

const carouselAutomation = {
  id: "auto-carousel",
  mediaId: carouselMedia.id,
  keyword: "QUIZ",
  keywordVariants: ["quiz.", "quiz!", "quiz?"],
};
const reelAutomation = {
  id: "auto-reel",
  media_id: reelMedia.id,
  keyword: "1991",
  keyword_variants: ["1991.", "1991!"],
};
const automations = [reelAutomation, carouselAutomation];

describe("automation matching for published media", () => {
  it("casa comentário de carrossel com a automação daquela mídia", () => {
    expect(matchAutomationForComment(carouselMedia, automations, "quiz!")).toEqual({
      outcome: "matched",
      automation: carouselAutomation,
    });
  });

  it("não aplica a automação de um Reel em comentário de carrossel", () => {
    expect(matchAutomationForComment(carouselMedia, automations, "1991")).toEqual({
      outcome: "not_matched",
    });
  });

  it("continua casando comentários de Reels como antes", () => {
    expect(matchAutomationForComment(reelMedia, automations, "1991")).toEqual({
      outcome: "matched",
      automation: reelAutomation,
    });
  });

  it("marca comentário de mídia ainda não sincronizada como wrong_media", () => {
    expect(matchAutomationForComment(null, [carouselAutomation], "quiz")).toEqual({
      outcome: "wrong_media",
    });
  });
});
