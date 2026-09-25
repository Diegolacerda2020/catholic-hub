# Central Paroquial

Sistema simples para uma paróquia se comunicar com paroquianos e dizimistas: painel para a secretaria/padre publicarem avisos e mandarem mensagens pelo WhatsApp, e uma página pública para os fiéis.

Piloto: Paróquia Santo Antônio – Jaraguá (Santo Antônio da Pampulha), Belo Horizonte.
Página do piloto: https://diegolacerda2020.github.io/catholic-hub/
Painel da equipe: https://diegolacerda2020.github.io/catholic-hub/#painel

## Como funciona

É um único arquivo (`index.html`), sem instalação e sem build, mais o `config.js` com o endereço do banco.

- **Com o `config.js` preenchido** (piloto): os dados da paróquia ficam no Supabase. Padre, secretaria e PASCOM entram com e-mail e senha e veem os mesmos dados em aparelhos diferentes. A página pública não pede login.
- **Com o `config.js` vazio** (demonstração): tudo fica só no navegador (`localStorage`), com dados de exemplo, e o seletor "Usando agora" simula quem está usando.

Configuração do banco, usuários e regras de acesso: veja [`supabase/README.md`](supabase/README.md).

## Rodar localmente

Basta abrir o `index.html` no navegador. Com o `config.js` vazio, abre no modo demonstração.

## Publicar (GitHub Pages)

1. Faça push deste repositório para o GitHub.
2. Em Settings → Pages, escolha a branch `main` e a pasta raiz (`/`).
3. O site fica disponível em `https://<usuario>.github.io/<repositorio>/`.

## Testar em vários aparelhos

1. **Aparelho A**: abra `…/catholic-hub/#painel` e entre como secretaria. Em Comunicar, escreva um aviso, toque em "Organizar aviso" e depois em "Publicar". Espere aparecer "Salvo ✓" no cabeçalho.
2. **Aparelho B**: abra `…/catholic-hub/#painel` e entre como padre. O aviso aparece em "Publicados recentemente". Se o painel já estava aberto, aparece em até 15 segundos.
3. **Aparelho C** (sem login, ou numa janela anônima): abra `…/catholic-hub/`. O aviso aparece na aba Avisos.

Extra: no aparelho C, peça uma intenção em Missas e acenda uma vela em Igreja. As duas aparecem para a secretaria na aba Intenções.

## Notícias da Arquidiocese de BH (automáticas)

Na aba Igreja → Notícias da Igreja, a página mostra as notícias do portal da Arquidiocese (https://arquidiocesebh.org.br/noticias/), separadas das notícias que a paróquia publica manualmente.

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
- `worker/`: Worker do Cloudflare (serve o site e o proxy `/api/noticias`).
- `scripts/atualizar-noticias.mjs`, `scripts/certs/` e `.github/workflows/noticias.yml`: espelho de hora em hora das notícias (branch `dados`).
- `wrangler.jsonc` e `.assetsignore`: deploy no Cloudflare Workers (publica só `index.html` e `config.js`).
- `supabase/schema.sql`: tabelas, regras de acesso (RLS) e funções da página pública.
- `supabase/README.md`: passo a passo do banco e dos usuários.

## Privacidade

Dados de dizimista e de contato são sensíveis (LGPD).

- Pessoas, intenções, pedidos da vela e o log só são lidos por quem está logado e vinculado à paróquia.
- A página pública só recebe os dados da paróquia, os avisos e o número de velas acesas.
- Ao tocar em "Sair", o aparelho apaga os dados da paróquia que guardava.
- Não use dados reais de paroquianos no modo demonstração.
