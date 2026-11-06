# Decisões arquiteturais

## ADR-001 — Monólito modular em Next.js

**Decisão:** painel, OAuth, webhooks e worker vivem no mesmo projeto Next.js, separados por módulos de domínio e adaptadores.

**Motivo:** o MVP tem um proprietário (`OWNER_EMAIL`) e pode manter várias contas Instagram Business/Creator ligadas a esse owner. Microserviços aumentariam implantação e observabilidade sem benefício comprovado. A interface `InstagramGateway` preserva uma fronteira extraível. Webhooks resolvem a conta por `instagram_user_id`; o painel opera sobre a conexão selecionada.

## ADR-002 — PostgreSQL, RLS e Supabase

**Decisão:** Supabase hospeda Auth, Postgres, migrations e fila `pgmq`; todas as tabelas expostas têm RLS por `owner_id`.

**Trade-off:** existe dependência de extensões Supabase, mitigada por SQL versionado e PostgreSQL padrão para o domínio principal.

## ADR-003 — Fila durável com processamento idempotente

**Decisão:** o webhook persiste e enfileira antes do `200`; `after()` tenta processar imediatamente e Cron recupera mensagens após visibility timeout.

**Invariantes:** evento único por conta/comentário; run único por automação/usuário; timeout depois de chamada Meta vira `ambiguous`, sem reenvio cego.

## ADR-004 — Tokens cifrados e rastreamento opaco

**Decisão:** tokens Meta usam AES-256-GCM com chave fora do banco. Tracking usa 128 bits aleatórios e só o SHA-256 é persistido.

**Trade-off:** perder a chave de criptografia exige reconectar o Instagram; a chave deve ser protegida e ter backup seguro.

## ADR-006 — Inteligência de audiência

O desenho de anonimização, Structured Outputs, evidências, limites de custo e aprovação humana está detalhado em [006-audience-intelligence.md](006-audience-intelligence.md).

## Estúdio de conteúdo

Voz, storytelling, entregáveis por tipo e o limite da Instagram API para ideias automáticas estão em [content-studio.md](../content-studio.md).
