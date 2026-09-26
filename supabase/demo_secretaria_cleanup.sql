-- Central Paroquial — remove SOMENTE os dados de demonstração criados por demo_secretaria_seed.sql.
--
-- Apaga apenas, e só na paróquia santo-antonio-jaragua:
--   solicitações da Secretaria 24h com is_demo = true
--   (o histórico delas sai junto, pela FK on delete cascade; aqui fica explícito)
-- Não mexe no catálogo de serviços nem em solicitações reais.
-- Não usa TRUNCATE, DROP nem DELETE sem filtro.
--
-- Recomendado: rode primeiro só a parte "conferir", veja a lista, e depois o script inteiro.

-- ---------- conferir o que será removido ----------
select r.protocol, r.requester_name as nome, r.status, r.is_demo,
       (select count(*) from service_request_history h where h.request_id = r.id) as historico
from service_requests r
where r.parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
  and r.is_demo
order by r.created_at;

-- ---------- limpeza ----------
begin;

delete from service_request_history
where request_id in (
  select id from service_requests
  where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
    and is_demo
);

delete from service_requests
where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
  and is_demo;

commit;

-- ---------- conferir depois da limpeza (deve dar 0) ----------
select count(*) as solicitacoes_demo_restantes
from service_requests
where is_demo;
