-- Central Paroquial — Agente Paroquial V1 (migração do módulo).
-- PREPARADO, NÃO EXECUTADO. Rodar no SQL Editor só depois de revisão.
-- Seguro para rodar de novo: não há DROP TABLE, TRUNCATE nem DELETE; não mexe em dados existentes,
-- em usuários, vínculos nem permissões (can_access não muda).
--
-- O Assistente funciona SEM esta migração (consulta e cria usando o que já existe: RLS de events e
-- communities, public_service_catalog, service_requests e staff_update_service_request). Ela só acrescenta:
--   1. agent_audit_log + agent_log_action(): auditoria mínima do que o Assistente fez (sem o texto da conversa);
--   2. events.source: de onde veio o evento ('painel' por padrão; 'agente' quando criado pelo Assistente).
--
-- Rollback: `drop function agent_log_action(uuid, text, text, text, boolean); drop table agent_audit_log;`
-- e, se quiser, `alter table events drop column source;` (nenhuma outra parte do sistema depende dela).

-- ---------- 1. Auditoria ----------
-- Guarda só: quem, qual paróquia, qual ferramenta, por qual canal, quando, resultado e se houve confirmação humana.
-- NÃO guarda: a mensagem, nomes, telefones, notas, tokens ou qualquer conteúdo pastoral.
create table if not exists agent_audit_log (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references parishes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  channel text not null check (channel in ('painel','whatsapp','app')),
  tool text not null check (tool ~ '^[a-z][a-z0-9_]{1,59}$'),
  result text not null check (result in ('ok','vazio','preparado','negado','cancelado','erro')),
  human_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists agent_audit_log_parish_idx on agent_audit_log (parish_id, created_at desc);

alter table agent_audit_log enable row level security;
revoke all on agent_audit_log from anon;
revoke all on agent_audit_log from authenticated;
grant select on agent_audit_log to authenticated;

-- Leitura: só padre e suporte (admin) da própria paróquia. Secretaria e PASCOM não leem a auditoria.
drop policy if exists "padre le auditoria do agente" on agent_audit_log;
create policy "padre le auditoria do agente" on agent_audit_log
  for select to authenticated using (
    exists (select 1 from parish_users pu where pu.parish_id = agent_audit_log.parish_id and pu.user_id = auth.uid() and pu.role in ('padre','admin'))
  );

-- Escrita: só por esta função. O usuário vem de auth.uid() (nunca de parâmetro) e precisa ser membro da paróquia.
create or replace function agent_log_action(
  p_parish uuid,
  p_channel text,
  p_tool text,
  p_result text,
  p_confirmed boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_parish is null or not is_parish_member(p_parish) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('painel','whatsapp','app')
     or p_tool is null or p_tool !~ '^[a-z][a-z0-9_]{1,59}$'
     or p_result is null or p_result not in ('ok','vazio','preparado','negado','cancelado','erro') then
    raise exception 'agente:dados_invalidos' using errcode = '22023';
  end if;
  -- limite simples contra abuso: 600 registros por usuário por hora
  if (select count(*) from agent_audit_log where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 600 then
    return;
  end if;
  insert into agent_audit_log (parish_id, user_id, channel, tool, result, human_confirmed)
  values (p_parish, auth.uid(), p_channel, p_tool, p_result, coalesce(p_confirmed, false));
end;
$$;

revoke all on function agent_log_action(uuid, text, text, text, boolean) from public, anon;
grant execute on function agent_log_action(uuid, text, text, text, boolean) to authenticated;

-- ---------- 2. Origem do evento ----------
-- Prepara a agenda para vários canais (painel, Assistente, Google Agenda, WhatsApp oficial).
-- A sincronização com o Google Agenda continua usando events.google_event_id (já existe).
-- get_public_parish monta os eventos campo a campo: esta coluna não aparece na página pública.
alter table events add column if not exists source text not null default 'painel';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_source_check' and conrelid = 'events'::regclass) then
    alter table events add constraint events_source_check check (source in ('painel','agente','google','whatsapp','importacao'));
  end if;
end;
$$;
