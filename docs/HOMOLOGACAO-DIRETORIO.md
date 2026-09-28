# Homologação do Diretório no Supabase real (roteiro manual)

Tudo aqui é para rodar **à mão, no SQL Editor**, na ordem. As consultas de conferência só leem dados.
O teste de isolamento (passo 8) grava dados de teste e **se desfaz sozinho**: termina de propósito com um
erro que mostra o resultado e reverte tudo.

O SQL Editor mostra só o resultado da **última** consulta de cada execução: rode **uma consulta por vez**.
Faça num horário sem uso do painel: se alguém salvar algo no meio, os checksums mudam por um motivo legítimo.

Ordem:
1. pré-check (P1–P6)
2. `supabase/diretorio.sql`
3. pós-check 1 (D1–D6)
4. `supabase/diretorio_santuarios.sql` (colunas de santuário + busca com filtro)
5. `supabase/diretorio_seed.sql` (regerado: 293 registros)
5b. pós-check 2 (S1–S5)
6. `supabase/diretorio_ativacao.sql`
7. pós-check 3 (A1–A6)
8. isolamento real (I1)
9. só depois: push/deploy do front
10. (independente) `supabase/doacoes.sql` — seção 11

**O banco real JÁ tem o diretório antigo (278, sem santuários)?** Siga a **seção 10** (atualização), não os passos 2–7.

O front atual em produção não usa nada do diretório. As migrações podem entrar antes do deploy sem mudar o
que o fiel vê: a página continua sendo a de Santo Antônio.

---

## 1. Pré-check (antes de tudo)

**P1. O que ainda NÃO pode existir** (esperado: `false`, `false`, `0`)
```sql
select to_regclass('public.parish_directory') is not null as ja_existe_parish_directory,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='parishes' and column_name='directory_id') as ja_existe_directory_id,
       (select count(*) from pg_proc where proname in ('dir_norm','dir_tenant_slug','public_directory_search','public_directory_entry')) as funcoes_do_diretorio;
```

**P2. Pré-requisitos das migrações** (esperado: `true`, `true`, e a versão ≥ 12)
```sql
select exists (select 1 from pg_proc where proname = 'touch_updated_at') as tem_touch_updated_at,
       exists (select 1 from pg_proc where proname = 'gen_random_uuid') as tem_gen_random_uuid,
       current_setting('server_version') as versao_postgres;
```

**P3. Paróquias (tenants) e Santo Antônio.** Anote o `id` de Santo Antônio.
```sql
select id, slug, name, active, created_at from parishes order by created_at;
```

**P4. Equipe** (e-mail e papel; serve para comparar depois)
```sql
select p.slug, u.email, pu.role, pu.user_id
from parish_users pu join auth.users u on u.id = pu.user_id join parishes p on p.id = pu.parish_id
order by p.slug, pu.role, u.email;
```

**P5. Contagem + checksum de cada tabela (GUARDE ESTE RESULTADO)**
```sql
select 'parishes' t, count(*) n, md5(coalesce(string_agg(concat_ws('|', x.id, x.slug, x.name, x.active, x.created_at), '#' order by x.id), '')) h from parishes x
union all select 'parish_users', count(*), md5(coalesce(string_agg(concat_ws('|', x.user_id, x.parish_id, x.role, x.created_at), '#' order by x.user_id, x.parish_id), '')) from parish_users x
union all select 'parish_state', count(*), md5(coalesce(string_agg(concat_ws('|', x.parish_id, x.data::text, x.updated_at), '#' order by x.parish_id), '')) from parish_state x
union all select 'communities', count(*), md5(coalesce(string_agg(x::text, '#' order by x.id), '')) from communities x
union all select 'events', count(*), md5(coalesce(string_agg(x::text, '#' order by x.id), '')) from events x
union all select 'tither_profiles', count(*), md5(coalesce(string_agg(x::text, '#' order by x.id), '')) from tither_profiles x
union all select 'tither_contributions', count(*), md5(coalesce(string_agg(x::text, '#' order by x.id), '')) from tither_contributions x
union all select 'tither_leads', count(*), md5(coalesce(string_agg(x::text, '#' order by x.id), '')) from tither_leads x
union all select 'service_catalog', count(*), md5(coalesce(string_agg(x::text, '#' order by x.id), '')) from service_catalog x
union all select 'service_requests', count(*), md5(coalesce(string_agg(x::text, '#' order by x.id), '')) from service_requests x
union all select 'service_request_history', count(*), md5(coalesce(string_agg(x::text, '#' order by x.id), '')) from service_request_history x
union all select 'auth.users', count(*), md5(coalesce(string_agg(concat_ws('|', x.id, x.email), '#' order by x.id), '')) from auth.users x;
```

