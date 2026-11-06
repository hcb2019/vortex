"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { contentPackageSchema, contentProjectInputSchema, creatorProfileSchema } from "@/lib/content-studio";
import { buildKeywordVariants, normalizeKeyword } from "@/lib/domain";
import { formatInstagramCaption, humanizeText } from "@/lib/humanizer";
import { getOpenAIErrorDetails, getStudioGenerationError, getStudioGenerationErrorCode } from "@/lib/openai-error";
import { ensureDatabaseWrite } from "@/lib/persistence";
import { env, isDemoMode } from "@/lib/env";
import { dedupeHashtags } from "@/lib/pipeline";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ContentStudioProvider, CONTENT_PROMPT_VERSION } from "@/server/content-studio/provider";
import { getContentProject, getCreatorProfile } from "@/server/content-studio/data";
import { generateStudioIdeas } from "@/server/content-studio/ideas";
import { getConnection } from "@/server/data";
import { demoStore, saveDemoAutomation } from "@/server/demo-store";
import type { StudioIdea } from "@/lib/studio-ideas";
import type { ContentPackage, ContentProject } from "@/types/content-studio";

export interface StudioActionState { error?: string; fields?: Record<string,string[]>; ideas?: StudioIdea[]; limitNote?: string; connected?: boolean }

const value = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function createContentProject(_state: StudioActionState, formData: FormData): Promise<StudioActionState> {
  const owner = await requireOwner();
  const secondary = value(formData, "secondaryGoal");
  const parsed = contentProjectInputSchema.safeParse({ title: value(formData,"title"), topic: value(formData,"topic"), pillar: value(formData,"pillar"), primaryGoal: value(formData,"primaryGoal"), secondaryGoal: secondary || null, hookIntensity: value(formData,"hookIntensity"), deliverableType: value(formData,"deliverableType"), notes: value(formData,"notes"), sourceInsightId: value(formData,"sourceInsightId") || null });
  if (!parsed.success) return { error: "Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors as Record<string,string[]> };
  const timestamp = new Date().toISOString();
  const base: ContentProject = { id: crypto.randomUUID(), ownerId: owner.id, ...parsed.data, status: "producing", concepts: [], selectedConceptIndex: null, contentPackage: null, mediaId: null, automationId: null, deliverableSlug: null, createdAt: timestamp, updatedAt: timestamp };
  const started = Date.now();
  try {
    const profile = await getCreatorProfile();
    const generation = await new ContentStudioProvider().generateConcepts(base, profile);
    if (isDemoMode) {
      base.concepts = generation.concepts; base.status = "idea"; demoStore().contentProjects.unshift(base);
    } else {
      const supabase = await createSupabaseServerClient();
      const { data: project, error } = await supabase.from("content_projects").insert({ id: base.id, owner_id: owner.id, source_insight_id: base.sourceInsightId, title: base.title, topic: base.topic, pillar: base.pillar, primary_goal: base.primaryGoal, secondary_goal: base.secondaryGoal, hook_intensity: base.hookIntensity, deliverable_type: base.deliverableType, notes: base.notes, status: "idea", concepts: generation.concepts }).select("id").single();
      if (error || !project) throw new Error("Não foi possível salvar o projeto.");
      await supabase.from("content_generation_runs").insert({ owner_id: owner.id, project_id: base.id, stage: "concepts", model: env.OPENAI_API_KEY ? env.OPENAI_AUDIENCE_MODEL : "local-fallback", prompt_version: CONTENT_PROMPT_VERSION, status: "succeeded", input_tokens: generation.usage.inputTokens, output_tokens: generation.usage.outputTokens, duration_ms: Date.now() - started });
      if (base.sourceInsightId) await supabase.from("audience_insights").update({ content_project_id: base.id, status: "converted" }).eq("id", base.sourceInsightId).eq("owner_id", owner.id);
    }
  } catch (error) {
    console.error("content_studio_generation_failed", getOpenAIErrorDetails(error));
    return { error: getStudioGenerationError(error) };
  }
  revalidatePath("/studio");
  redirect(`/studio/${base.id}`);
}

export async function generateContentPackage(formData: FormData) {
  const owner = await requireOwner();
  const id = value(formData,"id"); const selectedIndex = Number(value(formData,"conceptIndex"));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 2) return;
  const project = await getContentProject(id); const concept = project?.concepts[selectedIndex];
  if (!project || !concept) return;
  const started = Date.now();
  try {
    const profile = await getCreatorProfile();
    const generation = await new ContentStudioProvider().generatePackage(project, concept, profile);
    // Regenerating a material must improve the content in place. Keeping the
    // slug avoids breaking links that may already be present in an automation,
    // a Reel caption or a DM previously sent to the audience.
    const slug = project.deliverableSlug ?? randomBytes(16).toString("hex");
    if (isDemoMode) {
      Object.assign(project, { selectedConceptIndex: selectedIndex, contentPackage: generation.package, status: "ready", deliverableSlug: slug, updatedAt: new Date().toISOString() });
    } else {
      const supabase = await createSupabaseServerClient();
      const { error: savePackageError } = await supabase.rpc("save_content_package", {
        p_project_id: id,
        p_selected_concept_index: selectedIndex,
        p_content_package: generation.package,
        p_deliverable_type: project.deliverableType,
        p_deliverable_title: generation.package.deliverable.title,
        p_deliverable_summary: generation.package.deliverable.summary,
        p_deliverable_content: generation.package.deliverable,
        p_public_slug: slug,
        p_published_at: new Date().toISOString(),
      });
      ensureDatabaseWrite(savePackageError, "salvar o pacote");
      const { error: generationRunError } = await supabase.from("content_generation_runs").insert({ owner_id: owner.id, project_id: id, stage: "package", model: env.OPENAI_API_KEY ? env.OPENAI_AUDIENCE_MODEL : "local-fallback", prompt_version: CONTENT_PROMPT_VERSION, status: "succeeded", input_tokens: generation.usage.inputTokens, output_tokens: generation.usage.outputTokens, duration_ms: Date.now() - started });
      if (generationRunError) console.error("content_studio_package_run_record_failed", getOpenAIErrorDetails(generationRunError));
    }
  } catch (error) {
    console.error("content_studio_package_generation_failed", getOpenAIErrorDetails(error));
    redirect(`/studio/${id}?error=package_${getStudioGenerationErrorCode(error)}`);
  }
  revalidatePath(`/studio/${id}`); revalidatePath("/studio"); redirect(`/studio/${id}?generated=1`);
}

