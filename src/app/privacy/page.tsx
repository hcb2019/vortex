import Link from "next/link";
import { ArrowLeft, Database, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
import { env } from "@/lib/env";

export const metadata = { title: "Privacidade — Vortex" };

export default function PrivacyPage() {
  return <main className="legal-page"><div className="legal-document"><Link href="/" className="back-link"><ArrowLeft size={14} /> Voltar ao Vortex</Link><p className="eyebrow">Documento público</p><h1>Política de privacidade</h1><p className="legal-updated">Última atualização: 21 de julho de 2026</p><div className="legal-intro"><ShieldCheck size={24} /><p>O Vortex usa dados da conta profissional do Instagram exclusivamente para operar automações aprovadas pelo usuário e produzir inteligência de audiência.</p></div>
    <section><h2>Dados tratados</h2><p>Podemos tratar identificador e nome da conta profissional, publicações (Reels, carrosséis e posts do feed), comentários recebidos, identificadores Instagram-scoped, estados de entrega, métricas de conteúdo e cliques nos links gerados. Não armazenamos o endereço IP dos visitantes.</p></section>
    <section><h2>Finalidades</h2><p>Os dados são usados para sincronizar publicações, identificar palavras-chave, responder comentários, enviar a private reply permitida pela Meta, medir resultados e gerar sugestões de conteúdo. Nenhuma sugestão de IA publica conteúdo ou ativa automações sem aprovação humana.</p></section>
    <div className="legal-cards"><article><LockKeyhole size={18} /><h3>Proteção</h3><p>Tokens são cifrados no servidor e segredos nunca são enviados ao navegador.</p></article><article><Database size={18} /><h3>Retenção</h3><p>Comentários e dados individuais são removidos ou anonimizados após 180 dias.</p></article><article><Trash2 size={18} /><h3>Exclusão</h3><p>A desautorização ou solicitação válida da Meta remove os dados derivados da conexão.</p></article></div>
    <section><h2>OpenAI e fornecedores</h2><p>Quando o Radar real está habilitado, usernames e identificadores externos são substituídos por aliases temporários antes da análise. A aplicação também pode usar Meta, Supabase, Vercel e Sentry conforme a configuração do operador.</p></section>
    <section><h2>Seus controles</h2><p>Você pode pausar ou excluir automações, desconectar o Instagram e solicitar a exclusão dos dados. Também pode remover o acesso do aplicativo nas configurações do Instagram/Meta.</p></section>
    <section><h2>Contato do operador</h2><p>Para dúvidas ou solicitações relacionadas a este deploy, escreva para <a href={`mailto:${env.OWNER_EMAIL}`}>{env.OWNER_EMAIL}</a>.</p></section>
    <aside className="legal-template-note"><strong>Aviso para quem distribui o template</strong><p>Revise este texto com orientação jurídica, substitua o contato e descreva seus próprios fornecedores, base legal, território e práticas antes de colocar o app em produção.</p></aside>
  </div></main>;
}
