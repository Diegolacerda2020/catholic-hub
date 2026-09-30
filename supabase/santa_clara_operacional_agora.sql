-- Central Paroquial - Operacao Santa Clara operacional.
-- Escopo: catalogo real da Secretaria 24h de Santa Clara + vinculo da secretaria real.
-- Registro idempotente para reexecucao futura. O SQL real ja foi executado manualmente.
-- Nao executa em producao sem nova aprovacao.
--
-- Garantias:
-- - nao apaga auth.users, parish_users, solicitacoes, historico, fieis, eventos ou comunidades;
-- - nao copia solicitacoes, historico, fieis, usuarios, eventos ou comunidades;
-- - nao ativa servicos demo_*;
-- - rollback automatico se qualquer pre-condicao falhar.

begin;

do $$
declare
  v_parish uuid := '5806800c-7bc9-489d-9b45-0e81eeaf3923';
  v_slug text := 'santa-clara-e-sao-francisco-mineirao';
  v_email text := 'franciscoeclarapazebem@gmail.com';
  v_user uuid;
  v_count int;
  v_conflict record;
begin
  select count(*) into v_count
  from parishes
  where id = v_parish
    and slug = v_slug;

  if v_count <> 1 then
    raise exception 'Santa Clara deve existir exatamente 1 vez com parish_id % e slug %, encontrado %',
      v_parish, v_slug, v_count;
  end if;

  select count(*) into v_count
  from auth.users
  where lower(email) = lower(v_email);

  if v_count <> 1 then
    raise exception 'Esperado exatamente 1 auth.users para %, encontrado %', v_email, v_count;
  end if;

  select id into v_user
  from auth.users
  where lower(email) = lower(v_email);

  select pu.parish_id, p.slug, pu.role
    into v_conflict
  from parish_users pu
  left join parishes p on p.id = pu.parish_id
  where pu.user_id = v_user
    and pu.parish_id <> v_parish
  limit 1;

  if v_conflict.parish_id is not null then
    raise exception 'Usuario % ja esta vinculado a outra paroquia: % (%) role %',
      v_email, coalesce(v_conflict.slug, '<sem slug>'), v_conflict.parish_id, v_conflict.role;
  end if;
end $$;

-- Backup persistente sem dados de solicitacoes, historico, fieis, eventos ou comunidades.
create table if not exists operation_backups (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  parish_id uuid not null,
  parish_slug text not null,
  created_at timestamptz not null default now(),
  payload jsonb not null
);

insert into operation_backups (operation, parish_id, parish_slug, payload)
select
  'santa_clara_operacional_agora_before',
  p.id,
  p.slug,
  jsonb_build_object(
    'parish', to_jsonb(p),
    'parish_users', coalesce((select jsonb_agg(to_jsonb(x)) from parish_users x where x.parish_id = p.id), '[]'::jsonb),
    'service_catalog', coalesce((select jsonb_agg(to_jsonb(x)) from service_catalog x where x.parish_id = p.id), '[]'::jsonb),
    'service_requests_count', (select count(*) from service_requests x where x.parish_id = p.id),
    'service_request_history_count', (select count(*) from service_request_history x where x.parish_id = p.id)
  )
from parishes p
where p.id = '5806800c-7bc9-489d-9b45-0e81eeaf3923'
  and p.slug = 'santa-clara-e-sao-francisco-mineirao';

