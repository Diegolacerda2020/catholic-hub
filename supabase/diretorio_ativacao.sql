-- Central Paroquial — ATIVAÇÃO das 3 paróquias piloto (revisão manual; rode por último).
--
-- Ordem: schema.sql → secretaria24h.sql → diretorio.sql → diretorio_seed.sql → ESTE arquivo.
-- Pode rodar 2x. Não apaga nada. Não cria usuário nem vínculo de equipe (isso é feito depois, à mão).
--
--   013  Santo Antônio – Jaraguá (Belo Horizonte)            tenant JÁ existe: só ganha o directory_id
--   207  Santa Clara e São Francisco – Mineirão (Belo Horizonte)  tenant novo
--   009  Nossa Senhora das Graças – Centro (Ibirité)              tenant novo
--
-- Tenants novos começam VAZIOS: nada é copiado de Santo Antônio. O parish_state inicial tem só o que
-- está no Catálogo 2026 (nome, endereço, telefone, e-mail, pároco, forania, região). Horários de missa,
-- comunidades, avisos, eventos, dizimistas, contribuições e intenções ficam vazios até a paróquia publicar.

-- 1. Diretório: as 3 ficam "active" (as demais continuam "listed")
update parish_directory set status = 'active'
where catalog_code in ('013', '207', '009') and status <> 'active';

-- 2. Santo Antônio: liga o tenant existente ao diretório (não mexe em mais nada dele)
update parishes p set directory_id = d.id
from parish_directory d
where p.slug = 'santo-antonio-jaragua' and d.catalog_code = '013' and p.directory_id is null;

-- 3. Tenants novos, com o slug do diretório
insert into parishes (slug, name, directory_id)
select d.slug,
       'Paróquia ' || d.display_name || ' – ' || case when d.neighborhood is null or d.neighborhood ~* '^centro$' then d.municipality else d.neighborhood end,
       d.id
from parish_directory d
where d.catalog_code in ('207', '009')
on conflict (slug) do nothing;

-- 4. Estado inicial dos tenants novos: só dados do catálogo. Nunca sobrescreve um estado existente.
insert into parish_state (parish_id, data)
select p.id, jsonb_build_object('cfg', jsonb_strip_nulls(jsonb_build_object(
  'nome', p.name,
  'endereco', concat_ws(' – ', d.address, d.neighborhood, d.municipality || ' – MG' || coalesce(', CEP ' || d.postal_code, '')),
  'telefone', d.phone,
  'email', d.email,
  'paroco', d.pastor_name,
  'forania', d.forania,
  'regiao', d.episcopal_region_name,
  'missas', '',
  'secretaria', ''
)))
from parishes p join parish_directory d on d.id = p.directory_id
where d.catalog_code in ('207', '009')
on conflict (parish_id) do nothing;

-- Conferência: 3 ativas, cada uma com o seu tenant
select d.catalog_code, d.display_name, d.status, p.slug as tenant, p.name,
       (select count(*) from parish_users pu where pu.parish_id = p.id) as equipe
from parish_directory d left join parishes p on p.directory_id = d.id
where d.status = 'active' order by d.catalog_code;
