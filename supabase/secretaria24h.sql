-- Central Paroquial — migração da SECRETARIA 24H (somente este módulo).
--
-- "A Secretaria 24h recebe sua solicitação a qualquer momento. O atendimento pela
-- equipe acontece no horário normal da secretaria."
--
-- Rode no SQL Editor do Supabase DEPOIS do schema.sql (precisa de parishes e parish_users).
-- Pode ser rodado 1, 2 ou mais vezes: só cria o que falta (create … if not exists,
-- create or replace function, on conflict do nothing) e recria as policies deste módulo.
-- Não há DROP TABLE, TRUNCATE nem DELETE. Não toca get_public_parish nem nenhuma tabela
-- existente; a única função existente que muda é can_access (ganha a área 'secretaria24h').
--
-- O mesmo conteúdo (sem a seção 1) está no final do schema.sql, e a seção 1 foi aplicada
-- diretamente no can_access() do schema.sql.
--
-- Tabelas:   service_catalog, service_requests, service_request_history
-- Públicas:  public_service_catalog, public_create_service_request, public_get_service_request
-- Equipe:    staff_update_service_request

-- =========================================================
-- 1. Permissões: área 'secretaria24h'
-- Padre e suporte (admin) já têm tudo; secretaria ganha 'secretaria24h'; PASCOM não.
-- Mesma matriz de antes, só com o item novo na lista da secretaria.
-- =========================================================
create or replace function can_access(p_parish uuid, p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case pu.role
      when 'padre' then true
      when 'admin' then true
      when 'secretaria' then p_area in ('avisos','agenda','comunidades','dizimistas','pessoas','intencoes','mensagens','ajustes','secretaria24h')
      when 'pascom' then p_area in ('avisos','agenda','comunidades','noticias')
      else false
    end
    from parish_users pu where pu.parish_id = p_parish and pu.user_id = auth.uid()
  ), false);
$$;

revoke all on function can_access(uuid, text) from public, anon;
grant execute on function can_access(uuid, text) to authenticated;

-- >>> SECRETARIA 24H: estrutura (copiada igual no final do schema.sql) >>>
-- =========================================================
-- SECRETARIA 24H
-- O fiel faz a solicitação pelo celular a qualquer hora (sem login); a equipe recebe
-- tudo organizado no painel e responde no horário da secretaria.
-- Visitante: nenhum acesso direto às tabelas, só pelas funções public_*.
-- Equipe: só a própria paróquia e só com can_access(parish_id, 'secretaria24h').
-- Sem CPF, sem documento de identidade.
-- =========================================================