**P6. Página pública de Santo Antônio** (guarde: nome, slug, quantidades)
```sql
select g->>'name' as nome, g->>'slug' as slug, jsonb_array_length(g->'avisos') as avisos,
       jsonb_array_length(g->'events') as eventos, jsonb_array_length(g->'communities') as comunidades, g->'velasHoje' as velas_hoje
from (select get_public_parish('santo-antonio-jaragua') g) x;
```

**P7. Hash da linha de Santo Antônio** (guarde; a A3 compara)
```sql
select 'parishes (Santo Antônio)' t, md5(concat_ws('|', id, slug, name, active, created_at)) h from parishes where slug='santo-antonio-jaragua'
union all select 'parish_state (Santo Antônio)', md5(concat_ws('|', parish_id, data::text, updated_at)) from parish_state
  where parish_id = (select id from parishes where slug='santo-antonio-jaragua');
```

---

## 2. Rodar `supabase/diretorio.sql`

A última linha mostra `status | count` vazio (a tabela ainda não tem dados).

## 3. Pós-check 1 (depois de `diretorio.sql`)

**D1. Estrutura** (esperado: `true`, `true`, `YES`, `0`, `true`)
```sql
select to_regclass('public.parish_directory') is not null as tem_parish_directory,
       exists (select 1 from information_schema.columns where table_name='parishes' and column_name='directory_id') as tem_directory_id,
       (select is_nullable from information_schema.columns where table_name='parishes' and column_name='directory_id') as directory_id_opcional,
       (select count(*) from parishes where directory_id is not null) as paroquias_ja_ligadas,
       (select pg_get_constraintdef(oid) from pg_constraint where conrelid='parishes'::regclass and contype='f' and conname like '%directory%') like '%ON DELETE SET NULL%' as fk_segura;
```

**D2. RLS e acesso direto** (esperado: RLS `true`, 0 policies, `false` em tudo de anon/authenticated)
```sql
select c.relrowsecurity as rls_ligado,
       (select count(*) from pg_policies where tablename='parish_directory') as policies,
       has_table_privilege('anon','parish_directory','select') as anon_le,
       has_table_privilege('authenticated','parish_directory','select') as equipe_le,
       has_table_privilege('authenticated','parish_directory','update') as equipe_altera,
       has_table_privilege('anon','parishes','insert') as anon_cria_paroquia
from pg_class c where c.relname = 'parish_directory';
```
Zero policies com RLS ligado significa tudo fechado. O acesso é só pelas duas funções públicas.

**D3. Funções** (esperado: as duas `public_*` com `anon_executa = true`; `dir_tenant_slug` com `false`)
```sql
select p.proname, p.prosecdef as security_definer, has_function_privilege('anon', p.oid, 'execute') as anon_executa
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in ('dir_norm','dir_tenant_slug','public_directory_search','public_directory_entry') order by 1;
```

**D4. Dados antigos intactos:** rode de novo a **P5** e compare. Tudo deve ser idêntico.

**D5. Santo Antônio continua funcionando:** rode de novo a **P6**. Deve ser igual.

**D6. Busca ainda vazia** (esperado: `[]`)
```sql
select public_directory_search('', 30);
```

---

## 4. Rodar `supabase/diretorio_seed.sql`

A última linha mostra a contagem por tipo.

## 5. Pós-check 2 (depois do seed)

**S1. Total e tipos** (esperado: 293; territorial 284 — 273 + 11 que também são santuário —, pessoal 2, militar 1, curato 1, área pastoral 1, santuario 4)
```sql
select type, count(*) from parish_directory group by type
union all select 'TOTAL', count(*) from parish_directory order by 1;
```

**S2. Ano, status, códigos** (esperado: `{2026}`, `{listed}`, 0 duplicados, 18 sem código de paróquia — casam pelo slug)
```sql
select array_agg(distinct source_year) as anos, array_agg(distinct status) as status,
       count(catalog_code) - count(distinct catalog_code) as codigos_duplicados,
       count(*) filter (where catalog_code is null) as sem_codigo_no_catalogo,
       count(*) - count(distinct slug) as slugs_duplicados
from parish_directory;
```

