import Link from "next/link";
import { ArrowRight, Bolt, Pause, Play } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { formatDate } from "@/lib/domain";
import { instagramMediaKindLabel } from "@/lib/instagram-media";
import { listAutomations, listMedia } from "@/server/data";
import { setAutomationStatus } from "@/features/automations/actions";

export const metadata = { title: "Automações" };

export default async function AutomationsPage() {
  const [items, media] = await Promise.all([listAutomations(), listMedia()]);
  return <div className="page-shell"><header className="page-header compact"><div><p className="eyebrow">Operação</p><h1>Automações</h1><p>Uma regra simples para cada publicação e intenção.</p></div><Link className="button button-primary" href="/automations/new">Nova automação <ArrowRight size={16} /></Link></header>
    {items.length === 0 ? <EmptyState title="Sua primeira automação começa aqui" body="Escolha uma publicação, uma palavra e a mensagem que será entregue." action={<Link className="button button-primary" href="/automations/new">Criar automação</Link>} /> : <div className="automation-table"><div className="table-head"><span>Automação</span><span>Publicação</span><span>Estado</span><span>Atualização</span><span className="sr-only">Ações</span></div>{items.map((item) => { const linked = media.find((entry) => entry.id === item.mediaId); return <article className="table-row" key={item.id}>
      <Link className="table-title" href={`/automations/${item.id}`}><span className="reel-mark"><Bolt size={16} /></span><span><strong>{item.name}</strong><small>Palavra: “{item.keyword || "—"}”</small></span></Link>
      <div className="automation-cell table-reel" data-label="Publicação"><span>{linked ? `${instagramMediaKindLabel(linked)} · ${linked.caption.slice(0, 55)}` : "Publicação não selecionada"}</span></div>
      <div className="automation-cell automation-status" data-label="Estado"><StatusBadge status={item.status} /></div>
      <div className="automation-cell automation-date" data-label="Atualização"><span>{formatDate(item.updatedAt)}</span></div>
      <form className="automation-action" action={setAutomationStatus}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="status" value={item.status === "active" ? "paused" : "active"} /><button className="icon-button" aria-label={item.status === "active" ? `Pausar ${item.name}` : `Ativar ${item.name}`}>{item.status === "active" ? <Pause size={16} /> : <Play size={16} />}<span className="automation-action-label">{item.status === "active" ? "Pausar automação" : "Ativar automação"}</span></button></form>
    </article>; })}</div>}
  </div>;
}