create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Estrutura permitida para form_fields (o front-end só desenha estes tipos e nunca usa HTML do banco):
--   [{"name":"full_name","label":"Nome completo","type":"text","required":true,"hint":"…"},
--    {"name":"tipo","label":"Tipo","type":"select","options":["A","B"]}]
--   type: text | date | textarea | select (select exige options)
create or replace function s24_fields_ok(f jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  e jsonb;
  o jsonb;
  nomes text[] := '{}';
begin
  if f is null or jsonb_typeof(f) <> 'array' or jsonb_array_length(f) > 30 then
    return false;
  end if;
  for e in select value from jsonb_array_elements(f) loop
    if jsonb_typeof(e) <> 'object'
       or coalesce(e->>'name', '') !~ '^[a-z][a-z0-9_]{0,39}$'
       or (e->>'name') = any(nomes)
       or length(trim(coalesce(e->>'label', ''))) not between 1 and 120
       or coalesce(e->>'type', '') not in ('text','date','textarea','select')
       or (e ? 'required' and jsonb_typeof(e->'required') <> 'boolean')
       or (e ? 'hint' and (jsonb_typeof(e->'hint') <> 'string' or length(e->>'hint') > 300)) then
      return false;
    end if;
    if e->>'type' = 'select' then
      if jsonb_typeof(e->'options') is distinct from 'array' or jsonb_array_length(e->'options') not between 1 and 30 then
        return false;
      end if;
      for o in select value from jsonb_array_elements(e->'options') loop
        if jsonb_typeof(o) <> 'string' or length(o #>> '{}') not between 1 and 120 then
          return false;
        end if;
      end loop;
    end if;
    nomes := nomes || (e->>'name');
  end loop;
  return true;
end;
$$;

-- WhatsApp/telefone brasileiro: aceita só dígitos (e a formatação comum: espaço, ( ) . + -),
-- tira o 55 e o 0 da frente e devolve DDD + número (10 dígitos fixo, 11 celular), ou NULL.
-- O front-end usa a mesma regra (secretaria24h.js, s24Whats).
create or replace function s24_whatsapp(p text) returns text
language plpgsql immutable set search_path = public as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[\s().+-]', '', 'g');
begin
  if d !~ '^[0-9]{10,14}$' then
    return null;
  end if;
  d := regexp_replace(d, '^0+', '');
  if length(d) in (12, 13) and left(d, 2) = '55' then
    d := substr(d, 3);
  end if;
  if length(d) = 11 and d ~ '^[1-9][1-9]9[0-9]{8}$' then
    return d;
  end if;
  if length(d) = 10 and d ~ '^[1-9][1-9][2-5][0-9]{7}$' then
    return d;
  end if;
  return null;
end;
$$;

revoke all on function s24_fields_ok(jsonb) from public, anon;
revoke all on function s24_whatsapp(text) from public, anon;

-- ---------- Catálogo de serviços ----------
create table if not exists service_catalog (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references parishes(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and length(code) <= 40),
  title text not null check (length(trim(title)) between 2 and 120),
  description text check (length(description) <= 1000),
  instructions text check (length(instructions) <= 4000),
  form_fields jsonb not null default '[]'::jsonb check (s24_fields_ok(form_fields)),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parish_id, code),
  unique (id, parish_id) -- permite exigir que a solicitação aponte para serviço da mesma paróquia
);
create index if not exists service_catalog_parish_idx on service_catalog (parish_id, active, sort_order);

-- ---------- Solicitações ----------
-- Protocolo SA-AAAA-XXXXXXXX (8 hex aleatórios = 32 bits). Consultar exige protocolo + WhatsApp.
create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references parishes(id) on delete cascade,
  service_id uuid not null,
  protocol text unique not null check (protocol ~ '^SA-[0-9]{4}-[0-9A-F]{8}$'),
  requester_name text not null check (length(trim(requester_name)) between 2 and 120),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,11}$'),
  contact_preference text not null default 'whatsapp' check (contact_preference in ('whatsapp','ligacao','qualquer')),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 20000),
  status text not null default 'new' check (status in ('new','in_progress','waiting_user','completed','closed')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, parish_id), -- permite exigir que o histórico seja da mesma paróquia
  constraint service_requests_service_same_parish foreign key (service_id, parish_id) references service_catalog (id, parish_id)
);
create index if not exists service_requests_parish_idx on service_requests (parish_id, status, created_at desc);
create index if not exists service_requests_dedup_idx on service_requests (parish_id, service_id, whatsapp, created_at desc);

-- ---------- Histórico ----------
-- public_note = true: aparece para o fiel no acompanhamento. false: nota interna da equipe.
-- A FK composta (request_id, parish_id) garante a mesma paróquia e apaga junto com a solicitação.
create table if not exists service_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  parish_id uuid not null references parishes(id) on delete cascade,
  status text not null check (status in ('new','in_progress','waiting_user','completed','closed')),
  note text check (length(note) <= 1000),
  public_note boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint service_request_history_same_parish foreign key (request_id, parish_id) references service_requests (id, parish_id) on delete cascade
);
create index if not exists service_request_history_request_idx on service_request_history (request_id, created_at);

drop trigger if exists trg_touch_service_catalog on service_catalog;
create trigger trg_touch_service_catalog before update on service_catalog for each row execute function touch_updated_at();
drop trigger if exists trg_touch_service_requests on service_requests;
create trigger trg_touch_service_requests before update on service_requests for each row execute function touch_updated_at();

