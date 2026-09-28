-- Central Paroquial — remove SOMENTE os dados criados por supabase/demo_multitenant_seed.sql.
--
-- LIMPEZA SELETIVA: no bloco de limpeza, escreva na linha "alvos" (a que termina com "-- ←") as paróquias a limpar.
-- Vem VAZIA de propósito: rodar sem escolher não apaga nada. Exemplos:
--   só Santa Clara:  array['santa-clara-e-sao-francisco-mineirao']
--   as três:         array['santo-antonio-jaragua', 'santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite']
--
-- Como acha o DEMO: pelos ids determinísticos que o seed gerou para CADA paróquia
-- (md5('cp-demo-v1|' || parish_id || '|<tipo>|' || n)); nos itens de parish_state, pelos ids numéricos da faixa do
-- seed. Por isso apaga o DEMO mesmo que a equipe tenha editado o texto, e nunca toca em registro criado pela
-- equipe ou pelos fiéis (esses têm ids aleatórios).
-- Vai junto, em cascata: contribuições dos dizimistas DEMO e histórico das solicitações DEMO (inclusive o que a
-- equipe tiver registrado nelas durante a demonstração).
-- NÃO remove o DEMO antigo de Santo Antônio (demo_seed.sql / demo_secretaria_seed.sql): para ele use
-- demo_cleanup.sql e demo_secretaria_cleanup.sql. Sem TRUNCATE, sem DROP, sem DELETE sem filtro.
--
-- Recomendado: rode primeiro a consulta "conferir" (a primeira abaixo, com a mesma lista de paróquias).

-- ---------- conferir o que será removido (ajuste a lista igual à do bloco de limpeza) ----------
select p.slug,
  (select count(*) from events e, generate_series(1, 4) n where e.id = md5('cp-demo-v1|' || p.id || '|evento|' || n)::uuid) as eventos,
  (select count(*) from tither_profiles t, generate_series(1, 8) n where t.id = md5('cp-demo-v1|' || p.id || '|dizimista|' || n)::uuid) as dizimistas,
  (select count(*) from tither_contributions c where c.tither_id in (select md5('cp-demo-v1|' || p.id || '|dizimista|' || n)::uuid from generate_series(1, 8) n)) as contribuicoes,
  (select count(*) from tither_leads l, generate_series(1, 2) n where l.id = md5('cp-demo-v1|' || p.id || '|interessado|' || n)::uuid) as interessados,
  (select count(*) from service_requests r, generate_series(1, 4) n where r.id = md5('cp-demo-v1|' || p.id || '|solicitacao|' || n)::uuid) as solicitacoes_s24,
  (select count(*) from service_catalog s, generate_series(1, 3) n where s.id = md5('cp-demo-v1|' || p.id || '|servico|' || n)::uuid) as servicos_demo,
  (select count(*) from jsonb_array_elements(coalesce(ps.data->'avisos', '[]')) x where (x->>'demo')::boolean) as avisos,
  (select count(*) from jsonb_array_elements(coalesce(ps.data->'intencoes', '[]')) x where (x->>'demo')::boolean) as intencoes,
  (select count(*) from jsonb_array_elements(coalesce(ps.data->'velas', '[]')) x where (x->>'demo')::boolean) as velas
from parishes p left join parish_state ps on ps.parish_id = p.id
where p.slug = any(array['santo-antonio-jaragua', 'santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite'])
order by p.slug;

-- ---------- limpeza ----------
do $$
declare
  alvos text[] := array[]::text[]; -- ← escreva aqui as paróquias a limpar (vazio = não apaga nada)
  s text;
  pid uuid;
  base bigint;
  ids_json bigint[];