export async function regenerateContentConcepts(formData: FormData) {
  const owner = await requireOwner();
  const id = value(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const project = await getContentProject(id);
  if (!project || project.contentPackage) return;
  try {
    const profile = await getCreatorProfile();
    const generation = await new ContentStudioProvider().generateConcepts(project, profile);
    if (isDemoMode) {
      project.concepts = generation.concepts;
      project.status = "idea";
      project.updatedAt = new Date().toISOString();
    } else {
      const supabase = await createSupabaseServerClient();
      await supabase.from("content_projects").update({ concepts: generation.concepts, status: "idea" }).eq("id", id).eq("owner_id", owner.id);
    }
  } catch (error) {
    console.error("content_studio_concept_regeneration_failed", getOpenAIErrorDetails(error));
    redirect(`/studio/${id}?error=concepts`);
  }
  revalidatePath(`/studio/${id}`);
  redirect(`/studio/${id}?regenerated=1`);
}

export async function saveContentPackage(_state: StudioActionState, formData: FormData): Promise<StudioActionState> {
  const owner = await requireOwner(); const id = value(formData,"id"); const project = await getContentProject(id);
  if (!project?.contentPackage) return { error: "Projeto não encontrado." };
  const next: ContentPackage = { ...project.contentPackage, onScreenHook: humanizeText(value(formData,"onScreenHook")), visualDirection: humanizeText(value(formData,"visualDirection")), shortCaption: formatInstagramCaption(value(formData,"shortCaption")), mediumCaption: formatInstagramCaption(value(formData,"mediumCaption")), fullCaption: formatInstagramCaption(value(formData,"fullCaption")), selectedKeyword: value(formData,"selectedKeyword").normalize("NFKC").toLocaleUpperCase("pt-BR").replace(/[^\p{L}\p{N}]/gu,""), keywordSuggestions: formData.getAll("keywordSuggestions").map((item)=>String(item).normalize("NFKC").toLocaleUpperCase("pt-BR").replace(/[^\p{L}\p{N}]/gu,"")) as [string,string,string], publicReplies: formData.getAll("publicReplies").map((item)=>humanizeText(String(item))) as [string,string,string], dmMessages: formData.getAll("dmMessages").map((item)=>humanizeText(String(item))) as [string,string,string], hashtags: dedupeHashtags(formData.getAll("hashtags").map((item)=>String(item))).slice(0,5), deliverable: { ...project.contentPackage.deliverable, title: humanizeText(value(formData,"deliverableTitle")), summary: humanizeText(value(formData,"deliverableSummary")) } };
  const parsed = contentPackageSchema.safeParse(next);
  if (!parsed.success) return { error: "Revise os campos do pacote.", fields: parsed.error.flatten().fieldErrors as Record<string,string[]> };
  if (isDemoMode) { project.contentPackage = parsed.data; project.updatedAt = new Date().toISOString(); }
  else { const supabase = await createSupabaseServerClient(); await supabase.from("content_projects").update({ content_package: parsed.data }).eq("id", id).eq("owner_id", owner.id); await supabase.from("deliverables").update({ title: parsed.data.deliverable.title, summary: parsed.data.deliverable.summary, content: parsed.data.deliverable }).eq("project_id", id).eq("owner_id", owner.id); }
  revalidatePath(`/studio/${id}`); return {};
}

export async function createAutomationFromProject(formData: FormData) {
  const owner = await requireOwner(); const id = value(formData,"id"); const project = await getContentProject(id); const pack = project?.contentPackage;
  if (!project || !pack) return;
  if (project.automationId) redirect(`/automations/${project.automationId}/edit?source=studio`);
  if (!project.deliverableSlug) redirect(`/studio/${id}?error=deliverable`);
  const destinationUrl = `${env.APP_ORIGIN}/materiais/${project.deliverableSlug}`;
  if (isDemoMode) {
    const saved = saveDemoAutomation({ name: project.title.slice(0,80), mediaId: project.mediaId ?? "", keyword: pack.selectedKeyword, keywordVariants: buildKeywordVariants(pack.selectedKeyword), publicReply: pack.publicReplies[0], publicReplyVariants: pack.publicReplies, dmMessage: pack.dmMessages[0], dmMessageVariants: pack.dmMessages, destinationUrl, conversationFlow: { steps: [] }, appendUtmToButtons: true, requireFollow: false, followGateMessage: "Se você já me segue, digite PRONTO. Se não, me segue e depois volta aqui e digita PRONTO.", notFollowingMessage: "Poxa, você quer o conteúdo e ainda não me segue? Me segue primeiro e depois digita PRONTO aqui de novo.", status: "draft" });
    project.automationId = saved.id; project.status = "automation_draft"; redirect(`/automations/${saved.id}/edit?source=studio`);
  }
  const supabase = await createSupabaseServerClient(); const connection = await getConnection(); if (!connection) redirect(`/studio/${id}?error=connection`);
  const { data: automation } = await supabase.from("automations").insert({ owner_id: owner.id, connection_id: connection.id, media_id: project.mediaId, content_project_id: id, name: project.title.slice(0,80), keyword: pack.selectedKeyword, keyword_normalized: normalizeKeyword(pack.selectedKeyword), keyword_variants: buildKeywordVariants(pack.selectedKeyword), public_reply: pack.publicReplies[0], public_reply_variants: pack.publicReplies, dm_message: pack.dmMessages[0], dm_message_variants: pack.dmMessages, destination_url: destinationUrl, status: "draft" }).select("id").single();
  if (!automation) redirect(`/studio/${id}?error=automation`);
  await supabase.from("content_projects").update({ automation_id: automation.id, status: "automation_draft" }).eq("id",id).eq("owner_id",owner.id);
  revalidatePath("/studio"); redirect(`/automations/${automation.id}/edit?source=studio`);
}

export async function linkProjectMedia(formData: FormData) {
  const owner = await requireOwner(); const id=value(formData,"id"); const mediaId=value(formData,"mediaId");
  if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f-]{36}$/i.test(mediaId)) return;
  const project=await getContentProject(id); if(!project) return;
  if(isDemoMode){ const valid=demoStore().media.some((item)=>item.id===mediaId); if(valid){project.mediaId=mediaId; project.status=project.automationId?"automation_draft":"ready";} }
  else {const supabase=await createSupabaseServerClient(); const {data:media}=await supabase.from("instagram_media").select("id").eq("id",mediaId).eq("owner_id",owner.id).maybeSingle(); if(!media)return; await supabase.from("content_projects").update({media_id:mediaId,status:project.automationId?"automation_draft":"ready"}).eq("id",id).eq("owner_id",owner.id); if(project.automationId)await supabase.from("automations").update({media_id:mediaId}).eq("id",project.automationId).eq("owner_id",owner.id);}
  revalidatePath(`/studio/${id}`); revalidatePath("/studio"); redirect(`/studio/${id}?linked=1`);
}

