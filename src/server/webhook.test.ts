import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseCommentEvents,
  parseMessageEvents,
  verifyWebhookSignature,
  verifyWebhookSignatureWithSecrets,
} from "@/server/webhook";

const payload = JSON.stringify({
  object: "instagram",
  entry: [{ id: "ig-owner", changes: [{ field: "comments", value: { id: "comment-1", text: "1991", from: { id: "person-1", username: "maria" }, media: { id: "reel-1", media_product_type: "REELS" } } }] }],
});

describe("Meta webhooks", () => {
  it("verifies the exact raw body", () => {
    const signature = `sha256=${createHmac("sha256", "secret").update(payload).digest("hex")}`;
    expect(verifyWebhookSignature(payload, signature, "secret")).toBe(true);
    expect(verifyWebhookSignature(`${payload} `, signature, "secret")).toBe(false);
    expect(verifyWebhookSignature(payload, null, "secret")).toBe(false);
  });

  it("accepts the main Meta app secret while keeping the Instagram secret as a transition fallback", () => {
    const platformSignature = `sha256=${createHmac("sha256", "platform-secret").update(payload).digest("hex")}`;
    const instagramSignature = `sha256=${createHmac("sha256", "instagram-secret").update(payload).digest("hex")}`;

    expect(verifyWebhookSignatureWithSecrets(
      payload,
      platformSignature,
      ["platform-secret", "instagram-secret"],
    )).toBe(true);
    expect(verifyWebhookSignatureWithSecrets(
      payload,
      instagramSignature,
      ["platform-secret", "instagram-secret"],
    )).toBe(true);
    expect(verifyWebhookSignatureWithSecrets(payload, platformSignature, [])).toBe(false);
  });

  it("maps a carousel feed comment without treating it as a Reel", () => {
    const carouselPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        changes: [{
          field: "comments",
          value: {
            id: "comment-carousel",
            text: "QUIZ",
            from: { id: "person-2", username: "ana" },
            media: { id: "carousel-1", media_product_type: "FEED" },
          },
        }],
      }],
    });

    expect(parseCommentEvents(carouselPayload)).toEqual([{
      instagramUserId: "ig-owner",
      commentId: "comment-carousel",
      mediaId: "carousel-1",
      mediaProductType: "FEED",
      commenterScopedId: "person-2",
      commenterUsername: "ana",
      text: "QUIZ",
      isSelf: false,
    }]);
  });

  it("maps a comment event without retaining the full envelope", () => {
    expect(parseCommentEvents(payload)).toEqual([{ instagramUserId: "ig-owner", commentId: "comment-1", mediaId: "reel-1", mediaProductType: "REELS", commenterScopedId: "person-1", commenterUsername: "maria", text: "1991", isSelf: false }]);
  });

  it("accepts the direct comment payload sent by the current Instagram API", () => {
    const directPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        field: "comments",
        value: {
          id: "comment-2",
          text: "QUERO",
          from: { username: "Maria.Silva" },
          media: { id: "reel-2", media_product_type: "REELS" },
        },
      }],
    });

    expect(parseCommentEvents(directPayload)).toEqual([{
      instagramUserId: "ig-owner",
      commentId: "comment-2",
      mediaId: "reel-2",
      mediaProductType: "REELS",
      commenterScopedId: "username:maria.silva",
      commenterUsername: "Maria.Silva",
      text: "QUERO",
      isSelf: false,
    }]);
  });

  it("accepts comment values sent as an array with optional author and media fields omitted", () => {
    const compactPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: 12345,
        field: "comments",
        value: [{
          id: 67890,
          text: 1991,
          media: { id: 54321 },
        }],
      }],
    });

    expect(parseCommentEvents(compactPayload)).toEqual([{
      instagramUserId: "12345",
      commentId: "67890",
      mediaId: "54321",
      mediaProductType: "UNKNOWN",
      commenterScopedId: "comment:67890",
      commenterUsername: "instagram_user",
      text: "1991",
      isSelf: false,
    }]);
  });

  it("ignores unrelated webhook fields without rejecting the delivery", () => {
    const messagingPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        field: "messages",
        value: {
          id: "message-1",
          text: "oi",
          media: { id: "reel-1" },
        },
      }],
    });

    expect(parseCommentEvents(messagingPayload)).toEqual([]);
  });

  it("maps an inbound direct message used to confirm the follower", () => {
    const messagingPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        messaging: [{
          sender: { id: "ig-scoped-person" },
          recipient: { id: "ig-owner" },
          timestamp: 1785197000000,
          message: { mid: "message-1", text: "PRONTO" },
        }],
      }],
    });

    expect(parseMessageEvents(messagingPayload)).toEqual([{
      instagramUserId: "ig-owner",
      messageId: "message-1",
      senderScopedId: "ig-scoped-person",
      recipientId: "ig-owner",
      text: "PRONTO",
      quickReplyPayload: null,
      postbackPayload: null,
      isEcho: false,
    }]);
  });

  it("keeps a valid message when Meta sends unrelated messaging events in the same envelope", () => {
    const mixedPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        messaging: [
          {
            sender: { id: "ig-scoped-person" },
            recipient: { id: "ig-owner" },
            read: { mid: "message-read" },
          },
          {
            sender: { id: "ig-scoped-person" },
            recipient: { id: "ig-owner" },
            timestamp: 1785197000000,
            message: { mid: "message-ready", text: "pronto" },
          },
        ],
      }],
    });

    expect(parseMessageEvents(mixedPayload)).toEqual([{
      instagramUserId: "ig-owner",
      messageId: "message-ready",
      senderScopedId: "ig-scoped-person",
      recipientId: "ig-owner",
      text: "pronto",
      quickReplyPayload: null,
      postbackPayload: null,
      isEcho: false,
    }]);
  });

  it("accepts the direct messages variant and derives a stable id when Meta omits mid", () => {
    const directPayload = JSON.stringify({
      object: "instagram_business_account",
      entry: [{
        id: "ig-owner",
        field: "messages",
        value: {
          sender: { id: "ig-scoped-person" },
          recipient: { id: "ig-owner" },
          timestamp: "1785197000000",
          message: { text: "PRONTO" },
        },
      }],
    });

    const first = parseMessageEvents(directPayload);
    const second = parseMessageEvents(directPayload);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      instagramUserId: "ig-owner",
      senderScopedId: "ig-scoped-person",
      recipientId: "ig-owner",
      text: "PRONTO",
      quickReplyPayload: null,
      postbackPayload: null,
      isEcho: false,
    });
    expect(first[0]?.messageId).toMatch(/^derived:[a-f0-9]{64}$/);
    expect(second[0]?.messageId).toBe(first[0]?.messageId);
  });

  it("ignores seen and reaction notifications instead of rejecting the webhook", () => {
    const unrelatedPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        messaging: [{
          sender: { id: "ig-scoped-person" },
          recipient: { id: "ig-owner" },
          read: { mid: "message-1" },
        }],
      }],
    });

    expect(parseMessageEvents(unrelatedPayload)).toEqual([]);
    expect(parseCommentEvents(unrelatedPayload)).toEqual([]);
  });

  it("marks app echoes so they are never processed as follower replies", () => {
    const echoPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        messaging: [{
          sender: { id: "ig-owner" },
          recipient: { id: "ig-scoped-person" },
          message: { mid: "message-2", text: "mensagem enviada", is_echo: true },
        }],
      }],
    });

    expect(parseMessageEvents(echoPayload)[0]?.isEcho).toBe(true);
  });

  it("maps quick reply and postback payloads for DM automations", () => {
    const quickReplyPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        messaging: [{
          sender: { id: "ig-scoped-person" },
          recipient: { id: "ig-owner" },
          timestamp: 1785197000000,
          message: { mid: "message-opt-in", text: "Quero o guia", quick_reply: { payload: "vortex:flow:run-1:inicio:guia" } },
        }, {
          sender: { id: "ig-scoped-person" },
          recipient: { id: "ig-owner" },
          timestamp: 1785197000100,
          postback: { mid: "postback-1", title: "BIBLIOTECA", payload: "vortex:button:biblioteca" },
        }],
      }],
    });

    expect(parseMessageEvents(quickReplyPayload)).toEqual([
      {
        instagramUserId: "ig-owner",
        messageId: "message-opt-in",
        senderScopedId: "ig-scoped-person",
        recipientId: "ig-owner",
        text: "Quero o guia",
        quickReplyPayload: "vortex:flow:run-1:inicio:guia",
        postbackPayload: null,
        isEcho: false,
      },
      {
        instagramUserId: "ig-owner",
        messageId: "postback-1",
        senderScopedId: "ig-scoped-person",
        recipientId: "ig-owner",
        text: "BIBLIOTECA",
        quickReplyPayload: null,
        postbackPayload: "vortex:button:biblioteca",
        isEcho: false,
      },
    ]);
  });

  it("identifies comments made by the connected account", () => {
    const selfPayload = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "ig-owner",
        changes: [{
          field: "comments",
          value: {
            id: "comment-self",
            text: "quero",
            from: {
              id: "ig-owner",
              username: "creator.demo",
              self_ig_scoped_id: "ig-owner",
            },
            media: { id: "reel-1", media_product_type: "REELS" },
          },
        }],
      }],
    });

    expect(parseCommentEvents(selfPayload)[0]?.isSelf).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(() => parseCommentEvents(JSON.stringify({ object: "other", entry: [] }))).toThrow();
  });
});
