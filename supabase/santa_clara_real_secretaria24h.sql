-- Central Paroquial - Santa Clara real + Secretaria 24h multi-tenant.
-- Rode no SQL Editor somente depois de revisar a conferencia.
--
-- Ordem segura:
-- 1. Rodar a conferencia e o backup deste arquivo.
-- 2. Rodar supabase/demo_multitenant_cleanup.sql com:
--      alvos text[] := array['santa-clara-e-sao-francisco-mineirao'];
-- 3. Rodar novamente este arquivo para criar o catalogo real de Santa Clara
--    e deixar Nossa Senhora das Gracas demonstravel.
--
-- Este arquivo nao apaga DEMO. A remocao continua centralizada no cleanup seletivo existente.

-- ---------- conferencia antes/depois ----------
select p.slug, p.id as parish_id,
  count(sc.*)::int as service_catalog_total,
  count(sc.*) filter (where sc.active)::int as service_catalog_active,
  count(sc.*) filter (where not sc.active)::int as service_catalog_inactive,
  coalesce(array_agg(sc.code order by sc.sort_order, sc.code) filter (where sc.code is not null), array[]::text[]) as service_codes,
  (select count(*)::int from service_requests r where r.parish_id = p.id) as service_requests_total,
  (select count(*)::int from service_requests r where r.parish_id = p.id and r.is_demo) as service_requests_demo,
  jsonb_array_length(public_service_catalog(p.slug)) as public_service_catalog_total
from parishes p
left join service_catalog sc on sc.parish_id = p.id
where p.slug in ('santo-antonio-jaragua', 'santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite')
group by p.slug, p.id
order by p.slug;

-- ---------- backup especifico de Santa Clara ----------
create table if not exists operation_backups (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  parish_id uuid not null,
  parish_slug text not null,
  created_at timestamptz not null default now(),
  payload jsonb not null
);

insert into operation_backups (operation, parish_id, parish_slug, payload)
select 'santa_clara_real_secretaria24h_before_cleanup', p.id, p.slug,
  jsonb_build_object(
    'parish', to_jsonb(p),
    'parish_users', coalesce((select jsonb_agg(to_jsonb(x)) from parish_users x where x.parish_id = p.id), '[]'::jsonb),
    'parish_state', coalesce((select jsonb_agg(to_jsonb(x)) from parish_state x where x.parish_id = p.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from events x where x.parish_id = p.id), '[]'::jsonb),
    'tither_profiles', coalesce((select jsonb_agg(to_jsonb(x)) from tither_profiles x where x.parish_id = p.id), '[]'::jsonb),
    'tither_contributions', coalesce((select jsonb_agg(to_jsonb(x)) from tither_contributions x where x.parish_id = p.id), '[]'::jsonb),
    'tither_leads', coalesce((select jsonb_agg(to_jsonb(x)) from tither_leads x where x.parish_id = p.id), '[]'::jsonb),
    'service_catalog', coalesce((select jsonb_agg(to_jsonb(x)) from service_catalog x where x.parish_id = p.id), '[]'::jsonb),
    'service_requests', coalesce((select jsonb_agg(to_jsonb(x)) from service_requests x where x.parish_id = p.id), '[]'::jsonb),
    'service_request_history', coalesce((select jsonb_agg(to_jsonb(x)) from service_request_history x where x.parish_id = p.id), '[]'::jsonb)
  )
from parishes p
where p.slug = 'santa-clara-e-sao-francisco-mineirao'
  and p.id = '5806800c-7bc9-489d-9b45-0e81eeaf3923';

-- ---------- catalogo real inicial de Santa Clara ----------
insert into service_catalog (parish_id, code, title, description, instructions, form_fields, active, sort_order)
select sc_p.id, src.code, src.title, src.description, src.instructions, src.form_fields, true, src.sort_order
from parishes sc_p
join parishes sa_p on sa_p.slug = 'santo-antonio-jaragua'
join service_catalog src on src.parish_id = sa_p.id
where sc_p.slug = 'santa-clara-e-sao-francisco-mineirao'
  and sc_p.id = '5806800c-7bc9-489d-9b45-0e81eeaf3923'
  and src.active
  and src.code not like 'demo_%'
on conflict (parish_id, code) do nothing;

-- ---------- Gracas segue DEMO, mas demonstravel publicamente ----------
update service_catalog sc
set active = true
from parishes p
where sc.parish_id = p.id
  and p.slug = 'nossa-senhora-das-gracas-ibirite'
  and sc.code like 'demo_%'
  and not sc.active;

-- ---------- conferencia final esperada ----------
select p.slug, p.id as parish_id,
  count(sc.*)::int as service_catalog_total,
  count(sc.*) filter (where sc.active)::int as service_catalog_active,
  count(sc.*) filter (where not sc.active)::int as service_catalog_inactive,
  coalesce(array_agg(sc.code order by sc.sort_order, sc.code) filter (where sc.code is not null), array[]::text[]) as service_codes,
  (select count(*)::int from service_requests r where r.parish_id = p.id) as service_requests_total,
  (select count(*)::int from service_requests r where r.parish_id = p.id and r.is_demo) as service_requests_demo,
  jsonb_array_length(public_service_catalog(p.slug)) as public_service_catalog_total
from parishes p
left join service_catalog sc on sc.parish_id = p.id
where p.slug in ('santo-antonio-jaragua', 'santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite')
group by p.slug, p.id
order by p.slug;