begin
  if cardinality(alvos) = 0 then
    raise exception 'Nada foi apagado: escreva na linha "alvos" as paróquias a limpar (ex.: array[''santa-clara-e-sao-francisco-mineirao'']).';
  end if;
  if exists (select 1 from unnest(alvos) x where x not in ('santo-antonio-jaragua', 'santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite')) then
    raise exception 'Nada foi apagado: paróquia desconhecida em "alvos": %', alvos;
  end if;
  foreach s in array alvos loop
    select id into pid from parishes where slug = s;
    if pid is null then raise notice 'Paróquia % não existe: pulada.', s; continue; end if;
    base := 1000000000000 + (('x' || substr(md5(pid::text), 1, 6))::bit(24)::bigint) * 1000;
    ids_json := array[base + 1, base + 2, base + 3, base + 11, base + 12, base + 13, base + 21, base + 22, base + 23, base + 24, base + 25, base + 26];

    -- sempre com parish_id = a paróquia escolhida E o id determinístico dela
    delete from service_request_history where parish_id = pid
      and request_id in (select md5('cp-demo-v1|' || pid || '|solicitacao|' || n)::uuid from generate_series(1, 4) n);
    delete from service_requests where parish_id = pid and is_demo
      and id in (select md5('cp-demo-v1|' || pid || '|solicitacao|' || n)::uuid from generate_series(1, 4) n);
    delete from service_catalog where parish_id = pid
      and id in (select md5('cp-demo-v1|' || pid || '|servico|' || n)::uuid from generate_series(1, 3) n)
      and not exists (select 1 from service_requests r where r.service_id = service_catalog.id); -- nunca deixa solicitação sem serviço
    delete from tither_contributions where parish_id = pid
      and tither_id in (select md5('cp-demo-v1|' || pid || '|dizimista|' || n)::uuid from generate_series(1, 8) n);
    delete from tither_leads where parish_id = pid
      and id in (select md5('cp-demo-v1|' || pid || '|interessado|' || n)::uuid from generate_series(1, 2) n);
    delete from tither_profiles where parish_id = pid
      and id in (select md5('cp-demo-v1|' || pid || '|dizimista|' || n)::uuid from generate_series(1, 8) n);
    delete from events where parish_id = pid
      and id in (select md5('cp-demo-v1|' || pid || '|evento|' || n)::uuid from generate_series(1, 4) n);

    -- parish_state: tira só os itens DEMO deste pacote (pelo id); o resto das listas fica como está
    update parish_state ps set data = ps.data
      || jsonb_build_object('avisos',    coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(ps.data->'avisos', '[]')) x    where not ((x->>'id') ~ '^\d+$' and (x->>'id')::bigint = any(ids_json))), '[]'::jsonb))
      || jsonb_build_object('intencoes', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(ps.data->'intencoes', '[]')) x where not ((x->>'id') ~ '^\d+$' and (x->>'id')::bigint = any(ids_json))), '[]'::jsonb))
      || jsonb_build_object('velas',     coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(ps.data->'velas', '[]')) x     where not ((x->>'id') ~ '^\d+$' and (x->>'id')::bigint = any(ids_json))), '[]'::jsonb))
    where ps.parish_id = pid
      and exists (select 1 from jsonb_array_elements(coalesce(ps.data->'avisos', '[]') || coalesce(ps.data->'intencoes', '[]') || coalesce(ps.data->'velas', '[]')) x
                  where (x->>'id') ~ '^\d+$' and (x->>'id')::bigint = any(ids_json));
    raise notice '%: DEMO multi-paróquia removido.', s;
  end loop;
end $$;

-- ---------- conferir depois (as paróquias limpas devem dar 0 em tudo) ----------
select p.slug,
  (select count(*) from events e, generate_series(1, 4) n where e.id = md5('cp-demo-v1|' || p.id || '|evento|' || n)::uuid) as eventos,
  (select count(*) from tither_profiles t, generate_series(1, 8) n where t.id = md5('cp-demo-v1|' || p.id || '|dizimista|' || n)::uuid) as dizimistas,
  (select count(*) from tither_leads l, generate_series(1, 2) n where l.id = md5('cp-demo-v1|' || p.id || '|interessado|' || n)::uuid) as interessados,
  (select count(*) from service_requests r, generate_series(1, 4) n where r.id = md5('cp-demo-v1|' || p.id || '|solicitacao|' || n)::uuid) as solicitacoes_s24,
  (select count(*) from jsonb_array_elements(coalesce(ps.data->'avisos', '[]') || coalesce(ps.data->'intencoes', '[]') || coalesce(ps.data->'velas', '[]')) x where (x->>'demo')::boolean) as itens_json_demo
from parishes p left join parish_state ps on ps.parish_id = p.id
where p.slug = any(array['santo-antonio-jaragua', 'santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite'])
order by p.slug;
