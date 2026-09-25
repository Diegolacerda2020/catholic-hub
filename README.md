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
- `supabase/schema.sql`: tabelas, regras de acesso (RLS) e funções da página pública.
- `supabase/README.md`: passo a passo do banco e dos usuários.

## Privacidade

Dados de dizimista e de contato são sensíveis (LGPD).

- Pessoas, intenções, pedidos da vela e o log só são lidos por quem está logado e vinculado à paróquia.
- A página pública só recebe os dados da paróquia, os avisos e o número de velas acesas.
- Ao tocar em "Sair", o aparelho apaga os dados da paróquia que guardava.
- Não use dados reais de paroquianos no modo demonstração.
