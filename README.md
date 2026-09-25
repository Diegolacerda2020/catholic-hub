# Central Paroquial

Sistema simples para uma paróquia se comunicar com paroquianos e dizimistas: painel para a secretaria/padre publicarem avisos e mandarem mensagens pelo WhatsApp, e uma página pública para os fiéis.

Piloto: Paróquia Santo Antônio – Jaraguá (Santo Antônio da Pampulha), Belo Horizonte.

## Como funciona

É um único arquivo (`index.html`), sem instalação e sem build. Hoje os dados ficam salvos no navegador (`localStorage`). O plano é ligar a um banco compartilhado (Supabase) para que a secretaria e o padre, em aparelhos diferentes, vejam os mesmos dados.

## Rodar localmente

Basta abrir o `index.html` no navegador. Não precisa de servidor.

## Publicar (GitHub Pages)

1. Faça push deste repositório para o GitHub.
2. Em Settings → Pages, escolha a branch `main` e a pasta raiz (`/`).
3. O site fica disponível em `https://<usuario>.github.io/<repositorio>/`.

## Estrutura

- `index.html` — aplicação completa (painel + página pública).
- `supabase/` — scripts SQL e políticas de acesso (quando o backend for ligado).

## Privacidade

Dados de dizimista e de contato são sensíveis (LGPD). Não use dados reais de paroquianos em ambiente de desenvolvimento — apenas os dados de exemplo já incluídos.
