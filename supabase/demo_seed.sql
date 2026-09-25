-- Central Paroquial — dados de DEMONSTRAÇÃO do MVP 2 (totalmente fictícios).
-- Rode no SQL Editor do Supabase DEPOIS do schema.sql. Pode ser rodado de novo: não duplica.
--
-- Como identificar e apagar depois (supabase/demo_cleanup.sql):
--   dizimistas:    notes começa com  [DEMO]
--   contribuições: pertencem a dizimistas [DEMO] (e têm notes começando com [DEMO])
--   eventos:       description termina com  [Evento de demonstração]
--
-- Não cria paróquia, não cria comunidades, não altera nenhum registro existente
-- (só INSERT … WHERE NOT EXISTS). Nomes e WhatsApps são inventados
-- (sequência de teste 31990001001–31990001012). Sem CPF, endereço, e-mail ou valores.
-- As datas são calculadas no dia em que o script roda (fuso America/Sao_Paulo).

-- ---------- Dizimistas fictícios (12) ----------
-- 10 ativos (8 antigos + 2 novos nos últimos 30 dias) e 2 inativos.
-- Situação da contribuição só como texto de demonstração em notes (sem valores):
--   6 registrada · 3 ainda não registrada · 1 novo · 2 inativos.
-- Se a paróquia já tiver comunidades ativas, parte dos dizimistas é ligada a elas;
-- se não tiver, community_id fica NULL.
with p as (
  select id from parishes where slug = 'santo-antonio-jaragua'
),
ref as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         extract(month from (now() at time zone 'America/Sao_Paulo'))::int as m,
         least(extract(day from (now() at time zone 'America/Sao_Paulo'))::int, 28) as d
),
mes as (
  select (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[ref.m] as nome
  from ref
),
coms as (
  select array_agg(c.id order by c.name) as ids
  from communities c join p on c.parish_id = p.id
  where c.active
),
demo (n, name, whatsapp, birth_date, marriage_date, joined_on, status, consent, situacao) as (
  select v.* from ref, lateral (values
    -- aniversário HOJE, casada, dizimista há 15 anos
    ( 1, 'Maria Helena Ferreira',    '31990001001', make_date(1962, ref.m, ref.d),                 make_date(1986, 5, 17),                  ref.hoje - interval '15 years', 'active',   true,  'registrada'),
    -- bodas neste mês, dizimista há 12 anos
    ( 2, 'José Carlos de Almeida',   '31990001002', make_date(1958, 3, 14),                        make_date(1984, ref.m, least(ref.d + 3, 28)), ref.hoje - interval '12 years', 'active', true, 'registrada'),
    -- aniversário neste mês
    ( 3, 'Ana Paula Ribeiro',        '31990001003', make_date(1987, ref.m, least(ref.d + 5, 28)),  null::date,                              make_date(2019, 3, 10),         'active',   true,  'registrada'),
    -- completa 5 anos como dizimista HOJE
    ( 4, 'Carlos Eduardo Martins',   '31990001004', make_date(1975, 11, 2),                        null::date,                              ref.hoje - interval '5 years',  'active',   true,  'registrada'),
    -- dizimista há mais de 10 anos
    ( 5, 'Rosa Maria dos Santos',    '31990001005', make_date(1949, 7, 21),                        null::date,                              ref.hoje - interval '11 years', 'active',   true,  'registrada'),
    ( 6, 'João Batista Oliveira',    '31990001006', make_date(1970, 6, 24),                        null::date,                              make_date(2020, 8, 15),         'active',   true,  'pendente'),
    -- ativa, mas sem autorização para mensagens
    ( 7, 'Luciana Aparecida Gomes',  '31990001007', make_date(1983, 1, 30),                        null::date,                              make_date(2022, 4, 3),          'active',   false, 'pendente'),
    ( 8, 'Paulo Roberto Fernandes',  '31990001008', make_date(1966, 12, 8),                        make_date(1992, 10, 3),                  make_date(2018, 6, 1),          'active',   true,  'pendente'),
    -- novos (últimos 30 dias)
    ( 9, 'Cláudia Regina Souza',     '31990001009', make_date(1990, 4, 18),                        null::date,                              ref.hoje - 10,                  'active',   true,  'novo'),
    (10, 'Antônio Marcos Lima',      '31990001010', make_date(1979, 2, 5),                         null::date,                              ref.hoje - 25,                  'active',   true,  'registrada'),
    -- inativos
    (11, 'Tereza Cristina Alves',    '31990001011', make_date(1955, 8, 15),                        null::date,                              make_date(2010, 5, 2),          'inactive', false, 'inativo'),
    (12, 'Marcos Vinícius Rocha',    '31990001012', make_date(1988, 5, 9),                         null::date,                              make_date(2015, 9, 20),         'inactive', true,  'inativo')
  ) as v(n, name, whatsapp, birth_date, marriage_date, joined_on, status, consent, situacao)
)
insert into tither_profiles (parish_id, community_id, name, whatsapp, birth_date, marriage_date, joined_on, status, consent, notes)
select p.id,
       case when coms.ids is not null and demo.n % 3 <> 0
            then coms.ids[1 + (demo.n % array_length(coms.ids, 1))] end,
       demo.name, demo.whatsapp, demo.birth_date, demo.marriage_date, demo.joined_on::date, demo.status, demo.consent,
       case demo.situacao
         when 'registrada' then '[DEMO] Contribuição de ' || mes.nome || ' registrada. Dizimista ativo e participativo.'
         when 'pendente'   then '[DEMO] Contribuição de ' || mes.nome || ' ainda não registrada. Fazer contato somente de forma pastoral.'
         when 'novo'       then '[DEMO] Novo dizimista. Primeiro contato realizado pela secretaria.'
         else                   '[DEMO] Dizimista inativo. Cadastro mantido apenas para demonstração.'
       end
from demo cross join p cross join mes cross join coms
where not exists (
  select 1 from tither_profiles t
  where t.parish_id = p.id and t.notes like '[DEMO]%' and t.name = demo.name
);

-- ---------- Acompanhamento do dízimo: contribuições de demonstração ----------
-- Mês atual: 7 registradas (os 6 "registrada" + o novo dizimista), 3 ativos ainda sem
-- registro, 2 inativos. Também há histórico dos últimos 4 meses para parte deles.
-- Nenhum valor em dinheiro. Precisa da tabela tither_contributions (schema.sql atualizado).
-- meses: 0 = mês atual, 1 = mês passado … 4 = quatro meses atrás.
with p as (
  select id from parishes where slug = 'santo-antonio-jaragua'
),
ref as (
  select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as mes,
         (now() at time zone 'America/Sao_Paulo')::date as hoje
),
plano (name, meses) as (values
  ('Maria Helena Ferreira',   array[0,1,2,3,4]),
  ('José Carlos de Almeida',  array[0,1,2,4]),
  ('Ana Paula Ribeiro',       array[0,1,3]),
  ('Carlos Eduardo Martins',  array[0,1,2,3,4]),
  ('Rosa Maria dos Santos',   array[0,2,3,4]),
  ('Antônio Marcos Lima',     array[0]),
  ('Cláudia Regina Souza',    array[0]),
  ('João Batista Oliveira',   array[1,2,3]),
  ('Luciana Aparecida Gomes', array[2,4]),
  ('Paulo Roberto Fernandes', array[1])
),
itens as (
  select p.id as parish_id, t.id as tither_id, t.joined_on,
         (ref.mes - make_interval(months => k))::date as mes, ref.hoje, k
  from plano
  cross join unnest(plano.meses) as k
  cross join p cross join ref
  join tither_profiles t on t.parish_id = p.id and t.name = plano.name and t.notes like '[DEMO]%'
)
insert into tither_contributions (parish_id, tither_id, reference_month, received_at, notes)
select parish_id, tither_id, mes,
       (least(mes + (2 + (k * 7) % 18), hoje) + time '12:00') at time zone 'America/Sao_Paulo',
       '[DEMO] Registro de demonstração.'
from itens
where joined_on is null or mes >= date_trunc('month', joined_on)::date
on conflict (tither_id, reference_month) do nothing;

-- ---------- Eventos de demonstração (4), todos públicos e para toda a paróquia ----------
-- Datas a partir de hoje: próximo domingo depois de 2 semanas, sábado depois de 3,
-- sexta depois de 4 e domingo depois de 6 semanas (sempre entre 2 e 8 semanas à frente).
-- dia_semana: 0 = domingo … 6 = sábado.
with p as (
  select id from parishes where slug = 'santo-antonio-jaragua'
),
ref as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje
),
demo (title, description, location, apos_dias, dia_semana, inicio, fim, highlight_home) as (values
  ('Almoço Beneficente — Reforma do Telhado',
   E'Um momento de convivência e solidariedade em nossa comunidade.\nToda a renda da ação será destinada à reforma do telhado da igreja.\n\n[Evento de demonstração]',
   'Salão Paroquial', 14, 0, time '12:00', time '15:30', true),
  ('Grande Quermesse Paroquial',
   E'Barraquinhas, comidas típicas, música, brincadeiras e confraternização\npara toda a família.\n\n[Evento de demonstração]',
   'Adro da Matriz', 21, 6, time '17:00', time '22:00', true),
  ('Noite de Caldos',
   E'Venha participar de uma noite especial de convivência com nossa comunidade.\n\n[Evento de demonstração]',
   'Salão Paroquial', 28, 5, time '19:00', time '22:00', false),
  ('Encontro das Famílias',
   E'Momento de oração, formação e convivência para as famílias da paróquia.\n\n[Evento de demonstração]',
   'Igreja Matriz', 42, 0, time '16:00', time '18:00', false)
),
datas as (
  select demo.*,
         (ref.hoje + demo.apos_dias + ((demo.dia_semana - extract(dow from ref.hoje + demo.apos_dias)::int + 7) % 7)) as dia
  from demo cross join ref
)
insert into events (parish_id, community_id, scope, title, description, starts_at, ends_at, location, public, highlight_home, cancelled)
select p.id, null, 'parish', datas.title, datas.description,
       (datas.dia + datas.inicio) at time zone 'America/Sao_Paulo',
       (datas.dia + datas.fim)    at time zone 'America/Sao_Paulo',
       datas.location, true, datas.highlight_home, false
from datas cross join p
where not exists (
  select 1 from events e
  where e.parish_id = p.id and e.title = datas.title and e.description like '%[Evento de demonstração]'
);

-- ---------- Conferência ----------
select 'dizimistas DEMO' as o_que, count(*) as total,
       count(*) filter (where status = 'active') as ativos,
       count(*) filter (where status = 'inactive') as inativos
from tither_profiles
where notes like '[DEMO]%'
  and parish_id = (select id from parishes where slug = 'santo-antonio-jaragua');

select 'contribuições DEMO no mês atual' as o_que, count(*) as total
from tither_contributions c
join tither_profiles t on t.id = c.tither_id and t.notes like '[DEMO]%'
where c.reference_month = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;

select title, starts_at at time zone 'America/Sao_Paulo' as inicio_brasilia, ends_at at time zone 'America/Sao_Paulo' as fim_brasilia, highlight_home
from events
where description like '%[Evento de demonstração]'
  and parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
order by starts_at;
