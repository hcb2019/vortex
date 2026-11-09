"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Check, ExternalLink, Film, Image as ImageIcon, Images, Lightbulb, LoaderCircle, MessageCircle, Plus, RefreshCw, Search, Send, Sparkles, Trash2, UserCheck } from "lucide-react";
import { instagramMediaCaption, instagramMediaKindLabel } from "@/lib/instagram-media";
import {
  saveAutomation,
  suggestAutomationMessages,
  type AutomationActionState,
} from "@/features/automations/actions";
import { Button, Card } from "@/components/ui";
import type { AutomationMessageSuggestion } from "@/lib/automation-suggestions";
import { buildKeywordVariants, DEFAULT_FOLLOW_GATE_MESSAGE, DEFAULT_NOT_FOLLOWING_MESSAGE } from "@/lib/domain";
import type { Automation, AutomationFlowButton, AutomationFlowStep, InstagramMedia } from "@/types/domain";

function FieldError({ messages }: { messages?: string[] }) {
  return messages?.[0] ? <span className="field-error">{messages[0]}</span> : null;
}

const AUTO_SYNC_STALE_MS = 5 * 60 * 1000;

function shouldAutoSyncMedia(lastMediaSyncAt: string | null | undefined) {
  if (!lastMediaSyncAt) return true;
  return Date.now() - new Date(lastMediaSyncAt).getTime() >= AUTO_SYNC_STALE_MS;
}

function MediaCoverFallback({ media }: { media: InstagramMedia }) {
  const Icon = media.mediaType === "CAROUSEL_ALBUM" ? Images : media.mediaType === "IMAGE" ? ImageIcon : Film;
  return <span className="reel-cover-fallback"><Icon size={28} /><small>Sem capa</small></span>;
}

