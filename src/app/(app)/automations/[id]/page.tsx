import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Button, Card } from "@/components/ui";
import { setAutomationStatus } from "@/features/automations/actions";
import { DeleteAutomationButton } from "@/features/automations/delete-button";
import { formatDate } from "@/lib/domain";
import { getAutomation, listMedia, listRuns } from "@/server/data";

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getAutomation(id);
  if (!item) notFound();
  const [media, allRuns] = await Promise.all([listMedia(item.connectionId), listRuns(item.connectionId)]);
  const reel = media.find((entry) => entry.id === item.mediaId);
  const runs = allRuns.filter((run) => run.automationId === item.id);
  return <div className="page-shell"><Link href="/automations" className="back-link"><ArrowLeft size={15} /> Voltar para automações</Link><header className="detail-header"><div><div className="title-line"><h1>{item.name}</h1><StatusBadge status={item.status} /></div><p>Versão {item.version} · atualizada {formatDate(item.updatedAt)}</p></div><div className="header-actions"><Link className="button button-secondary" href={`/automations/${item.id}/edit`}><Pencil size={15} /> Editar</Link><form action={setAutomationStatus}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="status" value={item.status === "active" ? "paused" : "active"} /><Button>{item.status === "active" ? "Pausar" : "Ativar"}</Button></form></div></header>
    <section className="detail-grid"><Card className="panel"><p className="eyebrow">Regra</p><dl className="definition-list"><div><dt>Reel</dt><dd>{reel?.caption ?? "Não selecionado"}</dd></div><div><dt>Palavra exata</dt><dd><code>{item.keyword || "—"}</code></dd></div><div><dt>Respostas públicas</dt><dd><ol className="reply-variation-summary">{item.publicReplyVariants.filter(Boolean).map((reply, index) => <li key={`${index}-${reply}`}>{reply}</li>)}</ol></dd></div><div><dt>Mensagens privadas</dt><dd><ol className="reply-variation-summary">{item.dmMessageVariants.filter(Boolean).map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ol></dd></div>{item.conversationFlow.steps.length > 0 && <div><dt>Fluxo de conversa</dt><dd><ol className="reply-variation-summary">{item.conversationFlow.steps.map((step) => <li key={step.id}><strong>{step.id}</strong>: {step.text}<br /><small>{step.buttons.map((button) => `${button.label} → ${button.nextStepId ?? button.url ?? "fim"}`).join(" · ")}</small></li>)}</ol><small>UTM automático: {item.appendUtmToButtons ? "ativado" : "desativado"}</small></dd></div>}<div><dt>Exigir seguidor</dt><dd>{item.requireFollow ? "Sim — confirmar após a pessoa responder PRONTO" : "Não"}</dd></div>{item.requireFollow && <><div><dt>Primeira mensagem</dt><dd>{item.followGateMessage}</dd></div><div><dt>Se ainda não segue</dt><dd>{item.notFollowingMessage}</dd></div></>}<div><dt>Destino</dt><dd className="url-value">{item.destinationUrl || "—"}</dd></div></dl></Card><Card className="panel"><p className="eyebrow">Resultado</p><div className="mini-metrics"><div><strong>{runs.length}</strong><span>comentários</span></div><div><strong>{runs.filter((run) => run.contentDeliveredAt).length}</strong><span>conteúdos entregues</span></div><div><strong>{runs.filter((run) => run.firstClickedAt).length}</strong><span>cliques</span></div></div></Card></section>
    <Card className="danger-zone"><div><h2>Excluir automação</h2><p>Novos comentários deixam de ser processados. O histórico permanece disponível.</p></div><DeleteAutomationButton id={item.id} /></Card>
  </div>;
}
