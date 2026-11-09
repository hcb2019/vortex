# Runbook operacional

## Worker e fila

O webhook chama o worker via `after()`. Para recuperação, configure Supabase Cron para fazer POST a cada minuto em `/api/internal/jobs/process` com `Authorization: Bearer WORKER_SECRET`. Guarde URL e segredo no Vault; nunca no SQL versionado. Esse worker também verifica o vencimento do token do Instagram e o renova quando restarem 14 dias ou menos.

Mensagens permanecem na fila por 60 segundos quando um worker falha. Runs têm constraints idempotentes, portanto reentregas não enviam uma segunda DM ao mesmo usuário.

## Radar e IA

Configure um job diário para fazer POST em `/api/internal/jobs/analyze` com o mesmo Bearer secret. Ele sincroniza até 20 publicações/2.000 comentários, captura métricas disponíveis, enfileira somente fingerprints inéditos e consome duas mensagens por chamada. O limite padrão é de duas análises completas por dia.

- `OPENAI_API_KEY` ausente: sincronização manual e modo mock continuam funcionando; nenhum job de IA é criado.
- `ANALYSIS_FAILED`: verifique os logs protegidos, disponibilidade da OpenAI e schema de resposta. A interface recebe apenas um erro sanitizado.
- Métrica Meta indisponível: as demais métricas são buscadas separadamente e o valor ausente fica zerado.
- Fila parada: repetir o endpoint é seguro; a mensagem reaparece após o visibility timeout e o fingerprint impede duplicação.
- Custo inesperado: reduza `AI_MAX_COMMENTS_PER_RUN`, mantenha `AI_MAX_DAILY_RUNS=2` e confira tokens em `audience_analysis_runs`.

## Falhas

- `connection_unavailable`: renovar a conexão no painel antes de reativar automações.
- `Renovação do token: Meta (190)`: o token já expirou ou foi revogado e não
  pode mais ser renovado; reautorize uma vez. Conexões ainda válidas são
  renovadas automaticamente.
- `partial`: uma das duas etapas funcionou; não reenvie manualmente sem verificar o Instagram.
- `ambiguous`: houve timeout após a chamada; conferir na interface do Instagram antes de qualquer nova tentativa.
- `429`/`5xx`: o cliente tenta até três vezes com backoff e `Retry-After`.

## Retenção

Agende `select public.purge_expired_personal_data();` diariamente pelo Supabase Cron. A função remove cliques antigos e anonimiza comentários/usuários após 180 dias, mantendo métricas agregadas.

## Deploy

1. Crie projetos Supabase e Vercel.
2. Aplique migrations com `pnpm supabase db push --dry-run` e depois `pnpm supabase db push`.
3. Configure todas as variáveis de `.env.example` no Vercel.
4. Faça primeiro um preview deploy e execute smoke tests.
5. Configure Meta e Cron somente depois de existir o domínio estável.
