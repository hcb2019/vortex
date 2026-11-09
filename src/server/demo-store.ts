import "server-only";
import type { Automation, AutomationRun, InstagramConnection, InstagramMedia } from "@/types/domain";
import type { AudienceRadarData } from "@/types/audience";
import { normalizeKeyword } from "@/lib/domain";
import { createDemoAudienceData } from "@/server/demo-audience";
import type { ContentProject, CreatorProfile } from "@/types/content-studio";

const ownerId = "00000000-0000-4000-8000-000000000001";
const connectionId = "10000000-0000-4000-8000-000000000001";
const now = Date.now();

const mediaSeed: InstagramMedia[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    connectionId,
    externalId: "179001991",
    mediaProductType: "REELS",
    mediaType: "VIDEO",
    caption: "O ano que mudou a internet — comente 1991 para receber a história completa.",
    permalink: "https://www.instagram.com/reel/demo-1991/",
    thumbnailUrl: null,
    publishedAt: new Date(now - 86400000 * 2).toISOString(),
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    connectionId,
    externalId: "179001992",
    mediaProductType: "REELS",
    mediaType: "VIDEO",
    caption: "Checklist de lançamento: comente GUIA.",
    permalink: "https://www.instagram.com/reel/demo-guia/",
    thumbnailUrl: null,
    publishedAt: new Date(now - 86400000 * 8).toISOString(),
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    connectionId,
    externalId: "179001993",
    mediaProductType: "REELS",
    mediaType: "VIDEO",
    caption: "Três hábitos para vender melhor todos os dias.",
    permalink: "https://www.instagram.com/reel/demo-habitos/",
    thumbnailUrl: null,
    publishedAt: new Date(now - 86400000 * 16).toISOString(),
  },
  {
    id: "20000000-0000-4000-8000-000000000004",
    connectionId,
    externalId: "179001994",
    mediaProductType: "FEED",
    mediaType: "CAROUSEL_ALBUM",
    caption: "Carrossel de ofertas: comente QUIZ para receber o material.",
    permalink: "https://www.instagram.com/p/demo-carrossel/",
    thumbnailUrl: null,
    publishedAt: new Date(now - 86400000 * 4).toISOString(),
  },
];

const automationSeed: Automation[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    ownerId,
    connectionId,
    mediaId: mediaSeed[0]!.id,
    name: "Reel — História de 1991",
    keyword: "1991",
    keywordNormalized: "1991",
    keywordVariants: ["1991.", "1991!", "1991?"],
    publicReply: "Enviei para você. Confira seu direct.",
    publicReplyVariants: [
      "Enviei para você. Confira seu direct.",
      "Prontinho! Acabei de mandar no seu direct ✨",
      "Está a caminho — dá uma olhadinha nas suas mensagens.",
    ],
    dmMessage: "Aqui está o material que prometi — espero que seja útil:",
    dmMessageVariants: ["Aqui está o material que prometi — espero que seja útil:"],
    destinationUrl: "https://example.com/produto-1991",
    conversationFlow: { steps: [] },
    appendUtmToButtons: true,
    requireFollow: false,
    followGateMessage: "Se você já me segue, digite PRONTO. Se não, me segue e depois volta aqui e digita PRONTO.",
    notFollowingMessage: "Poxa… você quer o conteúdo e ainda não me segue? 😅 Me segue primeiro e depois digita PRONTO aqui de novo.",
    status: "active",
    version: 2,
    createdAt: new Date(now - 86400000 * 12).toISOString(),
    updatedAt: new Date(now - 86400000).toISOString(),
    deletedAt: null,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    ownerId,
    connectionId,
    mediaId: mediaSeed[1]!.id,
    name: "Checklist de lançamento",
    keyword: "GUIA",
    keywordNormalized: "guia",
    keywordVariants: ["guia.", "guia!", "guia?", "guias"],
    publicReply: "O guia já está a caminho ✦",
    publicReplyVariants: [
      "O guia já está a caminho ✦",
      "Prontinho! Confira seu direct.",
      "Te mandei agora — espero que ajude!",
    ],
    dmMessage: "Seu checklist está aqui:",
    dmMessageVariants: ["Seu checklist está aqui:"],
    destinationUrl: "https://example.com/guia",
    conversationFlow: { steps: [] },
    appendUtmToButtons: true,
    requireFollow: false,
    followGateMessage: "Se você já me segue, digite PRONTO. Se não, me segue e depois volta aqui e digita PRONTO.",
    notFollowingMessage: "Poxa… você quer o conteúdo e ainda não me segue? 😅 Me segue primeiro e depois digita PRONTO aqui de novo.",
    status: "paused",
    version: 1,
    createdAt: new Date(now - 86400000 * 7).toISOString(),
    updatedAt: new Date(now - 86400000 * 3).toISOString(),
    deletedAt: null,
  },
];

