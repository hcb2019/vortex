"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { automationSchema, buildKeywordVariants, keywordMatches, normalizeKeyword } from "@/lib/domain";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveDemoAutomation, demoStore } from "@/server/demo-store";
import { generateAutomationMessageSuggestions } from "@/server/automation-suggestions";
import { getConnection } from "@/server/data";
import type { AutomationMessageSuggestion } from "@/lib/automation-suggestions";

export interface AutomationActionState {
  error?: string;
  fields?: Record<string, string[]>;
}

export type AutomationSuggestionsResult =
  | { suggestions: AutomationMessageSuggestion[]; caption: string }
  | { error: string };

export async function suggestAutomationMessages(mediaId: string, variationSeed = 0): Promise<AutomationSuggestionsResult> {
  const owner = await requireOwner();
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return { error: "Escolha um Reel antes de gerar sugestões." };

  let caption: string | null = null;
  if (isDemoMode) {
    caption = demoStore().media.find((item) => item.id === mediaId)?.caption ?? null;
  } else {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("instagram_media")
      .select("caption")
      .eq("id", mediaId)
      .eq("owner_id", owner.id)
      .maybeSingle();
    caption = data?.caption ?? null;
  }
  if (caption === null) return { error: "Este Reel não foi encontrado na sua conta." };

  return {
    suggestions: await generateAutomationMessageSuggestions(caption, variationSeed),
    caption,
  };
}

export async function saveAutomation(_state: AutomationActionState, formData: FormData): Promise<AutomationActionState> {
  const owner = await requireOwner();
  const publicReplyVariants = formData.getAll("publicReplyVariants").map(String);
  const dmMessageVariants = formData.getAll("dmMessageVariants").map(String);
  const keywordVariants = formData.getAll("keywordVariants").map(String);
  const rawConversationFlow = String(formData.get("conversationFlow") ?? "");
  let conversationFlow: unknown = { steps: [] };
  try {
    conversationFlow = rawConversationFlow ? JSON.parse(rawConversationFlow) as unknown : { steps: [] };
  } catch {
    return { error: "Revise o fluxo de conversa.", fields: { conversationFlow: ["O fluxo não pôde ser lido."] } };
  }
  const parsed = automationSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    mediaId: formData.get("mediaId") ?? "",
    keyword: formData.get("keyword") ?? "",
    keywordVariants,
    publicReply: publicReplyVariants.find((value) => value.trim()) ?? "",
    publicReplyVariants,
    dmMessage: dmMessageVariants.find((value) => value.trim()) ?? "",
    dmMessageVariants,
    destinationUrl: formData.get("destinationUrl") ?? "",
    conversationFlow,
    appendUtmToButtons: formData.get("appendUtmToButtons") === "on",
    requireFollow: formData.get("requireFollow") === "on",
    followGateMessage: formData.get("followGateMessage") ?? "",
    notFollowingMessage: formData.get("notFollowingMessage") ?? "",
    intent: formData.get("intent") ?? "draft",
  });
  if (!parsed.success) return { error: "Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors };

  const input = parsed.data;
  if (isDemoMode) {
    const duplicate = demoStore().automations.find((item) =>
      item.id !== input.id
      && item.mediaId === input.mediaId
      && item.status !== "deleted"
      && [input.keyword, ...input.keywordVariants].some((term) =>
        keywordMatches(term, item.keyword, item.keywordVariants.length ? item.keywordVariants : buildKeywordVariants(item.keyword)),
      ),
    );
    if (duplicate) return { error: "Já existe uma automação com essa palavra-chave neste Reel." };
    const saved = saveDemoAutomation({ ...input, status: input.intent });
    revalidatePath("/dashboard", "layout");
    redirect(`/automations/${saved.id}?saved=1`);
  }

  const supabase = await createSupabaseServerClient();
  const connection = await getConnection();
  if (!connection) return { error: "Conecte uma conta do Instagram antes de salvar." };
  if (input.intent === "active" && connection.status !== "connected") return { error: "A conexão precisa estar ativa para publicar a automação." };
  const { data: mediaRow } = await supabase.from("instagram_media").select("id").eq("id", input.mediaId).eq("connection_id", connection.id).maybeSingle();
  if (input.mediaId && !mediaRow) return { error: "Este Reel não pertence à conta selecionada." };
  const { data: existingAutomations } = await supabase
    .from("automations")
    .select("id,keyword,keyword_variants")
    .eq("connection_id", connection.id)
    .eq("media_id", input.mediaId)
    .is("deleted_at", null);
  const duplicate = (existingAutomations ?? []).some((item) =>
    item.id !== input.id
    && [input.keyword, ...input.keywordVariants].some((term) =>
      keywordMatches(
        term,
        item.keyword,
        Array.isArray(item.keyword_variants) && item.keyword_variants.length
          ? item.keyword_variants
          : buildKeywordVariants(item.keyword),
      ),
    ),
  );
  if (duplicate) return { error: "Uma palavra-chave ou variação já é usada por outra automação neste Reel." };

  const payload = {
    owner_id: owner.id,
    connection_id: connection.id,
    media_id: input.mediaId || null,
    name: input.name,
    keyword: input.keyword,
    keyword_normalized: normalizeKeyword(input.keyword),
    keyword_variants: input.keywordVariants,
    public_reply: input.publicReply,
    public_reply_variants: input.publicReplyVariants,
    dm_message: input.dmMessage,
    dm_message_variants: input.dmMessageVariants,
    destination_url: input.destinationUrl,
    dm_conversation_flow: input.conversationFlow,
    append_utm_to_buttons: input.appendUtmToButtons,
    require_follow: input.requireFollow,
    follow_gate_message: input.followGateMessage,
    not_following_message: input.notFollowingMessage,
    status: input.intent,
  };
  const result = input.id
    ? await supabase.from("automations").update(payload).eq("id", input.id).eq("owner_id", owner.id).select("id").single()
    : await supabase.from("automations").insert(payload).select("id").single();
  if (result.error) return { error: result.error.code === "23505" ? "Já existe uma automação com essa palavra-chave neste Reel." : "Não foi possível salvar a automação." };
  revalidatePath("/dashboard", "layout");
  redirect(`/automations/${result.data.id}?saved=1`);
}

export async function setAutomationStatus(formData: FormData) {
  const owner = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["active", "paused"].includes(status)) return;
  if (isDemoMode) {
    const item = demoStore().automations.find((automation) => automation.id === id);
    if (item) { item.status = status as "active" | "paused"; item.updatedAt = new Date().toISOString(); }
  } else {
    const supabase = await createSupabaseServerClient();
    await supabase.from("automations").update({ status }).eq("id", id).eq("owner_id", owner.id);
  }
  revalidatePath("/dashboard", "layout");
}

export async function deleteAutomation(formData: FormData) {
  const owner = await requireOwner();
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const timestamp = new Date().toISOString();
  if (isDemoMode) {
    const item = demoStore().automations.find((automation) => automation.id === id);
    if (item) { item.status = "deleted"; item.deletedAt = timestamp; item.updatedAt = timestamp; }
  } else {
    const supabase = await createSupabaseServerClient();
    await supabase.from("automations").update({ status: "deleted", deleted_at: timestamp }).eq("id", id).eq("owner_id", owner.id);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/automations?deleted=1");
}
