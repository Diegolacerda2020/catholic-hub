-- Central Paroquial — remove SOMENTE os dados de demonstração criados por demo_seed.sql.
--
-- Apaga apenas, e só na paróquia santo-antonio-jaragua:
--   dizimistas cujo notes começa com  [DEMO]
--   contribuições (acompanhamento do dízimo) desses dizimistas [DEMO]
--   eventos cuja description TERMINA com  [Evento de demonstração]  (como o seed grava;
--   um evento real que só cite a expressão no meio do texto não é apagado)
-- Não usa TRUNCATE, DROP nem DELETE sem filtro. Nada mais é tocado.
--
-- Recomendado: rode primeiro só a parte "conferir", veja a lista, e depois o script inteiro.

-- ---------- conferir o que será removido ----------
select 'dizimista' as tipo, id, name as nome, status, notes as marca
from tither_profiles
where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
  and notes like '[DEMO]%'
union all
select 'evento', id, title, case when cancelled then 'cancelado' else 'ativo' end,
       right(description, 30)
from events
where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
  and description like '%[Evento de demonstração]'
order by 1, 3;

-- Contribuições que serão removidas (só de dizimistas [DEMO]; as de dizimistas reais não são tocadas)
select count(*) as contribuicoes_demo
from tither_contributions
where tither_id in (
  select id from tither_profiles
  where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
    and notes like '[DEMO]%'
);

-- Interessados (tither_leads) convertidos em algum dizimista DEMO não são apagados:
-- o banco só limpa o vínculo (tither_id fica NULL).
select count(*) as interessados_ligados_a_dizimistas_demo
from tither_leads
where tither_id in (
  select id from tither_profiles
  where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
    and notes like '[DEMO]%'
);

-- ---------- limpeza ----------
begin;

-- (o banco também apagaria em cascata ao remover o dizimista; aqui fica explícito)
delete from tither_contributions
where tither_id in (
  select id from tither_profiles
  where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
    and notes like '[DEMO]%'
);

delete from tither_profiles
where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
  and notes like '[DEMO]%';

delete from events
where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
  and description like '%[Evento de demonstração]';

commit;

-- ---------- conferir depois da limpeza (todos devem dar 0) ----------
select
  (select count(*) from tither_profiles where notes like '[DEMO]%') as dizimistas_demo_restantes,
  (select count(*) from tither_contributions where notes like '[DEMO]%') as contribuicoes_demo_restantes,
  (select count(*) from events where description like '%[Evento de demonstração]') as eventos_demo_restantes;
