import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env, isDemoMode } from "@/lib/env";
import {
  buildKeywordVariants,
  keywordMatches,
  normalizeKeyword,
  selectReplyVariant,
} from "@/lib/domain";
import { createTrackingToken, decryptSecret } from "@/server/crypto";
import { instagramGateway } from "@/server/instagram";
import { MetaApiError } from "@/server/instagram/meta-gateway";
import {
  buildDirectUrlStep,
  buildQuickReplies,
  buildQuickReplyFallbackMessage,
  buildTrackedUrlButtons,
  findStepButton,
  firstConversationStep,
  getConversationFlowSnapshot,
  getStep,
  isUrlStep,
  parseConversationPayload,
} from "@/server/dm-flow";
import type { InstagramGateway, InstagramMessageEvent } from "@/server/instagram/types";
import type { AutomationFlowStep } from "@/lib/domain";

function metaDiagnosticCode(error: MetaApiError) {
  return error.subcode ? `${error.code ?? `HTTP_${error.status}`}/${error.subcode}` : error.code ?? `HTTP_${error.status}`;
}

function metaDiagnosticMessage(prefix: string, error: MetaApiError) {
  const details = [
    error.subcode ? `subcódigo ${error.subcode}` : null,
    error.requestId ? `requisição ${error.requestId}` : null,
  ].filter(Boolean).join(", ");
  return `${prefix}${details ? ` (${details})` : ""}: ${error.message}`;
}

async function sendPrivateReplyWithQuickReplies(
  gateway: InstagramGateway,
  userId: string,
  commentId: string,
  message: string,
  accessToken: string,
  quickReplies: Array<{ title: string; payload: string }>,
) {
  if (!quickReplies.length) return gateway.sendPrivateReply(userId, commentId, message, accessToken);
  try {
    return await gateway.sendPrivateReply(userId, commentId, message, accessToken, { quickReplies });
  } catch (error) {
    if (error instanceof MetaApiError && !error.transient && !error.ambiguous) {
      return gateway.sendPrivateReply(
        userId,
        commentId,
        buildQuickReplyFallbackMessage(message, quickReplies.map((reply) => ({ id: reply.payload, label: reply.title, nextStepId: null, url: null }))),
        accessToken,
      );
    }
    throw error;
  }
}

async function sendConversationUrlStep(
  gateway: InstagramGateway,
  instagramUserId: string,
  recipientId: string,
  run: Record<string, unknown>,
  step: AutomationFlowStep,
  accessToken: string,
) {
  const buttons = buildTrackedUrlButtons(step.buttons, String(run.automation_id), run.append_utm_to_buttons_snapshot !== false);
  if (!buttons.length) return null;
  return gateway.sendButtonTemplateMessage(
    instagramUserId,
    recipientId,
    step.text,
    buttons,
    accessToken,
  );
}

export async function ingestEvents(events: unknown[]) {
  if (isDemoMode) return { accepted: events.length, queued: 0 };
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("ingest_comment_events", { events });
  if (error) throw new Error("Não foi possível persistir os eventos.");
  return data as { accepted: number; queued: number };
}

export async function processQueueBatch(batchSize = 10) {
  if (isDemoMode) return { processed: 0 };
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("claim_queue_batch", { batch_size: Math.min(Math.max(batchSize, 1), 25) });
  if (error) throw new Error("Falha ao consumir a fila.");
  const messages = (data ?? []) as Array<{ msg_id: number; event_id: string }>;
  let processed = 0;
  for (const message of messages) {
    try {
      await processEvent(message.event_id);
      await supabase.rpc("complete_queue_message", { queue_message_id: message.msg_id });
      processed += 1;
    } catch {
      // O visibility timeout torna a mensagem disponível novamente.
    }
  }
  return { processed };
}

