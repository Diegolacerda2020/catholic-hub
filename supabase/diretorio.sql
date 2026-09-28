-- Central Paroquial — DIRETÓRIO ARQUIDIOCESANO (somente estrutura).
--
-- parish_directory = catálogo oficial e pesquisável (todas as paróquias do Catálogo 2026).
-- parishes         = só as paróquias ATIVADAS na plataforma (tenants). Não muda nada nas que já existem.
--
-- Rode no SQL Editor DEPOIS do schema.sql (e do secretaria24h.sql, se já aplicado). Pode rodar 2x.
-- Não há DROP TABLE, TRUNCATE nem DELETE. A única mudança em tabela existente é uma coluna nova e
-- opcional em parishes (directory_id), sem valor padrão: nenhuma linha existente é alterada.
-- Carga do catálogo: supabase/diretorio_seed.sql (gerado por scripts/importar-catalogo.mjs).
-- Ativação das paróquias piloto: supabase/diretorio_ativacao.sql (revisão manual).
--
-- Ninguém ativa paróquia pela internet: não existe função pública que altere status ou crie tenant.

-- Busca sem acento e sem diferença de maiúsculas, sem depender de extensão (unaccent/pg_trgm).
create or replace function dir_norm(t text) returns text
language sql immutable parallel safe set search_path = public as $$
  select lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ’''".,;:()/-',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn           '));
$$;
revoke all on function dir_norm(text) from public, anon;

create table if not exists parish_directory (
  id uuid primary key default gen_random_uuid(),
  catalog_code text unique check (catalog_code ~ '^[0-9]{1,4}$'),
  name text not null check (length(trim(name)) between 2 and 200),           -- como está no catálogo
  display_name text not null check (length(trim(display_name)) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  type text not null check (type in ('paroquia_territorial','paroquia_pessoal','paroquia_militar','curato','area_pastoral')),
  episcopal_region text check (episcopal_region ~ '^RENS[A-Z]{1,2}$'),
  episcopal_region_name text check (length(episcopal_region_name) <= 120),
  forania text check (length(forania) <= 120),
  municipality text check (length(municipality) <= 120),
  neighborhood text check (length(neighborhood) <= 160),
  address text check (length(address) <= 300),
  postal_code text check (postal_code ~ '^[0-9]{5}-[0-9]{3}$'),
  phone text check (length(phone) <= 120),
  email text check (length(email) <= 200),
  founded_on date,
  source_year integer check (source_year between 2000 and 2100),
  status text not null default 'listed' check (status in ('listed','onboarding','active','suspended')),
  search_text text generated always as (dir_norm(display_name || ' ' || coalesce(neighborhood, '') || ' ' || coalesce(municipality, '') || ' ' || coalesce(forania, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists parish_directory_status_idx on parish_directory (status);

drop trigger if exists trg_touch_parish_directory on parish_directory;
create trigger trg_touch_parish_directory before update on parish_directory for each row execute function touch_updated_at();

-- Tenant ↔ diretório (1 para 1). Coluna nova e opcional: as paróquias existentes continuam iguais.
alter table parishes add column if not exists directory_id uuid references parish_directory(id) on delete set null;
create unique index if not exists parishes_directory_id_key on parishes (directory_id) where directory_id is not null;

-- ---------- RLS ----------
-- Ninguém lê nem escreve direto. Visitante e equipe usam só as funções public_directory_*.
-- Carga e ativação: SQL Editor (dono do projeto).
alter table parish_directory enable row level security;
revoke all on parish_directory from anon, authenticated;

-- Paróquia "ativa na plataforma" = diretório active + tenant ligado e ativo.
create or replace function dir_tenant_slug(p_dir uuid, p_status text) returns text
language sql stable security definer set search_path = public as $$
  select case when p_status = 'active' then (select p.slug from parishes p where p.directory_id = p_dir and p.active) end;
$$;
revoke all on function dir_tenant_slug(uuid, text) from public, anon, authenticated;

-- ---------- Público: buscar paróquia ----------
-- Busca por nome, bairro, município ou forania (todas as palavras, sem acento). Sem texto: só as ativas.
-- Devolve só dados públicos do catálogo; "tenant_slug" só existe para paróquia ativa na plataforma.
create or replace function public_directory_search(p_q text, p_limit integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with termos as (
    select array_remove(string_to_array(dir_norm(left(coalesce(p_q, ''), 80)), ' '), '') as t
  ), achados as (
    select d.*, dir_tenant_slug(d.id, d.status) as tenant_slug
    from parish_directory d, termos
    where (cardinality(termos.t) = 0 and d.status = 'active')
       or (cardinality(termos.t) > 0 and not exists (select 1 from unnest(termos.t) w where d.search_text not like '%' || w || '%'))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', a.slug, 'name', a.display_name, 'type', a.type, 'municipality', a.municipality, 'neighborhood', a.neighborhood,
      'forania', a.forania, 'episcopal_region', a.episcopal_region, 'active', a.tenant_slug is not null, 'tenant_slug', a.tenant_slug
    ) order by (a.tenant_slug is not null) desc, a.display_name, a.municipality), '[]'::jsonb)
  from (select * from achados order by (tenant_slug is not null) desc, display_name limit greatest(1, least(coalesce(p_limit, 30), 50))) a;
$$;
revoke all on function public_directory_search(text, integer) from public;
grant execute on function public_directory_search(text, integer) to anon, authenticated;

-- ---------- Público: ficha de uma paróquia do diretório ----------
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
    'phone', d.phone, 'email', d.email, 'source_year', d.source_year,
    'active', dir_tenant_slug(d.id, d.status) is not null, 'tenant_slug', dir_tenant_slug(d.id, d.status))
  from parish_directory d
  where d.slug = p_slug;
$$;
revoke all on function public_directory_entry(text) from public;
grant execute on function public_directory_entry(text) to anon, authenticated;

-- Conferência
select status, count(*) from parish_directory group by status order by status;
