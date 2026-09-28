# Painel responsivo, Início por papel e avisos (UX 2)

Pergunta que guiou esta rodada: *uma secretária sem treinamento técnico consegue trabalhar o dia inteiro
nisso? O padre abre o painel e entende a paróquia em 10 segundos?*

Nada muda no banco. Nenhuma RPC, tabela ou policy foi alterada; a privacidade de `public_note` continua a
mesma (testes em `tests/secretaria24h/navegador.test.mjs` e `jsdom.test.mjs`).

## Tamanhos de tela (só CSS, pela largura; nunca por user-agent)

| Largura | Painel |
|---|---|
| até 767 px (celular) | como antes: uma coluna, barra de baixo com **Início · Comunicar · Agenda · Intenções · Mais** |
| 768–1199 px (tablet) | trilho lateral (100 px) com ícone **e nome** de todas as áreas; cabeçalho em uma linha |
| 1200 px ou mais (computador) | menu lateral de 232 px, conteúdo até 1400 px, cabeçalho “Central Paroquial · Paróquia · perfil · 🔔 · Sair” |

Tudo depende de `body.painel-app` (painel logado ou modo demonstração). A página pública e a tela de
login não mudaram. O mesmo HTML serve às três larguras: itens só da barra têm `.so-barra` (“Mais”),
itens só do menu lateral têm `.so-lateral`.

No celular, **Dizimistas** saiu da barra para dar lugar ao **Início** e continua em “Mais” (com o badge
de interessados). No tablet e no computador, todas as áreas ficam no menu, com a Secretaria 24h logo
abaixo do Início.

Depois do login, o painel sempre abre no **Início**.

## Início por papel

- **Secretaria**: bloco da Secretaria 24h no topo (novas, em atendimento, aguardando fiel, concluídas
  hoje, as 4 novas mais recentes com “Abrir solicitação”), “Hoje na paróquia” (agenda, intenções, avisos,
  aniversários, interessados) e “Ações rápidas” (Publicar aviso, Criar evento, Ver intenções, Abrir
  Secretaria 24h, Registrar contribuição, Enviar mensagens do dia).
- **Padre e suporte**: cartões gerenciais (Secretaria 24h, Agenda, Aniversários e bodas, Dízimo do mês
  com % e barra, Avisos, Intenções, Quero ser dizimista, Novos dizimistas), próximos eventos (7 dias) e
  ações rápidas. Cada cartão abre o módulo no ponto certo (ex.: Dízimo abre o Acompanhamento).
- **PASCOM**: agenda, avisos, comunidades e ações de comunicação. Sem Secretaria 24h, dízimo ou
  interessados.

## Secretaria 24h no computador

Resumo no topo (4 números, clicáveis como filtro). Embaixo, **lista à esquerda e detalhe à direita**
(a partir de 1024 px): abrir outra solicitação não tira a lista do lugar. Filtros e busca ficam sempre
visíveis. Cada linha mostra nome, serviço, protocolo, data/hora (“há 3 min”), situação e a marca
**Nova** (recebida e ainda não aberta neste aparelho). Abaixo de 1024 px, continua lista **ou** detalhe.

Os status aparecem sempre em português: Recebida, Em atendimento, Aguardando resposta do fiel,
Concluída, Encerrada.

## Sistema de atenção

- **Badge** no item Secretaria 24h do menu (e somado no “Mais” do celular) = solicitações novas.
- **Início** com o bloco destacado quando há novas.
- **Aviso do próprio sistema** (canto inferior direito; no celular, acima da barra) quando chega uma
  solicitação com o painel aberto: serviço, nome e botão **Ver solicitação**. Não bloqueia a tela, some
  sozinho (pausa com o mouse em cima) e fecha no ×. Sem `alert()`, sem som, sem animação contínua: só
  uma entrada suave, desligada com `prefers-reduced-motion`.
- **🔔 Novas atividades** no cabeçalho: solicitações novas, “Quero ser dizimista” e intenções de missa
  novas, com “há X min”. Abrir o 🔔 marca tudo como visto (neste aparelho). PASCOM só vê as intenções.
- **Erros**: sem código técnico. Ao salvar na fila, “Não foi possível salvar agora” + **Tentar
  novamente**, que reenvia o que estava escrito. Confirmações com “✓” (“✓ Status atualizado: …”).

### Atualização: polling, não Realtime

A fila é relida a cada **30 s** na tela da Secretaria 24h e a cada **60 s** no resto do painel, e na hora
em que a pessoa entra na fila ou no Início. Com a aba escondida, para (a não ser que as notificações do
navegador estejam ativas).

Supabase Realtime foi descartado nesta rodada. Exigiria mudar o banco (colocar `service_requests` na
publicação `supabase_realtime`), manter um websocket aberto por aparelho e cuidar de reconexão. Tudo isso
é mais risco do que uma consulta a cada 30–60 s por secretária conectada. O resto do painel já relê a
cada 15 s pelo mesmo motivo.

## Notificações do navegador (sem Web Push)

