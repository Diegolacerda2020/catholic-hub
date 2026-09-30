# Assistente Paroquial (Agente V1)

> "Nós não somos o Theòs. Somos a Igreja viva."
> "A paróquia informa uma vez. A Central organiza e distribui."

O Assistente não é um chatbot decorativo. Ele segue um caminho fixo:

**linguagem natural → entender → organizar → consultar → preparar ação → pedir confirmação → executar ferramenta segura.**

No painel: **✨ Assistente Paroquial**: "Fale normalmente. A Central organiza para você." Fica em um card no **Início**
(todos os papéis), no menu lateral (tablet/computador) e em **Mais** (celular).

## Arquitetura

```
Painel ─┐
WhatsApp ─┼→ Agent Core (agente-core.js) → Intent Router → Ferramenta → Permissão → Confirmação → RPC/API → Banco (RLS)
futuro app ─┘
```

| Parte | Arquivo |
|---|---|
| Núcleo, independente de canal (sem DOM; roda no navegador, no Node e num Worker) | `agente-core.js` |
| Tela do painel, card do Início e adapter do navegador | `agente.js` |
| Estilos (só classes `.ag-*`) | `agente.css` |
| Migração do módulo (auditoria + `events.source`), **preparada, não executada** | `supabase/agente.sql` |
| Proposta de edição segura do catálogo, **não ativa** | `supabase/agente_servicos_proposta.sql` |
| Testes locais | `tests/agente/` |

Nunca há **LLM → SQL livre**. Cada ferramenta chama só consultas e funções que já existem e que o banco protege.
Interpretação e execução são separadas: `interpretar(texto)` devolve `{intent, ...dados}`; as ferramentas não
sabem quem interpretou. Um LLM pode entrar no lugar do parser devolvendo o mesmo formato
(`criarAgente({interpretar})`). Se ele falhar ou devolver algo inválido, o parser V1 responde. Uma intenção
desconhecida nunca executa nada, e o interpretador não consegue trocar a paróquia nem pular a permissão (testado).

Ganchos no `index.html` (todos testam `window.AGENTE`): `<link>`/`<script>`, ícone `I.assistente`, item em `NAV`
e `MAIS`, área aberta `assistente`, rota do painel e o card no Início. Sem os arquivos (404 ou erro), o painel
segue igual (testado).

## Contrato de entrada (qualquer canal)

```js
{ channel: 'painel' | 'whatsapp' | 'app',
  sender:  { userId, papel },          // da sessão autenticada do canal
  parish:  { id, slug, nome },         // da sessão autenticada, NUNCA do texto
  message: 'texto livre',
  timestamp }
```

Sem `userId`/papel válido ou sem paróquia, o Assistente responde só "Entre com seu usuário da paróquia" e não
toca no banco. No painel, `sender` e `parish` vêm de `NUVEM.sessao`, `NUVEM.papel` e `NUVEM.parishId`.

## Ferramentas e níveis de autonomia

| Ferramenta | Nível | Área (`can_access`) | Usa |
|---|---|---|---|
| `consultar_agenda` / `consultar_eventos` | 🟢 verde | membro | `events` (RLS) + horários de missa de Ajustes |
| `consultar_comunidades` | 🟢 verde | membro | `communities` (RLS) |
| `consultar_servicos` | 🟢 verde | membro | `public_service_catalog(slug)` |
| `consultar_solicitacoes` | 🟢 verde | `secretaria24h` | `service_requests` + `service_catalog` (RLS; sem nome/telefone/respostas do fiel) |
| `preparar_evento` → `criar_evento_confirmado` | 🟡 amarelo | `agenda` | insert em `events` (RLS `can_access 'agenda'`) |
| `preparar_atualizacao_solicitacao` → `atualizar_solicitacao_confirmada` | 🟡 amarelo | `secretaria24h` | `staff_update_service_request` (já existia) |
| `atualizar_servico` | ⛔ indisponível | — | aguarda `staff_update_service` (proposta) |

🔴 **Vermelho, nunca sozinho:** exclusão/cancelamento, usuários/acessos/permissões (inclui vincular e-mail),
pagamentos/Pix/doações, dados pastorais sensíveis (dizimistas, intenções, contatos), dados da paróquia,
criar comunidade a partir de texto e operações em massa. O Assistente explica e aponta a tela certa.

### Confirmação humana (amarelo)

1. O Assistente prepara e mostra o cartão (Evento · Data · Horário · Local · Comunidade · Visibilidade, ou
   Serviço · Protocolo · Situação atual · Nova situação), com **Confirmar**, **Corrigir** e **Cancelar**.
2. Se falta dado (título, data, hora, comunidade ambígua ou inexistente, data passada), o cartão já abre no
   "Corrigir" e **Confirmar** fica desabilitado; o núcleo também recusa.
3. A confirmação vale **10 minutos**, só para **o mesmo usuário, a mesma paróquia e o mesmo canal**, e **uma vez**
   (duplo clique não cria dois eventos).
4. Na mudança de status, a solicitação é relida **na paróquia da sessão** antes de executar.

Estados de solicitação: só os reais (`new`, `in_progress`, `waiting_user`, `completed`, `closed`).

## Comunidades

- Usa **exclusivamente** as `communities` ativas da paróquia da sessão. Nenhum nome é inventado.
- Sem comunidades: "Esta paróquia ainda não possui comunidades cadastradas." (Santa Clara hoje.)
- Nome exato vence o parecido; ambíguo → pergunta qual; inexistente → informa; o "Corrigir" só oferece as
  comunidades reais (e o núcleo recusa um id de outra paróquia).
