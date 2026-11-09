import type { SyncedInstagramMedia } from "@/server/instagram/media-mapping";

export interface InstagramCommentEvent {
  instagramUserId: string;
  commentId: string;
  mediaId: string;
  mediaProductType: string;
  commenterScopedId: string;
  commenterUsername: string;
  text: string;
  isSelf: boolean;
}

export interface InstagramMessageEvent {
  instagramUserId: string;
  messageId: string;
  senderScopedId: string;
  recipientId: string;
  text: string;
  quickReplyPayload: string | null;
  postbackPayload: string | null;
  isEcho: boolean;
}

export interface InstagramTokenResult {
  accessToken: string;
  userId: string;
  expiresIn: number | null;
  permissions: string[] | null;
}

export interface InstagramGateway {
  exchangeCode(code: string, redirectUri: string): Promise<InstagramTokenResult>;
  renewAccessToken(accessToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  getProfile(accessToken: string): Promise<{ userId: string; username: string }>;
  listGrantedPermissions(accessToken: string): Promise<string[] | null>;
  subscribeToComments(userId: string, accessToken: string): Promise<void>;
  hasCommentSubscription(userId: string, accessToken: string): Promise<boolean>;
  listPublishedMedia(userId: string, accessToken: string): Promise<SyncedInstagramMedia[]>;
  createReelContainer(userId: string, videoUrl: string, caption: string, accessToken: string): Promise<{ id: string }>;
  getMediaContainerStatus(containerId: string, accessToken: string): Promise<{ statusCode: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED" | string }>;
  publishMedia(userId: string, creationId: string, accessToken: string): Promise<{ id: string }>;
  getMedia(mediaId: string, accessToken: string): Promise<SyncedInstagramMedia>;
  listComments(mediaId: string, accessToken: string, since: Date, limit: number): Promise<Array<{ commentId: string; commenterScopedId: string; commenterUsername: string; text: string; publishedAt: string }>>;
  getMediaInsights(mediaId: string, accessToken: string): Promise<{ comments: number; views: number; reach: number; shares: number; saved: number; totalInteractions: number; raw: Record<string, number> }>;
  replyToComment(commentId: string, message: string, accessToken: string): Promise<{ id: string }>;
  sendPrivateReply(userId: string, commentId: string, message: string, accessToken: string, options?: { quickReplies?: Array<{ title: string; payload: string }> }): Promise<{ recipientId: string; messageId: string }>;
  getUserFollowStatus(scopedUserId: string, accessToken: string): Promise<boolean>;
  sendTextMessage(instagramUserId: string, recipientId: string, message: string, accessToken: string, options?: { quickReplies?: Array<{ title: string; payload: string }> }): Promise<{ recipientId: string; messageId: string }>;
  sendButtonTemplateMessage(
    instagramUserId: string,
    recipientId: string,
    message: string,
    buttons: Array<
      | { type: "web_url"; title: string; url: string }
      | { type: "postback"; title: string; payload: string }
    >,
    accessToken: string,
  ): Promise<{ recipientId: string; messageId: string }>;
  listRecentInboundMessages(
    instagramUserId: string,
    scopedUserId: string,
    since: Date,
    accessToken: string,
  ): Promise<Array<{ messageId: string; text: string; createdAt: string }>>;
}
