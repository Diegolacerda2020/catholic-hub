# Secretaria 24h

> "A Secretaria 24h recebe sua solicitação a qualquer momento.
> O atendimento pela equipe acontece no horário normal da secretaria."

## Conceito

A secretaria paroquial que nunca fecha as portas. O fiel faz a solicitação pelo celular a qualquer hora
(certidão, batismo, matrimônio, catequese, atendimento com o padre, outro assunto) e recebe um **protocolo**.
A equipe recebe tudo organizado no painel e responde no horário de trabalho.

A Secretaria 24h **não** é atendimento humano 24 horas, e isso está escrito na tela pública em todo o fluxo.
Nada é enviado automaticamente ao fiel: o botão "Falar no WhatsApp" só abre o WhatsApp com o texto pronto.

Intenção de Missa e "Quero ser dizimista" **não** foram duplicados: a Secretaria 24h mostra apenas atalhos
para os fluxos que já existiam.

## Arquitetura

Módulo novo e isolado, que pode ser removido sem afetar o resto do sistema.

| Parte | Arquivo |
|---|---|
| Front-end (página pública + painel) | `secretaria24h.js` |
| Estilos (só classes `.s24-*`) | `secretaria24h.css` |
| Banco (migração só do módulo) | `supabase/secretaria24h.sql` (o mesmo bloco está no final de `supabase/schema.sql`) |
| Dados de demonstração | `supabase/demo_secretaria_seed.sql` · `supabase/demo_secretaria_cleanup.sql` |
| Testes locais | `tests/secretaria24h/` |

Ganchos no `index.html` (todos testam `window.S24` antes de usar):

- `<link>` do CSS e `<script src="secretaria24h.js">` (antes do script principal);
- área `secretaria24h` em `ACESSO.secretaria` (espelho do `can_access`);
- ícone `I.secretaria24h`, item em `MAIS` e rota `secretaria24h` no painel;
- `SUBTELAS_PUB.secretaria = 'igreja'` e rota `secretaria` na página pública (subtela: a aba Igreja
  continua marcada e a barra continua com Igreja · Agenda · Comunidades · Avisos · Paróquia);
- card na Home (`S24.cardHomeHTML()`) e botão na página Paróquia (`S24.botaoParoquiaHTML()`).

O módulo usa o cliente Supabase e a sessão que o app já tem (`NUVEM.sb`, `NUVEM.parishId`, `NUVEM.slug`).
Não tem login próprio, não grava em `parish_state` e não mexe no ciclo de sincronização. Guarda o próprio
estado (catálogo, rascunho do formulário, lista do painel) só em memória. No modo demonstração (sem Supabase
no `config.js`), as solicitações ficam em `localStorage` (`central-paroquial-s24-demo`), só naquele aparelho.

`get_public_parish` **não** foi alterada: o módulo usa RPCs próprias.

## Tabelas

| Tabela | Guarda |
|---|---|
| `service_catalog` | serviços por paróquia: `code`, `title`, `description`, `instructions`, `form_fields`, `active`, `sort_order`. Único por `(parish_id, code)`. |
| `service_requests` | solicitações: `protocol` (único), `requester_name`, `whatsapp` (só dígitos, DDD + número), `contact_preference` (`whatsapp`/`ligacao`/`qualquer`), `answers` (objeto JSON), `status`, `is_demo`. |
| `service_request_history` | cada mudança de status ou nota: `status`, `note`, `public_note` (aparece para o fiel?), `created_by`. |

Status: `new` (Recebida) · `in_progress` (Em atendimento) · `waiting_user` (Aguardando fiel) ·
`completed` (Concluída) · `closed` (Encerrada).

Não há CPF, documento de identidade nem dados sensíveis desnecessários.

**`form_fields`** tem os tipos `text`, `date`, `textarea` e `select` (este com `options`), e opcionalmente
`required` e `hint`. O banco recusa outro formato (`check (s24_fields_ok(form_fields))`), e o front só
desenha esses tipos, sempre com texto escapado (nunca HTML vindo do banco).

