# Rodada pré-piloto: página pública, notícias, diretório e multi-paróquia

Versão candidata ao piloto com o padre. Nada foi executado no Supabase real. As migrações ficam neste
repositório para revisão.

## Página pública

**Home.** Começa com AÇÕES, não com nome + data + título repetidos. O bloco "Hoje na Igreja" saiu, porque o
nome da paróquia já está no cabeçalho.

1. Ações do mesmo nível: 📖 Liturgia de hoje · 🙏 Rezar · ⛪ Pedir intenção de Missa · 🕯️ Acender uma vela
   · 📥 Secretaria 24h (esta só aparece quando a paróquia tem catálogo).
2. Próxima missa (uma linha, só se houver horários).
3. **Hoje na paróquia**: só se houver evento hoje, que ainda não terminou. Mostra horário, local e "Ver detalhes".
   Sem evento, o bloco não aparece (nada de "Nenhum evento hoje").
4. **Destaque litúrgico**: só se houver (ver abaixo).
5. Próximo evento → notícias → assistir.

Saíram da Home e continuam no app:
- o texto grande da liturgia, que virou a ação "Liturgia de hoje", com tela própria;
- a grade de orações, que foi para "Rezar";
- "Minha comunidade", que está em Comunidades;
- "Quero ser dizimista", que está na aba Paróquia e em Secretaria 24h;
- o "Calendário da Igreja", que entrou na Agenda.

**Intenção de Missa.** A ação abre direto o mesmo formulário de antes, com os horários de missa. A Agenda e
o atalho da Secretaria 24h levam para a mesma tela.

**Agenda unificada.** Num lugar só: eventos da paróquia e das comunidades, missas especiais, solenidades,
festas e memórias da Igreja, além de tempos de oração e novenas em andamento. Os itens são agrupados por dia
e têm categoria com ícone + texto. Filtros: Tudo · 📅 Paróquia · ⛪ Calendário da Igreja (+ ★ minha
comunidade). Datas com página devocional têm botão "Rezar".

**"Adicionar à minha agenda".** Um botão só; o aparelho decide o mecanismo:

| Aparelho | O que acontece | Testado |
|---|---|---|
| Android | abre o Google Agenda (o app, se instalado) com o evento preenchido | Chrome com user-agent de Android (automatizado) |
| Windows / Linux / ChromeOS | Google Agenda na web | Chrome desktop (automatizado) |
| iPhone / iPad / Mac | arquivo de calendário que o Safari abre no app Calendário | user-agent de iPhone (automatizado: conteúdo do arquivo) |

**Pendente:** teste num iPhone de verdade. Não havia aparelho; o comportamento previsto é o Safari mostrar
"Adicionar ao Calendário".

**Sala das Velas.** Página própria. O número de velas das últimas 24 h vira luz, com até 50 velas desenhadas;
acima disso aparece "+N pessoas rezando conosco". Nunca mostra nomes nem pedidos. A chama é CSS puro (sem GIF)
e fica parada com "reduzir movimento". Desenhar a sala com 50 velas leva menos de 50 ms.

## Destaques litúrgicos e páginas devocionais

- **Estrutura.** Genérica, na lista `DEVOCIONAIS` do `index.html`. Campos: `id, title, subtitle, type`
  (santo/solenidade/festa/memoria/novena/campanha), `date` (MM-DD), `before` (dias antes em que aparece na Home),
  `novena {start, days}`, `description, prayer, official_url, image, active, keywords`. As `keywords` ligam a
  página aos eventos da paróquia.
- **Itens de hoje.** São Miguel (29/9), São Francisco (4/10), N. Sra. Aparecida (12/10, com novena de 3 a 11/10),
  Finados, Imaculada Conceição e Natal. Não há "santo do dia" para ocupar espaço.
- **Janelas.**
  - 26–29/9: "São Miguel Arcanjo · Vamos rezar? [Rezar com São Miguel]".
  - 28/9–2/10: "Nossa Senhora Aparecida · Estamos nos preparando para a Padroeira do Brasil [Rezar] [Ver programação]".
    "Ver programação" só aparece se a paróquia tiver evento relacionado.
  - 3–11/10: "Novena de Nossa Senhora Aparecida · Dia N de 9 [Rezar hoje]".
  - 12/10: "Hoje é dia de Nossa Senhora Aparecida".
