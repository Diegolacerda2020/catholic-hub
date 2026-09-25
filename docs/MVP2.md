# MVP 2: a porta digital da vida paroquial

Objetivo desta versão: o padre perceber valor em quatro pilares, sem aumentar a complexidade para quem usa.

1. **Igreja** como nova Home pública.
2. **Agenda** completa e administrável.
3. **Comunidades** paroquiais.
4. **Dizimistas** como relacionamento pastoral (sem financeiro).

## Visão geral

```
Navegador (index.html, um arquivo só)
 ├─ Página pública (sem login) ── get_public_parish / public_submit / public_tither_interest ──┐
 ├─ Painel (login Supabase) ───── parish_state (JSON) + tabelas communities/events/tither_*  ──┤── Supabase (Postgres + RLS)
 └─ /api/noticias, /api/liturgia ─────────────────────────────── Cloudflare Worker (worker/)   ┘
```

- **Cloudflare Workers** é a publicação principal (site + APIs). **GitHub Pages** continua como reserva: tudo funciona, só sem `/api/*` (notícias pelo espelho do branch `dados`; liturgia pelo calendário local).
- **Supabase**: só a chave pública (Publishable/anon) vai para o navegador. A segurança é o RLS.

## Modelo de dados

O modelo do piloto não mudou: `parish_state.data` continua guardando `cfg`, modelos, pessoas, avisos, intenções, velas, log e mensagens do dia, com a mesma sincronização (salva ~1 s depois, relê a cada 15 s, junta alterações item a item).

As entidades novas ficam em tabelas próprias, porque precisam de regras de acesso por linha e por papel:

```
parishes 1 ── n communities
         1 ── n events           (scope parish | community → community_id)
         1 ── n tither_profiles  (community_id opcional)
         1 ── n tither_leads     (community_id opcional, tither_id após conversão)
         1 ── n tither_contributions (tither_id + reference_month; um por mês)
```

- A comunidade referenciada precisa ser da mesma paróquia (FK composta `(community_id, parish_id)`).
- Comunidades não são apagadas (`active = false`). Eventos são cancelados (`cancelled = true`); só os cancelados podem ser excluídos pela tela.
- `events.image_url` (https) e `events.google_event_id` já existem para o folder no Supabase Storage e a futura sincronização com o Google Agenda.
- **Avisos por comunidade**: continuam no `parish_state`. Campos novos em cada aviso: `scope` (`parish`/`community`), `communityId` e `eventId`. Sem `scope` = toda a paróquia (todos os avisos antigos).

### Migração

`supabase/schema.sql` é idempotente: `create table if not exists`, `create index if not exists`, `create or replace function`, policies recriadas com `drop policy if exists`. Não há `DROP TABLE`, `TRUNCATE` nem `DELETE`, e nenhum dado existente é transformado.

**Ordem segura:** o front-end novo funciona com o banco antigo. Sem as tabelas, o painel mostra "precisa da atualização do banco" em Agenda, Comunidades e Dizimistas, e a página pública simplesmente não mostra comunidades e eventos. Então tanto faz publicar antes ou depois de rodar o SQL.

## Segurança e LGPD

| Quem | communities / events | tither_profiles / tither_leads |
|---|---|---|
| Visitante (`anon`) | nenhum acesso direto; lê ativos/públicos via `get_public_parish` | nenhum acesso; só envia interessado via `public_tither_interest` |
| Membro de outra paróquia | nada | nada |
| PASCOM | lê e administra | nada |
| Secretaria, Padre, Suporte | lê e administra | lê e administra |

- A matriz de papéis está em `can_access()` (banco) e em `pode()` (tela). Hoje só "dizimistas" é restrito; as áreas do piloto continuam abertas a toda a equipe para não mudar o que já é usado. Restringir a PASCOM em pessoas, pedidos da vela e intenções é só editar as duas funções.
- `public_tither_interest`: valida nome, WhatsApp (10 a 13 dígitos), preferência de contato, comunidade ativa da paróquia e consentimento; não duplica o mesmo WhatsApp pendente; limite de 30 por hora por paróquia; devolve só `true/false`. No navegador, há ainda um campo-isca e um intervalo de 1 minuto entre envios.
- Nenhum valor de dízimo, renda ou dado bancário é guardado. A observação pastoral nunca é pública. "Excluir cadastro" apaga de fato (direito do titular).

## Front-end

