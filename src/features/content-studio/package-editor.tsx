"use client";

import { useActionState, useRef, useState } from "react";
import type { RefObject } from "react";
import { Check, Copy, ExternalLink, Save, Zap } from "lucide-react";
import { createAutomationFromProject, generateContentPackage, linkProjectMedia, saveContentPackage, type StudioActionState } from "@/features/content-studio/actions";
import { CopyButton } from "@/features/content-studio/copy-button";
import { deliverablePromiseLine } from "@/lib/content-studio-coherence";
import { deliverableLabel } from "@/lib/content-studio";
import type { ContentProject } from "@/types/content-studio";
import type { InstagramMedia } from "@/types/domain";

function CopyFieldButton({ fieldRef }: { fieldRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null> }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="studio-copy" onClick={async () => { await navigator.clipboard.writeText(fieldRef.current?.value ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiado" : "Copiar"}</button>;
}

function CopyTextarea({ name, label, value, rows }: { name: string; label: string; value: string; rows: number }) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = `studio-${name}-${label.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-")}`;
  return <div className="studio-copy-field"><div><label htmlFor={fieldId}>{label}</label><CopyFieldButton fieldRef={fieldRef} /></div><textarea id={fieldId} ref={fieldRef} name={name} defaultValue={value} rows={rows} /></div>;
}

function CopyInput({ name, label, value }: { name: string; label: string; value: string }) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const fieldId = `studio-${name}`;
  return <div className="studio-copy-field"><div><label htmlFor={fieldId}>{label}</label><CopyFieldButton fieldRef={fieldRef} /></div><input id={fieldId} ref={fieldRef} name={name} defaultValue={value} /></div>;
}

export function PackageEditor({ project, publicUrl, media }: { project: ContentProject; publicUrl: string; media: InstagramMedia[] }) {
  const pack = project.contentPackage!;
  const [state, action, pending] = useActionState<StudioActionState, FormData>(saveContentPackage, {});
  const hashtags = [...(pack.hashtags ?? []), "", "", "", "", ""].slice(0, 5);
  const promise = deliverablePromiseLine(pack.deliverable);

  return <form action={action} className="studio-package"><input type="hidden" name="id" value={project.id} />
    {state.error && <p className="form-alert">{state.error}</p>}
    <p className="studio-promise">{promise}</p>
    <section className="studio-package-grid">
      <div className="studio-phone-preview"><div className="studio-phone-top">REELS</div><div className="studio-phone-copy">{pack.onScreenHook}</div><div className="studio-phone-foot"><span>{project.title}</span><small>7–10 segundos</small></div></div>
      <div className="card studio-package-fields">
        <div className="studio-package-head"><div><p className="eyebrow">Tela do Reel</p><h2>Hook e direção visual</h2></div></div>
        <CopyTextarea name="onScreenHook" label="Texto fixo" value={pack.onScreenHook} rows={5} />
        <label><span>Como gravar</span><textarea name="visualDirection" defaultValue={pack.visualDirection} rows={4} /></label>
      </div>
    </section>
    <section className="card studio-caption-editor">
      <div className="studio-package-head"><div><p className="eyebrow">Legendas</p><h2>Três tamanhos, a mesma ideia</h2><p>O hook precisa aparecer nos ~125 primeiros caracteres. CTA isolado, com a palavra-chave. Hashtags são opcionais, no máximo 5.</p></div></div>
      <div className="studio-caption-grid">{([["shortCaption", "Curta", pack.shortCaption], ["mediumCaption", "Média", pack.mediumCaption], ["fullCaption", "Completa", pack.fullCaption]] as const).map(([name, label, text]) => <CopyTextarea key={name} name={name} label={label} value={text} rows={name === "fullCaption" ? 16 : 10} />)}</div>
      <div className="studio-hashtags"><span>Hashtags ({(pack.hashtags ?? []).length}/5)</span>{hashtags.map((tag, index) => <input key={`${tag}-${index}`} name="hashtags" defaultValue={tag} placeholder={index === 0 ? "#ia" : ""} maxLength={60} />)}</div>
    </section>
    <section className="studio-package-columns">
      <div className="card studio-message-editor">
        <p className="eyebrow">Comentário → DM</p>
        <h2>Palavra e mensagens</h2>
        <CopyInput name="selectedKeyword" label="Palavra-chave selecionada" value={pack.selectedKeyword} />
        <p className="studio-keyword-hint">A palavra é o verbo ou o objeto da promessa. Quem comenta recebe o material em /materiais.</p>
        <div className="studio-keyword-options">{pack.keywordSuggestions.map((item) => <input key={item} type="hidden" name="keywordSuggestions" value={item} />)}{pack.keywordSuggestions.map((item) => <span key={item}><code>{item}</code><CopyButton value={item} /></span>)}</div>
        <h3>Respostas públicas</h3>
        {pack.publicReplies.map((item, index) => <CopyTextarea key={index} name="publicReplies" label={`Variação ${index + 1}`} value={item} rows={2} />)}
        <h3>Mensagens privadas</h3>
        {pack.dmMessages.map((item, index) => <CopyTextarea key={index} name="dmMessages" label={`Mensagem ${index + 1}`} value={item} rows={2} />)}
      </div>
      <div className="card studio-deliverable-editor">
        <p className="eyebrow">Entregável · {deliverableLabel(project.deliverableType)}</p>
        <h2>Material que vai para o direct</h2>
        <p className="studio-promise-inline">{promise}</p>
        <label><span>Título</span><input name="deliverableTitle" defaultValue={pack.deliverable.title} /></label>
        <label><span>Resumo</span><textarea name="deliverableSummary" defaultValue={pack.deliverable.summary} rows={3} /></label>
        <div className="studio-deliverable-stats">
          <span><strong>{pack.deliverable.sections.length}</strong> etapas</span>
          <span><strong>{pack.deliverable.templates?.length ?? 0}</strong> modelos copiáveis</span>
          <span><strong>{pack.deliverable.examples?.length ?? 0}</strong> exemplo preenchido</span>
        </div>
        <div className="studio-deliverable-outline">{pack.deliverable.sections.map((section) => <article key={section.heading}><strong>{section.heading}</strong><p>{section.body}</p><span>{section.items.length} ações práticas</span></article>)}</div>
        <a href={publicUrl} target="_blank" rel="noreferrer" className="button button-secondary">Abrir página pública <ExternalLink size={15} /></a>
      </div>
    </section>
    <section className="card studio-media-link">
      <div><p className="eyebrow">Publicação</p><h2>Vincule quando o conteúdo entrar no ar</h2><p>O Estúdio pode preparar tudo antes. Depois da publicação, sincronize as publicações e selecione o Reel, carrossel ou post correto aqui.</p></div>
      <div><select name="mediaId" defaultValue={project.mediaId ?? ""} aria-label="Publicação sincronizada"><option value="">Escolha uma publicação sincronizada</option>{media.map((item) => <option value={item.id} key={item.id}>{item.caption.slice(0, 90) || "Publicação sem legenda"}</option>)}</select><button className="button button-secondary" formAction={linkProjectMedia} disabled={!media.length}>Vincular publicação</button></div>
    </section>
    <footer className="studio-package-actions">
      <input type="hidden" name="conceptIndex" value={String(project.selectedConceptIndex ?? 0)} />
      <button className="button button-ghost" formAction={generateContentPackage}><Zap size={15} />Gerar nova versão completa</button>
      <button className="button button-secondary" disabled={pending}><Save size={15} />{pending ? "Salvando…" : "Salvar alterações"}</button>
      <button className="button button-primary" formAction={createAutomationFromProject}><Zap size={15} />{project.automationId ? "Abrir automação" : "Criar automação em rascunho"}</button>
    </footer>
  </form>;
}
