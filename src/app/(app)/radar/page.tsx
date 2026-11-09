import Link from "next/link";
import { ArrowRight, Check, ChevronRight, CircleHelp, Eye, Flame, Lightbulb, MessageSquareQuote, Radar, Sparkles, ThumbsDown, ThumbsUp, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Card, EmptyState } from "@/components/ui";
import { categoryLabel, confidenceLabel } from "@/lib/audience";
import { formatDate } from "@/lib/domain";
import { instagramMediaCaption, instagramMediaKindLabel } from "@/lib/instagram-media";
import { requestAudienceAnalysis, updateInsight } from "@/features/audience/actions";
import { SyncAudienceButton } from "@/features/audience/sync-button";
import { getAudienceMedia, getAudienceRadarData } from "@/server/audience/data";
import type { AudienceCategory, AudienceEvidence, AudienceInsight } from "@/types/audience";

export const metadata = { title: "Radar de audiência" };

const categoryMeta: Record<AudienceCategory, { icon: typeof Flame; tone: "accent" | "warning" | "danger" | "success" | "neutral" }> = {
  purchase_intent: { icon: Flame, tone: "accent" }, question: { icon: CircleHelp, tone: "warning" }, objection: { icon: TrendingDown, tone: "danger" }, content_request: { icon: Lightbulb, tone: "success" }, support: { icon: CircleHelp, tone: "danger" }, praise: { icon: ThumbsUp, tone: "success" }, irrelevant: { icon: MessageSquareQuote, tone: "neutral" },
};

function EvidenceList({ evidence }: { evidence: AudienceEvidence[] }) {
  return <details className="evidence-drawer">
    <summary><Eye size={15} /> Ver {evidence.length} evidência{evidence.length === 1 ? "" : "s"}<ChevronRight size={14} /></summary>
    <div className="evidence-list">{evidence.map((item) => <blockquote key={item.id}>
      <p>“{item.text}”</p><footer><strong>@{item.username}</strong><span>{item.mediaCaption} · {formatDate(item.publishedAt)}</span></footer>
    </blockquote>)}</div>
  </details>;
}

function InsightActions({ insight }: { insight: AudienceInsight }) {
  return <div className="insight-actions">
    <form action={updateInsight}><input type="hidden" name="id" value={insight.id} /><input type="hidden" name="status" value="reviewed" /><button className="text-action" type="submit"><Check size={14} /> Revisado</button></form>
    <span className="action-separator" />
    <form action={updateInsight}><input type="hidden" name="id" value={insight.id} /><input type="hidden" name="feedback" value="useful" /><button className={insight.feedback === "useful" ? "icon-choice selected" : "icon-choice"} type="submit" aria-label="Marcar como útil"><ThumbsUp size={14} /></button></form>
    <form action={updateInsight}><input type="hidden" name="id" value={insight.id} /><input type="hidden" name="feedback" value="not_useful" /><button className={insight.feedback === "not_useful" ? "icon-choice selected" : "icon-choice"} type="submit" aria-label="Marcar como não útil"><ThumbsDown size={14} /></button></form>
    <form action={updateInsight} className="discard-action"><input type="hidden" name="id" value={insight.id} /><input type="hidden" name="status" value="dismissed" /><button className="text-action muted" type="submit">Descartar</button></form>
  </div>;
}

function OpportunityCard({ insight, rank }: { insight: AudienceInsight; rank: number }) {
  const meta = categoryMeta[insight.category]; const Icon = meta.icon;
  return <article className={`opportunity-card priority-${rank}`}>
    <div className="opportunity-rank">{String(rank).padStart(2, "0")}</div>
    <div className="opportunity-body">
      <div className="opportunity-meta"><Badge tone={meta.tone}><Icon size={11} /> {categoryLabel(insight.category)}</Badge>{insight.isEarlySignal && <Badge tone="neutral">Sinal inicial</Badge>}<span>{Math.round(insight.confidence * 100)}% · {confidenceLabel(insight.confidence)}</span></div>
      <h3>{insight.title}</h3><p>{insight.summary}</p>
      <div className="recommendation"><Sparkles size={14} /><span><strong>Próximo passo</strong>{insight.recommendation}</span></div>
      <EvidenceList evidence={insight.evidence} />
      <InsightActions insight={insight} />
    </div>
  </article>;
}

