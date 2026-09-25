# Central Paroquial

Sistema simples para uma paróquia se comunicar com paroquianos e dizimistas: painel para a secretaria/padre publicarem avisos, organizarem a agenda, cuidarem dos dizimistas e mandarem mensagens pelo WhatsApp, e uma página pública que é a "porta digital da vida paroquial" para os fiéis.

**A paróquia administra daqui e o fiel vive a paróquia daqui.** A arquitetura desta versão está em [`docs/MVP2.md`](docs/MVP2.md).

## O que tem

**Página pública (sem login)**, abre sempre em **Igreja**:

- **Igreja (Home):** hoje na Igreja (data, tempo litúrgico, cor, festa), Liturgia de hoje, **Rezar** (Santo Terço com os mistérios do dia, Terço da Misericórdia, Angelus, Oração da Manhã, da Noite e a Santo Antônio, guiados e com contador), vela virtual, próxima missa, próximos eventos, minha comunidade, ❤️ Quero ser dizimista, notícias e Assistir.
- **Agenda:** eventos da paróquia e das comunidades, com **Adicionar ao Google Agenda** e **Adicionar à agenda** (.ics); horários de missa e pedido de intenção.
- **Comunidades:** página de cada comunidade e "★ Tornar esta minha comunidade" (guardado só no aparelho, sem conta).
- **Avisos:** avisos de toda a paróquia (sempre) e, primeiro, os da minha comunidade.
- **Paróquia:** contato, secretaria, paróquias vizinhas e Quero ser dizimista.

**Painel (padre, secretaria, PASCOM)**, barra com **Comunicar · Agenda · Dizimistas · Intenções · Mais** (Mensagens, Pessoas, Comunidades, Uso, Ajustes):

- **Comunicar:** escrever o aviso uma vez e sair com WhatsApp, card, legenda e página; escolher "Toda a paróquia" ou "Apenas uma comunidade".
- **Agenda:** criar, editar, cancelar eventos; destacar na Home; criar também um aviso.
- **Dizimistas:** cadastro pastoral (sem valores), aniversariantes, bodas, aniversário de dízimo, novos interessados (falar no WhatsApp, converter, encerrar).
- **Comunidades:** cadastrar, editar, desativar.
- Mensagens, Pessoas, Intenções/velas, Uso e Ajustes continuam como no piloto.

Nenhuma mensagem é enviada sozinha: o botão abre o WhatsApp com o texto pronto e a equipe confere e envia.

Piloto: Paróquia Santo Antônio – Jaraguá (Santo Antônio da Pampulha), Belo Horizonte.
Página do piloto: https://diegolacerda2020.github.io/catholic-hub/
Painel da equipe: https://diegolacerda2020.github.io/catholic-hub/#painel

## Como funciona

É um único arquivo (`index.html`), sem instalação e sem build, mais o `config.js` com o endereço do banco.

- **Com o `config.js` preenchido** (piloto): os dados da paróquia ficam no Supabase (`parish_state` + tabelas de comunidades, agenda e dizimistas). Padre, secretaria e PASCOM entram com e-mail e senha e veem os mesmos dados em aparelhos diferentes. A página pública não pede login.
- **Com o `config.js` vazio** (demonstração): tudo fica só no navegador (`localStorage`), com dados de exemplo (inclusive duas comunidades de demonstração), e o seletor "Usando agora" simula quem está usando.

Configuração do banco, usuários e regras de acesso: veja [`supabase/README.md`](supabase/README.md).

## Rodar localmente

Basta abrir o `index.html` no navegador. Com o `config.js` vazio, abre no modo demonstração.

## Publicar

**Principal: Cloudflare Workers.** O `wrangler.jsonc` publica o site (só `index.html` e `config.js`, via `.assetsignore`) e o Worker (`worker/`) com `/api/noticias` e `/api/liturgia`. Deploy: `npx wrangler deploy` (ou o deploy automático do repositório, se estiver ligado no painel da Cloudflare).

**Reserva: GitHub Pages.** Sem Worker: as notícias vêm do espelho no branch `dados` e a Liturgia de hoje usa só o calendário local (com o link da CNBB).

### GitHub Pages