- `REL` guarda as tabelas lidas com login; `relCarregar()` roda no login e a cada 15 s junto com o `parish_state`. `relGravar()`/`relExcluir()` gravam direto nas tabelas.
- No modo demonstração (sem `config.js`), as mesmas telas usam `S.rel` no `localStorage`, com dados de exemplo que nunca vão para o banco.
- A página pública lê `S.pubRel` (vindo de `get_public_parish`). "Minha comunidade" (`S.minhaCom`) fica só no aparelho, sem conta para o fiel.
- Enquanto um formulário do painel está aberto, a sincronização não redesenha a tela.

### Navegação

- **Página:** Igreja (Home) · Agenda · Comunidades · Avisos · Paróquia. Telas secundárias (rezar, notícias, assistir, comunidade, quero ser dizimista) têm "‹ voltar" e marcam a aba de origem.
- **Painel:** Comunicar · Agenda · Dizimistas · Intenções · Mais (Mensagens, Pessoas, Comunidades, Uso, Ajustes).

### Home "Igreja"

Hoje na Igreja → Liturgia de hoje → Rezar (+ vela) → Próxima missa → Próximos eventos (destaques primeiro, depois o próximo da minha comunidade) → Minha comunidade → Quero ser dizimista → Notícias (3 + "ver todas") → Assistir (3 canais + "ver todos") → Calendário da Igreja. Blocos sem conteúdo não aparecem.

- **Próxima missa**: calculada de `cfg.missas`, com a regra da primeira sexta-feira do mês.
- **Liturgia**: calendário local (tempo, cor, festas) + link para a Liturgia Diária da CNBB. `/api/liturgia` acrescenta as referências quando houver uma fonte autorizada em `LITURGIA_URL`. Nunca copia o texto das leituras.
- **Rezar**: orações tradicionais embutidas no app, guiadas e com contador; nada é salvo e nenhum serviço externo é usado. Mistérios: segunda e sábado Gozosos; terça e sexta Dolorosos; quarta e domingo Gloriosos; quinta Luminosos.
- **Assistir**: botões do YouTube por canal (`/live` e página do canal). Player só com um ID de vídeo específico; o embed antigo `live_stream?channel=` não voltou.

## Acompanhamento do dízimo

Responde "quem já contribuiu neste mês e quem ainda não tem contribuição registrada?" sem cobrança:

- `tither_contributions`: existir linha para (dizimista, mês) = contribuição registrada; não existir = ainda não registrada. Nada de "pendente" gravado todo mês. Sem valores.
- Painel › Dizimistas › Acompanhamento do dízimo: troca de mês, cards (ativos, registradas, ainda não, % do mês), filtros, registrar (data e observação), corrigir/desfazer e histórico de 12 meses. Mês futuro pede confirmação.
- Linguagem pastoral: nunca "inadimplente", "atrasado" ou "devedor"; mês sem registro aparece como "—", sem vermelho.
- RLS pela mesma `can_access(…, 'dizimistas')`: padre e secretaria; PASCOM e visitante sem acesso; fora de `get_public_parish`.
- O front-end detecta tabela por tabela: sem `tither_contributions` no banco, só essa seção pede a atualização; o cadastro de dizimistas segue normal.

## Fora desta versão

Financeiro de dízimo, cobrança, Pix individual, gateway de pagamento, OAuth do Google Agenda, apps nativos, chat, push, upload de galeria, IA complexa, ERP.

Próximos passos naturais: upload de folder no Supabase Storage (`image_url`), conectar o Google Agenda da paróquia (`google_event_id`), restringir a PASCOM nas áreas antigas e uma fonte autorizada para as referências da liturgia.

## Testes feitos nesta versão

- **SQL** (Postgres 17 em PGlite, imitando papéis e grants do Supabase): schema antigo com dados → schema novo 3 vezes; `parish_state` intacto; RLS de visitante, secretaria, padre, PASCOM, usuário sem vínculo e outra paróquia; validações e limites das funções públicas; conversão de interessado. 68 verificações.
- **Worker** (`wrangler dev`): `/api/liturgia` com fonte simulada, resposta inválida e sem fonte; `/api/noticias` sem mudança; código e SQL não publicados.
- **Navegador** (Chrome headless, 390 px): roteiro da apresentação no modo demonstração (40 verificações); modo com banco usando um Supabase simulado com dois aparelhos, antes (23) e depois (34) da migração; orações; dizimistas; tema escuro.