-- Catalogo real inicial de Santa Clara.
-- Templates definidos localmente: nao consulta nem reutiliza IDs de service_catalog de Santo Antonio.
with santa_clara as (
  select id
  from parishes
  where id = '5806800c-7bc9-489d-9b45-0e81eeaf3923'
    and slug = 'santa-clara-e-sao-francisco-mineirao'
),
servicos(code, title, description, instructions, form_fields, sort_order) as (
  values
  ('certidao', 'Certidao / documento paroquial',
   'Solicite informacoes ou segunda via de documentos emitidos pela paroquia.',
   'Informe os dados que souber para a secretaria localizar o registro nos livros da paroquia. Nao e preciso enviar documentos agora: a equipe entra em contato para combinar a retirada.',
   '[{"name":"tipo_documento","label":"Tipo de documento","type":"select","required":true,"options":["Certidao de Batismo","Certidao de Crisma","Certidao de Matrimonio","Outro"]},
     {"name":"nome_pessoa","label":"Nome completo da pessoa","type":"text","required":true},
     {"name":"data_sacramento","label":"Data aproximada do sacramento","type":"text","hint":"Pode ser so o ano ou o mes e o ano."},
     {"name":"nome_pais","label":"Nome dos pais","type":"text"},
     {"name":"local","label":"Comunidade/igreja onde ocorreu","type":"text"},
     {"name":"observacoes","label":"Observacoes","type":"textarea"}]'::jsonb,
   10),
  ('batismo', 'Batismo',
   'Receba as primeiras orientacoes para preparacao e realizacao do Batismo.',
   'A secretaria entra em contato para explicar a preparacao, os documentos necessarios e as datas disponiveis.',
   '[{"name":"nome_pessoa","label":"Nome da crianca/pessoa","type":"text","required":true},
     {"name":"data_nascimento","label":"Data de nascimento","type":"date"},
     {"name":"nome_responsaveis","label":"Nome dos responsaveis","type":"text"},
     {"name":"data_desejada","label":"Data desejada","type":"date"},
     {"name":"comunidade","label":"Comunidade desejada","type":"text"},
     {"name":"observacoes","label":"Observacoes","type":"textarea"}]'::jsonb,
   20),
  ('matrimonio', 'Matrimonio',
   'Receba as orientacoes iniciais para a preparacao e o agendamento do casamento.',
   'A secretaria entra em contato para explicar a preparacao, os documentos necessarios e a disponibilidade de datas. A data so fica reservada depois da confirmacao da paroquia.',
   '[{"name":"nome_noivo","label":"Nome do noivo","type":"text","required":true},
     {"name":"nome_noiva","label":"Nome da noiva","type":"text","required":true},
     {"name":"data_desejada","label":"Data desejada","type":"date"},
     {"name":"comunidade","label":"Comunidade/igreja","type":"text"},
     {"name":"observacoes","label":"Observacoes","type":"textarea"}]'::jsonb,
   30),
  ('catequese', 'Catequese',
   'Informacoes e inscricao para a catequese.',
   'A secretaria entra em contato com as informacoes de turmas, horarios e documentos.',
   '[{"name":"nome_catequizando","label":"Nome do catequizando","type":"text","required":true},
     {"name":"data_nascimento","label":"Data de nascimento","type":"date"},
     {"name":"nome_responsavel","label":"Nome do responsavel","type":"text"},
     {"name":"comunidade","label":"Comunidade","type":"text"},
     {"name":"observacoes","label":"Observacoes","type":"textarea"}]'::jsonb,
   40),
  ('atendimento_padre', 'Atendimento com o padre',
   'Solicite contato ou orientacao para agendamento de atendimento pastoral.',
   'Conte em poucas palavras o assunto. A secretaria entra em contato para combinar o melhor horario. Nao escreva aqui nada que seja assunto de confissao.',
   '[{"name":"assunto","label":"Assunto","type":"text","required":true},
     {"name":"melhor_periodo","label":"Melhor periodo para contato","type":"select","options":["Manha","Tarde","Noite","Qualquer horario"]},
     {"name":"observacoes","label":"Observacoes","type":"textarea"}]'::jsonb,
   50),
  ('outro', 'Outro assunto',
   'Envie sua duvida ou pedido para a secretaria.',
   'Escreva como podemos ajudar. A secretaria responde no horario de atendimento.',
   '[{"name":"mensagem","label":"Como podemos ajudar?","type":"textarea","required":true}]'::jsonb,
   60)
)
insert into service_catalog (parish_id, code, title, description, instructions, form_fields, active, sort_order)
select sc.id, s.code, s.title, s.description, s.instructions, s.form_fields, true, s.sort_order
from santa_clara sc
cross join servicos s
on conflict (parish_id, code) do update
set title = excluded.title,
    description = excluded.description,
    instructions = excluded.instructions,
    form_fields = excluded.form_fields,
    active = true,
    sort_order = excluded.sort_order;

-- Demo permanece documentado no banco, mas nunca publico/ativo.
update service_catalog
set active = false
where parish_id = '5806800c-7bc9-489d-9b45-0e81eeaf3923'
  and code like 'demo_%';

-- Vinculo idempotente da secretaria real. Nao altera auth.users.
insert into parish_users (user_id, parish_id, role)
select u.id, '5806800c-7bc9-489d-9b45-0e81eeaf3923', 'secretaria'
from auth.users u
where lower(u.email) = lower('franciscoeclarapazebem@gmail.com')
on conflict (user_id, parish_id) do update
set role = 'secretaria';

do $$
declare
  v_public int;
  v_real_active int;
  v_demo_total int;
  v_demo_active int;
  v_link int;
begin
  select count(*) into v_real_active
  from service_catalog
  where parish_id = '5806800c-7bc9-489d-9b45-0e81eeaf3923'
    and active
    and code not like 'demo_%';

  select count(*) filter (where code like 'demo_%'),
         count(*) filter (where code like 'demo_%' and active)
    into v_demo_total, v_demo_active
  from service_catalog
  where parish_id = '5806800c-7bc9-489d-9b45-0e81eeaf3923';

  select jsonb_array_length(public_service_catalog('santa-clara-e-sao-francisco-mineirao'))
    into v_public;

  select count(*) into v_link
  from parish_users pu
  join auth.users u on u.id = pu.user_id
  where pu.parish_id = '5806800c-7bc9-489d-9b45-0e81eeaf3923'
    and pu.role = 'secretaria'
    and lower(u.email) = lower('franciscoeclarapazebem@gmail.com');

  if v_real_active <> 6 or v_demo_active <> 0 or v_public <> 6 or v_link <> 1 then
    raise exception 'Pos-check invalido: real_active %, demo_total %, demo_active %, public %, link %',
      v_real_active, v_demo_total, v_demo_active, v_public, v_link;
  end if;
end $$;

-- Pos-check somente leitura.
select u.email, p.name as paroquia, pu.role, pu.parish_id
from parish_users pu
join auth.users u on u.id = pu.user_id
join parishes p on p.id = pu.parish_id
where lower(u.email) = lower('franciscoeclarapazebem@gmail.com')
order by u.email, p.slug;

select p.slug, p.id as parish_id,
  count(sc.*)::int as service_catalog_total,
  count(sc.*) filter (where sc.active and sc.code not like 'demo_%')::int as servicos_reais_ativos,
  count(sc.*) filter (where sc.code like 'demo_%')::int as servicos_demo,
  count(sc.*) filter (where sc.code like 'demo_%' and sc.active)::int as demos_ativos,
  jsonb_array_length(public_service_catalog(p.slug)) as servicos_publicos,
  coalesce(array_agg(sc.code order by sc.sort_order, sc.code) filter (where sc.code is not null), array[]::text[]) as service_codes
from parishes p
left join service_catalog sc on sc.parish_id = p.id
where p.slug in ('santo-antonio-jaragua', 'santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite')
group by p.slug, p.id
order by p.slug;

commit;