Implementado: um convite do próprio sistema no Início (“Quer receber aviso quando uma nova solicitação
chegar?” **Ativar notificações** / **Agora não**). O `Notification.requestPermission()` só é chamado
**depois** do clique em Ativar. “Agora não” esconde o convite por 14 dias.

Com a permissão dada, quando chega solicitação e o painel está **aberto mas escondido** (outra aba,
minimizado), o computador mostra “Nova solicitação — Secretaria 24h” com o **serviço, sem o nome do
fiel** (pode aparecer na tela bloqueada). Um clique leva à solicitação. Funciona no Chrome, Edge e
Firefox de computador. No Android e no iPhone, isso só funciona com Service Worker (ver Web Push).

## Web Push: análise e decisão

**Decisão: não implementar nesta rodada.** Dá para fazer sem serviço pago, mas não é uma mudança
pequena:

| Peça | O que exigiria |
|---|---|
| Service Worker | novo arquivo `sw.js` publicado (mudar `.assetsignore`), registro e atualização de versão |
| Push API + VAPID | par de chaves VAPID; a privada como *secret* do Worker (`wrangler secret put`) |
| Subscriptions | tabela nova no Supabase (`push_subscriptions`: usuário, paróquia, endpoint, chaves), RLS, limpeza das expiradas |
| Disparo | quando nasce uma solicitação, alguém chama o Worker: Database Webhook/`pg_net` no Supabase (mais uma peça no banco) ou o próprio `public_create_service_request` avisando |
| Envio | no Worker: assinar o JWT VAPID e cifrar a mensagem (RFC 8291, aes128gcm) com WebCrypto. A biblioteca `web-push` do Node não roda como está no Worker |
| Compatibilidade | Chrome/Edge/Firefox (computador e Android): sim. **iPhone: só iOS 16.4+ e só com o site instalado na tela de início (PWA com manifest)**. Pelo Safari aberto normalmente, não |
| HTTPS | obrigatório (já temos no Workers; `localhost` também vale para teste) |

Proposta para a próxima etapa, em ordem: (1) `manifest.webmanifest` + `sw.js` mínimo; (2) migração
`push_subscriptions` com RLS “cada um só as suas”; (3) rota `/api/push/assinar` no Worker; (4) rota
`/api/push/enviar` protegida por segredo, chamada por um Database Webhook em `service_requests` (insert);
(5) teste em Chrome Android e iPhone com PWA instalado. O que existe hoje (badge, aviso, 🔔,
notificação com o painel aberto, polling) continua valendo como plano B.

## “Minhas solicitações” (página pública)

Quando o fiel envia, o aparelho guarda **só** protocolo, título do serviço, data, WhatsApp normalizado e a
última situação vista (`localStorage`, chave `central-paroquial-s24-minhas`, por paróquia, até 10).
**Nunca** as respostas do formulário nem o nome. Na Secretaria 24h aparece “Minhas solicitações” com
**Acompanhar** (preenche protocolo + WhatsApp e já consulta) e “Remover deste aparelho”. Para outro
aparelho continua “Consultar outra solicitação” (protocolo + WhatsApp). A RPC e a segurança não mudaram.

## Console (F12) ao testar localmente

Servindo com `python -m http.server`, dois 404 são **esperados**: `/api/noticias` e `/api/liturgia`
(o Worker não roda). O app cai no espelho do GitHub e no link da CNBB. Qualquer outro erro vermelho é
real. Nos testes automatizados das 5 larguras, 0 erros de JavaScript (os 404 de `/api` são contados à
parte).

## Criar o usuário PASCOM de teste (NÃO executado)

1. Supabase → **Authentication → Users → Add user → Create new user**: e-mail `pascom@teste.com`, uma
   senha forte, marque **Auto Confirm User** (assim nenhum e-mail é enviado a `teste.com`, que é um
   domínio real de terceiros). Não crie usuários por SQL em `auth.users`.
2. SQL Editor (só leitura): confirme o usuário.
   ```sql
   select id, email, created_at from auth.users where email = 'pascom@teste.com';
   ```
3. SQL Editor: vincule como PASCOM à Santo Antônio (pode rodar 2x, não duplica).
   ```sql
   insert into parish_users (user_id, parish_id, role)
   select u.id, p.id, 'pascom'
   from auth.users u cross join parishes p
   where u.email = 'pascom@teste.com' and p.slug = 'santo-antonio-jaragua'
   on conflict (user_id, parish_id) do nothing;
   ```
4. Confira os vínculos (esperado: padre, secretaria **e** pascom).
   ```sql
   select u.email, pu.role
   from parish_users pu join auth.users u on u.id = pu.user_id join parishes p on p.id = pu.parish_id
   where p.slug = 'santo-antonio-jaragua' order by pu.role;
   ```
5. Teste: login como PASCOM → sem “Secretaria 24h” e sem “Dizimistas” no menu; Início só com
   comunicação/agenda; 🔔 sem solicitações nem interessados.
6. Para desfazer: `delete from parish_users where role = 'pascom' and user_id = (select id from auth.users where email = 'pascom@teste.com');`
   e apagar o usuário em Authentication → Users.