1. Faça push deste repositório para o GitHub.
2. Em Settings → Pages, escolha a branch `main` e a pasta raiz (`/`).
3. O site fica disponível em `https://<usuario>.github.io/<repositorio>/`.

## Testar em vários aparelhos

1. **Aparelho A**: abra `…/catholic-hub/#painel` e entre como secretaria. Em Comunicar, escreva um aviso, toque em "Organizar aviso" e depois em "Publicar". Espere aparecer "Salvo ✓" no cabeçalho.
2. **Aparelho B**: abra `…/catholic-hub/#painel` e entre como padre. O aviso aparece em "Publicados recentemente". Se o painel já estava aberto, aparece em até 15 segundos.
3. **Aparelho C** (sem login, ou numa janela anônima): abra `…/catholic-hub/`. O aviso aparece na aba Avisos.

Extra: no aparelho C, peça uma intenção em Agenda e acenda uma vela em Igreja › Rezar. As duas aparecem para a secretaria na aba Intenções.

**MVP 2:** no aparelho A, cadastre comunidades em Mais › Comunidades e um evento em Agenda. No aparelho C, eles aparecem em Comunidades, Agenda e (se destacado) na Home. No aparelho C, toque em "Quero ser dizimista" e envie; no aparelho A, o interessado aparece em Dizimistas.

## Google Agenda

Todo evento público tem **Adicionar ao Google Agenda**: um link `calendar.google.com/calendar/render?action=TEMPLATE` com título, início e fim (sem horário final, 1 hora), descrição, local e `ctz=America/Sao_Paulo`. Não precisa de login nem de OAuth. **Adicionar à agenda** baixa um arquivo `.ics` (iPhone, Outlook etc.) com horários em UTC.

Futuro: conectar a conta Google da paróquia (Ajustes › Conectar Google Agenda) e sincronizar pelo campo `events.google_event_id`, que já existe.

## Liturgia de hoje

A Home mostra o tempo litúrgico, a cor e a festa do dia (calendário calculado no próprio app) e o botão **Ver Liturgia de hoje**, que abre a Liturgia Diária oficial da Edições CNBB. O texto das leituras **não** é copiado.

O Worker tem `/api/liturgia?data=AAAA-MM-DD`, que devolve só metadados (celebração, cor e **referências** bíblicas, como "Lc 9,18-22") de uma fonte autorizada configurada na variável `LITURGIA_URL` do Worker (formato no topo de `worker/liturgia.js`). Sem fonte configurada, ou se ela falhar, responde `{disponivel:false}` e a Home segue só com o calendário local. A API interna do site da CNBB recusa acesso de terceiros (HTTP 403) e não é usada.

## Notícias da Arquidiocese de BH (automáticas)