- **Página devocional.** Mostra a data, o tipo, uma apresentação breve (escrita para o app), a oração, eventos
  da paróquia relacionados e o link oficial quando existe. Para a novena, link para o Santuário Nacional
  (a12.com), sem copiar o texto de lá.
- **Orações usadas.** Tradicionais de domínio público: São Miguel (Leão XIII), Oração da Paz, Salve Rainha,
  "Dai-lhes, Senhor, o descanso eterno" e "Ó Maria concebida sem pecado".

## Notícias: diagnóstico e correção

**Por que atrasavam.**
1. O servidor de arquidiocesebh.org.br envia o **certificado intermediário errado**. O `openssl` responde
   "unable to verify the first certificate". O runtime do Cloudflare Worker recusa a conexão, então o Worker
   nunca chegava na fonte oficial e caía sempre no espelho.
2. O espelho (`noticias.json`, branch `dados`) **parou em 25/09**, porque o workflow do GitHub que o atualiza
   não está na `main`. Em 28/09, a conferência mostrou o espelho **72 h atrás** do portal.
3. **Bug de ordenação:** as notícias da RENSC vinham sempre antes, então notícias de 01/09 e 09/09 apareciam
   acima das publicadas no dia.

**O que mudou (sem depender de GitHub Actions).**
- Ordem por data (a RENSC só desempata no mesmo dia).
- Worker: a lista vinda do espelho fica em cache só 10 min (a da fonte oficial, 1 h). A resposta traz
  `fonte`, `atualizadoEm`, `obtidoEm` e `idadeMin`, só para diagnóstico.
- **Navegador do fiel:** se o Worker responder com o espelho ou com lista de mais de 2 h, a página busca a
  **API oficial direto**. O portal libera CORS, e o navegador completa o certificado sozinho.
- O portal guarda em cache o cabeçalho CORS com a origem de quem pediu primeiro. Por isso a URL leva
  `cp=<nosso host>`, e cada site tem a própria entrada.
- Última lista boa guardada no aparelho: se tudo cair, a Home continua mostrando notícias. O fiel não vê
  nada técnico. Os detalhes ficam em `NOTICIAS.meta`, no console.
- `worker/noticias.js` passou a ser publicado (`.assetsignore`), para o navegador usar a mesma extração do Worker.

**Conferência.** Uma requisição por fonte:

```
NODE_EXTRA_CA_CERTS=scripts/certs/globalsign-rsa-ov-ssl-ca-2018.pem node scripts/conferir-noticias.mjs [URL do /api/noticias publicado]
```

Sai com código 1 se alguma fonte estiver mais de 6 h atrás do portal.

**Situação para o piloto (sem mudanças nesta arquitetura agora):**
- O Worker ainda pode falhar ao acessar a fonte por causa do certificado do servidor da Arquidiocese.
- O espelho no GitHub pode ficar velho: hoje, ninguém o atualiza automaticamente.
- O navegador do fiel tem a busca direta na fonte oficial como reserva, e a última lista boa fica no aparelho.
- No piloto, conferir as notícias da Home **no computador e no celular** (Android e iPhone), comparando com
  arquidiocesebh.org.br. Se precisar, use `scripts/conferir-noticias.mjs`.

**Para o Worker voltar a ler a fonte sozinho, uma de duas:**
- a Arquidiocese instala o intermediário certo ("GlobalSign RSA OV SSL CA 2018"). Nenhuma mudança nossa;
- ou o workflow do espelho vai para a `main` (token com permissão `workflow` ou criado pela interface do GitHub).

## Diretório Arquidiocesano

- **`parish_directory`** é o catálogo oficial e pesquisável. **`parishes`** continua só com as paróquias
  ativadas (tenants). As demais paróquias NÃO viram tenant.
- **Importação:** `node scripts/importar-catalogo.mjs [docs/catalogo-01.07.26.pdf]`. Lê a seção 7.13 do
  Catálogo 2026 com `pdftotext` e gera `supabase/diretorio_seed.sql` e `docs/diretorio-importacao.json`. Só
  importa o que está no catálogo; o que falta vira NULL. Confere a numeração de cada bloco (falha se pular
  algum item) e usa a seção 7.15 para achar forania/região quando o item não traz.
- **O PDF** (32 MB, da Arquidiocese) fica fora do git (`.gitignore`).

**278 entradas importadas:**

