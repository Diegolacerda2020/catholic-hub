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
| Migração do módulo (só a auditoria), **proposta local, não executada** | `supabase/agente.sql` |
| Proposta de edição segura do catálogo, **não ativa** | `supabase/agente_servicos_proposta.sql` |
| Testes locais | `tests/agente/` |

Nunca há **LLM → SQL livre**. Cada ferramenta chama só consultas e funções que já existem e que o banco protege.
Interpretação e execução são separadas (ver **Motor de IA**): quem interpreta devolve só `{intent, ...dados}`,
que passa por uma lista branca antes de chegar ao roteador.

Ganchos no `index.html` (todos testam `window.AGENTE`): `<link>`/`<script>`, ícone `I.assistente`, item em `NAV`
e `MAIS`, área aberta `assistente`, rota do painel e o card no Início. Sem os arquivos (404 ou erro), o painel
segue igual (testado).

## ARQUITETURA DE INTEGRAÇÃO

```
Painel (hoje) / WhatsApp oficial (futuro) / app (futuro)
        │   canal autentica o remetente e informa usuário + paróquia + papel
        ▼
Agent Core (agente-core.js)
        │   interpretar → lista branca → permissão → preparar → confirmação humana → ferramenta
        ▼
Serviços Central
        │   Agenda Central (consultarAgenda / criarEvento / atualizarEvento)
        │   Secretaria 24h (staff_update_service_request) · Comunidades · Catálogo
        ▼
Agenda Central  (tabela events + RLS can_access 'agenda')
        │
        ▼   integração DOWNSTREAM, em outra camada (branch feat/google-agenda-v1)
Google Calendar
```

**O Agent Core NÃO depende do Google Calendar.** Ele não conhece Google, calendários externos, ids externos,
OAuth, tokens nem estado de sincronização, e não escreve nenhuma coluna dessas (verificado por teste: o código do
núcleo e da tela não contém `google`, `external_`, `sync_status`, `calendar_id`, `oauth`).
**O Google Calendar é integração downstream da Agenda Central**: ele lê os eventos da Agenda e sincroniza depois.
Um evento criado pelo Assistente é um evento comum da Agenda Central; se a integração estiver ligada, ele entra na
sincronização como qualquer outro (testado com as colunas `source` default `'central'` e `timezone`).

O Agente também funciona **sem IA** (regras) e **sem migração** (só com o que já existe no banco).

### Contrato interno da Agenda Central

```js
evento = {
  parish_id,     // SEMPRE o da sessão; a camada recusa outro (42501)
  title,         // 2–160
  description,   // até 4000
  start_at,      // ISO
  end_at,        // ISO ou null (≥ start_at)
  timezone,      // 'America/Sao_Paulo' (único aceito nesta versão)
  location,      // até 200
  community_id,  // null ou comunidade ATIVA da mesma paróquia (conferida antes de gravar)
  visibility,    // 'publico' | 'equipe'
  source         // 'central' (evento da Agenda Central)
}
```

Qualquer outro campo (`google_event_id`, `external_event_id`, `sync_status`, `scope`, `public`, `created_by`…)
é recusado. `criarAgendaSupabase(sb)` implementa:

| Função | O que faz |
|---|---|
| `consultarAgenda({parishId, inicio, fim})` | eventos da paróquia no período (RLS), já no contrato |
| `criarEvento({parishId, evento})` | valida o contrato, confere a comunidade, grava em `events` (RLS `agenda`) |
| `atualizarEvento({parishId, eventoId, alteracoes})` | só `title, description, start_at, end_at, location, community_id, visibility`; confere que o evento é da paróquia da sessão |

A camada grava só as colunas que já existem (`title, description, starts_at, ends_at, location, community_id,
scope, public`). Origem, fuso e campos de sincronização ficam com os **padrões do banco**, que pertencem à
Agenda/integração. Quando a Agenda Central ganhar RPCs próprias (ex.: `staff_create_event`), só esta camada muda.

**`events.source`:** não é escrita pelo Agente e não é criada por `supabase/agente.sql`. A coluna pertence ao
contrato da Agenda (`'central'`/`'google'` na branch de integração). Quem criou o evento fica em
`events.created_by` e na auditoria do Agente (`criar_evento_confirmado`).

## Contrato de entrada (qualquer canal)

```js
{ channel: 'painel' | 'whatsapp' | 'app',
  sender:  { userId, papel },          // da sessão autenticada do canal
  parish:  { id, slug, nome },         // da sessão autenticada, NUNCA do texto
  message: 'texto livre',
  timestamp }
```

Sem `userId`/papel válido ou sem paróquia, o Assistente responde só "Entre com seu usuário da paróquia" e não
toca no banco.