export async function suggestStudioIdeas(_state: StudioActionState, formData: FormData): Promise<StudioActionState> {
  await requireOwner();
  void formData;
  try {
    const result = await generateStudioIdeas();
    return { ideas: result.ideas, limitNote: result.limitNote, connected: result.connected };
  } catch (error) {
    console.error("content_studio_ideas_failed", getOpenAIErrorDetails(error));
    return { error: getStudioGenerationError(error, "ideias automáticas") };
  }
}

export async function saveCreatorProfile(_state: StudioActionState, formData: FormData): Promise<StudioActionState> {
  const owner = await requireOwner(); const terms = (key: string) => value(formData,key).split(",").map((item)=>item.trim()).filter(Boolean);
  const parsed = creatorProfileSchema.safeParse({ instagramHandle:value(formData,"instagramHandle"), niche:value(formData,"niche"), audience:value(formData,"audience"), voice:value(formData,"voice"), preferredTerms:terms("preferredTerms"), avoidedTerms:terms("avoidedTerms"), defaultCta:value(formData,"defaultCta") });
  if (!parsed.success) return { error:"Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors as Record<string,string[]> };
  if (isDemoMode) demoStore().creatorProfile = parsed.data;
  else { const supabase = await createSupabaseServerClient(); await supabase.from("creator_profiles").upsert({ owner_id:owner.id, instagram_handle:parsed.data.instagramHandle, niche:parsed.data.niche, audience:parsed.data.audience, voice:parsed.data.voice, preferred_terms:parsed.data.preferredTerms, avoided_terms:parsed.data.avoidedTerms, default_cta:parsed.data.defaultCta }); }
  revalidatePath("/studio","layout"); return {};
}