**Integridade entre paróquias:** as FKs compostas garantem que a solicitação aponta para um serviço da
**mesma** paróquia (`(service_id, parish_id)`) e que o histórico é da **mesma** paróquia da solicitação
(`(request_id, parish_id)`, `on delete cascade`).

## RPCs

| Função | Quem | O que faz |
|---|---|---|
| `public_service_catalog(p_slug)` | anon, authenticated | serviços **ativos** do slug; devolve só `code, title, description, instructions, form_fields, sort_order` (sem ids) |
| `public_create_service_request(p_slug, p_service_code, p_name, p_whatsapp, p_contact_preference, p_answers)` | anon, authenticated | valida no servidor e cria a solicitação + o 1º histórico (`new`, "Solicitação recebida.", público) na mesma transação; devolve só `protocol, status, created_at` |
| `public_get_service_request(p_slug, p_protocol, p_whatsapp)` | anon, authenticated | `protocol, service_title, status, created_at, updated_at` + histórico com `public_note = true` (`status, note, created_at`); `NULL` se não bater |
| `staff_update_service_request(p_request, p_status, p_note, p_public_note)` | authenticated com `can_access(parish_id,'secretaria24h')` | muda o status e grava o histórico na mesma transação |

Validação do servidor em `public_create_service_request` (não depende do JavaScript):

- paróquia ativa e serviço ativo **da mesma paróquia**;
- nome com 2 a 120 caracteres, sem caracteres de controle;
- WhatsApp: só dígitos (aceita a formatação comum `( ) - . +` e espaço), tira `55` e `0`, e exige DDD +
  número plausível (celular com 11 dígitos começando em 9, fixo com 10 dígitos começando em 2-5);
- `contact_preference` da lista;
- `answers` precisa ser objeto, com até 16 KB e até 40 chaves; só são guardadas as chaves que são campos do
  serviço; cada valor tem que ser texto (até 200; `textarea` até 2000); `date` tem que ser data válida;
  `select` tem que ser uma das opções; campo `required` não pode vir vazio.

Os erros saem como exceção `s24:<motivo>` (`servico_indisponivel`, `nome_invalido`, `whatsapp_invalido`,
`campo_obrigatorio`, `dados_invalidos`, `limite`, `status_invalido`, `nota_longa`, `nada_alterado`), e o
front traduz cada um para uma frase amigável.

Mudança de status com nota **interna** grava duas linhas: a mudança de status, pública e sem texto (para o
fiel ver a linha do tempo), e a nota interna. Uma nota só interna não mexe em `updated_at`.

## Permissões

| Papel | Secretaria 24h |
|---|---|
| Padre | sim |
| Secretaria | sim (área `secretaria24h` adicionada; nenhuma permissão anterior foi retirada) |
| Suporte (`admin`) | sim |
| PASCOM | **não**: não vê o item em Mais, não lê as tabelas, a RPC da equipe é negada |
| Visitante | só as 3 RPCs públicas; nenhum acesso direto às tabelas |

## RLS

As três tabelas têm RLS ligada. `anon` não tem **nenhum** privilégio nelas (`revoke all`); `authenticated`
tem só `select`, com policy `can_access(parish_id, 'secretaria24h')`. Não há insert, update nem delete
direto: toda escrita passa por `public_create_service_request` e `staff_update_service_request`
(`security definer`, `search_path = public`). O catálogo é mantido pelo SQL Editor.

## Fluxo público

1. **Home Igreja:** card "Secretaria paroquial, sempre aberta" → **Acessar secretaria**. Na página
   **Paróquia**, há também o botão **Secretaria 24h**. Os dois só aparecem se o catálogo carregar.