**`channel` não autentica ninguém.** Cada instância do núcleo declara os canais em que QUEM A CHAMA já autenticou
o remetente (`criarAgente({canaisAutenticados})`, padrão `['painel']`). Mensagem de outro canal é recusada
("Este canal ainda não está autorizado a usar o Assistente."), mesmo trazendo papel ou paróquia no corpo.

- **No navegador:** a sessão do Supabase identifica usuário e paróquia (`NUVEM.sessao`, `NUVEM.papel`,
  `NUVEM.parishId`), e o RLS confere de novo no banco.
- **No WhatsApp (futuro):** o backend do webhook precisa mapear **remetente verificado → identidade autorizada →
  paróquia → papel/permissão** (tabela de vínculo no banco), e só então chamar uma instância com
  `canaisAutenticados: ['whatsapp']`, usando o JWT/identidade desse usuário para o acesso ao banco.
  **Nunca** confiar em `parish_id`, papel ou usuário enviados na mensagem ou no corpo do webhook.

## Ferramentas e níveis de autonomia

| Ferramenta | Nível | Área (`can_access`) | Usa |
|---|---|---|---|
| `consultar_agenda` / `consultar_eventos` | 🟢 verde | membro | Agenda Central `consultarAgenda` (RLS) + horários de missa de Ajustes |
| `consultar_comunidades` | 🟢 verde | membro | `communities` (RLS) |
| `consultar_servicos` | 🟢 verde | membro | `public_service_catalog(slug)` |
| `consultar_solicitacoes` | 🟢 verde | `secretaria24h` | `service_requests` + `service_catalog` (RLS; sem nome/telefone/respostas do fiel) |
| `preparar_evento` → `criar_evento_confirmado` | 🟡 amarelo | `agenda` | Agenda Central `criarEvento` (RLS `can_access 'agenda'`) |
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
5. A preparação guarda uma **cópia congelada** do que o humano revisou e uma **assinatura** desse conteúdo
   (ligada também a usuário, paróquia e canal). O cartão devolve a assinatura; confirmar exige a mesma.
   A execução usa **só** a cópia guardada: nada que o cliente mande na confirmação (dados, campos, status,
   paróquia) entra na operação. "Corrigir" gera nova pendência e invalida o cartão anterior.

Testado: expirada, reutilizada, usuário A confirmando ação de B, tenant A confirmando ação de B, canal diferente,
assinatura ausente/adulterada, cartão adulterado depois da revisão, dados extras na confirmação, duplo clique
simultâneo e cartão antigo depois do "Corrigir".

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
`cancelado`, `erro`) e se houve confirmação humana. **Não** guarda a mensagem, protocolos, títulos, nomes,
telefones, notas nem tokens. O nome da ferramenta vem sempre da lista fixa (texto livre da IA vira
`bloqueado_acao`). Leitura só por padre/suporte da própria paróquia. Sem a migração, a auditoria fica só na
memória e o Assistente funciona igual.

## Privacidade

- Listagens da Secretaria 24h: sem nome, telefone nem respostas do fiel (a consulta nem pede essas colunas).
- Conversa **só em memória** da aba: nada em `localStorage`, `sessionStorage` ou IndexedDB; ao sair, some
  (testado no Chrome). O único rastro persistido de uma ação é o mesmo que o formulário da Agenda já deixa: a
  entrada `criou-evento` com o título do evento na tela **Uso** (`parish_state.log`).
- Console: sem `console.log`; os avisos de falha registram só o código/nome do erro, nunca o objeto (que pode
  trazer dados da linha).
- O provedor de IA (futuro) recebe só o texto e `{agora, canal}`: nunca ids, paróquia, papel ou dados do banco.
## Motor de IA

Auditado em 30/09/2026: **nenhum provedor de IA configurado** (Worker só com o binding `ASSETS`; nenhum `vars`,
secret, `.dev.vars` ou Edge Function no repositório; o "Organizar aviso" usa só `window.claude` quando existe).

Interface: `interpretarMensagem(texto, contexto, {provedor})` (o `interpretar_mensagem` da especificação):

```
provedor de IA (opcional)
        ↓ falhou, deu erro ou não entendeu
interpretador por regras (interpretarDeterministico)
        ↓
lista branca (normalizarIntencao): intenção conhecida + dados no formato; o resto é descartado
        ↓
roteador → permissão → preparação → confirmação humana → ferramenta
```

