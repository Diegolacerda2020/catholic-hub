-- Central Paroquial — PROPOSTA (não ativa): edição segura do catálogo da Secretaria 24h.
-- PREPARADO, NÃO EXECUTADO, e o Assistente AINDA NÃO CHAMA esta função (ferramenta atualizar_servico
-- está marcada como indisponível em agente-core.js).
--
-- Hoje o catálogo (service_catalog) só é alterado pelo SQL Editor: a equipe tem apenas SELECT (RLS).
-- Esta proposta NÃO libera escrita direta na tabela. Cria uma função com campos explicitamente permitidos.
--
-- DECISÃO PENDENTE (não ampliar permissão em silêncio): quem pode editar?
--   Proposta abaixo: quem já opera a Secretaria 24h na paróquia (can_access 'secretaria24h' = padre,
--   secretaria e suporte). PASCOM não. Se a paróquia preferir só padre, troque a checagem marcada com (*).
--
-- Campos permitidos: title, description, instructions, active, sort_order.
-- NÃO permitidos por aqui: code (é a chave usada pelas solicitações), form_fields (muda o formulário
-- público; continua pelo SQL Editor), parish_id, ids e datas.

create or replace function staff_update_service(p_service uuid, p_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s service_catalog%rowtype;
  k text;
  permitidos constant text[] := array['title','description','instructions','active','sort_order'];
begin
  select * into s from service_catalog where id = p_service for update;
  if s.id is null or not can_access(s.parish_id, 'secretaria24h') then   -- (*)
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'agente:nada_alterado' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not (k = any(permitidos)) then
      raise exception 'agente:campo_nao_permitido' using errcode = '22023';
    end if;
  end loop;
  if p_changes ? 'title' and (jsonb_typeof(p_changes->'title') <> 'string' or length(trim(p_changes->>'title')) not between 2 and 120) then
    raise exception 'agente:titulo_invalido' using errcode = '22023';
  end if;
  if p_changes ? 'description' and jsonb_typeof(p_changes->'description') not in ('string','null') then
    raise exception 'agente:dados_invalidos' using errcode = '22023';
  end if;
  if p_changes ? 'instructions' and jsonb_typeof(p_changes->'instructions') not in ('string','null') then
    raise exception 'agente:dados_invalidos' using errcode = '22023';
  end if;
  if p_changes ? 'active' and jsonb_typeof(p_changes->'active') <> 'boolean' then
    raise exception 'agente:dados_invalidos' using errcode = '22023';
  end if;
  if p_changes ? 'sort_order' and (jsonb_typeof(p_changes->'sort_order') <> 'number' or (p_changes->>'sort_order')::numeric not between -1000 and 1000) then
    raise exception 'agente:dados_invalidos' using errcode = '22023';
  end if;

  update service_catalog set
    title        = case when p_changes ? 'title' then trim(p_changes->>'title') else title end,
    description  = case when p_changes ? 'description' then p_changes->>'description' else description end,
    instructions = case when p_changes ? 'instructions' then p_changes->>'instructions' else instructions end,
    active       = case when p_changes ? 'active' then (p_changes->>'active')::boolean else active end,
    sort_order   = case when p_changes ? 'sort_order' then (p_changes->>'sort_order')::numeric::int else sort_order end
  where id = s.id
  returning * into s;

  -- os limites de tamanho (description 1000, instructions 4000) continuam garantidos pelos checks da tabela
  return jsonb_build_object('code', s.code, 'title', s.title, 'description', s.description,
    'instructions', s.instructions, 'active', s.active, 'sort_order', s.sort_order);
end;
$$;

revoke all on function staff_update_service(uuid, jsonb) from public, anon;
grant execute on function staff_update_service(uuid, jsonb) to authenticated;