2. **Secretaria 24h:** "Como podemos ajudar?", o aviso de horário, o horário da secretaria (de Ajustes), os
   cards dos serviços, os atalhos (🙏 Enviar intenção de Missa · ❤️ Quero ser dizimista) e
   **Acompanhar protocolo**.
3. **Formulário:** título, descrição, orientações, os campos do serviço e, sempre no final: Nome *,
   WhatsApp *, preferência (WhatsApp / Ligação / Tanto faz) e a autorização obrigatória "Autorizo a paróquia
   a usar estes dados exclusivamente para responder esta solicitação." → **Enviar solicitação**. O que foi
   digitado fica guardado em memória se a tela se redesenhar.
4. **Confirmação:** ✅ Solicitação recebida, o protocolo, "Guarde este protocolo…", e os botões
   **Copiar protocolo** · **Acompanhar solicitação** · **Voltar à página da paróquia**.
5. **Acompanhar:** protocolo + WhatsApp informado → serviço, protocolo, situação atual e linha do tempo com
   as mensagens públicas da secretaria.

## Fluxo interno (painel)

**Mais → Secretaria 24h** ("Solicitações recebidas pela secretaria digital"), só com `pode('secretaria24h')`.
Não há aba nova na barra do painel.

- Cards NOVAS · EM ATENDIMENTO · AGUARDANDO FIEL · CONCLUÍDAS (tocar filtra).
- Filtros Todas · Novas · Em atendimento · Aguardando fiel · Concluídas; busca por nome, telefone ou protocolo.
- Lista (mais recente primeiro): nome, serviço, protocolo, data/hora e status; solicitações de demonstração
  têm a etiqueta "demonstração".
- Detalhe: protocolo, serviço, nome, WhatsApp, preferência, respostas do formulário, data, status,
  **Falar no WhatsApp** (e **Ligar**, se a preferência não for só WhatsApp), **Alterar status** com nota e a
  caixa "Esta mensagem pode aparecer para o fiel no acompanhamento" (sem marcar = nota interna; marcada, pede
  confirmação), e o histórico completo com "nota interna" / "visível para o fiel".
- A lista é relida a cada 30 s enquanto a tela está aberta, e também pelo botão **Atualizar lista**.

## Protocolo + WhatsApp

O protocolo tem o formato `SA-AAAA-XXXXXXXX`: o ano (fuso de São Paulo) e 8 hexadecimais aleatórios
(32 bits, a partir de `gen_random_uuid()`). Não é sequencial. Se houver colisão, a função tenta de novo.

Só o protocolo não basta para consultar: `public_get_service_request` exige também o WhatsApp informado na
solicitação (normalizado pela mesma regra). Se protocolo, WhatsApp e paróquia não baterem, a resposta é
`NULL`, igual para "não existe" e "telefone errado", sem revelar se o protocolo existe. A consulta nunca
devolve ids, nome, respostas, notas internas nem quem alterou.

## Prevenção de duplicidade

Duplo clique ou internet ruim: se chega de novo o mesmo **paróquia + serviço + WhatsApp** em até **5 minutos**
e a solicitação anterior ainda está `new`, nenhuma solicitação é criada e a função devolve o protocolo que já
existe. Um `pg_advisory_xact_lock` por paróquia + serviço + WhatsApp serializa envios simultâneos. No front, o
botão fica desabilitado enquanto envia.

## Proteção contra abuso

- no máximo **5** solicitações por WhatsApp por hora, e **120** por paróquia por hora (`s24:limite`);
- tamanho limitado de tudo (nome, respostas, notas, número de chaves);
- campo escondido anti-robô no formulário;
- toda escrita pública passa por uma função com validação; não há acesso direto às tabelas.

## Multi-paróquia

