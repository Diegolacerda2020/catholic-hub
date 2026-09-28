# Testes da Secretaria 24h

Tudo roda localmente e **nunca** usa o Supabase real: o banco é um Postgres em WASM (PGlite) imitando o
Supabase (roles `anon`/`authenticated`, `auth.uid()`, privilégios padrão), e a interface roda no Chrome
headless (ou no jsdom).

```sh
cd tests/secretaria24h
npm install
npm test            # todas as suítes
```

Precisa do Git (os testes leem `supabase/schema.sql` de `bbb34e1` e de `4fc9da4`, que simulam o banco de
produção) e do Chrome instalado (`CHROME=/caminho/do/chrome` para usar outro).

| Arquivo | O que cobre |
|---|---|
| `sql-base.test.mjs` | migração 1x/2x, RLS, anon sem acesso direto, validações do servidor, duplicidade, limite, protocolo + WhatsApp, notas internas/públicas, papéis (padre, secretaria, suporte, PASCOM, outra paróquia), demo seed/cleanup |
| `sql-multiparoquia-migracao.test.mjs` | banco equivalente à produção + `secretaria24h.sql` 2x sem mudar nenhum dado existente (8 tabelas, policies, grants, funções, `get_public_parish`); multi-paróquia A/B; slug do piloto fora do código principal |
| `jsdom.test.mjs` | fluxo completo no modo demonstração; `sem-modulo`: o site sem o `secretaria24h.js` |
| `navegador.test.mjs` | Chrome real com login: fiel, padre, secretaria, PASCOM, multi-paróquia no front, falhas (RPC com erro, banco sem migração, arquivo 404/quebrado, exceção interna), 390 px / 1280 px / modo escuro, screenshots em `shots/` |
| `ux.test.mjs` | painel responsivo em 390×844, 768×1024, 1024×768, 1366×768 e 1920×1080: barra (celular) × menu lateral (tablet/PC), Início por papel (secretaria, padre, PASCOM), badge, aviso de nova solicitação, 🔔, fila master-detail, “Minhas solicitações”, erro com “Tentar novamente”, termos técnicos, rolagem lateral, acessibilidade básica, tempo de desenho; screenshots em `shots/ux/` |

`banco.mjs` monta o Postgres com o SQL real; `supabase-falso.mjs` é o Supabase falso das suítes anteriores
(cuida do resto do app), e `banco.mjs#ponte` manda para o Postgres só as chamadas da Secretaria 24h.

O `jsdom.test.mjs` ignora o erro `Cannot set properties of undefined (setting 'onchange')`. Ele vem do
formulário de intenção que já existia (`f.data.onchange`, acesso nomeado a campo de formulário, que o jsdom
não implementa), aparece igual em `bbb34e1` e não acontece no Chrome (o `navegador.test.mjs` verifica isso).