- Nunca cria comunidade a partir de texto (Mais › Comunidades).
- Mapeado para depois: agenda da comunidade já funciona ("agenda da comunidade X nesta semana"); avisos da
  comunidade vêm de `parish_state.avisos` (`scope`/`communityId`) e podem virar a ferramenta `consultar_avisos`.

## Multi-paróquia

- A paróquia de trabalho é sempre a da sessão. O texto nunca troca de paróquia.
- "Mostre Santo Antônio." numa sessão da Santa Clara → **negado** (nomes das paróquias ativas vêm do diretório,
  `public_directory_search`; "paróquia X" com nome de santo também). Títulos como "Trezena de Santo Antônio" ou
  "Missa de ação de graças" em pedidos de criação não são confundidos.
- Mesmo com o cliente adulterado (paróquia trocada no navegador), o banco não entrega nem grava nada (RLS):
  testado em `tests/agente/sql.test.mjs`.

## Auditoria

`backend.auditar` grava via `agent_log_action` (em `supabase/agente.sql`): usuário (`auth.uid()`, nunca parâmetro),
paróquia (precisa ser membro), ferramenta, canal, horário, resultado (`ok`, `vazio`, `preparado`, `negado`,
`cancelado`, `erro`) e se houve confirmação humana. **Não** guarda a mensagem, nomes, telefones, notas nem
tokens. Leitura só por padre/suporte da própria paróquia. Sem a migração, a auditoria fica só na memória e o
Assistente funciona igual.

## Motor de IA

Auditado em 30/09/2026: **nenhum provedor de IA configurado** (Worker só com o binding `ASSETS`; nenhum `vars`,
secret, `.dev.vars` ou Edge Function no repositório; o "Organizar aviso" usa só `window.claude` quando existe).
Por isso o V1 usa o **parser determinístico** (`interpretarDeterministico`), que já cobre as intenções
essenciais. Para plugar um LLM depois, sem chave no navegador:

1. um endpoint no servidor (Edge Function do Supabase ou rota do Worker) que confere o JWT do usuário e chama o
   provedor com a chave guardada em secret;
2. o endpoint devolve **só** `{intent, ...dados}` no formato do parser; o navegador passa isso como
   `interpretar` para `criarAgente`. As ferramentas, permissões e confirmações não mudam.

## Google Agenda

Existe hoje: link "Adicionar ao Google Agenda" e `.ics` nos eventos públicos (sem OAuth) e a coluna
`events.google_event_id`. **Não existe** OAuth nem sincronização. O modelo de evento do Assistente já tem
`parish_id`, `community_id` opcional, `title`, `description`, `starts_at`, `ends_at`, `location`, visibilidade
(`public`), `source` e `google_event_id`. Para sincronizar falta:

1. projeto no Google Cloud da Central com a Calendar API e tela de consentimento OAuth (verificada);
2. `client_id`/`client_secret` como **secrets do servidor** (nunca no front) e tabela de tokens por paróquia
   (refresh token criptografado, só acessível por função `security definer`);
3. fluxo "Ajustes › Conectar Google Agenda" (padre/admin) e endpoint de callback no Worker/Edge Function;
4. job de sincronização (criar/atualizar/cancelar por `google_event_id`, `source = 'google'` para os importados).

## WhatsApp

Nada de WhatsApp Web não oficial. O núcleo já aceita `channel: 'whatsapp'`, mas **não há integração**. Falta:

1. conta na WhatsApp Business Platform (Cloud API da Meta) com número verificado da paróquia/Central;
2. webhook no Worker (verificação de assinatura `X-Hub-Signature-256`, token de acesso em secret);
3. vínculo **número verificado → usuário → paróquia** no banco (o número nunca escolhe a paróquia sozinho);
4. confirmação por botão interativo do WhatsApp usando o mesmo `confirmar(id)`;
5. modelos de mensagem aprovados pela Meta para qualquer envio fora da janela de 24 h.

## Catálogo de serviços

Não existe RPC segura de edição (a equipe só tem `SELECT`; o catálogo é mantido pelo SQL Editor). A escrita
direta **não** foi liberada. `supabase/agente_servicos_proposta.sql` propõe `staff_update_service(id, changes)`
com campos permitidos (`title`, `description`, `instructions`, `active`, `sort_order`; nunca `code` nem
`form_fields`). **Decisão pendente:** quem edita (proposta: `can_access 'secretaria24h'`, ou só padre).

## Como ativar a auditoria e a origem dos eventos

Revisar e rodar `supabase/agente.sql` no SQL Editor (pode rodar 2x; não muda dados existentes nem permissões).
Rollback no topo do arquivo.

## Testes

```sh
cd tests/agente
npm install
npm test
```

| Arquivo | O que cobre |
|---|---|
| `core.test.mjs` | parser, respostas humanas, confirmação (usuário/paróquia/canal/validade/uma vez), comunidades reais, vermelho, anônimo, auditoria mínima, IA plugável sem furar permissão |
| `sql.test.mjs` | SQL real (PGlite): 3 paróquias do `diretorio_ativacao.sql`; Santa Clara só Santa Clara; Graças sem Santa Clara (inclusive forçando ids); Santo Antônio isolado; admin só no próprio tenant; PASCOM sem Secretaria 24h; anônimo; evento/status só após confirmar; `agente.sql` 2x sem mudar dados; auditoria; proposta do catálogo; banco sem a migração |
| `navegador.test.mjs` | Chrome com login: card no Início, conversa, evento com Corrigir/Confirmar (duplo clique), status, cancelar, PASCOM, Graças, anônimo, 390 px e 1280 px escuro, sem o módulo (404); screenshots em `shots/` |
| `segredos.test.mjs` | nenhuma chave/API secreta no que é publicado nem no repositório; sem chamadas de IA/WhatsApp não oficial pelo navegador; conversa só em memória |