Nada no módulo depende da paróquia piloto: as RPCs recebem o slug e trabalham com o `parish_id` dele; o
front usa `NUVEM.slug` / `NUVEM.parishId`. O slug `santo-antonio-jaragua` aparece só na carga inicial do
catálogo, nos arquivos de demonstração e nos testes. Cada paróquia pode ter um catálogo diferente (inclusive
com o mesmo `code`), e as FKs compostas e as policies impedem qualquer cruzamento de dados entre paróquias
(isso é coberto por `tests/secretaria24h/sql-multiparoquia-migracao.test.mjs`).

## Dados de demonstração

`supabase/demo_secretaria_seed.sql` cria 5 solicitações totalmente fictícias (`is_demo = true`), com
histórico (notas públicas e internas):

| Serviço | Status |
|---|---|
| Certidão | new |
| Batismo | in_progress |
| Matrimônio | waiting_user |
| Catequese | completed |
| Atendimento com o padre | new |

Pode ser rodado de novo sem duplicar. A última consulta mostra protocolo e WhatsApp, para testar
"Acompanhar solicitação".

## Cleanup

`supabase/demo_secretaria_cleanup.sql` mostra primeiro o que será removido e depois apaga **só** as
solicitações `is_demo = true` da paróquia piloto (o histórico vai junto). Não mexe no catálogo nem em
solicitações reais, e não usa `TRUNCATE`, `DROP` nem `DELETE` sem filtro.

## Como ativar em uma nova paróquia

1. Rode `supabase/secretaria24h.sql` uma vez no projeto (se ainda não rodou). Pode rodar de novo.
2. Crie o catálogo da paróquia pelo SQL Editor, trocando o slug e os serviços:

   ```sql
   insert into service_catalog (parish_id, code, title, description, instructions, form_fields, sort_order)
   select p.id, 'batismo', 'Batismo', 'Primeiras orientações para o Batismo.',
          'A secretaria entra em contato para explicar a preparação.',
          '[{"name":"nome_pessoa","label":"Nome da criança/pessoa","type":"text","required":true}]', 10
   from parishes p where p.slug = 'slug-da-nova-paroquia'
   on conflict (parish_id, code) do nothing;
   ```

3. Vincule padre e secretaria em `parish_users`, como no `supabase/README.md`. Eles já veem o item em Mais.
4. Para tirar um serviço da página: `update service_catalog set active = false where …`.

## Como desabilitar o módulo

- **Só a página pública, sem deploy:** `update service_catalog set active = false where parish_id = …`.
  Sem serviços ativos, o card da Home e o botão da página Paróquia somem.
- **Todo o front:** remova as duas linhas `<link rel="stylesheet" href="secretaria24h.css">` e
  `<script src="secretaria24h.js"></script>` do `index.html` (ou apague o arquivo). Todos os ganchos testam
  `window.S24`: card, botão, item em Mais e rotas somem, e o resto do site segue igual (isso é testado com o
  arquivo em 404 e com o arquivo quebrado).
- O banco pode ficar como está: sem o front, ninguém chama as RPCs.

## Falha isolada

- **Se o `secretaria24h.js` não carregar ou der erro ao carregar:** `window.S24` não existe e o site funciona
  como antes.
- **Se as RPCs falharem** (rede, erro 500, banco sem a migração): o card e o botão não aparecem; quem já está
  dentro da Secretaria 24h (página ou painel) vê "A Secretaria 24h está temporariamente indisponível. Os
  demais serviços da paróquia continuam funcionando." com **Tentar de novo**; o formulário não perde o que foi
  digitado.
- **Se houver uma exceção dentro do módulo:** as funções exportadas são envolvidas por `try/catch` e devolvem
  a mesma mensagem (ou nada, no card e no botão). Nenhum erro sobe para o `render()` do app.
- Home, Agenda, Comunidades, Avisos, Intenções, Dizimistas e Acompanhamento do dízimo continuam funcionando
  em todos esses casos (testado em `tests/secretaria24h/navegador.test.mjs`).

## Testes

Veja `tests/secretaria24h/README.md`. Todos rodam localmente (Postgres em WASM + Chrome headless) e nunca usam
o Supabase real.