| Tipo | Qtde | Observação |
|---|---:|---|
| paroquia_territorial | 273 | |
| paroquia_pessoal | 2 | Maronitas e Siríacos |
| paroquia_militar | 1 | N. Sra. de Loreto, sem código no catálogo |
| curato | 1 | Divino Espírito Santo: **não** é paróquia |
| area_pastoral | 1 | Rainha dos Mártires, sem código: **não** é paróquia |

Ficaram fora: santuários, capelas e capelanias (seção 7.14). Os santuários que são paróquia já estão na lista.

**Campos NULL porque não constam no catálogo:**

| Campo | Entradas sem o dado |
|---|---:|
| código | 3 |
| forania | 4 (inclui as 2 pessoais e a militar, que não têm) |
| endereço | 1 |
| CEP | 2 |
| município | 2 |
| bairro | 4 |
| telefone | 8 |
| e-mail | 24 |
| pároco/administrador | 4 |
| data de criação | 1 |

- **Status:** `listed` (275) · `onboarding` · `active` (3) · `suspended`.
- **3 ativas** (códigos do catálogo):

  | Código | Paróquia | Tenant (`?p=`) | Situação |
  |---|---|---|---|
  | 013 | Santo Antônio – Jaraguá (BH) | `santo-antonio-jaragua` | já existia |
  | 207 | Santa Clara e São Francisco – Mineirão (BH) | `santa-clara-e-sao-francisco-mineirao` | nova |
  | 009 | Nossa Senhora das Graças – Centro (Ibirité) | `nossa-senhora-das-gracas-ibirite` | nova |

  As duas novas começam **vazias**. O `parish_state` inicial tem só dados do catálogo (nome, endereço,
  telefone, e-mail, pároco, forania, região). Não têm horários de missa, comunidades, avisos, eventos,
  dizimistas, contribuições, intenções nem catálogo da Secretaria 24h; onde falta, aparece "Informações serão
  publicadas em breve.". Não há usuário de equipe: criar e vincular é passo manual (ver `docs/UX-PAINEL.md`,
  seção PASCOM; mesmo roteiro, com o papel certo).

**Encontre sua paróquia.**
- Busca por nome, bairro, município ou forania, sem acento e sem diferença de maiúsculas.
- Ativa: "✓ Central Paroquial ativa" + [Acessar], que abre `?p=slug` (mesmo código, outro contexto).
- Listed: "Central Paroquial ainda não ativada" + [Solicitar ativação]. Abre a ficha do catálogo e a mensagem
  "A ativação da Central Paroquial deve ser solicitada pelo pároco, administrador paroquial ou responsável
  autorizado." [Entrar em contato], com o contato de `config.js → contato`.
- **Ninguém ativa pela internet:** não existe função pública que mude status ou crie tenant.
- **Trocar paróquia** (tocar no nome no cabeçalho): Minha paróquia · Recentes · Buscar · Com a Central
  Paroquial. Ficam guardados só no aparelho.
- **Sem o banco novo** (produção hoje), a busca usa a lista antiga da RENSC e avisa isso.

## Multi-paróquia no front

- A paróquia vem do endereço (`?p=slug`); senão, da "minha paróquia" do aparelho; senão, do `config.js`.
- Cada paróquia tem o **próprio estado no aparelho** (`central-paroquial-v02@slug`; a piloto mantém a chave
  antiga). Trocar de paróquia recarrega a página.
- Paróquia nova não recebe nada da piloto: nem textos iniciais, nem horários, nem exemplos, nem "Santo
  Antônio, intercedei" na oração da vela (usa o padroeiro cadastrado).
- Equipe de outra paróquia que entra pela página errada é levada para `?p=<paróquia dela>#painel`.

## Migrações (NÃO executadas)

Ordem no SQL Editor, depois do que já está em produção:

1. `supabase/diretorio.sql`: estrutura. Única mudança em tabela existente: coluna opcional
   `parishes.directory_id`.
2. `supabase/diretorio_seed.sql`: carga do catálogo (gerada). Pode rodar de novo: atualiza dados do
   catálogo e nunca mexe em status/tenant.
3. `supabase/diretorio_ativacao.sql`: 3 ativas + 2 tenants novos + `parish_state` inicial. Revisão manual.

Teste local equivalente à produção: `tests/secretaria24h/sql-diretorio.test.mjs` (78 verificações). Roda
cada arquivo 2x; confere que nada existente mudou; 278 por tipo; 3 ativas; busca; nenhuma ativação pela
internet; tenants vazios; isolamento de equipe e da página pública em 11 tabelas e nas funções.
