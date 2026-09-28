-- Central Paroquial — Diretório: SANTUÁRIOS + busca por tipo (somente estrutura; revisão manual).
--
-- Por que: o Catálogo 2026 põe as paróquias que são santuários (ex.: São Paulo da Cruz) só na seção 7.14
-- (Santuários), e a primeira importação lia só a 7.13. Este arquivo prepara o diretório para receber os
-- santuários, marcando quando a mesma instituição é paróquia E santuário (um registro só).
--
-- O que muda:
--   parish_directory: colunas NOVAS e opcionais (is_sanctuary, sanctuary_code, sanctuary_name, sanctuary_kind,
--   rector_name, sanctuary_since, source_section) e o tipo 'santuario'. Nenhuma linha existente é alterada aqui.
--   public_directory_search: aceita o filtro de tipo (paróquias/santuários), entende abreviações simples
--   (sto, sta, sra, n.s.) e procura também pelo nome do santuário. public_directory_entry: devolve os campos novos.
-- Não mexe em parishes, parish_state, usuários nem em nenhuma outra tabela. Pode rodar 2x.
--
-- Ordem: diretorio.sql (já aplicado) → ESTE arquivo → diretorio_seed.sql (regerado) → diretorio_ativacao.sql (já aplicado; não precisa rodar de novo).
--
-- Risco: baixo. As colunas novas têm valor padrão ou aceitam nulo; a regra de tipo é trocada por outra que aceita
-- tudo o que já existe e mais 'santuario'. A função de busca é recriada (DROP + CREATE da mesma função com um
-- parâmetro a mais, opcional); o front atual em produção não usa o diretório.
-- Rollback (se precisar): apagar os registros com type = 'santuario', voltar a regra de tipo sem 'santuario',
-- recriar public_directory_search(text, integer) de diretorio.sql. As colunas novas podem ficar (ninguém depende delas).

alter table parish_directory add column if not exists is_sanctuary boolean not null default false;
alter table parish_directory add column if not exists sanctuary_code text;
alter table parish_directory add column if not exists sanctuary_name text;
alter table parish_directory add column if not exists sanctuary_kind text;
alter table parish_directory add column if not exists rector_name text;
alter table parish_directory add column if not exists sanctuary_since date;
alter table parish_directory add column if not exists source_section text;

do $$
begin
  -- regra de tipo: a mesma de antes + 'santuario'
  if exists (select 1 from pg_constraint where conrelid = 'parish_directory'::regclass and conname = 'parish_directory_type_check') then
    alter table parish_directory drop constraint parish_directory_type_check;
  end if;
  alter table parish_directory add constraint parish_directory_type_check
    check (type in ('paroquia_territorial','paroquia_pessoal','paroquia_militar','curato','area_pastoral','santuario'));
  if not exists (select 1 from pg_constraint where conrelid = 'parish_directory'::regclass and conname = 'parish_directory_sanctuary_ck') then
    alter table parish_directory add constraint parish_directory_sanctuary_ck check (
      (sanctuary_code is null or sanctuary_code ~ '^[0-9]{1,4}$')
      and length(coalesce(sanctuary_name, '')) <= 200 and length(coalesce(sanctuary_kind, '')) <= 60 and length(coalesce(rector_name, '')) <= 200
      and (source_section is null or source_section in ('7.13','7.14','7.13+7.14','7.14+7.15'))
      and (type <> 'santuario' or is_sanctuary));
  end if;
end $$;
create unique index if not exists parish_directory_sanctuary_code_key on parish_directory (sanctuary_code) where sanctuary_code is not null;

-- Abreviações simples, nos dois lados da busca (texto já sem acento e em minúsculas)
create or replace function dir_expande(t text) returns text
language sql immutable parallel safe set search_path = public as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(' ' || coalesce(t, '') || ' ',
    '\mn\s+s\M', 'nossa senhora', 'g'), '\mnsra\M', 'nossa senhora', 'g'), '\msto\M', 'santo', 'g'), '\msta\M', 'santa', 'g'), '\msra\M', 'senhora', 'g'), '\s+', ' ', 'g');
$$;
revoke all on function dir_expande(text) from public, anon;