**S3. As 3 paróquias piloto no catálogo**
```sql
select catalog_code, display_name, slug, municipality, neighborhood, forania, pastor_name, status
from parish_directory where catalog_code in ('013','207','009') order by catalog_code;
```

**S4. Ainda 1 tenant só** (esperado: 1, `santo-antonio-jaragua`, `directory_id` vazio)
```sql
select count(*) over () as total_tenants, slug, directory_id from parishes;
```

**S5.** Rode de novo a **P5**: tudo idêntico. Opcional: rode o seed uma 2ª vez e repita a **S1**; deve continuar 293.

---

## 6. Rodar `supabase/diretorio_ativacao.sql`

A última linha lista as 3 ativas com o tenant de cada uma. A coluna `equipe` fica 0 nas novas: nenhum usuário é criado.

## 7. Pós-check 3 (depois da ativação)

**A1. 3 tenants** (esperado: 3 linhas; Santo Antônio com o MESMO `id` da P3)
```sql
select p.id, p.slug, p.name, p.directory_id, d.catalog_code, d.status
from parishes p left join parish_directory d on d.id = p.directory_id order by d.catalog_code;
```

**A2. Só 3 ativas no diretório** (esperado: `active 3`, `listed 290`)
```sql
select status, count(*) from parish_directory group by status order by 1;
```

**A3. Santo Antônio preservada.** Rode de novo a **P5**. Esperado:
- idênticas: `parish_users`, `communities`, `events`, `tither_*`, `service_*`, `auth.users`;
- mudam de propósito: `parishes` (n = 3) e `parish_state` (n + 2).

Para conferir que a linha de Santo Antônio em si não mudou, rode de novo a **P7**: os 2 hashes devem ser idênticos.

**A4. Tenants novos vazios** (esperado: tudo 0, e `parish_state` = 1 em cada)
```sql
select p.slug,
  (select count(*) from communities x where x.parish_id=p.id) comunidades, (select count(*) from events x where x.parish_id=p.id) eventos,
  (select count(*) from tither_profiles x where x.parish_id=p.id) dizimistas, (select count(*) from tither_contributions x where x.parish_id=p.id) contribuicoes,
  (select count(*) from tither_leads x where x.parish_id=p.id) interessados, (select count(*) from service_catalog x where x.parish_id=p.id) servicos_s24,
  (select count(*) from service_requests x where x.parish_id=p.id) solicitacoes, (select count(*) from parish_users x where x.parish_id=p.id) equipe,
  (select count(*) from parish_state x where x.parish_id=p.id) parish_state
from parishes p where p.slug <> 'santo-antonio-jaragua' order by 1;
```

**A5. Estado inicial só com dados do catálogo, sem nada de Santo Antônio**
```sql
select p.slug, jsonb_object_keys(ps.data) as chaves, ps.data->'cfg' as cfg,
       ps.data::text ~* 'santo ant[oô]nio|jaragu|praça santo|quermesse|demonstra' as tem_algo_de_santo_antonio
from parishes p join parish_state ps on ps.parish_id = p.id where p.slug <> 'santo-antonio-jaragua';
```
Esperado:
- a única chave é `cfg`;
- `cfg` tem só nome, endereço, telefone, e-mail, pároco, forania, região, `missas` vazio e `secretaria` vazio;
- `tem_algo_de_santo_antonio = false`.

**A6. Páginas públicas e busca**
```sql
select slug, g->>'name' nome, jsonb_array_length(g->'avisos') avisos, jsonb_array_length(g->'events') eventos, g->'cfg'->>'missas' missas
from (select slug, get_public_parish(slug) g from parishes) x order by slug;
```
```sql
select public_directory_search('', 30);   -- esperado: as 3 ativas, com tenant_slug
select public_directory_search('bom pastor', 30);   -- esperado: "Bom Pastor", active false, tenant_slug null
```

---

## 8. Isolamento real (I1)

Um bloco só:
- cria dados marcados `[ISO]` em Santa Clara e N. Sra. das Graças e, se essas paróquias ainda não tiverem
  equipe, usuários temporários;
- olha cada tabela como a secretaria de cada paróquia e como visitante;
- **termina com um erro de propósito**: a mensagem é o resultado, e o erro desfaz tudo (nada fica gravado).

