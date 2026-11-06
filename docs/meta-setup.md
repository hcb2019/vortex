# Configuração atual da Meta

O guia interativo em `/connection-guide` é a fonte principal para configurar o Instagram. Ele acompanha o fluxo atual de criação do aplicativo e a tela "Configuração da API com login do Instagram".

## Quem faz esta configuração

O administrador que instalou o Vortex configura a Meta e a Vercel uma vez. Um usuário comum não cria outro aplicativo na Meta. Depois que a instalação estiver pronta, ele apenas entra no Vortex e clica em "Conectar Instagram". O mesmo login (`OWNER_EMAIL`) pode manter várias contas Business ou Creator: reconectar uma não substitui as outras.

## Caminho usado pelo Vortex

- Caso de uso: `Gerenciar mensagens e conteúdo no Instagram`
- Login: `Instagram API with Instagram Login`
- Host: `graph.instagram.com`
- Página do Facebook: não é necessária
- Conta: Instagram Business ou Creator

Não use "Auxiliar de integração de API" nem "Configuração com Facebook Login".

## Permissões solicitadas no OAuth

- `instagram_business_basic`
- `instagram_business_manage_comments`
- `instagram_business_manage_messages`
- `instagram_business_manage_insights`

O Vortex solicita `instagram_business_manage_messages` por compatibilidade com aplicativos Meta que exigem essa permissão no endpoint usado para a private reply.

## Credenciais e webhook

- `META_APP_ID`: ID do app do Instagram, dentro de "Configuração da API com login do Instagram".
- `META_APP_SECRET`: chave secreta do app do Instagram, usada no OAuth.
- `META_WEBHOOK_APP_SECRET`: chave secreta do aplicativo principal, em "Configurações do app → Básico". A Meta usa este segredo para assinar webhooks e solicitações de exclusão de dados.
- `META_WEBHOOK_VERIFY_TOKEN`: senha aleatória criada pelo administrador. Ela não é fornecida pela Meta.

- Callback: `https://SEU_DOMINIO/api/meta/webhook`
- Campos necessários: `comments` e `messages`
- Campos desnecessários: `live_comments`, `message_edit`, `message_reactions`, `messaging_handover`, `messaging_optins`, `messaging_postbacks`, `messaging_referral`, `messaging_seen` e `standby`
- Certificado de cliente: desligado

O administrador cria `META_WEBHOOK_VERIFY_TOKEN`, salva o mesmo valor na Vercel e no campo "Verificar token" da Meta. Depois do OAuth, o Vortex chama `/{ig_user_id}/subscribed_apps?subscribed_fields=comments,messages` automaticamente.

## URLs do login

- OAuth: `https://SEU_DOMINIO/api/meta/oauth/callback`
- Desautorização: `https://SEU_DOMINIO/api/meta/deauthorize`
- Exclusão de dados: `https://SEU_DOMINIO/api/meta/data-deletion`
- Política de privacidade: `https://SEU_DOMINIO/privacy`

## Teste

1. Adicione **cada** conta (incluindo a segunda e as seguintes) como Testador do Instagram e aceite o convite no app. Enquanto o aplicativo Meta estiver em Desenvolvimento, um perfil sem essa função pode concluir o consentimento OAuth e ainda assim ser recusado no Graph (código 100, `Unsupported request`).
2. Salve as variáveis na Vercel e faça um novo deploy.
3. Configure o webhook e as URLs do login.
4. Conecte a conta pelo Vortex. Para um segundo perfil, use **Conectar outra conta** em Integração — o painel passa a operar na conta selecionada, e os webhooks continuam a chegar por `instagram_user_id`. Reautorizar um perfil não desconecta os demais.
5. Crie uma automação de teste.
6. Comente em um Reel usando uma segunda conta.
7. Confira a resposta pública, a private reply e o Histórico.

Se a Integração voltar com `error=oauth_restricted`, o Vortex não persiste o token: a Meta recusou as chamadas ao Graph. Confira o papel de testador e o modo do app antes de tentar de novo.

Para liberar contas que não são testadoras, siga o bloco 5 da Meta, conclua a análise do aplicativo e solicite o nível de acesso exigido para as permissões usadas.