-- ---------- Público: buscar paróquia ou santuário ----------
-- p_tipo: null (todos) | 'paroquia' | 'santuario'. Sem texto: as ativas na plataforma; com p_tipo 'santuario', todos os santuários.
drop function if exists public_directory_search(text, integer);
create or replace function public_directory_search(p_q text, p_limit integer default 30, p_tipo text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with termos as (
    select array_remove(string_to_array(trim(dir_expande(dir_norm(left(coalesce(p_q, ''), 80)))), ' '), '') as t,
           trim(dir_expande(dir_norm(left(coalesce(p_q, ''), 80)))) as frase
  ), base as (
    select d.*, dir_tenant_slug(d.id, d.status) as tenant_slug,
           dir_expande(d.search_text || ' ' || dir_norm(coalesce(d.sanctuary_name, '') || ' ' || coalesce(d.sanctuary_kind, ''))
             || case when d.type like 'paroquia%' then ' paroquia' when d.type = 'curato' then ' curato' when d.type = 'area_pastoral' then ' area pastoral' else '' end
             || case when d.is_sanctuary then ' santuario' else '' end) as texto
    from parish_directory d
    where p_tipo is null or (p_tipo = 'paroquia' and d.type like 'paroquia%') or (p_tipo = 'santuario' and d.is_sanctuary)
  ), achados as (
    -- relevância: 0 = o nome (ou o nome do santuário) contém a frase inteira; 1 = as palavras aparecem em qualquer campo
    select b.*, case when cardinality(termos.t) > 0 and dir_expande(dir_norm(b.display_name || ' ' || coalesce(b.sanctuary_name, ''))) like '%' || termos.frase || '%' then 0 else 1 end as rel
    from base b, termos
    where (cardinality(termos.t) = 0 and (b.status = 'active' or p_tipo = 'santuario'))
       or (cardinality(termos.t) > 0 and not exists (select 1 from unnest(termos.t) w where b.texto not like '%' || w || '%'))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', a.slug, 'name', a.display_name, 'type', a.type, 'municipality', a.municipality, 'neighborhood', a.neighborhood,
      'forania', a.forania, 'episcopal_region', a.episcopal_region, 'is_sanctuary', a.is_sanctuary, 'sanctuary_name', a.sanctuary_name,
      'sanctuary_kind', a.sanctuary_kind, 'active', a.tenant_slug is not null, 'tenant_slug', a.tenant_slug
    ) order by a.rel, (a.tenant_slug is not null) desc, coalesce(a.sanctuary_name, a.display_name), a.municipality), '[]'::jsonb)
  from (select * from achados order by rel, (tenant_slug is not null) desc, coalesce(sanctuary_name, display_name) limit greatest(1, least(coalesce(p_limit, 30), 50))) a;
$$;
revoke all on function public_directory_search(text, integer, text) from public;
grant execute on function public_directory_search(text, integer, text) to anon, authenticated;

-- ---------- Público: ficha (com os campos de santuário) ----------
create or replace function public_directory_entry(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', d.slug, 'name', d.display_name, 'type', d.type, 'catalog_code', d.catalog_code,
    'episcopal_region', d.episcopal_region, 'episcopal_region_name', d.episcopal_region_name, 'forania', d.forania,
    'municipality', d.municipality, 'neighborhood', d.neighborhood, 'address', d.address, 'postal_code', d.postal_code,
    'phone', d.phone, 'email', d.email, 'pastor_role', d.pastor_role, 'pastor_name', d.pastor_name, 'source_year', d.source_year,
    'is_sanctuary', d.is_sanctuary, 'sanctuary_code', d.sanctuary_code, 'sanctuary_name', d.sanctuary_name, 'sanctuary_kind', d.sanctuary_kind,
    'rector_name', d.rector_name,
    'active', dir_tenant_slug(d.id, d.status) is not null, 'tenant_slug', dir_tenant_slug(d.id, d.status))
  from parish_directory d
  where d.slug = p_slug;
$$;
revoke all on function public_directory_entry(text) from public;
grant execute on function public_directory_entry(text) to anon, authenticated;

-- Conferência
select count(*) filter (where is_sanctuary) as santuarios, count(*) as total from parish_directory;