A IA **só interpreta**. Ela não ganha autorização para executar nada: não escolhe ferramenta de execução
(`criar_evento_confirmado`, `atualizar_solicitacao_confirmada` não são intenções válidas), não passa
`parish_id`, ids, comunidade por id nem estado inventado, e não pula permissão. Testado com intenções
maliciosas: excluir, vincular e-mail, alterar permissão, pagamento, criar comunidade, alterar paróquia,
`__proto__`, SQL em texto, estado inexistente, filtro com injeção, `parish_id` de outra paróquia.

Para plugar um LLM depois, sem chave no navegador:

1. endpoint no servidor (Edge Function do Supabase ou rota do Worker) que confere o JWT do usuário e chama o
   provedor com a chave guardada em secret;
2. o endpoint devolve **só** `{intent, ...dados}`; o navegador passa essa função como `provedorIA` para
   `criarAgente`. Ferramentas, permissões e confirmações não mudam.
## Google Agenda

**Não é implementado aqui.** A integração está na branch `feat/google-agenda-v1` (outro agente), com o modelo
completo de sincronização (`events.source`, `external_*`, `sync_*`, `timezone`, `parish_calendar_integrations`).
Este módulo não duplica esse schema nem cria outra sincronização: o Agente escreve na Agenda Central e a
integração sincroniza depois (ver **ARQUITETURA DE INTEGRAÇÃO**).

`google_event_id` **foi removido do desenho do Agente**: não está no contrato do evento, não é enviado ao banco e
não aparece no SQL do módulo. A coluna antiga continua existindo no `schema.sql` (não é deste módulo).
## WhatsApp

Nada de WhatsApp Web não oficial, e **nenhuma integração** nesta versão. O núcleo aceita `channel: 'whatsapp'` só
numa instância criada no servidor com `canaisAutenticados: ['whatsapp']` (ver **Contrato de entrada**). Falta:

1. conta na WhatsApp Business Platform (Cloud API da Meta) com número verificado da paróquia/Central;
2. webhook no Worker (verificação de assinatura `X-Hub-Signature-256`, token de acesso em secret);
3. vínculo **número verificado → usuário → paróquia → papel** no banco (o número nunca escolhe a paróquia sozinho);
4. confirmação por botão interativo do WhatsApp usando o mesmo `confirmar(id, assinatura)`;
5. modelos de mensagem aprovados pela Meta para qualquer envio fora da janela de 24 h.
## Catálogo de serviços

Não existe RPC segura de edição (a equipe só tem `SELECT`; o catálogo é mantido pelo SQL Editor). A escrita
direta **não** foi liberada. `supabase/agente_servicos_proposta.sql` propõe `staff_update_service(id, changes)`
com campos permitidos (`title`, `description`, `instructions`, `active`, `sort_order`; nunca `code` nem
`form_fields`). **Decisão pendente:** quem edita (proposta: `can_access 'secretaria24h'`, ou só padre).

## Como ativar a auditoria

`supabase/agente.sql` é **proposta local**: não foi executado. Depois de revisão, rodar no SQL Editor (pode rodar
2x; não muda dados existentes, permissões nem a tabela `events`). Rollback no topo do arquivo.
## Testes

```sh
cd tests/agente
npm install
npm test
```

| Arquivo | O que cobre |
|---|---|
| `core.test.mjs` | parser, respostas humanas, comunidades reais, vermelho, anônimo, auditoria mínima; contrato da Agenda sem Google; confirmação endurecida (expirada, reutilizada, outro usuário/tenant/canal, assinatura, payload adulterado, duplo clique); IA maliciosa só interpreta; WhatsApp sem autenticação recusado; privacidade da auditoria |
| `sql.test.mjs` | SQL real (PGlite): 3 paróquias do `diretorio_ativacao.sql`; isolamento Santa Clara/Graças/Santo Antônio (inclusive forçando ids e sessão adulterada); admin só no próprio tenant; PASCOM sem Secretaria 24h; anônimo; evento/status só após confirmar; `atualizarEvento` com tenant e comunidade de outra paróquia; contrato recusando campos de sincronização; `agente.sql` 2x sem tocar em `events`; auditoria; proposta do catálogo; banco sem migração; compatibilidade com `source`/`timezone` da Agenda |
| `navegador.test.mjs` | Chrome com login: card no Início, conversa, evento com Corrigir/Confirmar (duplo clique), status, cancelar, PASCOM, Graças, anônimo, 390 px e 1280 px escuro, sem o módulo (404), nada da conversa em storage/console, conversa some ao sair; screenshots em `shots/` |
| `segredos.test.mjs` | nenhuma chave/API secreta no que é publicado nem no repositório; sem chamadas de IA/WhatsApp não oficial pelo navegador; núcleo e tela sem dependência de Google/sincronização; sem `console.log`; conversa só em memória |