Na Home (aba Igreja) → Notícias da Igreja (e em "Ver todas as notícias"), a página mostra as notícias do portal da Arquidiocese (https://arquidiocesebh.org.br/noticias/), separadas das notícias que a paróquia publica manualmente.

- **Quem busca é o Worker do Cloudflare** (`worker/`), em `/api/noticias`. O navegador nunca acessa o portal direto.
- **Fontes, nesta ordem:**
  1. API REST do WordPress do portal (`/wp-json/wp/v2/noticias`): título, data, região/categoria e imagem;
  2. RSS (`/noticias/feed/`): resumo curto, e reserva se a API falhar;
  3. HTML da página de notícias: só se as duas anteriores falharem.
- **O que é guardado:** título, data, rótulo (RENSC, Arquidiocese, outras regiões), resumo de até ~180 caracteres, imagem e link. A matéria completa nunca é copiada; o card leva à notícia original em nova aba.
- **Ordem dos cards:** RENSC primeiro, depois as gerais da Arquidiocese, depois as demais regiões e categorias.
- **Cache:** ~1 hora. Se o portal cair, o Worker devolve o último resultado válido. O cache fica na memória da instância e no Cache API do Cloudflare. Para um cache persistente entre instâncias, crie um KV e ligue-o como `NOTICIAS_CACHE` no `wrangler.jsonc`.
- **Espelho de hora em hora (GitHub Actions):** o workflow `.github/workflows/noticias.yml` roda `scripts/atualizar-noticias.mjs` (mesma extração do Worker) e grava `noticias.json` no branch `dados`. Esse branch é separado para as atualizações não dispararem novos deploys do site. Só há commit quando as notícias mudam. Se o portal cair, o arquivo anterior é mantido e a execução mostra um aviso.
- **Onde funciona:**
  - No Cloudflare, o Worker tenta o portal e, se falhar, usa o espelho.
  - No GitHub Pages (sem Worker), a página lê o espelho direto de `raw.githubusercontent.com`.
  - Se tudo falhar, a seção mostra só o link para o site da Arquidiocese.
  - Dá para trocar as fontes no `config.js` com `noticiasApi` e `noticiasEspelho`.

**Atenção, certificado do portal:** em 25/09/2026, o servidor de arquidiocesebh.org.br envia o certificado intermediário errado (envia "GlobalSign Organization Validation CA - SHA256 - G2", mas o certificado do site foi emitido por "GlobalSign RSA OV SSL CA 2018"). Navegadores contornam isso sozinhos, mas o runtime de Workers e o Node recusam a conexão.

- **Como contornamos:** o workflow entrega ao Node o intermediário correto, que é público, fica em `scripts/certs/` e vale até 21/11/2028. A verificação TLS continua ligada.
- **Correção definitiva:** a equipe do portal instalar a cadeia correta. Depois disso, o Worker volta a buscar direto, sem mudar nada aqui.
- **Se trocarem o certificado por outro emissor:** o espelho para de atualizar (a execução mostra o aviso) e o site segue com as últimas notícias válidas. Aí é preciso atualizar o arquivo em `scripts/certs/`.

## Organizar aviso (IA)

Hoje o botão "Organizar aviso" usa o **modo básico** (`organizarLocal()`), que roda no próprio navegador e funciona sempre.
O modo inteligente (`organizarInteligente()`) só é ativado em ambientes que oferecem `window.claude`. No GitHub Pages isso não existe, então o modo básico é usado automaticamente.

Para ligar a IA no piloto no futuro, sem colocar chave no site:

1. Criar uma Supabase Edge Function `organizar-aviso` que recebe `{texto, tipo, link}`, confere se quem chamou está logado e é membro da paróquia (JWT do Supabase), monta o mesmo prompt de `organizarInteligente()` e chama a API da Anthropic com a chave guardada nos *secrets* da função (`supabase secrets set ANTHROPIC_API_KEY=...`).
2. No `index.html`, trocar `SAMPLE.json(prompt)` por `NUVEM.sb.functions.invoke('organizar-aviso', {body:{...}})` quando houver login, mantendo `organizarLocal()` como alternativa se falhar.

A chave da IA fica só no servidor do Supabase, nunca no `config.js` nem no GitHub.

## Estrutura

- `index.html`: aplicação completa (painel e página pública).
- `config.js`: endereço e chave pública do Supabase (vazio = demonstração).
- `worker/`: Worker do Cloudflare (serve o site, `/api/noticias` e `/api/liturgia`).
- `scripts/atualizar-noticias.mjs`, `scripts/certs/` e `.github/workflows/noticias.yml`: espelho de hora em hora das notícias (branch `dados`).
- `wrangler.jsonc` e `.assetsignore`: deploy no Cloudflare Workers (publica só `index.html` e `config.js`).
- `supabase/schema.sql`: tabelas, regras de acesso (RLS) e funções da página pública (idempotente).
- `docs/MVP2.md`: arquitetura desta versão.
- `supabase/README.md`: passo a passo do banco e dos usuários.

## Privacidade

Dados de dizimista e de contato são sensíveis (LGPD).

- Pessoas, intenções, pedidos da vela e o log só são lidos por quem está logado e vinculado à paróquia.
- Dizimistas e interessados só são lidos por padre e secretaria (a PASCOM não vê). Não há valores nem dados financeiros.
- Mensagens só para quem autorizou; o formulário "Quero ser dizimista" exige autorização.
- A página pública só recebe os dados da paróquia, os avisos, o número de velas acesas, as comunidades ativas e os eventos públicos. WhatsApp e observações nunca aparecem nela.
- No navegador só existe a chave pública (Publishable/anon). Nenhuma chave secreta ou `service_role` no repositório.
- Ao tocar em "Sair", o aparelho apaga os dados da paróquia que guardava.
- Não use dados reais de paroquianos no modo demonstração.
