import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FileKey2,
  Globe2,
  KeyRound,
  Link2,
  MessageCircle,
  Radio,
  ShieldCheck,
  TestTube2,
  UserRoundCheck,
  Webhook,
} from "lucide-react";
import { CopyValue, GuideProgress, StepComplete, WebhookTokenSetup } from "@/features/integration-guide/guide-client";
import { env, isDemoMode } from "@/lib/env";
import { getConnection } from "@/server/data";

export const metadata = { title: "Guia de conexão com Instagram" };

const META_CREATE_APP = "https://developers.facebook.com/apps/creation/";
const META_INSTAGRAM_DOCS = "https://www.postman.com/meta/instagram/folder/23987686-98bfade9-3736-4738-8b4a-f56d6534f6de";
const META_COMMENTS_DOCS = "https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-db99ce99-bf76-475c-8b76-718576c11cae";
const META_INSIGHTS_DOCS = "https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-26e7999c-fc7e-44c8-8f71-ab2de8d35c32";

const STEP_IDS = ["prepare", "create-app", "instagram-api", "tester", "server", "webhook-login", "publish", "connect-test"];

function ExternalAction({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="setup-action" href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={15} /></a>;
}

function UrlRow({ label, value, where }: { label: string; value: string; where: string }) {
  return <div className="setup-copy-row">
    <div><span>{label}</span><small>{where}</small></div>
    <code>{value}</code>
    <CopyValue value={value} />
  </div>;
}

function StepShell({
  id,
  number,
  title,
  intro,
  location,
  children,
}: {
  id: string;
  number: string;
  title: string;
  intro: string;
  location: string;
  children: React.ReactNode;
}) {
  return <article className="setup-step" id={id}>
    <header>
      <div className="setup-step-number"><small>Etapa</small><strong>{number}</strong></div>
      <div><span className="setup-location">{location}</span><h2>{title}</h2><p>{intro}</p></div>
    </header>
    <div className="setup-step-content">{children}</div>
    <footer><StepComplete id={id} /></footer>
  </article>;
}

function TaskList({ children }: { children: React.ReactNode }) {
  return <div className="setup-task-list"><h3>Faça assim</h3><ol>{children}</ol></div>;
}

function Expected({ children }: { children: React.ReactNode }) {
  return <div className="setup-expected"><CheckCircle2 size={18} /><div><strong>Antes de continuar</strong><p>{children}</p></div></div>;
}

function AppCreationMap() {
  const screens = [
    ["01", "Detalhes do app", "Digite o nome do aplicativo e um e-mail que você consulta."],
    ["02", "Casos de uso", "Marque somente \"Gerenciar mensagens e conteúdo no Instagram\"."],
    ["03", "Empresa", "Escolha seu portfólio empresarial. Se ainda não tiver um, continue sem conectar e adicione depois."],
    ["04", "Requisitos", "Se aparecer \"Nenhum requisito identificado\", apenas avance."],
    ["05", "Visão geral", "Confira o caso de uso e clique em \"Criar aplicativo\"."],
  ];
  return <section className="meta-screen-map" aria-labelledby="creation-map-title">
    <div className="setup-section-heading"><span>As cinco telas da criação</span><h3 id="creation-map-title">Não escolha Messenger, WhatsApp ou Facebook Login</h3></div>
    <div>{screens.map(([number, title, text]) => <article key={number}><b>{number}</b><div><strong>{title}</strong><p>{text}</p></div></article>)}</div>
  </section>;
}

function InstagramSetupMap() {
  const blocks = [
    ["1", "Permissões obrigatórias", "Clique em \"Add all required permissions\". Depois, em Permissões e recursos, adicione instagram_business_manage_insights para o Radar e instagram_business_content_publish para Novo conteúdo."],
    ["2", "Gerar tokens de acesso", "Adicione a conta profissional. Não copie o token manual para o Vortex."],
    ["3", "Configurar webhooks", "Informe a URL de callback e o token de verificação. Assine somente comments."],
    ["4", "Login da empresa no Instagram", "Clique em Configurar e cadastre as URLs do Vortex."],
    ["5", "Concluir a análise do app", "Use esta etapa quando for publicar o app ou permitir contas que não são testadoras."],
  ];
  return <section className="meta-block-map" aria-labelledby="meta-block-title">
    <header><div><span>Mapa da tela atual</span><h3 id="meta-block-title">A página correta tem cinco blocos numerados</h3></div><div className="setup-right-screen"><CheckCircle2 size={17} /> Login do Instagram</div></header>
    <div>{blocks.map(([number, title, text]) => <article key={number}><b>{number}</b><div><strong>{title}</strong><p>{text}</p></div></article>)}</div>
  </section>;
}

function PermissionTable() {
  return <div className="setup-permission-table">
    <div><code>instagram_business_basic</code><span>Conta profissional e Reels</span><b>Usada</b></div>
    <div><code>instagram_business_manage_comments</code><span>Comentários, resposta pública e private reply</span><b>Usada</b></div>
    <div><code>instagram_business_manage_insights</code><span>Métricas usadas pelo Radar</span><b>Usada</b></div>
    <div><code>instagram_business_manage_messages</code><span>Compatibilidade do envio da mensagem privada</span><b>Usada</b></div>
    <div><code>instagram_business_content_publish</code><span>Publicação de Reels pelo Novo conteúdo</span><b>Usada</b></div>
  </div>;
}

function WebhookFields() {
  const fields = [
    ["comments", "Ligado", true],
    ["messages", "Ligado", true],
    ["live_comments", "Desligado", false],
    ["message_edit e message_reactions", "Desligado", false],
    ["outros messaging_* e standby", "Desligado", false],
  ];
  return <section className="webhook-fields" aria-labelledby="webhook-fields-title">
    <div className="setup-section-heading"><span>Campos do webhook</span><h3 id="webhook-fields-title">Ligue comments e messages</h3><p><code>comments</code> inicia a automação. <code>messages</code> recebe a confirmação “pronto” e libera o conteúdo depois da verificação de seguidor.</p></div>
    <div>{fields.map(([name, status, enabled]) => <div key={String(name)}><code>{name}</code><span className={enabled ? "on" : "off"}><i />{status}</span></div>)}</div>
  </section>;
}

export default async function ConnectionGuidePage() {
  const connection = await getConnection();
  const origin = env.APP_ORIGIN.replace(/\/$/, "");
  const urls = {
    webhook: `${origin}/api/meta/webhook`,
    oauth: `${origin}/api/meta/oauth/callback`,
    deauthorize: `${origin}/api/meta/deauthorize`,
    deletion: `${origin}/api/meta/data-deletion`,
    privacy: `${origin}/privacy`,
  };
  const publicOrigin = origin.startsWith("https://");

  return <div className="page-shell connection-guide-v2">
    <header className="setup-hero">
      <div>
        <p className="eyebrow">Configuração do Instagram</p>
        <h1>Um caminho só.<br /><em>Sem adivinhação.</em></h1>
        <p>Este guia acompanha as telas atuais da Meta. Siga as etapas na ordem e não pule para o botão de conexão antes de terminar a configuração do servidor.</p>
      </div>
      <aside>
        <div className={connection ? "setup-status connected" : "setup-status"}>{connection ? <CheckCircle2 size={20} /> : <AtSign size={20} />}</div>
        <span>Estado da sua instalação</span>
        <strong>{connection ? `@${connection.username}` : "Instagram ainda não conectado"}</strong>
        <p>{isDemoMode ? "O painel está em modo demonstração." : connection ? "A conta já autorizou o Vortex. Em Integração você pode conectar outra sem substituir esta." : "Complete as oito etapas abaixo."}</p>
      </aside>
    </header>

    <section className="setup-who-is-this-for">
      <div><ShieldCheck size={21} /><div><strong>Você instalou ou administra o Vortex?</strong><p>Este guia é para você. A configuração da Meta e da Vercel é feita uma vez por instalação.</p></div></div>
      <div><UserRoundCheck size={21} /><div><strong>Você é apenas usuário ou cliente?</strong><p>Você não precisa criar um app na Meta. Quando o administrador terminar esta configuração, basta entrar no Vortex e clicar em &quot;Conectar Instagram&quot;.</p></div></div>
    </section>

    <GuideProgress stepIds={STEP_IDS} />

    {!publicOrigin && <div className="setup-blocker"><AlertTriangle size={18} /><p>O endereço atual é local: <code>{origin}</code>. Faça o deploy em um domínio HTTPS antes de configurar webhooks e OAuth.</p></div>}

    <nav className="setup-roadmap" aria-label="Etapas do guia">
      {[
        ["01", "Preparar"],
        ["02", "Criar app"],
        ["03", "Abrir API"],
        ["04", "Conta teste"],
        ["05", "Servidor"],
        ["06", "Webhook"],
        ["07", "Publicar"],
        ["08", "Conectar"],
      ].map(([number, label], index) => <a href={`#${STEP_IDS[index]}`} key={number}><b>{number}</b><span>{label}</span></a>)}
    </nav>

    <main className="setup-steps">
      <StepShell id="prepare" number="01" location="Instagram e acessos" title="Separe o que será usado" intro="Antes de abrir a Meta, confirme a conta profissional e os acessos necessários.">
        <TaskList>
          <li>Confirme que a conta do Instagram é <strong>Business ou Creator</strong>. Perfil pessoal não funciona com esta API.</li>
          <li>Tenha acesso ao Instagram, ao <strong>Meta for Developers</strong> e ao projeto do Vortex na <strong>Vercel</strong>.</li>
          <li>Use uma conta Meta protegida por autenticação em dois fatores.</li>
          <li>Não é necessário vincular uma Página do Facebook. Este projeto usa <strong>Instagram Login</strong>.</li>
        </TaskList>
        <div className="setup-note"><AtSign size={17} /><p>Se a conta ainda for pessoal, abra o Instagram: <strong>Configurações e atividade → Tipo e ferramentas da conta → Mudar para conta profissional.</strong></p></div>
        <Expected>A conta aparece como Business ou Creator e você consegue entrar nela.</Expected>
      </StepShell>

      <StepShell id="create-app" number="02" location="Meta for Developers" title="Crie o aplicativo da Meta" intro="A criação tem cinco telas. Os nomes abaixo correspondem às telas que você enviou.">
        <div className="setup-action-row"><ExternalAction href={META_CREATE_APP}>Abrir criação de aplicativo</ExternalAction><span>Abra em outra aba e mantenha este guia disponível.</span></div>
        <AppCreationMap />
        <TaskList>
          <li>Na tela <strong>Detalhes do app</strong>, informe o nome do aplicativo e seu e-mail.</li>
          <li>Em <strong>Casos de uso</strong>, filtre por Business Messaging e marque <strong>Gerenciar mensagens e conteúdo no Instagram</strong>.</li>
          <li>Escolha o portfólio empresarial que será dono do app. Se não tiver um, use a opção de continuar sem conectar.</li>
          <li>Revise o resumo e clique no botão verde <strong>Criar aplicativo</strong>.</li>
        </TaskList>
        <Expected>O painel do novo aplicativo está aberto e mostra o caso de uso do Instagram.</Expected>
      </StepShell>

      <StepShell id="instagram-api" number="03" location="Casos de uso → Personalizar" title="Abra a configuração com Login do Instagram" intro="A Meta mostra opções com nomes parecidos. Confirme pelo conteúdo da página, não pelo texto cortado do menu.">
        <div className="setup-choice-grid">
          <article className="correct"><CheckCircle2 size={19} /><div><small>Use</small><strong>Configuração da API com login do Instagram</strong><p>Mostra Instagram App ID, permissões instagram_business_* e o endereço graph.instagram.com.</p></div></article>
          <article><AlertTriangle size={19} /><div><small>Não use</small><strong>Auxiliar de integração de API</strong><p>Essa tela serve apenas para testes manuais com token.</p></div></article>
          <article><AlertTriangle size={19} /><div><small>Não use</small><strong>Configuração com Facebook Login</strong><p>Ela mostra instagram_basic, pages_* e exige Página do Facebook.</p></div></article>
        </div>
        <InstagramSetupMap />
        <TaskList>
          <li>No bloco 1, clique em <strong>Add all required permissions</strong>.</li>
          <li>Abra <strong>Permissões e recursos</strong> e adicione <code>instagram_business_manage_insights</code> e <code>instagram_business_content_publish</code>.</li>
          <li>No topo da página, localize o <strong>ID do app do Instagram</strong> e a <strong>Chave secreta do app do Instagram</strong>. Eles serão usados na etapa 5.</li>
        </TaskList>
        <PermissionTable />
        <div className="setup-warning"><AlertTriangle size={17} /><p>Não use o App ID genérico de &quot;Configurações do app → Básico&quot;. O Vortex precisa das credenciais mostradas dentro da configuração da API do Instagram.</p></div>
        <Expected>A página mostra os cinco blocos numerados e as credenciais específicas do Instagram.</Expected>
      </StepShell>

      <StepShell id="tester" number="04" location="Funções do app e bloco 2" title="Adicione cada conta que vai conectar" intro="Enquanto o aplicativo estiver em Desenvolvimento, cada perfil Business ou Creator — inclusive o segundo — precisa ser testador. Sem isso, o consentimento da Meta pode concluir e o Graph ainda recusar o token.">
        <TaskList>
          <li>No menu lateral da Meta, abra <strong>Funções do app → Funções</strong>.</li>
          <li>Adicione cada conta profissional como <strong>Testador do Instagram</strong>.</li>
          <li>Entre nessa conta pelo Instagram. Abra <strong>Configurações → Apps e sites → Convites de teste</strong> e aceite o convite.</li>
          <li>Repita o convite e o aceite para qualquer perfil extra antes de usar <strong>Conectar outra conta</strong>.</li>
          <li>Volte ao bloco 2, <strong>Gerar tokens de acesso</strong>, e clique em <strong>Adicionar conta</strong>.</li>
        </TaskList>
        <div className="setup-dont-token"><KeyRound size={20} /><div><strong>Não use &quot;Gerar token&quot; para conectar o Vortex</strong><p>Esse token é útil apenas para testes dentro da Meta. O botão &quot;Conectar Instagram&quot; do Vortex cria e salva o token correto automaticamente.</p></div></div>
        <Expected>A conta aparece no bloco 2. O botão de assinatura do webhook pode continuar desligado por enquanto; o Vortex fará a assinatura depois do login.</Expected>
      </StepShell>

      <StepShell id="server" number="05" location="Vercel → Settings → Environment Variables" title="Salve as credenciais no servidor" intro="Esta é a ponte entre o aplicativo da Meta e o Vortex. Cada valor tem uma origem definida.">
        <div className="setup-action-row"><ExternalAction href="https://vercel.com/dashboard">Abrir painel da Vercel</ExternalAction><span>Abra seu projeto e cadastre as variáveis em Production, Preview e Development.</span></div>
        <div className="setup-env-table">
          <div><code>META_APP_ID</code><span>Copie o ID do app do Instagram mostrado na etapa 3.</span></div>
          <div><code>META_APP_SECRET</code><span>Copie a chave secreta do app do Instagram. Nunca exponha esse valor.</span></div>
          <div><code>META_WEBHOOK_APP_SECRET</code><span>Em <strong>Configurações do app → Básico</strong>, copie a <strong>Chave secreta do aplicativo principal</strong>. Ela assina os eventos recebidos; não é a chave do app do Instagram.</span></div>
          <div><code>META_GRAPH_API_VERSION</code><span>Use <strong>v25.0</strong>, a versão exibida nas telas atuais da Meta.</span></div>
          <div><code>META_WEBHOOK_VERIFY_TOKEN</code><span>Crie no gerador logo abaixo.</span></div>
          <div><code>APP_ORIGIN</code><span>Use <strong>{origin}</strong>, sem barra no final.</span></div>
          <div><code>DEMO_MODE</code><span>Digite <strong>false</strong>.</span></div>
        </div>
        <WebhookTokenSetup />
        <div className="setup-note"><FileKey2 size={17} /><p>Depois de salvar as variáveis, abra <strong>Deployments</strong> na Vercel e faça um novo deploy. Alterar uma variável não atualiza um deploy antigo.</p></div>
        <Expected>O novo deploy terminou sem erro e o modo demonstração está desligado.</Expected>
      </StepShell>

      <StepShell id="webhook-login" number="06" location="Configuração da API → blocos 3 e 4" title="Configure o webhook e as URLs do login" intro="Agora você voltará à mesma página da Meta. Primeiro configure o bloco 3. Depois abra o bloco 4.">
        <section className="setup-config-panel">
          <header><Webhook size={19} /><div><small>Bloco 3</small><h3>Configurar webhooks</h3></div></header>
          <UrlRow label="URL de callback" value={urls.webhook} where="Cole no primeiro campo do bloco 3" />
          <div className="setup-plain-instruction"><b>Verificar token</b><p>Cole o mesmo valor de <code>META_WEBHOOK_VERIFY_TOKEN</code> que você salvou na Vercel.</p></div>
          <div className="setup-plain-instruction"><b>Certificado de cliente</b><p>Deixe a chave desligada. Clique em <strong>Verificar e salvar</strong>.</p></div>
        </section>
        <WebhookFields />
        <div className="setup-warning"><AlertTriangle size={17} /><p>Deixe <code>comments</code> e <code>messages</code> como &quot;Assinado&quot;. Sem <code>messages</code>, o Vortex envia a primeira DM, mas não recebe a palavra “pronto”. Os demais campos podem ficar desligados.</p></div>
        <section className="setup-config-panel">
          <header><Link2 size={19} /><div><small>Bloco 4</small><h3>Configurar o login da empresa no Instagram</h3></div></header>
          <p className="setup-panel-intro">Clique em <strong>Configurar</strong>. Na tela que abrir, cadastre estas URLs:</p>
          <UrlRow label="Valid OAuth Redirect URI" value={urls.oauth} where="Retorno do login" />
          <UrlRow label="Deauthorize Callback URL" value={urls.deauthorize} where="Desautorização" />
          <UrlRow label="Data Deletion Request URL" value={urls.deletion} where="Exclusão de dados" />
          <UrlRow label="Privacy Policy URL" value={urls.privacy} where="Política de privacidade" />
        </section>
        <Expected>O bloco 3 aparece com o indicador verde, `comments` está assinado e as quatro URLs do bloco 4 foram salvas.</Expected>
      </StepShell>

      <StepShell id="publish" number="07" location="Bloco 5 e menu Publicar" title="Escolha entre teste e uso real" intro="A conta testadora pode validar a integração antes da análise do app. Para liberar outras contas e operar em produção, siga o processo indicado pela Meta.">
        <div className="setup-publish-paths">
          <article><TestTube2 size={20} /><div><small>Agora</small><strong>Testar com sua conta</strong><p>Mantenha a conta como testadora. Termine a etapa 8 e confirme que o fluxo técnico funciona.</p></div></article>
          <article><Globe2 size={20} /><div><small>Depois do teste</small><strong>Colocar em uso real</strong><p>Abra o bloco 5, prepare a análise do app, conclua os requisitos mostrados pela Meta e publique.</p></div></article>
        </div>
        <TaskList>
          <li>Confirme que a política de privacidade e a página de exclusão de dados abrem sem login.</li>
          <li>No bloco 5, leia os requisitos exibidos para as permissões realmente usadas pelo Vortex.</li>
          <li>Para atender contas de clientes, solicite <strong>Advanced Access</strong> e conclua a verificação empresarial quando a Meta pedir.</li>
          <li>Não solicite revisão de publicação de conteúdo ou mensagens gerais. O Vortex não usa essas funções.</li>
        </TaskList>
        <div className="setup-reference-row"><ExternalAction href={META_INSTAGRAM_DOCS}>Login do Instagram</ExternalAction><ExternalAction href={META_COMMENTS_DOCS}>Webhooks de comentários</ExternalAction><ExternalAction href={META_INSIGHTS_DOCS}>Insights</ExternalAction></div>
        <Expected>Para o primeiro teste, sua conta continua como testadora. Para produção, o painel da Meta não mostra requisitos pendentes.</Expected>
      </StepShell>

      <StepShell id="connect-test" number="08" location="Vortex → Integração" title="Conecte a conta e faça um teste simples" intro="A partir daqui, o Vortex assume o trabalho técnico: OAuth, token, assinatura de comments e sincronização dos Reels.">
        <div className="setup-action-row"><Link className="setup-action" href="/settings">Abrir Integração<ArrowRight size={15} /></Link><span>Use a conta profissional adicionada como testadora.</span></div>
        <TaskList>
          <li>Clique em <strong>Conectar Instagram</strong> e autorize as permissões solicitadas.</li>
          <li>Ao voltar, confirme que o painel mostra a conta conectada e os Reels sincronizados.</li>
          <li>Para um segundo perfil Business ou Creator, confirme que ele também é testador, abra Integração e use <strong>Conectar outra conta</strong>. Reautorizar um @handle não apaga o outro.</li>
          <li>Crie uma automação com uma palavra fácil de testar, por exemplo <strong>GUIA2026</strong>.</li>
          <li>Com uma segunda conta, comente exatamente essa palavra em um Reel.</li>
          <li>Confira a resposta pública, a solicitação no Direct e o registro no Histórico.</li>
        </TaskList>
        <div className="setup-test-line" aria-label="Fluxo do teste">
          <span><MessageCircle size={16} /> Segunda conta comenta</span><ChevronRight size={15} />
          <span><Radio size={16} /> Meta envia o webhook</span><ChevronRight size={15} />
          <span><AtSign size={16} /> Vortex responde</span><ChevronRight size={15} />
          <span><CheckCircle2 size={16} /> Histórico confirma</span>
        </div>
        <div className="setup-warning"><AlertTriangle size={17} /><p>Não faça o teste comentando com a própria conta profissional. O Vortex ignora comentários próprios para evitar respostas em ciclo.</p></div>
        <Expected>O comentário aparece no Histórico e a segunda conta recebe a resposta privada.</Expected>
      </StepShell>
    </main>

    <section className="setup-help">
      <div className="setup-section-heading"><span>Se algo der errado</span><h2>Confira o ponto exato antes de recomeçar</h2></div>
      <div>{[
        ["A Meta não aceita o webhook", "Confira se o deploy foi feito depois de salvar o token. A URL precisa ser HTTPS e o valor colado na Meta deve ser idêntico ao da Vercel."],
        ["A conta não aparece", "Confirme se ela é profissional, se foi adicionada como Testador do Instagram e se o convite foi aceito dentro do Instagram."],
        ["Aparecem permissões pages_*", "Você abriu Facebook Login. Volte para a configuração com Login do Instagram."],
        ["O webhook verifica, mas não chega comentário", "Deixe comments assinado. Depois reconecte a conta para o Vortex executar a assinatura por usuário."],
        ["O login volta com erro", "Compare a Valid OAuth Redirect URI com a URL deste guia. HTTPS, caminho e barra final precisam coincidir."],
        ["O login volta com código 100", "O consentimento concluiu, mas a Meta recusou o token no Graph. Enquanto o app estiver em Desenvolvimento, adicione esse perfil como Testador do Instagram, aceite o convite e tente de novo. As contas já conectadas permanecem."],
        ["A DM não chegou", "Use uma segunda conta e confira a pasta Solicitações do Direct. A Meta permite uma private reply por comentário."],
      ].map(([title, answer]) => <details key={title}><summary><CircleHelp size={16} />{title}<ChevronRight size={15} /></summary><p>{answer}</p></details>)}</div>
    </section>

    <footer className="setup-final">
      <div><p className="eyebrow">Fim do guia</p><h2>Terminou as oito etapas?</h2><p>Abra a Integração e conecte a conta profissional.</p></div>
      <Link className="button button-primary" href="/settings">Conectar Instagram <ArrowRight size={15} /></Link>
    </footer>
  </div>;
}
