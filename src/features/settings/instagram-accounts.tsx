import { AtSign, BellRing, CheckCircle2, Clock3, KeyRound, Link2, MessageCircleMore, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { DisconnectAccountButton } from "@/features/settings/disconnect-button";
import { selectInstagramConnection } from "@/features/settings/actions";
import { formatDate } from "@/lib/domain";
import { isDemoMode } from "@/lib/env";
import type { InstagramConnection, InstagramMedia } from "@/types/domain";

function ConnectionActions({ connectionId, isDemo }: { connectionId: string; isDemo: boolean }) {
  return <div className="connection-actions">
    <form action="/api/meta/media/sync" method="post">
      <input type="hidden" name="connectionId" value={connectionId} />
      <Button variant="secondary" disabled={isDemo}><RefreshCw size={15} /> {isDemo ? "Simulação ativa" : "Sincronizar publicações"}</Button>
    </form>
    {!isDemo && <form action="/api/meta/comments/sync" method="post">
      <input type="hidden" name="connectionId" value={connectionId} />
      <Button variant="secondary"><MessageCircleMore size={15} /> Buscar comentários</Button>
    </form>}
    {!isDemo && <form action="/api/meta/messages/sync" method="post">
      <Button variant="secondary"><MessageCircleMore size={15} /> Buscar respostas da DM</Button>
    </form>}
    {!isDemo && <form action="/api/meta/webhook/subscription" method="post">
      <input type="hidden" name="connectionId" value={connectionId} />
      <Button variant="secondary"><BellRing size={15} /> Verificar webhook</Button>
    </form>}
    {!isDemo && <form action="/api/meta/token/refresh" method="post">
      <input type="hidden" name="connectionId" value={connectionId} />
      <Button variant="secondary"><KeyRound size={15} /> Renovar conexão</Button>
    </form>}
    {!isDemo && <a className="button button-primary" href="/api/meta/oauth/start"><Link2 size={15} /> Reautorizar Instagram</a>}
  </div>;
}

export function InstagramAccountsPanel({
  connections,
  selected,
  media,
}: {
  connections: InstagramConnection[];
  selected: InstagramConnection | null;
  media: InstagramMedia[];
}) {
  if (!connections.length) {
    return <Card className="empty-state">
      <AtSign size={28} />
      <h2>Conecte sua conta profissional</h2>
      <p>O Vortex solicitará acesso ao perfil, comentários e métricas de conteúdo. Depois você pode adicionar outra conta Business ou Creator sem substituir a primeira.</p>
      <a className="button button-primary" href="/api/meta/oauth/start">Conectar Instagram</a>
    </Card>;
  }

  const mediaCount = (connectionId: string) => media.filter((item) => item.connectionId === connectionId).length;

  return <div className="connection-list">
    {connections.map((connection) => {
      const isSelected = selected?.id === connection.id;
      return <Card className={isSelected ? "connection-card is-selected" : "connection-card"} key={connection.id}>
        <div className="connection-main">
          <div className="instagram-avatar"><AtSign size={24} /></div>
          <div>
            <div className="title-line">
              <h2>@{connection.username}</h2>
              <StatusBadge status={connection.status} />
              {isSelected && <span className="connection-selected-tag">No painel</span>}
            </div>
            <p>Conta profissional · Instagram API with Instagram Login</p>
          </div>
        </div>
        <div className="connection-stats">
          <div><Clock3 size={16} /><span>Última sincronização<strong>{formatDate(connection.lastSyncAt)}</strong></span></div>
          <div><CheckCircle2 size={16} /><span>Publicações disponíveis<strong>{mediaCount(connection.id)}</strong></span></div>
          <div><ShieldCheck size={16} /><span>Token válido até<strong>{formatDate(connection.tokenExpiresAt)}</strong></span></div>
        </div>
        {isSelected
          ? <ConnectionActions connectionId={connection.id} isDemo={isDemoMode} />
          : <div className="connection-actions">
              {!isDemoMode && <form action={selectInstagramConnection}><input type="hidden" name="connectionId" value={connection.id} /><Button variant="secondary">Usar no painel</Button></form>}
              {!isDemoMode && <a className="button button-secondary" href="/api/meta/oauth/start"><Link2 size={15} /> Reautorizar Instagram</a>}
            </div>}
        {!isDemoMode && <div className="connection-row-footer">
          <DisconnectAccountButton connectionId={connection.id} username={connection.username} />
        </div>}
      </Card>;
    })}
    {!isDemoMode && <Card className="connection-add-card">
      <div>
        <p className="eyebrow">Outra conta</p>
        <h2>Conectar outra conta</h2>
        <p>Adicione um segundo perfil Business ou Creator no mesmo login. A conta atual continua conectada; o painel passa a usar a nova até você trocar.</p>
      </div>
      <a className="button button-primary" href="/api/meta/oauth/start"><Link2 size={15} /> Conectar outra conta</a>
    </Card>}
  </div>;
}
