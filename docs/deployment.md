# Publicação com Vercel e Supabase

Este é o caminho com menor manutenção para colocar o Vortex online.

## Arquitetura

- **GitHub:** código, Pull Requests e CI.
- **Vercel:** aplicação Next.js, OAuth, webhooks e workers HTTP.
- **Supabase:** PostgreSQL, autenticação, RLS, filas e Cron.
- **OpenAI:** análise do Radar, opcional.
- **Seu provedor de DNS:** domínio e subdomínio.

## 1. Faça seu próprio fork

Abra <https://github.com/hcb2019/vortex> e clique em **Fork**. Conecte esse fork à Vercel. Assim, cada pessoa mantém sua própria instalação e suas próprias credenciais.

## 2. Teste uma demonstração

Configure:

```dotenv
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
APP_ORIGIN=https://vortex.seudominio.com
OWNER_EMAIL=seu-email@example.com
```

Publique e confirme `/`, `/dashboard`, `/radar` e `/connection-guide`.

## 3. Crie o Supabase

1. Crie um projeto.
2. Vincule a CLI ao projeto.
3. Aplique as migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push
   ```

   Aplique as migrations **antes ou junto** do deploy. A migration `multi_instagram_connections` remove `UNIQUE(owner_id)` para permitir várias contas Instagram no mesmo login; a linha já existente permanece intacta. A migration `feed_media_types` relaxa o check de `instagram_media` para aceitar `FEED` e adiciona `media_type`; as linhas de Reels já existentes recebem `VIDEO` e não são apagadas.

4. Em Authentication:
   - configure a Site URL;
   - adicione `https://vortex.seudominio.com/auth/callback`;
   - convide o `OWNER_EMAIL`;
   - mantenha cadastro público desativado.

## 4. Configure os segredos

Copie `.env.example` e cadastre os valores no painel da Vercel. Em produção:

```dotenv
DEMO_MODE=false
NEXT_PUBLIC_DEMO_MODE=false
APP_ORIGIN=https://vortex.seudominio.com
OPENAI_API_KEY=sk-...
OPENAI_AUDIENCE_MODEL=gpt-5.6-terra
```

`OPENAI_API_KEY` libera a redação completa por IA no Estúdio. Sem ela, o aplicativo usa uma geração local isolada por briefing e identifica esse modo na tela.

Gere:

```bash
openssl rand -base64 32 # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32    # WORKER_SECRET
openssl rand -hex 32    # CRON_SECRET
openssl rand -hex 32    # META_WEBHOOK_VERIFY_TOKEN
openssl rand -hex 32    # PIPELINE_API_KEY_PEPPER
```

Use valores independentes para `TOKEN_ENCRYPTION_KEY`, `WORKER_SECRET`,
`CRON_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` e `PIPELINE_API_KEY_PEPPER`.

Segredos nunca podem usar prefixo `NEXT_PUBLIC_`.

## 5. Conecte a Meta

Siga [Configuração da Meta](meta-setup.md). Cadastre as URLs do domínio definitivo e reautorize o Instagram sempre que mudar o App ID, segredo ou permissões.

## 6. Configure os jobs

Programe chamadas `POST` autenticadas com `WORKER_SECRET`:

- `/api/internal/jobs/process`;
- `/api/internal/jobs/analyze`.

Use Supabase Cron, Vercel Cron compatível com seu plano ou outro agendador seguro.

O deploy da Vercel também registra uma chamada diária para
`/api/internal/jobs/maintenance`. Cadastre `CRON_SECRET` nos ambientes de
produção da Vercel. Essa rotina renova o token do Instagram 14 dias antes do
vencimento. O worker de processamento executa a mesma verificação como
redundância.

## 7. Adicione o domínio

Cadastre o domínio na Vercel e copie exatamente o registro DNS fornecido. Depois de validar HTTPS, atualize `APP_ORIGIN`, Supabase e Meta.

## Custos

Planos e limites mudam. Confira os termos atuais antes de uso comercial:

- [Vercel](https://vercel.com/pricing);
- [Supabase](https://supabase.com/pricing);
- [OpenAI](https://openai.com/api/pricing/);
- [Meta for Developers](https://developers.facebook.com/docs/).

## Checklist

```bash
pnpm install --frozen-lockfile
pnpm config:check
pnpm audit --prod --audit-level high
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

Depois do deploy, valide o checklist de produção em [Instalação local e VPS](self-hosting.md).