const runSeed: AutomationRun[] = Array.from({ length: 8 }, (_, index) => ({
  id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  automationId: automationSeed[0]!.id,
  automationName: automationSeed[0]!.name,
  mediaExternalId: mediaSeed[0]!.externalId,
  commentId: `comment-${index + 1}`,
  commenterScopedId: `ig-user-${index + 1}`,
  commenterUsername: ["marina.cria", "joaopedro", "bia.lima", "leo.co", "nina.studio", "caio.lab", "ana.v", "mariax"][index]!,
  commentText: index === 6 ? "1991!" : "1991",
  status: index === 5 ? "partial" : index === 7 ? "failed" : "succeeded",
  publicReplyStatus: "succeeded",
  dmStatus: index === 5 || index === 7 ? "failed" : "succeeded",
  publicReplyAttempts: 1,
  dmAttempts: index === 5 ? 3 : 1,
  requireFollow: false,
  followStatus: "not_required",
  conversationAnswers: [],
  contentDeliveredAt: index === 5 || index === 7 ? null : new Date(now - 3600000 * (index + 1)).toISOString(),
  errorCode: index === 5 ? "META_RATE_LIMIT" : index === 7 ? "TOKEN_EXPIRED" : null,
  errorMessage: index === 5 ? "Limite temporário da integração." : index === 7 ? "Conexão precisa ser renovada." : null,
  firstClickedAt: index < 4 ? new Date(now - 3600000 * (index + 2)).toISOString() : null,
  createdAt: new Date(now - 3600000 * (index + 1)).toISOString(),
}));

interface DemoState {
  connection: InstagramConnection;
  media: InstagramMedia[];
  automations: Automation[];
  runs: AutomationRun[];
  audience: AudienceRadarData;
  creatorProfile: CreatorProfile;
  contentProjects: ContentProject[];
}

declare global {
  var __vortexDemoState: DemoState | undefined;
}

export function demoStore(): DemoState {
  globalThis.__vortexDemoState ??= {
    connection: {
      id: connectionId,
      ownerId,
      instagramUserId: "178414000000001",
      username: "vortex.demo",
      status: "connected",
      tokenExpiresAt: new Date(now + 86400000 * 42).toISOString(),
      tokenRefreshedAt: new Date(now - 86400000 * 7).toISOString(),
      lastSyncAt: new Date(now - 1000 * 60 * 18).toISOString(),
      lastError: null,
    },
    media: structuredClone(mediaSeed),
    automations: structuredClone(automationSeed),
    runs: structuredClone(runSeed),
    audience: structuredClone(createDemoAudienceData(mediaSeed)),
    creatorProfile: {
      instagramHandle: "@hernando.ia",
      niche: "Inteligência artificial aplicada a negócios e à vida cotidiana",
      audience: "Pequenos empresários, profissionais autônomos e criadores que querem começar a usar IA sem virar 'especialista de palco'",
      voice: "PT-BR casual, cara de áudio de WhatsApp, específico, sem clichê. Mostra o processo, fala de segurança e LGPD, empacota o método. Nunca se chama de dev.",
      preferredTerms: ["na prática", "testa isso", "vc", "tb", "pq", "comenta VORTEX"],
      avoidedTerms: ["revolucionário", "jornada", "guru", "dev", "farda"],
      defaultCta: "Comenta VORTEX que eu te mando no direct.",
    },
    contentProjects: [],
  };
  // Preserve HMR state while safely introducing new demo domains.
  globalThis.__vortexDemoState.audience ??= structuredClone(createDemoAudienceData(globalThis.__vortexDemoState.media));
  globalThis.__vortexDemoState.contentProjects ??= [];
  return globalThis.__vortexDemoState;
}

export function saveDemoAutomation(input: {
  id?: string;
  name: string;
  mediaId: string;
  keyword: string;
  keywordVariants: string[];
  publicReply: string;
  publicReplyVariants: string[];
  dmMessage: string;
  dmMessageVariants: string[];
  destinationUrl: string;
  conversationFlow: Automation["conversationFlow"];
  appendUtmToButtons: boolean;
  requireFollow: boolean;
  followGateMessage: string;
  notFollowingMessage: string;
  status: "draft" | "active";
}) {
  const store = demoStore();
  const timestamp = new Date().toISOString();
  const existing = input.id ? store.automations.find((item) => item.id === input.id) : undefined;
  if (existing) {
    Object.assign(existing, input, {
      publicReply: input.publicReplyVariants.find(Boolean) ?? input.publicReply,
      dmMessage: input.dmMessageVariants.find(Boolean) ?? input.dmMessage,
      keywordNormalized: normalizeKeyword(input.keyword),
      version: existing.version + 1,
      updatedAt: timestamp,
    });
    return existing;
  }
  const created: Automation = {
    ...input,
    id: crypto.randomUUID(),
    ownerId,
    connectionId,
    keywordNormalized: normalizeKeyword(input.keyword),
    publicReply: input.publicReplyVariants.find(Boolean) ?? input.publicReply,
    dmMessage: input.dmMessageVariants.find(Boolean) ?? input.dmMessage,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  store.automations.unshift(created);
  return created;
}