export async function retryPrivateReply(ownerId: string, runId: string) {
  if (isDemoMode) return { sent: true };
  const supabase = createSupabaseAdminClient();
  const { data: run } = await supabase
    .from("automation_runs")
    .select("*, automations!inner(connection_id)")
    .eq("id", runId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!run) throw new Error("Execução não encontrada.");
  if (run.dm_status !== "failed") throw new Error("A DM desta execução não está disponível para reenvio.");
  if (Date.now() - new Date(run.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) {
    throw new Error("A janela de sete dias da Meta terminou.");
  }

  const connectionId = (run.automations as { connection_id?: string } | null)?.connection_id;
  const { data: connection } = await supabase
    .from("instagram_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("owner_id", ownerId)
    .eq("status", "connected")
    .maybeSingle();
  if (!connection) throw new Error("Conexão do Instagram indisponível.");

  const { token, hash } = createTrackingToken();
  const attempts = Number(run.dm_attempts ?? 0) + 1;
  const accessToken = decryptSecret({
    ciphertext: connection.token_ciphertext,
    iv: connection.token_iv,
    tag: connection.token_tag,
  });
  const gateway = instagramGateway();

  try {
    const trackingUrl = `${env.APP_ORIGIN}/r/${token}`;
    const flow = getConversationFlowSnapshot(run.dm_conversation_flow_snapshot);
    const firstStep = firstConversationStep(flow);
    const usesConversation = !run.require_follow_snapshot && Boolean(firstStep);
    const message = run.require_follow_snapshot
      ? run.follow_gate_message_snapshot
      : firstStep
        ? firstStep.text
      : `${run.dm_message_snapshot}\n\n${trackingUrl}`;
    const reply = await sendPrivateReplyWithQuickReplies(
      gateway,
      connection.instagram_user_id,
      run.comment_id,
      message,
      accessToken,
      firstStep && !isUrlStep(firstStep) ? buildQuickReplies(run.id, firstStep) : [],
    );
    const status = run.require_follow_snapshot
      ? "processing"
      : usesConversation
        ? "processing"
      : run.public_reply_status === "succeeded"
        ? "succeeded"
        : run.public_reply_status === "ambiguous"
          ? "ambiguous"
          : "partial";
    const completedAt = run.require_follow_snapshot || usesConversation ? null : new Date().toISOString();
    const { error } = await supabase
      .from("automation_runs")
      .update({
        tracking_token_hash: hash,
        dm_status: "succeeded",
        dm_message_id: reply.messageId,
        dm_recipient_id: reply.recipientId,
        dm_attempts: attempts,
        status,
        follow_status: run.require_follow_snapshot ? "awaiting_reply" : "not_required",
        conversation_status: usesConversation ? "awaiting_reply" : "not_required",
        conversation_current_step_id: usesConversation ? firstStep?.id ?? null : null,
        content_delivered_at: run.require_follow_snapshot || usesConversation ? null : completedAt,
        error_code: null,
        error_message: null,
        completed_at: completedAt,
      })
      .eq("id", run.id)
      .eq("owner_id", ownerId);
    if (error) {
      throw new MetaApiError(
        "A DM pode ter sido enviada, mas o histórico não confirmou a gravação.",
        0,
        "PERSISTENCE_AFTER_SEND",
        undefined,
        true,
      );
    }
    return { sent: true };
  } catch (error) {
    const ambiguous = error instanceof MetaApiError && error.ambiguous;
    const errorCode = error instanceof MetaApiError
      ? metaDiagnosticCode(error)
      : "PRIVATE_REPLY_RETRY_FAILED";
    const errorMessage = error instanceof MetaApiError
      ? metaDiagnosticMessage("Mensagem privada", error)
      : error instanceof Error
        ? error.message
        : "Não foi possível confirmar a mensagem privada.";
    await supabase
      .from("automation_runs")
      .update({
        dm_status: ambiguous ? "ambiguous" : "failed",
        dm_attempts: attempts,
        status: ambiguous ? "ambiguous" : run.public_reply_status === "succeeded" ? "partial" : "failed",
        follow_status: run.require_follow_snapshot ? "failed" : "not_required",
        conversation_status: getConversationFlowSnapshot(run.dm_conversation_flow_snapshot).steps.length ? "failed" : "not_required",
        error_code: errorCode,
        error_message: errorMessage.slice(0, 400),
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .eq("owner_id", ownerId);
    throw error;
  }
}

async function processEvent(eventId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: event } = await supabase.from("comment_events").select("*").eq("id", eventId).single();
  if (!event || event.processed_at) return;
  const { data: connection } = await supabase.from("instagram_connections").select("*").eq("id", event.connection_id).single();
  if (!connection || connection.status !== "connected") {
    await supabase.from("comment_events").update({ outcome: "connection_unavailable", processed_at: new Date().toISOString() }).eq("id", eventId);
    return;
  }
  const { data: media } = await supabase.from("instagram_media").select("id").eq("connection_id", connection.id).eq("external_id", event.media_external_id).maybeSingle();
  if (!media) {
    await supabase.from("comment_events").update({ outcome: "wrong_media", processed_at: new Date().toISOString() }).eq("id", eventId);
    return;
  }
  const { data: candidates } = await supabase.from("automations").select("*").eq("media_id", media.id).eq("status", "active").is("deleted_at", null);
  const automation = (candidates ?? []).find((item) =>
    keywordMatches(
      event.comment_text,
      item.keyword,
      Array.isArray(item.keyword_variants) && item.keyword_variants.length
        ? item.keyword_variants
        : buildKeywordVariants(item.keyword),
    ),
  );
  if (!automation) {
    await supabase.from("comment_events").update({ outcome: "not_matched", processed_at: new Date().toISOString() }).eq("id", eventId);
    return;
  }
  const { token, hash } = createTrackingToken();
  const publicReply = selectReplyVariant(
    event.comment_id,
    Array.isArray(automation.public_reply_variants)
      ? automation.public_reply_variants
      : [automation.public_reply],
  ) || automation.public_reply;
  const dmMessage = selectReplyVariant(
    `dm:${event.comment_id}`,
    Array.isArray(automation.dm_message_variants)
      ? automation.dm_message_variants
      : [automation.dm_message],
  ) || automation.dm_message;
  const conversationFlow = getConversationFlowSnapshot(automation.dm_conversation_flow);
  const firstStep = firstConversationStep(conversationFlow);
  const usesConversation = !automation.require_follow && Boolean(firstStep);
  const { data: run, error: runError } = await supabase.from("automation_runs").insert({
    owner_id: automation.owner_id, automation_id: automation.id, comment_event_id: event.id,
    automation_name_snapshot: automation.name, automation_version: automation.version,
    media_external_id: event.media_external_id, comment_id: event.comment_id,
    commenter_scoped_id: event.commenter_scoped_id, commenter_username: event.commenter_username,
    comment_text: event.comment_text, public_reply_snapshot: publicReply,
    dm_message_snapshot: dmMessage, destination_url_snapshot: automation.destination_url,
    require_follow_snapshot: automation.require_follow,
    follow_gate_message_snapshot: automation.follow_gate_message,
    not_following_message_snapshot: automation.not_following_message,
    follow_status: automation.require_follow ? "awaiting_reply" : "not_required",
    dm_conversation_flow_snapshot: conversationFlow,
    append_utm_to_buttons_snapshot: automation.append_utm_to_buttons !== false,
    conversation_status: usesConversation ? "awaiting_reply" : "not_required",
    conversation_current_step_id: usesConversation ? firstStep?.id ?? null : null,
    conversation_answers: [],
    tracking_token_hash: hash, status: "processing",
  }).select("id").single();
  if (runError?.code === "23505") {
    await supabase.from("comment_events").update({ outcome: "duplicate", processed_at: new Date().toISOString() }).eq("id", eventId);
    return;
  }
  if (!run) throw new Error("Falha ao criar execução.");

  await supabase.from("comment_events").update({ automation_id: automation.id, outcome: "matched" }).eq("id", eventId);
  const accessToken = decryptSecret({ ciphertext: connection.token_ciphertext, iv: connection.token_iv, tag: connection.token_tag });
  const gateway = instagramGateway();
  let publicStatus: "succeeded" | "failed" | "ambiguous" = "succeeded";
  let dmStatus: "succeeded" | "failed" | "ambiguous" = "succeeded";
  let publicId: string | null = null;
  let messageId: string | null = null;
  let recipientId: string | null = null;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const reply = await gateway.replyToComment(event.comment_id, publicReply, accessToken);
    publicId = reply.id;
  } catch (error) {
    publicStatus = error instanceof MetaApiError && error.ambiguous ? "ambiguous" : "failed";
    errorCode = error instanceof MetaApiError ? metaDiagnosticCode(error) : "PUBLIC_REPLY_FAILED";
    errorMessage = error instanceof MetaApiError
      ? metaDiagnosticMessage("Resposta pública", error)
      : "Não foi possível confirmar a resposta pública.";
  }
  try {
    const trackingUrl = `${env.APP_ORIGIN}/r/${token}`;
    const privateMessage = automation.require_follow
      ? automation.follow_gate_message
      : firstStep
        ? firstStep.text
      : `${dmMessage}\n\n${trackingUrl}`;
    const reply = await sendPrivateReplyWithQuickReplies(
      gateway,
      connection.instagram_user_id,
      event.comment_id,
      privateMessage,
      accessToken,
      firstStep && !isUrlStep(firstStep) ? buildQuickReplies(run.id, firstStep) : [],
    );
    messageId = reply.messageId;
    recipientId = reply.recipientId;
  } catch (error) {
    dmStatus = error instanceof MetaApiError && error.ambiguous ? "ambiguous" : "failed";
    errorCode ??= error instanceof MetaApiError ? metaDiagnosticCode(error) : "PRIVATE_REPLY_FAILED";
    errorMessage ??= error instanceof MetaApiError
      ? metaDiagnosticMessage("Mensagem privada", error)
      : "Não foi possível confirmar a mensagem privada.";
  }
  const status = (automation.require_follow || usesConversation) && dmStatus === "succeeded"
    ? "processing"
    : publicStatus === "succeeded" && dmStatus === "succeeded"
      ? "succeeded"
      : publicStatus === "failed" && dmStatus === "failed"
        ? "failed"
        : publicStatus === "ambiguous" || dmStatus === "ambiguous"
          ? "ambiguous"
          : "partial";
  const completedAt = new Date().toISOString();
  await supabase.from("automation_runs").update({
    status, public_reply_status: publicStatus, dm_status: dmStatus, public_reply_id: publicId,
    dm_message_id: messageId, dm_recipient_id: recipientId, public_reply_attempts: 1, dm_attempts: 1,
    follow_status: automation.require_follow
      ? dmStatus === "succeeded" ? "awaiting_reply" : "failed"
      : "not_required",
    conversation_status: usesConversation ? dmStatus === "succeeded" ? "awaiting_reply" : "failed" : "not_required",
    content_delivered_at: !automation.require_follow && !usesConversation && dmStatus === "succeeded" ? completedAt : null,
    error_code: errorCode, error_message: errorMessage,
    completed_at: (automation.require_follow || usesConversation) && dmStatus === "succeeded" ? null : completedAt,
  }).eq("id", run.id);
  await supabase.from("comment_events").update({ processed_at: completedAt }).eq("id", eventId);
}

export async function processIncomingMessages(events: InstagramMessageEvent[]) {
  if (isDemoMode) return { received: events.length, processed: events.length };
  const supabase = createSupabaseAdminClient();
  let received = 0;
  let processed = 0;

  for (const event of events) {
    if (!event.text.trim() && !event.quickReplyPayload && !event.postbackPayload) continue;
    const { data: connection } = await supabase
      .from("instagram_connections")
      .select("*")
      .eq("instagram_user_id", event.instagramUserId)
      .eq("status", "connected")
      .maybeSingle();
    if (!connection) continue;

    const { data: inserted, error: insertError } = await supabase
      .from("instagram_message_events")
      .insert({
        owner_id: connection.owner_id,
        connection_id: connection.id,
        message_id: event.messageId,
        sender_scoped_id: event.senderScopedId,
        message_text: event.text.slice(0, 1000),
      })
      .select("id")
      .maybeSingle();
    if (insertError?.code === "23505") continue;
    if (insertError || !inserted) throw new Error("Não foi possível registrar a mensagem recebida.");
    received += 1;

    const accessToken = decryptSecret({
      ciphertext: connection.token_ciphertext,
      iv: connection.token_iv,
      tag: connection.token_tag,
    });
    const gateway = instagramGateway();
    const checkedAt = new Date().toISOString();
    const conversationPayload = parseConversationPayload(event.quickReplyPayload ?? event.postbackPayload);
    if (conversationPayload) {
      const { data: conversationRun } = await supabase
        .from("automation_runs")
        .select("*")
        .eq("id", conversationPayload.runId)
        .eq("owner_id", connection.owner_id)
        .eq("dm_recipient_id", event.senderScopedId)
        .eq("conversation_status", "awaiting_reply")
        .maybeSingle();
      if (!conversationRun) {
        await supabase.from("instagram_message_events").update({
          outcome: "no_pending_gate",
          processed_at: checkedAt,
        }).eq("id", inserted.id);
        processed += 1;
        continue;
      }
      try {
        const flow = getConversationFlowSnapshot(conversationRun.dm_conversation_flow_snapshot);
        const currentStep = getStep(flow, conversationPayload.stepId);
        const selectedButton = currentStep ? findStepButton(currentStep, conversationPayload.buttonId) : null;
        if (!currentStep || !selectedButton) {
          await supabase.from("instagram_message_events").update({
            outcome: "no_pending_gate",
            processed_at: checkedAt,
          }).eq("id", inserted.id);
          processed += 1;
          continue;
        }
        const previousAnswers = Array.isArray(conversationRun.conversation_answers)
          ? conversationRun.conversation_answers
          : [];
        const conversationAnswers = [...previousAnswers, {
          stepId: currentStep.id,
          stepText: currentStep.text,
          buttonId: selectedButton.id,
          label: selectedButton.label,
          answeredAt: checkedAt,
        }];
        const nextStep = selectedButton.nextStepId ? getStep(flow, selectedButton.nextStepId) : null;
        const directUrlStep = selectedButton.url ? buildDirectUrlStep(selectedButton) : null;
        const stepToSend = nextStep ?? directUrlStep;
        if (!stepToSend) {
          await supabase.from("automation_runs").update({
            conversation_answers: conversationAnswers,
            conversation_status: "completed",
            conversation_current_step_id: null,
          }).eq("id", conversationRun.id);
          await supabase.from("instagram_message_events").update({
            outcome: "content_delivered",
            processed_at: checkedAt,
          }).eq("id", inserted.id);
          processed += 1;
          continue;
        }
        const urlStep = isUrlStep(stepToSend);
        const reply = urlStep
          ? await sendConversationUrlStep(gateway, connection.instagram_user_id, event.senderScopedId, conversationRun, stepToSend, accessToken)
          : await gateway.sendTextMessage(
            connection.instagram_user_id,
            event.senderScopedId,
            stepToSend.text,
            accessToken,
            { quickReplies: buildQuickReplies(conversationRun.id, stepToSend) },
          );
        if (!reply) throw new MetaApiError("O passo final não possui botões de URL válidos.", 400, "INVALID_CONVERSATION_STEP");
        const finalStatus = conversationRun.public_reply_status === "succeeded"
          ? "succeeded"
          : conversationRun.public_reply_status === "ambiguous"
            ? "ambiguous"
            : "partial";
        const { error: updateError } = await supabase.from("automation_runs").update({
          status: urlStep ? finalStatus : "processing",
          conversation_status: urlStep ? "completed" : "awaiting_reply",
          conversation_current_step_id: urlStep ? null : stepToSend.id,
          conversation_answers: conversationAnswers,
          dm_delivery_message_id: reply.messageId,
          dm_attempts: Number(conversationRun.dm_attempts ?? 0) + 1,
          content_delivered_at: urlStep ? checkedAt : null,
          completed_at: urlStep ? checkedAt : null,
          error_code: null,
          error_message: null,
        }).eq("id", conversationRun.id);
        if (updateError) {
          throw new MetaApiError(
            "O conteúdo pode ter sido enviado, mas o histórico não confirmou a gravação.",
            0,
            "PERSISTENCE_AFTER_SEND",
            undefined,
            true,
          );
        }
        await supabase.from("instagram_message_events").update({
          outcome: urlStep ? "content_delivered" : "received",
          processed_at: checkedAt,
        }).eq("id", inserted.id);
        processed += 1;
        continue;
      } catch (error) {
        const ambiguous = error instanceof MetaApiError && error.ambiguous;
        const errorCode = error instanceof MetaApiError ? metaDiagnosticCode(error) : "CONVERSATION_STEP_FAILED";
        const errorMessage = error instanceof MetaApiError
          ? metaDiagnosticMessage("Fluxo de conversa", error)
          : "Não foi possível avançar a conversa no direct.";
        await supabase.from("automation_runs").update({
          status: ambiguous ? "ambiguous" : "processing",
          conversation_status: ambiguous ? "awaiting_reply" : "failed",
          error_code: errorCode,
          error_message: errorMessage.slice(0, 400),
        }).eq("id", conversationRun.id);
        await supabase.from("instagram_message_events").update({
          outcome: "failed",
          processed_at: new Date().toISOString(),
        }).eq("id", inserted.id);
        processed += 1;
        continue;
      }
    }

    const { data: run } = await supabase
      .from("automation_runs")
      .select("*")
      .eq("owner_id", connection.owner_id)
      .eq("dm_recipient_id", event.senderScopedId)
      .eq("require_follow_snapshot", true)
      .in("follow_status", ["awaiting_reply", "not_following"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!run) {
      await supabase.from("instagram_message_events").update({
        outcome: "no_pending_gate",
        processed_at: new Date().toISOString(),
      }).eq("id", inserted.id);
      processed += 1;
      continue;
    }

    try {
      const follows = await gateway.getUserFollowStatus(event.senderScopedId, accessToken);
      if (!follows) {
        await gateway.sendTextMessage(
          connection.instagram_user_id,
          event.senderScopedId,
          run.not_following_message_snapshot,
          accessToken,
        );
        await supabase.from("automation_runs").update({
          follow_status: "not_following",
          follow_checked_at: checkedAt,
          dm_attempts: Number(run.dm_attempts ?? 0) + 1,
          error_code: null,
          error_message: null,
        }).eq("id", run.id);
        await supabase.from("instagram_message_events").update({
          outcome: "not_following",
          processed_at: checkedAt,
        }).eq("id", inserted.id);
        processed += 1;
        continue;
      }

      const { token, hash } = createTrackingToken();
      const trackingUrl = `${env.APP_ORIGIN}/r/${token}`;
      const flow = getConversationFlowSnapshot(run.dm_conversation_flow_snapshot);
      const firstStep = firstConversationStep(flow);
      const reply = firstStep
        ? await gateway.sendTextMessage(
          connection.instagram_user_id,
          event.senderScopedId,
          firstStep.text,
          accessToken,
          { quickReplies: isUrlStep(firstStep) ? [] : buildQuickReplies(run.id, firstStep) },
        )
        : await gateway.sendTextMessage(
          connection.instagram_user_id,
          event.senderScopedId,
          `${run.dm_message_snapshot}\n\n${trackingUrl}`,
          accessToken,
        );
      const finalStatus = run.public_reply_status === "succeeded"
        ? "succeeded"
        : run.public_reply_status === "ambiguous"
          ? "ambiguous"
          : "partial";
      const { error: updateError } = await supabase.from("automation_runs").update({
        tracking_token_hash: hash,
        status: firstStep ? "processing" : finalStatus,
        follow_status: "verified",
        conversation_status: firstStep ? "awaiting_reply" : "not_required",
        conversation_current_step_id: firstStep?.id ?? null,
        follow_checked_at: checkedAt,
        dm_delivery_message_id: reply.messageId,
        dm_attempts: Number(run.dm_attempts ?? 0) + 1,
        content_delivered_at: firstStep ? null : checkedAt,
        completed_at: firstStep ? null : checkedAt,
        error_code: null,
        error_message: null,
      }).eq("id", run.id);
      if (updateError) {
        throw new MetaApiError(
          "O conteúdo pode ter sido enviado, mas o histórico não confirmou a gravação.",
          0,
          "PERSISTENCE_AFTER_SEND",
          undefined,
          true,
        );
      }
      await supabase.from("instagram_message_events").update({
        outcome: "content_delivered",
        processed_at: checkedAt,
      }).eq("id", inserted.id);
      processed += 1;
    } catch (error) {
      const ambiguous = error instanceof MetaApiError && error.ambiguous;
      const errorCode = error instanceof MetaApiError ? metaDiagnosticCode(error) : "FOLLOW_CHECK_FAILED";
      const errorMessage = error instanceof MetaApiError
        ? metaDiagnosticMessage("Confirmação de seguidor", error)
        : "Não foi possível confirmar se a pessoa segue o perfil.";
      await supabase.from("automation_runs").update({
        status: ambiguous ? "ambiguous" : "processing",
        error_code: errorCode,
        error_message: errorMessage.slice(0, 400),
      }).eq("id", run.id);
      await supabase.from("instagram_message_events").update({
        outcome: "failed",
        processed_at: new Date().toISOString(),
      }).eq("id", inserted.id);
      processed += 1;
    }
  }

  return { received, processed };
}

export async function recoverPendingFollowerMessages(limit = 10) {
  if (isDemoMode) return { checked: 0, recovered: 0, processed: 0 };
  const supabase = createSupabaseAdminClient();
  const oldestAllowed = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pendingRuns, error } = await supabase
    .from("automation_runs")
    .select("id,owner_id,dm_recipient_id,created_at,automations!inner(connection_id)")
    .eq("require_follow_snapshot", true)
    .in("follow_status", ["awaiting_reply", "not_following"])
    .not("dm_recipient_id", "is", null)
    .gte("created_at", oldestAllowed)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 20));
  if (error) throw new Error("Não foi possível consultar confirmações pendentes.");

  const gateway = instagramGateway();
  const recoveredEvents: InstagramMessageEvent[] = [];
  const checkedRecipients = new Set<string>();
  for (const run of pendingRuns ?? []) {
    const recipientId = run.dm_recipient_id as string;
    const connectionId = (run.automations as { connection_id?: string } | null)?.connection_id;
    const lookupKey = `${connectionId ?? run.owner_id}:${recipientId}`;
    if (checkedRecipients.has(lookupKey)) continue;
    checkedRecipients.add(lookupKey);

    const { data: connection } = await supabase
      .from("instagram_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("status", "connected")
      .maybeSingle();
    if (!connection) continue;

    try {
      const accessToken = decryptSecret({
        ciphertext: connection.token_ciphertext,
        iv: connection.token_iv,
        tag: connection.token_tag,
      });
      const messages = await gateway.listRecentInboundMessages(
        connection.instagram_user_id,
        recipientId,
        new Date(run.created_at),
        accessToken,
      );
      const confirmation = messages.find((message) => normalizeKeyword(message.text) === "pronto");
      if (!confirmation) continue;
      recoveredEvents.push({
        instagramUserId: connection.instagram_user_id,
        messageId: confirmation.messageId,
        senderScopedId: recipientId,
        recipientId: connection.instagram_user_id,
        text: confirmation.text,
        quickReplyPayload: null,
        postbackPayload: null,
        isEcho: false,
      });
    } catch (recoveryError) {
      console.warn("Instagram conversation recovery failed", {
        error: recoveryError instanceof MetaApiError
          ? metaDiagnosticCode(recoveryError)
          : recoveryError instanceof Error
            ? recoveryError.name
            : "UnknownError",
      });
    }
  }

  const result = recoveredEvents.length
    ? await processIncomingMessages(recoveredEvents)
    : { received: 0, processed: 0 };
  return {
    checked: checkedRecipients.size,
    recovered: result.received,
    processed: result.processed,
  };
}
