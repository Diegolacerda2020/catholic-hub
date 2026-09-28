-- Central Paroquial — Diretório: MINIMIZAÇÃO DE DADOS PESSOAIS (somente estrutura/limpeza; revisão manual; NÃO executado).
--
-- Por que: o diretório público precisa só de dados INSTITUCIONAIS (nome, tipo, endereço, bairro, município, CEP,
-- telefone e e-mail da instituição, forania, região, condição de paróquia/santuário, status na Central).
-- Nome de pároco, vigário, reitor, administrador, cura etc. não é necessário ao produto — mesmo vindo de fonte
-- pública —, então deixa de ser guardado. Não basta esconder na tela: o dado sai do banco.
--
-- O que faz (nesta ordem):
--   1. Nos 2 tenants criados a partir do catálogo (códigos 207 e 009), tira cfg.paroco do parish_state SÓ quando
--      ele é exatamente o nome copiado do catálogo pelo diretorio_ativacao.sql. Se a própria paróquia já tiver
--      mudado esse campo no painel, fica como está. Santo Antônio (013) não é tocada: o dado dela foi a
--      própria paróquia que cadastrou.
--   2. Recria public_directory_entry sem nenhum campo de responsável.
--   3. Remove de parish_directory as colunas pastor_role, pastor_name e rector_name (e os dados delas).
--
-- NÃO mexe em parish_users nem em auth.users: "responsável listado no Catálogo" não é "usuário autorizado da
-- Central Paroquial". Nenhuma outra tabela muda.
--
-- Ordem: diretorio.sql → diretorio_santuarios.sql → ESTE arquivo → diretorio_seed.sql (regerado, já sem esses campos).
-- Pode rodar 2x (na 2ª não há mais o que limpar). Em banco novo (diretorio.sql atual, sem essas colunas) não faz nada.
--
-- Risco: baixo. Nenhum código atual lê essas colunas (o front e as funções já não usam). O seed ANTIGO
-- (com pastor_name) deixa de funcionar depois disto — de propósito.
-- Rollback: não há volta dos dados (e não deve haver: eles não são necessários). Estrutura: recriar as colunas
-- vazias com "alter table parish_directory add column pastor_role text, add column pastor_name text, add column rector_name text".

do $$
begin
  -- 1. cfg.paroco copiado do catálogo nos 2 tenants novos
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'parish_directory' and column_name = 'pastor_name') then
    execute $q$
      update parish_state ps
         set data = jsonb_set(ps.data, '{cfg}', (ps.data->'cfg') - 'paroco'), updated_at = now()
        from parishes p join parish_directory d on d.id = p.directory_id
       where ps.parish_id = p.id
         and d.catalog_code in ('207', '009')
         and d.pastor_name is not null
         and ps.data->'cfg'->>'paroco' = d.pastor_name
    $q$;
  end if;
end $$;

-- 2. Ficha pública só com dados institucionais
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
    'is_sanctuary', d.is_sanctuary, 'sanctuary_code', d.sanctuary_code, 'sanctuary_name', d.sanctuary_name, 'sanctuary_kind', d.sanctuary_kind,
    'active', dir_tenant_slug(d.id, d.status) is not null, 'tenant_slug', dir_tenant_slug(d.id, d.status))
  from parish_directory d
  where d.slug = p_slug;
$$;
revoke all on function public_directory_entry(text) from public;
grant execute on function public_directory_entry(text) to anon, authenticated;

-- 3. Os dados saem do banco
alter table parish_directory drop column if exists pastor_role;
alter table parish_directory drop column if exists pastor_name;
alter table parish_directory drop column if exists rector_name;

-- Conferência (esperado: 0 colunas de responsável; 0 tenants novos com cfg.paroco)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'parish_directory'
          and column_name in ('pastor_role', 'pastor_name', 'rector_name')) as colunas_de_responsavel,
       (select count(*) from parishes p join parish_directory d on d.id = p.directory_id join parish_state ps on ps.parish_id = p.id
         where d.catalog_code in ('207', '009') and ps.data->'cfg' ? 'paroco') as tenants_novos_com_paroco;