```sql
do $$
declare
  a uuid := (select id from parishes where slug = 'santo-antonio-jaragua');
  b uuid := (select id from parishes where slug = 'santa-clara-e-sao-francisco-mineirao');
  c uuid := (select id from parishes where slug = 'nossa-senhora-das-gracas-ibirite');
  ua uuid := (select user_id from parish_users where parish_id = a and role in ('secretaria','padre') order by role desc limit 1);
  ub uuid := (select user_id from parish_users where parish_id = b limit 1);
  uc uuid := (select user_id from parish_users where parish_id = c limit 1);
  q record; v text; r text := '';
begin
  if a is null or b is null or c is null or ua is null then
    raise exception 'Pré-requisito faltando: rode a ativação antes (a=%, b=%, c=%, equipe de A=%)', a, b, c, ua;
  end if;
  -- equipe de B e C: usa a real, se já existir; senão, usuário temporário (desfeito no fim)
  if ub is null then ub := gen_random_uuid(); insert into auth.users (id, email, aud, role) values (ub, 'isolamento-b@teste.invalid', 'authenticated', 'authenticated'); insert into parish_users values (ub, b, 'secretaria'); end if;
  if uc is null then uc := gen_random_uuid(); insert into auth.users (id, email, aud, role) values (uc, 'isolamento-c@teste.invalid', 'authenticated', 'authenticated'); insert into parish_users values (uc, c, 'secretaria'); end if;
  -- dados de teste em B e C (desfeitos no fim)
  insert into communities (parish_id, name, slug) values (b, '[ISO] Comunidade B', 'iso-teste-b'), (c, '[ISO] Comunidade C', 'iso-teste-c');
  insert into events (parish_id, title, starts_at) values (b, '[ISO] Evento B', now() + interval '1 day'), (c, '[ISO] Evento C', now() + interval '1 day');
  insert into tither_profiles (parish_id, name, whatsapp) values (b, '[ISO] Dizimista B', '31900000001'), (c, '[ISO] Dizimista C', '31900000002');
  insert into tither_contributions (parish_id, tither_id, reference_month)
    select parish_id, id, date_trunc('month', now())::date from tither_profiles where name like '[ISO]%';
  insert into service_catalog (parish_id, code, title) values (b, 'iso_teste_b', '[ISO] Serviço B'), (c, 'iso_teste_c', '[ISO] Serviço C');
  insert into service_requests (parish_id, service_id, protocol, requester_name, whatsapp)
    select sc.parish_id, sc.id, 'SA-2099-' || upper(substr(md5(sc.code), 1, 8)), '[ISO] Fiel', '31900000009' from service_catalog sc where sc.code like 'iso_teste_%';
  insert into service_request_history (request_id, parish_id, status, note)
    select id, parish_id, 'new', '[ISO]' from service_requests where requester_name = '[ISO] Fiel';

  for q in select * from (values ('A (Santo Antônio)', ua, a), ('B (Santa Clara)', ub, b), ('C (N. Sra. das Graças)', uc, c)) x(nome, uid, pid) loop
    perform set_config('request.jwt.claims', json_build_object('sub', q.uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', q.uid::text, true);
    set local role authenticated;
    select format(E'\n%s | vê de OUTRAS paróquias: parishes=%s parish_state=%s communities=%s events=%s tither_profiles=%s tither_contributions=%s tither_leads=%s service_requests=%s service_request_history=%s | vê da PRÓPRIA: events=%s service_requests=%s',
      q.nome,
      (select count(*) from parishes where id <> q.pid), (select count(*) from parish_state where parish_id <> q.pid),
      (select count(*) from communities where parish_id <> q.pid), (select count(*) from events where parish_id <> q.pid),
      (select count(*) from tither_profiles where parish_id <> q.pid), (select count(*) from tither_contributions where parish_id <> q.pid),
      (select count(*) from tither_leads where parish_id <> q.pid), (select count(*) from service_requests where parish_id <> q.pid),
      (select count(*) from service_request_history where parish_id <> q.pid),
      (select count(*) from events where parish_id = q.pid), (select count(*) from service_requests where parish_id = q.pid)) into v;
    reset role;
    r := r || v;
  end loop;

  -- visitante (sem login): nenhuma tabela direto
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin perform count(*) from events; v := 'LEU events (FALHA)'; exception when insufficient_privilege then v := 'sem acesso direto (ok)'; end;
  reset role;
  r := r || E'\nvisitante | ' || v;
  -- página pública de B não mostra nada de A
  r := r || E'\npágina pública de B | eventos: ' || (select string_agg(e->>'title', ', ') from jsonb_array_elements(get_public_parish('santa-clara-e-sao-francisco-mineirao')->'events') e)
         || ' | avisos: ' || jsonb_array_length(get_public_parish('santa-clara-e-sao-francisco-mineirao')->'avisos');

  raise exception E'RESULTADO DO TESTE DE ISOLAMENTO (nada foi gravado: este erro desfaz tudo)%', r;
end $$;
```

