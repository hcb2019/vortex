import Link from "next/link";
import { ArrowRight, BookOpenCheck } from "lucide-react";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/domain";
import { getConnection, listAllMedia, listConnections } from "@/server/data";
import { env, isDemoMode } from "@/lib/env";
import { listPipelineApiKeys } from "@/server/pipeline-api-keys";
import { InstagramAccountsPanel } from "@/features/settings/instagram-accounts";
import { PipelineApiKeysPanel } from "@/features/settings/pipeline-api-keys-panel";

export const metadata = { title: "Integração" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ sync?: string; count?: string; error?: string; webhook?: string; comments?: string; found?: string; queued?: string; processed?: string; messages?: string; recovered?: string; token?: string; connected?: string }> }) {
  const query = await searchParams;
  const [connections, selected, media, apiKeys] = await Promise.all([listConnections(), getConnection(), listAllMedia(), listPipelineApiKeys()]);
  return <div className="page-shell"><header className="page-header compact"><div><p className="eyebrow">Integração</p><h1>Contas do Instagram</h1><p>Conecte mais de um perfil Business ou Creator no mesmo login. Automações, Radar e Estúdio usam a conta selecionada no painel.</p></div><Link className="button button-secondary" href="/connection-guide"><BookOpenCheck size={15} /> Ver guia completo <ArrowRight size={14} /></Link></header>
    {query.connected === "1" && selected && <p className="form-success" role="status">Conta conectada. O painel está usando @{selected.username}.</p>}
    {query.sync === "success" && <p className="form-success" role="status">Sincronização concluída. {Number(query.count ?? 0)} Reel(is) encontrado(s).</p>}
    {query.sync === "error" && <p className="form-alert" role="alert">A sincronização não foi concluída. Veja o motivo abaixo e tente novamente.</p>}
    {query.webhook === "active" && <p className="form-success" role="status">Webhook confirmado: a Meta já estava enviando comentários para o Vortex.</p>}
    {query.webhook === "restored" && <p className="form-success" role="status">Webhook restaurado: a assinatura de comentários foi refeita com sucesso.</p>}
    {query.webhook === "error" && <p className="form-alert" role="alert">Não foi possível confirmar a assinatura do webhook. Reautorize o Instagram e tente novamente.</p>}
    {query.comments === "success" && <p className="form-success" role="status">Busca concluída: {Number(query.found ?? 0)} comentário(s) recente(s), {Number(query.queued ?? 0)} novo(s) na fila e {Number(query.processed ?? 0)} processado(s).</p>}
    {query.comments === "error" && <p className="form-alert" role="alert">Não foi possível buscar os comentários recentes pela API da Meta.</p>}
    {query.messages === "success" && <p className="form-success" role="status">Resposta recuperada: {Number(query.recovered ?? 0)} confirmação(ões) processada(s).</p>}
    {query.messages === "empty" && <p className="form-alert" role="status">Nenhuma nova resposta “pronto” foi encontrada nas conversas pendentes.</p>}
    {query.messages === "error" && <p className="form-alert" role="alert">Não foi possível consultar as respostas pendentes pela API da Meta.</p>}
    {query.token === "success" && <p className="form-success" role="status">Conexão renovada. O novo token de longa duração foi salvo com segurança.</p>}
    {query.token === "error" && <p className="form-alert" role="alert">A Meta não permitiu renovar este token. Se ele já expirou, reautorize o Instagram uma última vez.</p>}
    {query.error === "missing_basic" && <p className="form-alert" role="alert">A Meta conectou a conta, mas não concedeu a permissão <code>instagram_business_basic</code>. Adicione essa permissão no painel da Meta e reautorize.</p>}
    {query.error === "missing_comments" && <p className="form-alert" role="alert">A Meta conectou a conta, mas não concedeu a permissão <code>instagram_business_manage_comments</code>. Adicione essa permissão no painel da Meta e reautorize.</p>}
    {query.error === "missing_messages" && <p className="form-alert" role="alert">A Meta conectou a conta, mas não concedeu a permissão <code>instagram_business_manage_messages</code>. Adicione essa permissão no painel da Meta e reautorize.</p>}
    {query.error === "missing_content_publish" && <p className="form-alert" role="alert">A Meta conectou a conta, mas não concedeu a permissão <code>instagram_business_content_publish</code>. Adicione essa permissão no painel da Meta, solicite a revisão se necessário e reautorize o Instagram.</p>}
    {query.error === "oauth" && <p className="form-alert" role="alert">Não foi possível concluir a autorização. Tente novamente em instantes.</p>}
    {query.error === "oauth_conflict" && <p className="form-alert" role="alert">Não foi possível concluir a autorização. Tente novamente sem substituir as contas já conectadas.</p>}
    <InstagramAccountsPanel connections={connections} selected={selected} media={media} />
    {selected && <Card className="settings-info-card"><p className="eyebrow">Conexão persistente</p><h2>Renovação automática ativada</h2><p>O Vortex usa um token de longa duração e tenta renová-lo diariamente quando faltarem 14 dias para vencer. Última renovação de @{selected.username}: <strong>{formatDate(selected.tokenRefreshedAt)}</strong>.</p><p>A Meta ainda pode invalidar o acesso se a senha mudar, a permissão for removida ou o aplicativo for revogado. Nesses casos, somente uma nova autorização resolve. Reautorizar uma conta não apaga as outras.</p></Card>}
    {selected?.lastError && <Card className="settings-info-card"><p className="eyebrow">Diagnóstico da última tentativa</p><h2>O que impediu a sincronização</h2><p>{selected.lastError}</p><p>Se a Meta mencionar permissão ou token, reautorize a conta pelo botão de conexão. Nenhum segredo é exibido nesta mensagem.</p></Card>}
    {!isDemoMode && <Card className="settings-info-card"><p className="eyebrow">Conferência do aplicativo Meta</p><h2>Client ID usado pelo Vortex</h2><p><code>{env.META_APP_ID ?? "Não configurado"}</code></p><p>Esse número deve coincidir com o <strong>ID do app do Instagram</strong> do aplicativo atualmente conectado. Não use o ID principal exibido na URL do painel da Meta.</p></Card>}
    {!isDemoMode && <PipelineApiKeysPanel keys={apiKeys} />}
    <Card className="permissions-card"><p className="eyebrow">Privilégio mínimo</p><h2>Permissões utilizadas</h2><div><code>instagram_business_basic</code><span>Identifica a conta e lista os Reels.</span></div><div><code>instagram_business_manage_comments</code><span>Recebe e responde comentários e autoriza a private reply.</span></div><div><code>instagram_business_manage_messages</code><span>Compatibilidade do envio privado pelo endpoint de mensagens da Meta.</span></div><div><code>instagram_business_manage_insights</code><span>Lê métricas dos Reels para contextualizar os sinais da audiência.</span></div><div><code>instagram_business_content_publish</code><span>Publica Reels pelo fluxo Novo conteúdo e exige reautorização após a revisão no app Meta.</span></div></Card>
  </div>;
}