-- ---------- RLS ----------
-- Visitante (anon): nada direto. Equipe: só leitura, só da própria paróquia, só com a área
-- 'secretaria24h' (padre, secretaria, suporte; PASCOM não). Toda escrita passa pelas funções.
-- O catálogo é mantido pelo SQL Editor (dono do projeto).
alter table service_catalog enable row level security;
alter table service_requests enable row level security;
alter table service_request_history enable row level security;

revoke all on service_catalog, service_requests, service_request_history from anon;
revoke all on service_catalog, service_requests, service_request_history from authenticated;
grant select on service_catalog, service_requests, service_request_history to authenticated;

drop policy if exists "equipe le catalogo da secretaria" on service_catalog;
create policy "equipe le catalogo da secretaria" on service_catalog
  for select to authenticated using (can_access(parish_id, 'secretaria24h'));
drop policy if exists "equipe le solicitacoes" on service_requests;
create policy "equipe le solicitacoes" on service_requests
  for select to authenticated using (can_access(parish_id, 'secretaria24h'));
drop policy if exists "equipe le historico das solicitacoes" on service_request_history;
create policy "equipe le historico das solicitacoes" on service_request_history
  for select to authenticated using (can_access(parish_id, 'secretaria24h'));

-- ---------- Público: catálogo ----------
-- Só serviços ativos e só os campos que a página precisa (sem ids).
create or replace function public_service_catalog(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', sc.code, 'title', sc.title, 'description', sc.description,
      'instructions', sc.instructions, 'form_fields', sc.form_fields, 'sort_order', sc.sort_order
    ) order by sc.sort_order, sc.title)
    from service_catalog sc
    join parishes p on p.id = sc.parish_id
    where p.slug = p_slug and p.active and sc.active
  ), '[]'::jsonb);
$$;

revoke all on function public_service_catalog(text) from public;
grant execute on function public_service_catalog(text) to anon, authenticated;