export default async function RadarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const rawPeriod = Number(Array.isArray(query.period) ? query.period[0] : query.period);
  const period = rawPeriod === 7 || rawPeriod === 90 ? rawPeriod : 30;
  const mediaId = String(Array.isArray(query.media) ? query.media[0] ?? "" : query.media ?? "") || null;
  const [data, media] = await Promise.all([getAudienceRadarData({ periodDays: period, mediaId }), getAudienceMedia()]);
  const activeInsights = data.insights.filter(({ status }) => status !== "dismissed");
  const notice = typeof query.analysis === "string" ? query.analysis : null;
  const metrics = [
    { label: "Comentários analisados", value: data.metrics.analyzedComments, icon: MessageSquareQuote },
    { label: "Perguntas em aberto", value: data.metrics.openQuestions, icon: CircleHelp },
    { label: "Intenção de compra", value: data.metrics.purchaseIntent, icon: Flame },
    { label: "Pedidos de conteúdo", value: data.metrics.contentRequests, icon: Lightbulb },
    { label: "Objeções", value: data.metrics.objections, icon: TrendingDown },
  ];
  const filterHref = (days: number) => `/radar?period=${days}${mediaId ? `&media=${mediaId}` : ""}`;

  return <div className="page-shell radar-page">
    <header className="radar-header">
      <div><p className="eyebrow">Inteligência de audiência</p><h1>O que sua audiência está <em>tentando dizer?</em></h1><p>O Radar encontra perguntas, objeções e oportunidades escondidas nos comentários — você decide o que fazer com cada sinal.</p></div>
      <div className="radar-header-actions"><SyncAudienceButton /><form action={requestAudienceAnalysis}><input type="hidden" name="period" value={period} /><input type="hidden" name="mediaId" value={mediaId ?? ""} /><button className="button button-primary" type="submit"><Sparkles size={15} /> Analisar agora</button></form></div>
    </header>

    {notice && <div className={`radar-notice ${notice === "ready" || notice === "queued" ? "success" : "neutral"}`} role="status">{notice === "ready" ? "Análise atualizada com dados simulados." : notice === "queued" ? "Análise enfileirada. Os resultados aparecerão em instantes." : notice === "duplicate" ? "Esses dados já foram analisados." : notice === "daily_limit" ? "Limite diário de análises atingido." : notice === "no_comments" ? "Não há comentários novos nesse recorte." : notice === "invalid_media" ? "A publicação selecionada não está disponível." : "Não foi possível iniciar a análise."}</div>}

    <Card className="radar-control-bar">
      <div className="period-tabs" aria-label="Período">{[7, 30, 90].map((days) => <Link className={period === days ? "active" : ""} href={filterHref(days)} key={days}>{days} dias</Link>)}</div>
      <form className="reel-filter" method="get"><input type="hidden" name="period" value={period} /><label htmlFor="media">Publicação</label><select id="media" name="media" defaultValue={mediaId ?? ""}><option value="">Todas as publicações</option>{media.map((item) => <option value={item.id} key={item.id}>{instagramMediaKindLabel(item)} · {instagramMediaCaption(item)}</option>)}</select><button type="submit">Aplicar</button></form>
      <div className="radar-freshness"><span className="pulse" /><span>Atualizado {formatDate(data.metrics.lastUpdatedAt)}</span></div>
    </Card>

    <section className="radar-metrics" aria-label="Resumo do Radar">{metrics.map(({ label, value, icon: Icon }, index) => <Card className={index === 0 ? "radar-metric primary" : "radar-metric"} key={label}><Icon size={17} /><span>{label}</span><strong>{value}</strong></Card>)}</section>

    {activeInsights.length === 0 ? <EmptyState title="O Radar está aguardando sinais" body="Atualize os comentários e execute uma análise para revelar temas e oportunidades." /> : <>
      <section className="radar-section themes-section"><div className="section-heading"><div><p className="eyebrow">Mapa de sinais</p><h2>Temas que estão ganhando voz</h2></div><p>Volume e tendência nunca dependem apenas da cor.</p></div><div className="theme-grid">{data.themes.slice(0, 6).map((theme, index) => <Card className={`theme-card theme-${index}`} key={theme.id}><div className="theme-card-head"><span>{String(index + 1).padStart(2, "0")}</span>{theme.trend >= 0 ? <span className="trend up"><TrendingUp size={13} /> +{theme.trend}%</span> : <span className="trend down"><TrendingDown size={13} /> {theme.trend}%</span>}</div><h3>{theme.label}</h3><p>{theme.summary}</p><div className="theme-volume"><strong>{theme.volume}</strong><span>comentários · {Math.round(theme.confidence * 100)}% confiança</span></div><progress max="100" value={Math.round(theme.share * 100)} aria-label={`${Math.round(theme.share * 100)}% dos comentários`} /></Card>)}</div></section>

      <section className="radar-section opportunities-section"><div className="section-heading"><div><p className="eyebrow">Caixa de oportunidades</p><h2>Onde vale prestar atenção agora</h2></div><span className="section-count">{activeInsights.length} sinais priorizados</span></div><div className="opportunity-list">{activeInsights.slice(0, 6).map((insight, index) => <OpportunityCard insight={insight} rank={index + 1} key={insight.id} />)}</div></section>

      <section className="radar-section studio-section"><div className="studio-title"><div className="studio-mark"><Lightbulb size={22} /></div><div><p className="eyebrow">Estúdio de conteúdo</p><h2>Sinais transformados em campanhas completas</h2><p>Leve uma oportunidade para o Estúdio e crie hook, legenda, material e automação no mesmo fluxo.</p></div></div><div className="idea-grid">{data.ideas.map((idea, index) => { const suggestion = idea.contentSuggestion!; const href = `/studio/new?insight=${idea.id}&title=${encodeURIComponent(idea.title)}&topic=${encodeURIComponent(`${idea.summary} ${idea.recommendation}`)}`; return <article className="idea-card" key={idea.id}><div className="idea-number">IDEIA {String(index + 1).padStart(2, "0")}</div><Badge tone="accent">{categoryLabel(idea.category)}</Badge><h3>“{suggestion.hook}”</h3><p className="idea-angle">{suggestion.angle}</p><ol>{suggestion.outline.map((item) => <li key={item}>{item}</li>)}</ol><div className="idea-footer"><div><span>CTA sugerido</span><strong>{suggestion.cta}</strong></div><div><span>Palavra-chave</span><code>{suggestion.keyword}</code></div></div><Link className="button button-primary" href={href}>Criar no Estúdio <ArrowRight size={15} /></Link></article>; })}</div></section>
    </>}

    <footer className="radar-run-note"><Radar size={15} /><span>{data.latestRun ? <>Última análise: <strong>{data.latestRun.commentCount} comentários</strong> · {data.latestRun.model} · prompt {data.latestRun.promptVersion}</> : "Nenhuma análise concluída neste período."}</span><Link href="/settings">Configurações <ChevronRight size={14} /></Link></footer>
  </div>;
}
