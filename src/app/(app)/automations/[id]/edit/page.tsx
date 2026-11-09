import { notFound } from "next/navigation";
import { AutomationForm } from "@/features/automations/automation-form";
import { getAutomation, getConnection, listMedia } from "@/server/data";

export const metadata = { title: "Editar automação" };

export default async function EditAutomationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ source?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const automation = await getAutomation(id);
  if (!automation) notFound();
  const [media, connection] = await Promise.all([listMedia(automation.connectionId), getConnection(automation.connectionId)]);
  return <div className="page-shell"><header className="page-header compact"><div><p className="eyebrow">Editar automação</p><h1>{automation.name}</h1><p>As mudanças serão aplicadas somente aos próximos comentários.</p></div></header>{query.source === "radar" && <p className="form-success">Rascunho criado pelo Radar. Revise a publicação, o destino e as mensagens antes de ativar.</p>}<AutomationForm automation={automation} media={media} lastMediaSyncAt={connection?.lastSyncAt} canSyncMedia={Boolean(connection)} connectionId={automation.connectionId} /></div>;
}
