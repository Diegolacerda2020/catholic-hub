# Pacote DEMO multi-paróquia

Arquivos: `supabase/demo_multitenant_seed.sql` e `supabase/demo_multitenant_cleanup.sql`.
Teste: `tests/secretaria24h/demo-multitenant.test.mjs`. **Nada foi executado no Supabase real.**

## Regra

Cada dado DEMO pertence a UMA paróquia: tem o `parish_id` dela e um id próprio, derivado dela. Nenhum
registro é compartilhado. Por isso cada paróquia pode editar, excluir, criar, concluir, mudar status, datas e
textos do seu DEMO sem afetar as outras (o isolamento por paróquia é o mesmo RLS dos dados reais).

## Como o DEMO é identificado (sem mudar o schema)

| Estrutura | Marca usada | Por quê |
|---|---|---|
| `events` | id determinístico + `description` terminando com `[Evento de demonstração]` | não tem `is_demo`; o texto é só visual, o id é o que vale |
| `tither_profiles` | id determinístico + `notes` começando com `[DEMO]` | idem |
| `tither_contributions` | id determinístico (e pertence a um dizimista DEMO) | apagada junto com o dizimista |
| `tither_leads` | id determinístico | não tem campo livre adequado |
| `service_catalog` | id determinístico + `code` começando com `demo_` + `active = false` | a página pública não oferece serviço DEMO |
| `service_requests` | **`is_demo = true`** + id determinístico | já tinha `is_demo` |
| `service_request_history` | id determinístico (e pertence a uma solicitação DEMO) | apagado junto com a solicitação |
| `parish_state` → `avisos`, `intencoes`, `velas` (JSON) | id numérico determinístico por paróquia (faixa 1.000.000.000.000–1.017.000.000.000; os ids do app ficam acima de 1.700.000.000.000.000) + `"demo": true` | não existe tabela própria; o seed só acrescenta itens |

- **Id determinístico:** `md5('cp-demo-v1|' || parish_id || '|<tipo>|' || n)::uuid`.
- **Consequências:**
  - rodar o seed de novo não duplica, mesmo depois de a equipe editar textos;
  - o cleanup apaga exatamente o que o seed criou, mesmo editado;
  - o que a equipe ou os fiéis criarem tem id aleatório e nunca é apagado.
- Um item DEMO que a equipe excluir volta se o seed rodar de novo. É o jeito de "restaurar o cenário".

## O que cada paróquia recebe

| | Santa Clara | N. Sra. das Graças | Santo Antônio |
|---|---|---|---|
| Eventos (hoje à noite, +5, +12, +26 dias; "Local a confirmar") | 4 | 4 | — (já tem 4 do `demo_seed.sql`) |
| Dizimistas (7 ativos, 1 inativo; aniversário hoje, bodas no mês, nova, sem autorização) | 8 | 8 | — (já tem 12) |
| Contribuições do mês e histórico (sem valores) | ~17* | ~17* | — (já tem as do `demo_seed.sql`) |
| Interessados "Quero ser dizimista" | 2 | 2 | 2 |
| Serviços da Secretaria 24h (inativos) | 3 | 3 | — (usa o catálogo real) |
| Solicitações da Secretaria 24h (recebida, em atendimento, aguardando fiel, concluída) + histórico | 4 + 8 | 4 + 8 | — (já tem 5 do `demo_secretaria_seed.sql`) |
| Avisos | 3 | 3 | 3 |
| Intenções de missa ("Horário a confirmar": sem inventar horário) | 3 | 3 | 3 |
| Velas (últimas 12 h) | 6 | 6 | 6 |

\* O número exato de contribuições depende do dia em que o seed roda (nenhuma antes da data de entrada do dizimista).

Nomes e WhatsApps são claramente fictícios: "Ana Exemplo Lima", 3199501xxxx / 3199502xxxx / 3199503xxxx.
Não há horário real de missa, comunidade real, programação oficial nem valor em dinheiro.

## Diferenças em relação aos seeds antigos

- **Seeds antigos:**
  - `demo_seed.sql` e `demo_secretaria_seed.sql` valem só para Santo Antônio.
  - Reconhecem o DEMO por texto editável e pelo nome. Se a equipe editar, rodar de novo pode duplicar, e o
    cleanup antigo não acha o registro editado.
- **Pacote novo:**
  - vale para as 3 paróquias;
  - usa ids determinísticos por paróquia;
  - cobre também avisos, intenções, velas e interessados.
- **Santo Antônio não é duplicada:** onde já existe o DEMO antigo (eventos, dizimistas/contribuições,
  Secretaria 24h), a categoria é pulada. O DEMO antigo continua sendo limpo pelos cleanups antigos.

## Cleanup

1. Rode a consulta "conferir" do arquivo.
2. No bloco de limpeza, escreva na linha `alvos` (termina com `-- ←`) só as paróquias a limpar. Ex.:
   `array['santa-clara-e-sao-francisco-mineirao']`.
   - A lista vem **vazia**: rodar sem escolher não apaga nada (o script para com um aviso).
   - Paróquia desconhecida também para sem apagar nada.
3. Cada DELETE usa `parish_id` da paróquia escolhida **e** o id determinístico dela. Nas listas de
   `parish_state`, sai só o item com o id DEMO daquela paróquia.

## Testes (`demo-multitenant.test.mjs`, 41 verificações, banco equivalente à produção pós-homologação)

- Seed: cenário completo em Santa Clara e Graças; Santo Antônio recebe só o que faltava, sem duplicar o DEMO antigo.
- Todo registro que já existia continua idêntico. Em `parish_state`, só entram itens no fim das listas.
  Dados reais de Santo Antônio intactos.
- Nenhum `auth.users` e nenhum `parish_users` criado.
- Seed 2x: banco idêntico (nem `parish_state` é reescrito).
- Ids e protocolos únicos entre as 3 paróquias; os serviços DEMO não aparecem na página pública.
- Isolamento: cada equipe vê só a própria paróquia em 8 tabelas; o visitante não lê nenhuma.
- Alteração independente:
  - Santa Clara muda título e data do seu evento DEMO, e o de Graças não muda;
  - Santa Clara não consegue alterar o de Graças;
  - Graças muda status e histórico da sua solicitação, e nenhuma outra muda;
  - Graças não altera a de Santa Clara.
- Seed de novo depois das edições: não duplica e não desfaz a edição.
- Cleanup só de Santa Clara:
  - Santo Antônio e Graças ficam absolutamente iguais;
  - o que a equipe de Santa Clara criou continua;
  - o DEMO antigo de Santo Antônio não é tocado.
- Cleanup sem paróquia escolhida ou com paróquia desconhecida: não apaga nada.
- Cleanup das 3 e seed de novo: o cenário volta, e os dados reais de Santo Antônio continuam.