-- ---------- Público: nova solicitação ----------
-- Valida tudo no servidor (não confia no JavaScript). Cria a solicitação e o primeiro
-- histórico na mesma transação. Devolve só {protocol, status, created_at}.
-- Envio repetido (mesmo serviço + WhatsApp, ainda "new", até 5 min): devolve o protocolo
-- que já existe, sem criar outro. Contra abuso: no máximo 5 por WhatsApp e 120 por paróquia
-- por hora. Erros saem como exceção com mensagem 's24:<motivo>' (o front-end traduz).
create or replace function public_create_service_request(
  p_slug text,
  p_service_code text,
  p_name text,
  p_whatsapp text,
  p_contact_preference text,
  p_answers jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_sid uuid;
  v_fields jsonb;
  v_is_demo boolean := false;
  v_name text;
  v_wa text;
  v_pref text;
  v_ans jsonb := '{}'::jsonb;
  f jsonb;
  v_key text;
  v_val text;
  v_max int;
  v_prev service_requests%rowtype;
  v_new service_requests%rowtype;
  v_proto text;
  i int;
begin
  select id into v_pid from parishes where slug = p_slug and active;
  if v_pid is null then
    raise exception 's24:servico_indisponivel' using errcode = '22023';
  end if;
  select id, form_fields, code like 'demo_%' into v_sid, v_fields, v_is_demo
    from service_catalog where parish_id = v_pid and code = p_service_code and active;
  if v_sid is null then
    raise exception 's24:servico_indisponivel' using errcode = '22023';
  end if;

  v_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if length(v_name) not between 2 and 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 's24:nome_invalido' using errcode = '22023';
  end if;
  v_wa := s24_whatsapp(p_whatsapp);
  if v_wa is null then
    raise exception 's24:whatsapp_invalido' using errcode = '22023';
  end if;
  v_pref := coalesce(nullif(p_contact_preference, ''), 'whatsapp');
  if v_pref not in ('whatsapp','ligacao','qualquer') then
    raise exception 's24:dados_invalidos' using errcode = '22023';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object'
     or pg_column_size(p_answers) > 16000
     or (select count(*) from jsonb_object_keys(p_answers)) > 40 then
    raise exception 's24:dados_invalidos' using errcode = '22023';
  end if;

  -- Só guarda as respostas dos campos do serviço (chaves desconhecidas são descartadas).
  for f in select value from jsonb_array_elements(v_fields) loop
    v_key := f->>'name';
    if p_answers ? v_key and jsonb_typeof(p_answers->v_key) not in ('string','null') then
      raise exception 's24:dados_invalidos' using errcode = '22023';
    end if;
    v_val := trim(coalesce(p_answers->>v_key, ''));
    v_max := case f->>'type' when 'textarea' then 2000 when 'date' then 10 else 200 end;
    if length(v_val) > v_max
       or (f->>'type' = 'textarea' and v_val ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]')
       or (f->>'type' <> 'textarea' and v_val ~ '[[:cntrl:]]') then
      raise exception 's24:dados_invalidos' using errcode = '22023';
    end if;
    if v_val = '' then
      if coalesce((f->>'required')::boolean, false) then
        raise exception 's24:campo_obrigatorio' using errcode = '22023';
      end if;
      continue;
    end if;
    if f->>'type' = 'date' then
      if v_val !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 's24:dados_invalidos' using errcode = '22023';
      end if;
      begin
        if extract(year from v_val::date) not between 1900 and 2100 then
          raise exception 's24:dados_invalidos' using errcode = '22023';
        end if;
      exception when others then
        raise exception 's24:dados_invalidos' using errcode = '22023';
      end;
    elsif f->>'type' = 'select' then
      if not ((f->'options') ? v_val) then
        raise exception 's24:dados_invalidos' using errcode = '22023';
      end if;
    end if;
    v_ans := v_ans || jsonb_build_object(v_key, v_val);
  end loop;

  -- Duplo clique / internet ruim: serializa envios do mesmo serviço + WhatsApp.
  perform pg_advisory_xact_lock(hashtextextended('s24:' || v_pid::text || ':' || v_sid::text || ':' || v_wa, 0));
  select * into v_prev from service_requests
   where parish_id = v_pid and service_id = v_sid and whatsapp = v_wa
     and status = 'new' and created_at > now() - interval '5 minutes'
   order by created_at desc limit 1;
  if v_prev.id is not null then
    return jsonb_build_object('protocol', v_prev.protocol, 'status', v_prev.status, 'created_at', v_prev.created_at);
  end if;

  if (select count(*) from service_requests where parish_id = v_pid and whatsapp = v_wa and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from service_requests where parish_id = v_pid and created_at > now() - interval '1 hour') >= 120 then
    raise exception 's24:limite' using errcode = '22023';
  end if;

  for i in 1..5 loop
    v_proto := 'SA-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-'
               || upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
    begin
      insert into service_requests (parish_id, service_id, protocol, requester_name, whatsapp, contact_preference, answers, is_demo)
      values (v_pid, v_sid, v_proto, v_name, v_wa, v_pref, v_ans, v_is_demo)
      returning * into v_new;
      exit;
    exception when unique_violation then
      if i = 5 then
        raise;
      end if;
    end;
  end loop;

  insert into service_request_history (request_id, parish_id, status, note, public_note, created_by, created_at)
  values (v_new.id, v_pid, 'new', 'Solicitação recebida.', true, null, v_new.created_at);

  return jsonb_build_object('protocol', v_new.protocol, 'status', v_new.status, 'created_at', v_new.created_at);
end;
$$;

revoke all on function public_create_service_request(text, text, text, text, text, jsonb) from public;
grant execute on function public_create_service_request(text, text, text, text, text, jsonb) to anon, authenticated;

-- ---------- Público: acompanhar solicitação (sem login) ----------
-- Exige protocolo + WhatsApp informado. Se não baterem, devolve NULL (não diz se o
-- protocolo existe). Nunca devolve ids, respostas, nome, notas internas ou quem alterou.
create or replace function public_get_service_request(p_slug text, p_protocol text, p_whatsapp text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_wa text;
  v_proto text;
  r record;
begin
  select id into v_pid from parishes where slug = p_slug and active;
  v_wa := s24_whatsapp(p_whatsapp);
  v_proto := upper(regexp_replace(coalesce(p_protocol, ''), '\s', '', 'g'));
  if v_pid is null or v_wa is null or v_proto !~ '^SA-[0-9]{4}-[0-9A-F]{8}$' then
    return null;
  end if;

  select sr.id, sr.protocol, sr.status, sr.created_at, sr.updated_at, sc.title into r
    from service_requests sr
    join service_catalog sc on sc.id = sr.service_id
   where sr.parish_id = v_pid and sr.protocol = v_proto and sr.whatsapp = v_wa;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'protocol', r.protocol,
    'service_title', r.title,
    'status', r.status,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('status', h.status, 'note', h.note, 'created_at', h.created_at) order by h.created_at)
      from service_request_history h
      where h.request_id = r.id and h.public_note
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public_get_service_request(text, text, text) from public;
grant execute on function public_get_service_request(text, text, text) to anon, authenticated;

-- ---------- Equipe: alterar status / registrar nota ----------
-- Status e histórico na mesma transação. Só estados da lista; só quem tem 'secretaria24h'
-- na paróquia da solicitação. Nunca envia WhatsApp (isso é sempre um toque da equipe).
-- Mudança de status com nota INTERNA gera duas linhas: a mudança de status (pública, sem
-- texto, para o fiel ver a linha do tempo) e a nota interna (não aparece para o fiel).
create or replace function staff_update_service_request(
  p_request uuid,
  p_status text,
  p_note text,
  p_public_note boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r service_requests%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_pub boolean := coalesce(p_public_note, false);
  v_mudou boolean;
begin
  select * into r from service_requests where id = p_request for update;
  if r.id is null or not can_access(r.parish_id, 'secretaria24h') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('new','in_progress','waiting_user','completed','closed') then
    raise exception 's24:status_invalido' using errcode = '22023';
  end if;
  if length(v_note) > 1000 then
    raise exception 's24:nota_longa' using errcode = '22023';
  end if;
  v_mudou := p_status <> r.status;
  if not v_mudou and v_note is null then
    raise exception 's24:nada_alterado' using errcode = '22023';
  end if;

  if v_mudou and v_note is not null and not v_pub then
    insert into service_request_history (request_id, parish_id, status, note, public_note, created_by, created_at)
    values (r.id, r.parish_id, p_status, null, true, auth.uid(), clock_timestamp());
    insert into service_request_history (request_id, parish_id, status, note, public_note, created_by, created_at)
    values (r.id, r.parish_id, p_status, v_note, false, auth.uid(), clock_timestamp());
  else
    insert into service_request_history (request_id, parish_id, status, note, public_note, created_by, created_at)
    values (r.id, r.parish_id, p_status, v_note, v_note is null or v_pub, auth.uid(), clock_timestamp());
  end if;

  -- Nota só interna não mexe em updated_at (o fiel não vê "atualizado" sem nada novo).
  if v_mudou or v_pub then
    update service_requests set status = p_status where id = r.id;
  end if;

  return jsonb_build_object('status', p_status);
end;
$$;

revoke all on function staff_update_service_request(uuid, text, text, boolean) from public, anon;
grant execute on function staff_update_service_request(uuid, text, text, boolean) to authenticated;

-- ---------- Catálogo inicial da paróquia piloto ----------
-- Só insere o serviço que ainda não existe (pelo code). Rodar de novo não duplica
-- nem sobrescreve textos que a paróquia já tenha ajustado.
-- Intenção de Missa e "Quero ser dizimista" NÃO entram aqui: já têm fluxo próprio.
insert into service_catalog (parish_id, code, title, description, instructions, form_fields, sort_order)
select p.id, v.code, v.title, v.description, v.instructions, v.form_fields::jsonb, v.sort_order
from parishes p
cross join (values
  ('certidao', 'Certidão / documento paroquial',
   'Solicite informações ou segunda via de documentos emitidos pela paróquia.',
   'Informe os dados que souber para a secretaria localizar o registro nos livros da paróquia. Não é preciso enviar documentos agora: a equipe entra em contato para combinar a retirada.',
   '[{"name":"tipo_documento","label":"Tipo de documento","type":"select","required":true,"options":["Certidão de Batismo","Certidão de Crisma","Certidão de Matrimônio","Outro"]},
     {"name":"nome_pessoa","label":"Nome completo da pessoa","type":"text","required":true},
     {"name":"data_sacramento","label":"Data aproximada do sacramento","type":"text","hint":"Pode ser só o ano ou o mês e o ano."},
     {"name":"nome_pais","label":"Nome dos pais","type":"text"},
     {"name":"local","label":"Comunidade/igreja onde ocorreu","type":"text"},
     {"name":"observacoes","label":"Observações","type":"textarea"}]',
   10),
  ('batismo', 'Batismo',
   'Receba as primeiras orientações para preparação e realização do Batismo.',
   'A secretaria entra em contato para explicar a preparação, os documentos necessários e as datas disponíveis.',
   '[{"name":"nome_pessoa","label":"Nome da criança/pessoa","type":"text","required":true},
     {"name":"data_nascimento","label":"Data de nascimento","type":"date"},
     {"name":"nome_responsaveis","label":"Nome dos responsáveis","type":"text"},
     {"name":"data_desejada","label":"Data desejada","type":"date"},
     {"name":"comunidade","label":"Comunidade desejada","type":"text"},
     {"name":"observacoes","label":"Observações","type":"textarea"}]',
   20),
  ('matrimonio', 'Matrimônio',
   'Receba as orientações iniciais para a preparação e o agendamento do casamento.',
   'A secretaria entra em contato para explicar a preparação, os documentos necessários e a disponibilidade de datas. A data só fica reservada depois da confirmação da paróquia.',
   '[{"name":"nome_noivo","label":"Nome do noivo","type":"text","required":true},
     {"name":"nome_noiva","label":"Nome da noiva","type":"text","required":true},
     {"name":"data_desejada","label":"Data desejada","type":"date"},
     {"name":"comunidade","label":"Comunidade/igreja","type":"text"},
     {"name":"observacoes","label":"Observações","type":"textarea"}]',
   30),
  ('catequese', 'Catequese',
   'Informações e inscrição para a catequese.',
   'A secretaria entra em contato com as informações de turmas, horários e documentos.',
   '[{"name":"nome_catequizando","label":"Nome do catequizando","type":"text","required":true},
     {"name":"data_nascimento","label":"Data de nascimento","type":"date"},
     {"name":"nome_responsavel","label":"Nome do responsável","type":"text"},
     {"name":"comunidade","label":"Comunidade","type":"text"},
     {"name":"observacoes","label":"Observações","type":"textarea"}]',
   40),
  ('atendimento_padre', 'Atendimento com o padre',
   'Solicite contato ou orientação para agendamento de atendimento pastoral.',
   'Conte em poucas palavras o assunto. A secretaria entra em contato para combinar o melhor horário. Não escreva aqui nada que seja assunto de confissão.',
   '[{"name":"assunto","label":"Assunto","type":"text","required":true},
     {"name":"melhor_periodo","label":"Melhor período para contato","type":"select","options":["Manhã","Tarde","Noite","Qualquer horário"]},
     {"name":"observacoes","label":"Observações","type":"textarea"}]',
   50),
  ('outro', 'Outro assunto',
   'Envie sua dúvida ou pedido para a secretaria.',
   'Escreva como podemos ajudar. A secretaria responde no horário de atendimento.',
   '[{"name":"mensagem","label":"Como podemos ajudar?","type":"textarea","required":true}]',
   60)
) as v(code, title, description, instructions, form_fields, sort_order)
where p.slug = 'santo-antonio-jaragua'
on conflict (parish_id, code) do nothing;
-- <<< SECRETARIA 24H: fim da estrutura <<<

-- ---------- Conferência ----------
select code, title, active, sort_order, jsonb_array_length(form_fields) as campos
from service_catalog
where parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
order by sort_order;