**Esperado** na mensagem de erro:
- as linhas A, B e C com **0** em todas as colunas "de OUTRAS paróquias";
- em "da PRÓPRIA": B e C com `events=1 service_requests=1`, A com os números reais dela;
- `visitante | sem acesso direto (ok)`;
- página pública de B só com `[ISO] Evento B` e `avisos: 0`.

**Depois**, confirme que nada ficou (esperado: `0 | 0 | 0`):
```sql
select (select count(*) from events where title like '[ISO]%') eventos_iso,
       (select count(*) from auth.users where email like 'isolamento-%@teste.invalid') usuarios_iso,
       (select count(*) from service_catalog where code like 'iso_teste_%') servicos_iso;
```
Se a criação do usuário temporário for recusada pelo Supabase ("permission denied for table users"), nada é
gravado. Nesse caso, crie antes a equipe real de Santa Clara e de N. Sra. das Graças
(Authentication → Add user + vínculo) e rode o bloco de novo: ele usa a equipe real quando existe.

---

## 10. Atualização: santuários do Catálogo 2026 (banco que já tem o diretório antigo)

**Por que:** no banco real, São Paulo da Cruz não aparece e não há nenhum santuário. Causa: as paróquias que
também são santuário (São Paulo da Cruz e mais 10) têm ficha **só na seção 7.14** (Santuários) do Catálogo;
o importador antigo lia só a 7.13. O importador foi corrigido; o seed foi regerado (293 registros).

**U0. Antes** (anote): `select status, count(*) from parish_directory group by 1;` (esperado hoje: active 3, listed 275)
e a **P5** (checksums).

**U1.** Rodar `supabase/diretorio_santuarios.sql` (colunas novas opcionais, tipo `santuario`, busca com filtro
Paróquias/Santuários e abreviações). Não altera nenhuma linha.

**U2.** Rodar `supabase/diretorio_seed.sql` (regerado). Insere as 15 entradas novas e atualiza as existentes
pelo código; **não muda slug nem status** (as 3 ativas continuam ativas). `diretorio_ativacao.sql` NÃO precisa
rodar de novo.

**U3. Conferência** (esperado: total 293; active 3; listed 290; santuários 15, dos quais 11 também paróquia)
```sql
select count(*) total, count(*) filter (where status='active') active, count(*) filter (where status='listed') listed,
       count(*) filter (where is_sanctuary) santuarios, count(*) filter (where is_sanctuary and type like 'paroquia%') santuario_e_paroquia
from parish_directory;
```

**U4. São Paulo da Cruz** (esperado: 1 linha, `paroquia_territorial`, `is_sanctuary` true, Santuário Arquidiocesano, Barreiro de Baixo)
```sql
select slug, type, is_sanctuary, sanctuary_name, sanctuary_kind, neighborhood, municipality from parish_directory where slug = 'sao-paulo-da-cruz-barreiro-de-baixo';
select jsonb_array_length(public_directory_search('sao paulo da cruz')) as resultados; -- esperado >= 1; o 1º é o santuário
```

**U5.** Rode de novo a **P5**: `parishes`, `parish_state`, `parish_users` e demais tabelas idênticas ao U0.

**Rollback:** ver o cabeçalho de `diretorio_santuarios.sql` (apagar `type = 'santuario'`, voltar a regra de tipo,
recriar a busca de `diretorio.sql`; as 11 paróquias-santuário podem ficar: são paróquias da relação oficial).

---

## 11. Doações (`supabase/doacoes.sql`) — independente do diretório

Cria `parish_donation_settings` (uma linha por paróquia; só dados públicos de recebimento) e 3 funções.
Sem nenhuma linha: **doações desligadas nas 3 paróquias** (o botão não aparece). Ninguém lê/grava a tabela direto;
só padre e suporte, pelas funções. Secretaria e PASCOM não configuram.

**Não inserir** chave Pix nem link de checkout por SQL: quem configura é o padre, no painel (Ajustes › Doações),
com os dados reais da paróquia.

Conferência (esperado 0): `select count(*) from parish_donation_settings;`
Rollback: ver o cabeçalho do arquivo.