export function AutomationForm({ automation, media, lastMediaSyncAt, canSyncMedia = true, connectionId }: { automation?: Automation; media: InstagramMedia[]; lastMediaSyncAt?: string | null; canSyncMedia?: boolean; connectionId?: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<AutomationActionState, FormData>(saveAutomation, {});
  const [suggestionPending, startSuggestionTransition] = useTransition();
  const [syncPending, setSyncPending] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [name, setName] = useState(automation?.name ?? "");
  const [keyword, setKeyword] = useState(automation?.keyword ?? "");
  const [keywordVariants, setKeywordVariants] = useState(
    automation?.keywordVariants?.length
      ? automation.keywordVariants
      : buildKeywordVariants(automation?.keyword ?? ""),
  );
  const [publicReplies, setPublicReplies] = useState(() => {
    const existing = automation?.publicReplyVariants?.length
      ? automation.publicReplyVariants
      : automation?.publicReply
        ? [automation.publicReply]
        : [];
    return [...existing, "", ""].slice(0, Math.max(3, existing.length));
  });
  const [dmMessages, setDmMessages] = useState(() => {
    const existing = automation?.dmMessageVariants?.length
      ? automation.dmMessageVariants
      : automation?.dmMessage
        ? [automation.dmMessage]
        : [""];
    return existing;
  });
  const [destination, setDestination] = useState(automation?.destinationUrl ?? "");
  const [flowSteps, setFlowSteps] = useState<AutomationFlowStep[]>(() => automation?.conversationFlow.steps.length ? automation.conversationFlow.steps : []);
  const [appendUtmToButtons, setAppendUtmToButtons] = useState(automation?.appendUtmToButtons ?? true);
  const [requireFollow, setRequireFollow] = useState(automation?.requireFollow ?? false);
  const [followGateMessage, setFollowGateMessage] = useState(automation?.followGateMessage || DEFAULT_FOLLOW_GATE_MESSAGE);
  const [notFollowingMessage, setNotFollowingMessage] = useState(automation?.notFollowingMessage || DEFAULT_NOT_FOLLOWING_MESSAGE);
  const [selectedMediaId, setSelectedMediaId] = useState(automation?.mediaId ?? "");
  const [reelQuery, setReelQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AutomationMessageSuggestion[]>([]);
  const [suggestionError, setSuggestionError] = useState("");
  const [suggestionGeneration, setSuggestionGeneration] = useState(0);
  const normalizedQuery = reelQuery.trim().toLocaleLowerCase("pt-BR");
  const visibleMedia = normalizedQuery
    ? media.filter((item) => item.caption.toLocaleLowerCase("pt-BR").includes(normalizedQuery))
    : media;
  const selectedMedia = media.find((item) => item.id === selectedMediaId);
  const dmPreview = dmMessages.find((message) => message.trim()) ?? "";
  const firstFlowStep = flowSteps[0];
  const previewFinalStep = flowSteps.find((step) => step.buttons.some((button) => button.url));

  async function syncMedia(source: "manual" | "auto") {
    if (!canSyncMedia) {
      setSyncError("Conecte o Instagram antes de atualizar as publicações.");
      return;
    }
    setSyncPending(true);
    setSyncError("");
    if (source === "manual") setSyncMessage("");
    try {
      const body = new FormData();
      if (connectionId) body.set("connectionId", connectionId);
      const response = await fetch("/api/meta/media/sync", { method: "POST", headers: { Accept: "application/json" }, body });
      const result = await response.json() as { synced?: number; skipped?: boolean; message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível atualizar as publicações.");
      setSyncMessage(result.message ?? (result.skipped ? "As publicações já estavam atualizadas." : "Publicações atualizadas."));
      router.refresh();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Não foi possível atualizar as publicações.");
    } finally {
      setSyncPending(false);
    }
  }

  useEffect(() => {
    if (!canSyncMedia) return;
    if (!shouldAutoSyncMedia(lastMediaSyncAt)) return;
    const storageKey = "vortex:auto-sync-reels:last-attempt";
    const lastAttempt = Number(sessionStorage.getItem(storageKey) ?? 0);
    if (Date.now() - lastAttempt < AUTO_SYNC_STALE_MS) return;
    sessionStorage.setItem(storageKey, String(Date.now()));
    const syncTimer = window.setTimeout(() => {
      void syncMedia("auto");
    }, 0);
    return () => window.clearTimeout(syncTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSyncMedia, lastMediaSyncAt]);

  function selectMedia(id: string) {
    setSelectedMediaId(id);
    setSuggestions([]);
    setSuggestionError("");
  }

  function generateSuggestions() {
    if (!selectedMediaId) return;
    setSuggestionError("");
    const nextGeneration = suggestionGeneration + 1;
    setSuggestionGeneration(nextGeneration);
    startSuggestionTransition(async () => {
      const result = await suggestAutomationMessages(selectedMediaId, nextGeneration);
      if ("error" in result) {
        setSuggestions([]);
        setSuggestionError(result.error);
        return;
      }
      setSuggestions(result.suggestions);
    });
  }

  function updateKeyword(value: string) {
    setKeyword(value);
    setKeywordVariants(buildKeywordVariants(value));
  }

  function applyAllSuggestions() {
    setPublicReplies((current) => {
      const extras = current.slice(3);
      return [...suggestions.map((item) => item.publicReply), ...extras];
    });
    setDmMessages(suggestions.map((item) => item.dmMessage));
  }

  function applySuggestion(suggestion: AutomationMessageSuggestion) {
    setPublicReplies((current) => {
      const next = [...current];
      const emptyIndex = next.findIndex((value) => !value.trim());
      next[emptyIndex >= 0 ? emptyIndex : 0] = suggestion.publicReply;
      return next;
    });
    setDmMessages((current) => {
      const next = [...current];
      const emptyIndex = next.findIndex((value) => !value.trim());
      next[emptyIndex >= 0 ? emptyIndex : 0] = suggestion.dmMessage;
      return next;
    });
  }

  function updatePublicReply(index: number, value: string) {
    setPublicReplies((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function removePublicReply(index: number) {
    setPublicReplies((current) => current.length > 3 ? current.filter((_, itemIndex) => itemIndex !== index) : current);
  }

  function updateDmMessage(index: number, value: string) {
    setDmMessages((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function removeDmMessage(index: number) {
    setDmMessages((current) => current.length > 1 ? current.filter((_, itemIndex) => itemIndex !== index) : current);
  }

  function addFlowStep() {
    setFlowSteps((current) => [...current, { id: `step-${current.length + 1}`, text: "", buttons: [{ id: "choice-1", label: "", nextStepId: null, url: null }] }]);
  }

  function updateFlowStep(index: number, patch: Partial<AutomationFlowStep>) {
    setFlowSteps((current) => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  function removeFlowStep(index: number) {
    setFlowSteps((current) => current.filter((_, stepIndex) => stepIndex !== index));
  }

  function addFlowButton(stepIndex: number) {
    setFlowSteps((current) => current.map((step, index) => index === stepIndex ? { ...step, buttons: [...step.buttons, { id: `choice-${step.buttons.length + 1}`, label: "", nextStepId: null, url: null }] } : step));
  }

  function updateFlowButton(stepIndex: number, buttonIndex: number, patch: Partial<AutomationFlowButton>) {
    setFlowSteps((current) => current.map((step, index) => index === stepIndex ? { ...step, buttons: step.buttons.map((button, nestedIndex) => nestedIndex === buttonIndex ? { ...button, ...patch } : button) } : step));
  }

  function removeFlowButton(stepIndex: number, buttonIndex: number) {
    setFlowSteps((current) => current.map((step, index) => index === stepIndex ? { ...step, buttons: step.buttons.filter((_, nestedIndex) => nestedIndex !== buttonIndex) } : step));
  }

  return <form action={action} className="automation-layout">
    {automation && <input type="hidden" name="id" value={automation.id} />}
    <section className="form-stack">
      {state.error && <div className="form-alert" role="alert">{state.error}</div>}
      <Card className="form-section"><div className="section-kicker">01 · Identidade</div><h2>O que esta automação faz?</h2>
        <label><span>Nome interno</span><input name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Carrossel — Guia de lançamento" maxLength={80} aria-invalid={Boolean(state.fields?.name) && !name.trim()} /><FieldError messages={state.fields?.name} /></label>
        <fieldset className={`reel-picker${state.fields?.mediaId ? " field-invalid" : ""}`} aria-invalid={Boolean(state.fields?.mediaId)}>
          <legend>Publicação vinculada</legend>
          <div className="reel-picker-toolbar">
            <div className="reel-search"><Search size={15} aria-hidden="true" /><input value={reelQuery} onChange={(event) => setReelQuery(event.target.value)} placeholder="Buscar pela legenda…" aria-label="Buscar publicação pela legenda" /></div>
            <button type="button" className="reel-sync-button" onClick={() => syncMedia("manual")} disabled={syncPending || !canSyncMedia}>
              {syncPending ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
              {syncPending ? "Atualizando…" : "Atualizar publicações"}
            </button>
            <span>{visibleMedia.length} de {media.length} publicações</span>
          </div>
          {syncError && <p className="suggestion-error" role="alert">{syncError}</p>}
          {syncMessage && !syncError && <p className="form-success reel-sync-status" role="status">{syncMessage}</p>}
          <div className="reel-grid" role="radiogroup" aria-label="Escolha a publicação da automação">
            {visibleMedia.map((item) => {
              const selected = selectedMediaId === item.id;
              const kindLabel = instagramMediaKindLabel(item);
              return <label className={`reel-option${selected ? " selected" : ""}`} key={item.id} aria-label={`${kindLabel}: ${instagramMediaCaption(item)}`}>
                <input type="radio" name="mediaId" value={item.id} checked={selected} onChange={() => selectMedia(item.id)} />
                <span className="reel-cover">
                  {item.thumbnailUrl
                    ? <Image src={item.thumbnailUrl} alt="" fill sizes="(max-width: 470px) 42vw, (max-width: 760px) 28vw, 180px" unoptimized />
                    : <MediaCoverFallback media={item} />}
                  <span className="reel-type-badge">{kindLabel}</span>
                  <span className="reel-selected-mark"><Check size={14} /></span>
                </span>
                <span className="reel-option-copy">
                  <strong>{instagramMediaCaption(item)}</strong>
                  <small>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(item.publishedAt))}</small>
                </span>
              </label>;
            })}
          </div>
          {!visibleMedia.length && <div className="reel-empty"><Film size={22} /><span>Nenhuma publicação encontrada para essa busca.</span></div>}
          <FieldError messages={state.fields?.mediaId} />
        </fieldset>
      </Card>
      <Card className="form-section"><div className="section-kicker">02 · Gatilho</div><h2>Qual comentário inicia o fluxo?</h2>
        <label><span>Palavra-chave</span><input name="keyword" value={keyword} onChange={(event) => updateKeyword(event.target.value)} placeholder="1991" maxLength={80} aria-invalid={Boolean(state.fields?.keyword) && !keyword.trim()} /><small>Aceitamos maiúsculas, espaços extras, pontuação final, plural e erros simples com uma letra ausente.</small><FieldError messages={state.fields?.keyword} /></label>
        {keyword.trim() && <div className="keyword-variants">
          <div className="keyword-variants-head">
            <div><strong>Variações aceitas automaticamente</strong><small>Você pode remover uma opção que não faça sentido para esta publicação.</small></div>
            <button type="button" onClick={() => setKeywordVariants(buildKeywordVariants(keyword))}>Restaurar sugestões</button>
          </div>
          <div className="keyword-variant-list">
            <span className="keyword-variant primary">{keyword.trim()} <small>principal</small></span>
            {keywordVariants.map((variant) => <span className="keyword-variant" key={variant}>
              {variant}
              <input type="hidden" name="keywordVariants" value={variant} />
              <button type="button" onClick={() => setKeywordVariants((current) => current.filter((item) => item !== variant))} aria-label={`Remover variação ${variant}`}>×</button>
            </span>)}
          </div>
        </div>}
      </Card>
      <Card className="form-section"><div className="section-kicker">03 · Respostas</div><h2>O que a pessoa recebe?</h2>
        <div className="message-suggestion-box">
          <div className="message-suggestion-intro">
            <span className="suggestion-icon"><Lightbulb size={18} /></span>
            <div>
              <strong>Sugestões para este conteúdo</strong>
              <p>{selectedMedia ? "Usamos apenas o contexto desta publicação. As sugestões não copiam a legenda, o título nem @usuários." : "Escolha uma publicação para gerar respostas naturais e prontas para revisar."}</p>
            </div>
            <button type="button" className="button button-secondary" onClick={generateSuggestions} disabled={!selectedMediaId || suggestionPending}>
              {suggestionPending ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
              {suggestionPending ? "Analisando…" : suggestions.length ? "Gerar novamente" : "Gerar sugestões"}
            </button>
          </div>
          {suggestionError && <p className="suggestion-error" role="alert">{suggestionError}</p>}
          {suggestions.length > 0 && <>
            <div className="suggestion-apply-all"><span>Três opções diferentes, prontas para revisar.</span><button type="button" onClick={applyAllSuggestions}><Sparkles size={14} /> Usar as 3 sugestões</button></div>
            <div className="suggestion-grid" aria-live="polite">
            {suggestions.map((suggestion) => <article className="suggestion-card" key={suggestion.label}>
              <div className="suggestion-card-head"><strong>{suggestion.label}</strong><button type="button" onClick={() => applySuggestion(suggestion)}>Usar mensagem</button></div>
              <span>Público</span><p>{suggestion.publicReply}</p>
              <span>Direct</span><p>{suggestion.dmMessage}</p>
              <small>{suggestion.rationale}</small>
            </article>)}
            </div>
          </>}
        </div>
        <div className={`reply-variations${state.fields?.publicReplyVariants ? " field-invalid" : ""}`}>
          <div className="reply-variations-head">
            <div><strong>Respostas públicas variadas</strong><small>O Vortex alterna automaticamente entre elas para deixar os comentários mais naturais.</small></div>
            <span>{publicReplies.filter((reply) => reply.trim()).length}/{publicReplies.length} preenchidas</span>
          </div>
          <div className="reply-variations-list">
            {publicReplies.map((reply, index) => <label key={index}>
              <span>Variação {index + 1}{index < 3 && <em> obrigatória</em>}</span>
              <div>
                <textarea name="publicReplyVariants" value={reply} onChange={(event) => updatePublicReply(index, event.target.value)} placeholder={index === 0 ? "Enviei para você. Confira seu direct." : index === 1 ? "Prontinho! Acabei de mandar no seu direct ✨" : "Está a caminho — dá uma olhadinha nas mensagens."} maxLength={500} rows={3} aria-invalid={Boolean(state.fields?.publicReplyVariants) && !reply.trim()} />
                {publicReplies.length > 3 && <button type="button" className="icon-button" onClick={() => removePublicReply(index)} aria-label={`Remover variação ${index + 1}`}><Trash2 size={15} /></button>}
              </div>
            </label>)}
          </div>
          {publicReplies.length < 5 && <button type="button" className="add-reply-variation" onClick={() => setPublicReplies((current) => [...current, ""])}><Plus size={15} /> Adicionar outra variação</button>}
          <FieldError messages={state.fields?.publicReplyVariants} />
        </div>
        <div className={`reply-variations${state.fields?.dmMessageVariants ? " field-invalid" : ""}`}>
          <div className="reply-variations-head">
            <div><strong>Mensagens privadas variadas</strong><small>Uma mensagem é suficiente. Adicione outras se também quiser variar o direct.</small></div>
            <span>{dmMessages.filter((message) => message.trim()).length}/{dmMessages.length} preenchidas</span>
          </div>
          <div className="reply-variations-list">
            {dmMessages.map((message, index) => <label key={index}>
              <span>Mensagem {index + 1}{index === 0 && <em> obrigatória</em>}</span>
              <div>
                <textarea name="dmMessageVariants" value={message} onChange={(event) => updateDmMessage(index, event.target.value)} placeholder={index === 0 ? "Como prometido, deixei o conteúdo logo abaixo:" : "Prontinho! Aqui está o que você pediu:"} maxLength={900} rows={4} aria-invalid={Boolean(state.fields?.dmMessageVariants) && !message.trim()} />
                {dmMessages.length > 1 && <button type="button" className="icon-button" onClick={() => removeDmMessage(index)} aria-label={`Remover mensagem privada ${index + 1}`}><Trash2 size={15} /></button>}
              </div>
            </label>)}
          </div>
          {dmMessages.length < 5 && <button type="button" className="add-reply-variation" onClick={() => setDmMessages((current) => [...current, ""])}><Plus size={15} /> Adicionar outra mensagem privada</button>}
          <FieldError messages={state.fields?.dmMessageVariants} />
        </div>
        <label><span>URL de destino</span><input name="destinationUrl" type="url" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="https://seusite.com/produto" maxLength={2048} aria-invalid={Boolean(state.fields?.destinationUrl)} /><small>Usada no fluxo simples de mensagem + link. Se configurar botões abaixo, esta URL pode ficar vazia.</small><FieldError messages={state.fields?.destinationUrl} /></label>
        <div className={`reply-variations link-button-config${state.fields?.conversationFlow ? " field-invalid" : ""}`}>
          <div className="reply-variations-head">
            <div><strong>Fluxo de conversa no direct</strong><small>Opcional: crie perguntas com respostas rápidas. Cada resposta leva a outro passo ou a uma mensagem final com botões de URL.</small></div>
            <span>{flowSteps.length}/10 passos</span>
          </div>
          <input type="hidden" name="conversationFlow" value={JSON.stringify({ steps: flowSteps })} />
          <div className="link-button-list">
            {flowSteps.map((step, stepIndex) => <article className="flow-step-editor" key={step.id}>
              <div className="flow-step-head"><strong>Passo {stepIndex + 1}</strong>{flowSteps.length > 0 && <button type="button" onClick={() => removeFlowStep(stepIndex)}>Remover</button>}</div>
              <label><span>ID do passo</span><input value={step.id} onChange={(event) => updateFlowStep(stepIndex, { id: event.target.value })} maxLength={48} placeholder={`step-${stepIndex + 1}`} /></label>
              <label><span>Pergunta ou mensagem</span><textarea value={step.text} onChange={(event) => updateFlowStep(stepIndex, { text: event.target.value })} maxLength={900} rows={3} placeholder="Qual caminho você quer seguir agora?" /></label>
              <div className="flow-button-list">
                {step.buttons.map((button, buttonIndex) => {
                  const action = button.url ? "url" : "next";
                  return <div className="flow-button-row" key={button.id}>
                    <label><span>Resposta</span><input value={button.label} onChange={(event) => updateFlowButton(stepIndex, buttonIndex, { label: event.target.value })} maxLength={20} placeholder={buttonIndex === 0 ? "Quero o guia" : "Ver biblioteca"} /></label>
                    <label><span>Ação</span><select value={action} onChange={(event) => updateFlowButton(stepIndex, buttonIndex, event.target.value === "url" ? { url: "", nextStepId: null } : { nextStepId: flowSteps[stepIndex + 1]?.id ?? "", url: null })}><option value="next">Ir para outro passo</option><option value="url">Botão final de URL</option></select></label>
                    {action === "next" ? <label><span>Próximo passo</span><select value={button.nextStepId ?? ""} onChange={(event) => updateFlowButton(stepIndex, buttonIndex, { nextStepId: event.target.value || null, url: null })}><option value="">Selecione</option>{flowSteps.filter((target) => target.id !== step.id).map((target) => <option value={target.id} key={target.id}>{target.id}</option>)}</select></label> : <label><span>URL final</span><input type="url" value={button.url ?? ""} onChange={(event) => updateFlowButton(stepIndex, buttonIndex, { url: event.target.value, nextStepId: null })} placeholder="https://seusite.com/material" /></label>}
                    <button type="button" className="icon-button" onClick={() => removeFlowButton(stepIndex, buttonIndex)} aria-label={`Remover resposta ${buttonIndex + 1}`}><Trash2 size={15} /></button>
                  </div>;
                })}
              </div>
              {step.buttons.length < 13 && <button type="button" className="add-reply-variation" onClick={() => addFlowButton(stepIndex)}><Plus size={15} /> Adicionar resposta</button>}
            </article>)}
          </div>
          {flowSteps.length < 10 && <button type="button" className="add-reply-variation" onClick={addFlowStep}><Plus size={15} /> Adicionar passo</button>}
          <label className="utm-toggle">
            <input type="checkbox" name="appendUtmToButtons" checked={appendUtmToButtons} onChange={(event) => setAppendUtmToButtons(event.target.checked)} />
            <span>Adicionar UTM automaticamente (<code>utm_source=vortex</code> e <code>utm_term=&lt;automationId&gt;</code>)</span>
          </label>
          <FieldError messages={state.fields?.conversationFlow} />
        </div>
        <div className={`follow-gate${requireFollow ? " enabled" : ""}`}>
          <label className="follow-gate-switch">
            <span className="follow-gate-icon"><UserCheck size={19} /></span>
            <span className="follow-gate-copy">
              <strong>Liberar conteúdo somente para seguidores</strong>
              <small>O Instagram só permite confirmar depois que a pessoa responder à primeira mensagem.</small>
            </span>
            <input
              type="checkbox"
              name="requireFollow"
              checked={requireFollow}
              onChange={(event) => setRequireFollow(event.target.checked)}
            />
            <span className="switch-control" aria-hidden="true" />
          </label>
          {requireFollow && <div className="follow-gate-fields">
            <div className="follow-gate-flow" aria-label="Fluxo da confirmação">
              <span>1 · Comentou</span><span>2 · Respondeu PRONTO</span><span>3 · Seguimento confirmado</span><span>4 · Link liberado</span>
            </div>
            <label>
              <span>Primeira mensagem</span>
              <textarea name="followGateMessage" value={followGateMessage} onChange={(event) => setFollowGateMessage(event.target.value)} maxLength={900} rows={4} aria-invalid={Boolean(state.fields?.followGateMessage) && !followGateMessage.trim()} />
              <small>Enviada no lugar do link. A pessoa deve responder para autorizar a verificação.</small>
              <FieldError messages={state.fields?.followGateMessage} />
            </label>
            <label>
              <span>Se a pessoa ainda não seguir</span>
              <textarea name="notFollowingMessage" value={notFollowingMessage} onChange={(event) => setNotFollowingMessage(event.target.value)} maxLength={900} rows={4} aria-invalid={Boolean(state.fields?.notFollowingMessage) && !notFollowingMessage.trim()} />
              <FieldError messages={state.fields?.notFollowingMessage} />
            </label>
          </div>}
          {!requireFollow && <>
            <input type="hidden" name="followGateMessage" value={followGateMessage} />
            <input type="hidden" name="notFollowingMessage" value={notFollowingMessage} />
          </>}
        </div>
      </Card>
      <div className="form-actions"><Button name="intent" value="draft" variant="secondary" disabled={pending}>Salvar rascunho</Button><Button name="intent" value="active" disabled={pending}>{pending ? "Salvando…" : automation?.status === "active" ? "Salvar e manter ativa" : "Salvar e ativar"}</Button></div>
    </section>
    <aside className="preview-column"><div className="preview-label"><Sparkles size={15} /> Prévia do direct</div><div className="phone"><div className="phone-top"><span className="preview-avatar">V</span><div><strong>vortex.demo</strong><small>Instagram</small></div></div>{requireFollow && <><div className="message-bubble"><p>{followGateMessage}</p></div><div className="message-bubble message-bubble-user"><p>PRONTO</p></div></>}{firstFlowStep ? <><div className="message-bubble"><p>{firstFlowStep.text || "Primeira pergunta do fluxo."}</p>{firstFlowStep.buttons.slice(0, 3).map((button) => <span className="preview-quick-reply" key={button.id}>{button.label || "Resposta"}</span>)}</div>{previewFinalStep && <div className="message-bubble"><p>{previewFinalStep.text || "Mensagem final."}</p><div className="preview-button-list">{previewFinalStep.buttons.filter((button) => button.url).map((button) => <span className="preview-link" key={button.id}><ExternalLink size={13} /> {button.label || "Abrir link"}</span>)}</div></div>}</> : <div className="message-bubble"><p>{dmPreview || "Sua mensagem aparecerá aqui."}</p>{destination && <span className="preview-link"><ExternalLink size={13} /> Abrir material</span>}</div>}<div className="phone-hint"><MessageCircle size={14} /> {requireFollow ? "Fluxo liberado após confirmar o seguidor" : firstFlowStep ? "Conversa guiada por respostas rápidas" : "Resposta privada ao comentário"}</div><div className="phone-input"><span>Mensagem…</span><Send size={15} /></div></div></aside>
  </form>;
}
