# Relatório de entrega — Vortex MVP

Data: 18/07/2026.

## Entregue

- Painel completo em português do Brasil, responsivo, com login owner-only, dashboard, automações, edição, detalhe, histórico, configurações e modo de demonstração.
- Supabase versionado com schema, constraints, índices, RLS, view `security_invoker`, fila `pgmq`, RPCs privilegiadas, retenção e seed.
- Adaptadores `InstagramGateway` mock/Meta, OAuth, sincronização paginada de Reels, carrosséis e posts do feed, webhook HMAC, processamento idempotente, retries, estados parciais/ambíguos e soft delete.
- Links opacos rastreáveis, primeiro clique atômico, redirecionamento 302 sem cache e retenção de 180 dias sem IP.
- CSP com nonce, headers defensivos, AES-256-GCM, redaction opcional do Sentry, CI, runbook, ADRs, threat model e checklist Meta.
- Radar de audiência com filtros de 7/30/90 dias e Reel, temas, oportunidades priorizadas, evidências, feedback e Estúdio de ideias.
- Backfill dos 20 Reels/2.000 comentários, snapshots de Insights, fila `audience_analysis`, execução diária e gatilho ao acumular 20 comentários.
- `AudienceIntelligenceProvider` mock/OpenAI, aliases efêmeros, Responses API com Structured Outputs, fingerprint e limites configuráveis de custo.
- Conversão idempotente de uma oportunidade em rascunho pré-preenchido; nenhuma publicação, mensagem ou ativação automática.
- Estúdio de ideias com perfil editorial, três conceitos, pacote humanizado de hook/legendas/CTA e entregável público de execução rápida: preparar o caso, copiar o prompt, alterar campos indicados, usar na IA, colar o resultado e aplicá-lo. A explicação aprofundada permanece recolhida como apoio opcional.
- Botões de cópia em todos os textos destinados ao Instagram, preservando exatamente parágrafos, listas e linhas em branco editados pelo usuário.
- Central “Guia de conexão” com oito etapas, checklist persistente, URLs copiáveis por deploy, ilustrações próprias, referências oficiais e diagnóstico de erros.
- Rotas públicas de privacidade, desautorização e exclusão de dados; callbacks da Meta validam `signed_request` com HMAC-SHA256 antes da remoção.

## Evidências executadas

```text
pnpm lint                         aprovado, zero warnings
pnpm typecheck                    aprovado
pnpm test                         18/18 testes aprovados
pnpm test:coverage                statements 75,42%; branches 68,00%; functions 82,75%; lines 78,72%
pnpm test:e2e                     10/10 testes aprovados (desktop e mobile)
pnpm build                        aprovado, Next.js 16.2.10
pnpm audit --audit-level moderate aprovado, nenhuma vulnerabilidade conhecida
git diff --check                  aprovado
```

A inspeção em Chromium confirmou o dashboard sem erros de console. O teste E2E também falha se houver erro de console no fluxo principal.

## Pendente por dependência externa

- Iniciar o Docker Desktop para executar migrations do zero, testes RLS e geração dos tipos locais com `pnpm db:types`.
- Informar `OWNER_EMAIL` e conectar projetos Supabase/Vercel; Sentry é opcional.
- Criar o Meta Business App, informar App ID/secret, conta profissional/tester, URLs definitivas e concluir o OAuth real.
- Reautorizar a conta com `instagram_business_manage_insights` e fornecer `OPENAI_API_KEY` para trocar os adaptadores mock pelos reais.
- Fixar em `META_GRAPH_API_VERSION` a versão exibida no Meta Dashboard no momento da conexão e realizar um envio controlado.
- Registrar o Cron/segredos em produção e executar o checklist de implantação. Nenhum deploy foi feito sem essas credenciais.
