-- Central Paroquial — esquema mínimo para o piloto multiusuário.
-- Rode este script inteiro no SQL Editor do Supabase (projeto do piloto).
-- O estado original da paróquia continua guardado como um JSON só (coluna
-- "data"), igual ao objeto S do protótipo. A partir do MVP 2, comunidades,
-- agenda, dizimistas, interessados e o acompanhamento mensal do dízimo ficam
-- em tabelas próprias (mais abaixo).
-- Seguro para rodar de novo: não há DROP TABLE, TRUNCATE nem DELETE.

create extension if not exists pgcrypto;

create table if not exists parishes (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists parish_users (
  user_id uuid not null references auth.users(id) on delete cascade,
  parish_id uuid not null references parishes(id) on delete cascade,
  role text not null check (role in ('padre','secretaria','pascom','admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, parish_id)
);

create table if not exists parish_state (
  parish_id uuid primary key references parishes(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Mantém updated_at correto sem depender do front-end
create or replace function touch_parish_state() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_parish_state on parish_state;
create trigger trg_touch_parish_state
  before update on parish_state
  for each row execute function touch_parish_state();

-- ---------- Row Level Security ----------
-- Ninguém acessa estas três tabelas direto de fora do backend, exceto
-- os próprios membros autenticados da paróquia. O visitante público
-- (sem login) só enxerga dados pela função get_public_parish() abaixo,
-- que devolve apenas o que é seguro mostrar (nunca pessoas, dizimistas,
-- intenções ou o log de uso).

alter table parishes enable row level security;
alter table parish_users enable row level security;
alter table parish_state enable row level security;

-- Visitante sem login não tem nenhum acesso direto às tabelas
-- (só pelas funções get_public_parish e public_submit abaixo).
revoke all on parishes, parish_users, parish_state from anon;
-- Usuário logado só lê/atualiza; criar e apagar paróquias, vínculos e
-- estados é feito pelo SQL Editor (dono do projeto).
revoke all on parishes, parish_users, parish_state from authenticated;
grant select on parishes, parish_users to authenticated;
grant select, update (data) on parish_state to authenticated;

drop policy if exists "membro ve sua paroquia" on parishes;
create policy "membro ve sua paroquia" on parishes
  for select using (
    exists (select 1 from parish_users pu where pu.parish_id = parishes.id and pu.user_id = auth.uid())
  );

drop policy if exists "usuario ve seu proprio vinculo" on parish_users;
create policy "usuario ve seu proprio vinculo" on parish_users
  for select using (user_id = auth.uid());

drop policy if exists "membro le o estado da sua paroquia" on parish_state;
create policy "membro le o estado da sua paroquia" on parish_state
  for select using (
    exists (select 1 from parish_users pu where pu.parish_id = parish_state.parish_id and pu.user_id = auth.uid())
  );

drop policy if exists "membro atualiza o estado da sua paroquia" on parish_state;
create policy "membro atualiza o estado da sua paroquia" on parish_state
  for update using (
    exists (select 1 from parish_users pu where pu.parish_id = parish_state.parish_id and pu.user_id = auth.uid())
  ) with check (
    exists (select 1 from parish_users pu where pu.parish_id = parish_state.parish_id and pu.user_id = auth.uid())
  );

-- =========================================================
-- MVP 2: comunidades, agenda, dizimistas e interessados.
-- Tabelas normalizadas, ao lado do parish_state (que continua igual).
-- Só cria o que ainda não existe: rodar de novo não apaga nada.
-- =========================================================

-- ---------- Permissões por papel ----------
-- Um lugar só para a matriz de acesso. Hoje padre e secretaria fazem tudo;
-- PASCOM cuida da comunicação (avisos, agenda, comunidades) e não lê dados
-- pessoais de dizimistas. Para mudar a matriz, altere só can_access().
create or replace function is_parish_member(p_parish uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from parish_users where parish_id = p_parish and user_id = auth.uid());
$$;

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

revoke all on function is_parish_member(uuid) from public, anon;
revoke all on function can_access(uuid, text) from public, anon;
grant execute on function is_parish_member(uuid) to authenticated;
grant execute on function can_access(uuid, text) to authenticated;

-- ---------- Equipe da paróquia ----------
-- Leitura mínima da equipe vinculada à própria paróquia.
-- Não expõe auth.users inteiro: só nome público (quando houver), e-mail,
-- papel pastoral/administrativo e um status simples.
create or replace function staff_list_parish_team(p_parish uuid)
returns table (
  display_name text,
  email text,
  role text,
  active boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    null::text as display_name,
    u.email::text as email,
    pu.role::text as role,
    true as active
  from parish_users pu
  join auth.users u on u.id = pu.user_id
  where pu.parish_id = p_parish
    and exists (
      select 1
      from parish_users me
      where me.parish_id = p_parish
        and me.user_id = auth.uid()
        and me.role in ('padre', 'secretaria', 'admin')
    )
  order by
    case pu.role when 'padre' then 1 when 'secretaria' then 2 when 'pascom' then 3 when 'admin' then 4 else 9 end,
    u.email;
$$;

revoke all on function staff_list_parish_team(uuid) from public, anon;
grant execute on function staff_list_parish_team(uuid) to authenticated;

create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Comunidades ----------
create table if not exists communities (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references parishes(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  patron text check (length(patron) <= 120),
  address text check (length(address) <= 300),
  phone text check (length(phone) <= 40),
  description text check (length(description) <= 4000),
  photo_url text check (photo_url ~* '^https://'),
  mass_schedule text check (length(mass_schedule) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parish_id, slug),
  unique (id, parish_id) -- permite exigir que evento/dizimista aponte para comunidade da mesma paróquia
);
create index if not exists communities_parish_idx on communities (parish_id, active);

-- ---------- Agenda (eventos) ----------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references parishes(id) on delete cascade,
  community_id uuid,
  title text not null check (length(trim(title)) between 2 and 160),
  description text not null default '' check (length(description) <= 4000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '' check (length(location) <= 200),
  scope text not null default 'parish' check (scope in ('parish','community')),
  public boolean not null default true,
  highlight_home boolean not null default false,
  image_url text check (image_url ~* '^https://'),          -- pronto para folder no Supabase Storage
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  google_event_id text,                                     -- futura sincronização com o Google Agenda da paróquia
  cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_scope_community check ((scope = 'parish' and community_id is null) or (scope = 'community' and community_id is not null)),
  constraint events_ends_after_start check (ends_at is null or ends_at >= starts_at),
  constraint events_community_same_parish foreign key (community_id, parish_id) references communities (id, parish_id)
);
create index if not exists events_parish_starts_idx on events (parish_id, starts_at);

-- ---------- Dizimistas (relacionamento pastoral; sem valores nem dados financeiros) ----------
create table if not exists tither_profiles (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references parishes(id) on delete cascade,
  community_id uuid,
  name text not null check (length(trim(name)) between 2 and 120),
  whatsapp text not null default '' check (whatsapp ~ '^[0-9]{0,15}$'),
  birth_date date,
  marriage_date date,
  joined_on date,
  status text not null default 'active' check (status in ('active','inactive')),
  consent boolean not null default false,
  notes text check (length(notes) <= 2000),                 -- observação pastoral: nunca pública
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tither_profiles_community_same_parish foreign key (community_id, parish_id) references communities (id, parish_id)
);
create index if not exists tither_profiles_parish_idx on tither_profiles (parish_id, status);
create index if not exists tither_profiles_whatsapp_idx on tither_profiles (parish_id, whatsapp);

-- ---------- "Quero ser dizimista" (interessados vindos da página pública) ----------
create table if not exists tither_leads (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references parishes(id) on delete cascade,
  community_id uuid,
  name text not null check (length(trim(name)) between 2 and 120),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,13}$'),
  contact_preference text not null default 'whatsapp' check (contact_preference in ('whatsapp','ligacao','qualquer')),
  consent boolean not null check (consent),
  status text not null default 'new' check (status in ('new','contacted','converted','closed')),
  tither_id uuid references tither_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tither_leads_community_same_parish foreign key (community_id, parish_id) references communities (id, parish_id)
);
create index if not exists tither_leads_parish_idx on tither_leads (parish_id, status, created_at desc);

drop trigger if exists trg_touch_communities on communities;
create trigger trg_touch_communities before update on communities for each row execute function touch_updated_at();
drop trigger if exists trg_touch_events on events;
create trigger trg_touch_events before update on events for each row execute function touch_updated_at();
drop trigger if exists trg_touch_tither_profiles on tither_profiles;
create trigger trg_touch_tither_profiles before update on tither_profiles for each row execute function touch_updated_at();
drop trigger if exists trg_touch_tither_leads on tither_leads;
create trigger trg_touch_tither_leads before update on tither_leads for each row execute function touch_updated_at();

-- ---------- RLS das tabelas novas ----------
-- Visitante sem login: nenhum acesso direto (a página pública usa get_public_parish
-- e public_tither_interest). Membro logado: só a própria paróquia, conforme can_access().
alter table communities enable row level security;
alter table events enable row level security;
alter table tither_profiles enable row level security;
alter table tither_leads enable row level security;

revoke all on communities, events, tither_profiles, tither_leads from anon;
revoke all on communities, events, tither_profiles, tither_leads from authenticated;
grant select, insert, update on communities to authenticated;           -- sem delete: comunidade é desativada
grant select, insert, update, delete on events to authenticated;        -- delete só para evento cancelado (regra da tela)
grant select, insert, update, delete on tither_profiles to authenticated;
grant select, delete on tither_leads to authenticated;                  -- entrada só pela função pública
grant update (status) on tither_leads to authenticated;

drop policy if exists "membro le comunidades" on communities;
create policy "membro le comunidades" on communities
  for select to authenticated using (is_parish_member(parish_id));
drop policy if exists "equipe cria comunidades" on communities;
create policy "equipe cria comunidades" on communities
  for insert to authenticated with check (can_access(parish_id, 'comunidades'));
drop policy if exists "equipe altera comunidades" on communities;
create policy "equipe altera comunidades" on communities
  for update to authenticated using (can_access(parish_id, 'comunidades')) with check (can_access(parish_id, 'comunidades'));

drop policy if exists "membro le eventos" on events;
create policy "membro le eventos" on events
  for select to authenticated using (is_parish_member(parish_id));
drop policy if exists "equipe cria eventos" on events;
create policy "equipe cria eventos" on events
  for insert to authenticated with check (can_access(parish_id, 'agenda'));
drop policy if exists "equipe altera eventos" on events;
create policy "equipe altera eventos" on events
  for update to authenticated using (can_access(parish_id, 'agenda')) with check (can_access(parish_id, 'agenda'));
drop policy if exists "equipe exclui eventos" on events;
create policy "equipe exclui eventos" on events
  for delete to authenticated using (can_access(parish_id, 'agenda'));

drop policy if exists "equipe le dizimistas" on tither_profiles;
create policy "equipe le dizimistas" on tither_profiles
  for select to authenticated using (can_access(parish_id, 'dizimistas'));
drop policy if exists "equipe cria dizimistas" on tither_profiles;
create policy "equipe cria dizimistas" on tither_profiles
  for insert to authenticated with check (can_access(parish_id, 'dizimistas'));
drop policy if exists "equipe altera dizimistas" on tither_profiles;
create policy "equipe altera dizimistas" on tither_profiles
  for update to authenticated using (can_access(parish_id, 'dizimistas')) with check (can_access(parish_id, 'dizimistas'));
drop policy if exists "equipe exclui dizimistas" on tither_profiles;
create policy "equipe exclui dizimistas" on tither_profiles
  for delete to authenticated using (can_access(parish_id, 'dizimistas'));

drop policy if exists "equipe le interessados" on tither_leads;
create policy "equipe le interessados" on tither_leads
  for select to authenticated using (can_access(parish_id, 'dizimistas'));
drop policy if exists "equipe altera interessados" on tither_leads;
create policy "equipe altera interessados" on tither_leads
  for update to authenticated using (can_access(parish_id, 'dizimistas')) with check (can_access(parish_id, 'dizimistas'));
drop policy if exists "equipe exclui interessados" on tither_leads;
create policy "equipe exclui interessados" on tither_leads
  for delete to authenticated using (can_access(parish_id, 'dizimistas'));

-- ---------- Acompanhamento mensal do dízimo ----------
-- Uma linha = "contribuição do mês registrada" para um dizimista. Sem linha = ainda não
-- registrada (nada de "pendente" gravado). Sem valores em dinheiro nesta etapa.
-- reference_month é sempre o 1º dia do mês (ex.: 2026-09-01).

-- Permite exigir que a contribuição aponte para um dizimista da mesma paróquia.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tither_profiles_id_parish_key' and conrelid = 'tither_profiles'::regclass) then
    alter table tither_profiles add constraint tither_profiles_id_parish_key unique (id, parish_id);
  end if;
end;
$$;

create table if not exists tither_contributions (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references parishes(id) on delete cascade,
  tither_id uuid not null,
  reference_month date not null check (reference_month = date_trunc('month', reference_month)::date),
  received_at timestamptz,
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tither_contributions_one_per_month unique (tither_id, reference_month),
  constraint tither_contributions_same_parish foreign key (tither_id, parish_id) references tither_profiles (id, parish_id) on delete cascade
);
create index if not exists tither_contributions_parish_month_idx on tither_contributions (parish_id, reference_month);

drop trigger if exists trg_touch_tither_contributions on tither_contributions;
create trigger trg_touch_tither_contributions before update on tither_contributions for each row execute function touch_updated_at();

-- Só padre, secretaria e suporte (área 'dizimistas' de can_access). PASCOM e visitante: nada.
alter table tither_contributions enable row level security;
revoke all on tither_contributions from anon;
revoke all on tither_contributions from authenticated;
grant select, insert, update, delete on tither_contributions to authenticated;

drop policy if exists "equipe le contribuicoes" on tither_contributions;
create policy "equipe le contribuicoes" on tither_contributions
  for select to authenticated using (can_access(parish_id, 'dizimistas'));
drop policy if exists "equipe registra contribuicoes" on tither_contributions;
create policy "equipe registra contribuicoes" on tither_contributions
  for insert to authenticated with check (can_access(parish_id, 'dizimistas'));
drop policy if exists "equipe corrige contribuicoes" on tither_contributions;
create policy "equipe corrige contribuicoes" on tither_contributions
  for update to authenticated using (can_access(parish_id, 'dizimistas')) with check (can_access(parish_id, 'dizimistas'));
drop policy if exists "equipe remove contribuicoes" on tither_contributions;
create policy "equipe remove contribuicoes" on tither_contributions
  for delete to authenticated using (can_access(parish_id, 'dizimistas'));

-- ---------- Converter interessado em dizimista (painel) ----------
-- Numa transação só: cria o cadastro (ou reaproveita o do mesmo WhatsApp)
-- e marca o interessado como convertido.
create or replace function convert_tither_lead(p_lead uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  l tither_leads%rowtype;
  v_id uuid;
begin
  select * into l from tither_leads where id = p_lead for update;
  if l.id is null or not can_access(l.parish_id, 'dizimistas') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  v_id := l.tither_id;
  if v_id is null then
    select id into v_id from tither_profiles
     where parish_id = l.parish_id and whatsapp = l.whatsapp
     order by created_at limit 1;
  end if;
  if v_id is null then
    insert into tither_profiles (parish_id, community_id, name, whatsapp, joined_on, status, consent)
    values (l.parish_id, l.community_id, l.name, l.whatsapp, (now() at time zone 'America/Sao_Paulo')::date, 'active', l.consent)
    returning id into v_id;
  else
    update tither_profiles set status = 'active' where id = v_id;
  end if;
  update tither_leads set status = 'converted', tither_id = v_id where id = l.id;
  return v_id;
end;
$$;

revoke all on function convert_tither_lead(uuid) from public, anon;
grant execute on function convert_tither_lead(uuid) to authenticated;

-- ---------- Leitura pública (página do fiel, sem login) ----------
-- security definer: ignora RLS por dentro, mas só devolve os campos
-- que já eram públicos na página (avisos, dados da paróquia, horários,
-- quantidade de velas), mais as comunidades ativas e os eventos públicos
-- não cancelados. Nunca devolve pessoas, dizimistas, interessados,
-- intenções, pedidos da vela ou log.
create or replace function get_public_parish(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name', p.name,
    'slug', p.slug,
    'cfg', coalesce(ps.data->'cfg', '{}'::jsonb),
    'avisos', coalesce(ps.data->'avisos', '[]'::jsonb),
    'velasHoje', (
      select count(*) from jsonb_array_elements(coalesce(ps.data->'velas', '[]'::jsonb)) v
      where (v->>'ts')::bigint > (extract(epoch from now()) * 1000 - 86400000)
    ),
    'communities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug, 'patron', c.patron, 'address', c.address,
        'phone', c.phone, 'description', c.description, 'photo_url', c.photo_url, 'mass_schedule', c.mass_schedule
      ) order by c.name)
      from communities c where c.parish_id = p.id and c.active
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'community_id', e.community_id, 'scope', e.scope, 'title', e.title, 'description', e.description,
        'starts_at', e.starts_at, 'ends_at', e.ends_at, 'location', e.location,
        'highlight_home', e.highlight_home, 'image_url', e.image_url
      ) order by e.starts_at)
      from (
        select ev.* from events ev
        left join communities c on c.id = ev.community_id
        where ev.parish_id = p.id and ev.public and not ev.cancelled
          and (ev.community_id is null or c.active)
          and coalesce(ev.ends_at, ev.starts_at) >= now() - interval '6 hours'
        order by ev.starts_at
        limit 100
      ) e
    ), '[]'::jsonb)
  )
  from parishes p
  join parish_state ps on ps.parish_id = p.id
  where p.slug = p_slug and p.active = true;
$$;

revoke all on function get_public_parish(text) from public;
grant execute on function get_public_parish(text) to anon, authenticated;

-- ---------- Envio público (fiel sem login) ----------
-- A página pública deixa o fiel pedir intenção de missa e acender vela.
-- Esta função é o ÚNICO caminho de escrita sem login: acrescenta um item
-- validado (campos fixos, tamanho limitado) à lista da paróquia. O visitante
-- não consegue ler nem alterar nada além disso.
create or replace function public_submit(p_slug text, p_kind text, p_item jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_key text;
  v_cap int;
  v_item jsonb;
  v_ts bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  v_id bigint := floor(extract(epoch from clock_timestamp()) * 1000) * 1000 + floor(random() * 1000);
begin
  select id into v_pid from parishes where slug = p_slug and active = true;
  if v_pid is null or p_item is null or jsonb_typeof(p_item) <> 'object' then
    return false;
  end if;

  if p_kind = 'intencao' then
    if coalesce(p_item->>'tipo','') not in ('gracas','falecidos','saude','aniversario','outra')
       or coalesce(p_item->>'data','') !~ '^\d{4}-\d{2}-\d{2}$'
       or length(trim(coalesce(p_item->>'por',''))) = 0
       or length(trim(coalesce(p_item->>'nome',''))) = 0 then
      return false;
    end if;
    v_key := 'intencoes'; v_cap := 1000;
    v_item := jsonb_build_object(
      'id', v_id, 'ts', v_ts,
      'tipo', p_item->>'tipo',
      'por', left(trim(p_item->>'por'), 200),
      'data', p_item->>'data',
      'hora', left(trim(coalesce(p_item->>'hora','')), 10),
      'nome', left(trim(p_item->>'nome'), 100),
      'whats', left(regexp_replace(coalesce(p_item->>'whats',''), '\D', '', 'g'), 15),
      'status', 'nova');
  elsif p_kind = 'vela' then
    if coalesce(p_item->>'para','') not in ('mim','alguem','almas','gracas') then
      return false;
    end if;
    v_key := 'velas'; v_cap := 2000;
    v_item := jsonb_build_object(
      'id', v_id, 'ts', v_ts,
      'para', p_item->>'para',
      'por', left(trim(coalesce(p_item->>'por','')), 100),
      'pedido', left(trim(coalesce(p_item->>'pedido','')), 500),
      'nome', left(trim(coalesce(p_item->>'nome','')), 100),
      'rezar', coalesce((p_item->>'rezar')::boolean, false));
  else
    return false;
  end if;

  update parish_state
     set data = jsonb_set(data, array[v_key], coalesce(data->v_key, '[]'::jsonb) || jsonb_build_array(v_item))
   where parish_id = v_pid
     and jsonb_array_length(coalesce(data->v_key, '[]'::jsonb)) < v_cap
     and pg_column_size(data) < 5000000;
  return found;
end;
$$;

revoke all on function public_submit(text, text, jsonb) from public;
grant execute on function public_submit(text, text, jsonb) to anon, authenticated;

-- ---------- "Quero ser dizimista" (fiel sem login) ----------
-- Único caminho de entrada em tither_leads. Valida nome, WhatsApp, comunidade
-- (ativa e da mesma paróquia) e consentimento. Contra abuso: o mesmo WhatsApp
-- aguardando contato não gera outro registro, e cada paróquia aceita no máximo
-- 30 interessados por hora. Não devolve nada além de true/false.
create or replace function public_tither_interest(p_slug text, p_item jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_com uuid;
  v_name text;
  v_wa text;
  v_pref text;
begin
  select id into v_pid from parishes where slug = p_slug and active = true;
  if v_pid is null or p_item is null or jsonb_typeof(p_item) <> 'object' then
    return false;
  end if;

  v_name := left(regexp_replace(trim(coalesce(p_item->>'name','')), '\s+', ' ', 'g'), 120);
  v_wa := regexp_replace(coalesce(p_item->>'whatsapp',''), '\D', '', 'g');
  v_pref := coalesce(nullif(p_item->>'contact_preference',''), 'whatsapp');
  if length(v_name) < 2 or length(v_wa) not between 10 and 13
     or v_pref not in ('whatsapp','ligacao','qualquer')
     or coalesce(p_item->>'consent','') <> 'true' then
    return false;
  end if;

  if coalesce(p_item->>'community_id','') <> '' then
    if (p_item->>'community_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    select id into v_com from communities
     where id = (p_item->>'community_id')::uuid and parish_id = v_pid and active;
    if v_com is null then
      return false;
    end if;
  end if;

  if exists (select 1 from tither_leads where parish_id = v_pid and whatsapp = v_wa and status in ('new','contacted')) then
    return true;
  end if;
  if (select count(*) from tither_leads where parish_id = v_pid and created_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;

  insert into tither_leads (parish_id, community_id, name, whatsapp, contact_preference, consent)
  values (v_pid, v_com, v_name, v_wa, v_pref, true);
  return true;
end;
$$;

revoke all on function public_tither_interest(text, jsonb) from public;
grant execute on function public_tither_interest(text, jsonb) to anon, authenticated;

-- ---------- Paróquia piloto ----------
insert into parishes (slug, name, active)
values ('santo-antonio-jaragua', 'Paróquia Santo Antônio – Jaraguá', true)
on conflict (slug) do nothing;

insert into parish_state (parish_id, data)
select id, '{}'::jsonb from parishes where slug = 'santo-antonio-jaragua'
on conflict (parish_id) do nothing;

-- O conteúdo inicial (dados da paróquia, horários de missa, modelos de
-- mensagem) é gravado pelo próprio sistema no primeiro login da equipe.

-- Depois de criar os usuários em Authentication > Users, vincule cada um
-- à paróquia pelo e-mail (troque os e-mails pelos reais):
--
-- insert into parish_users (user_id, parish_id, role)
-- select u.id, p.id, v.role
-- from (values
--   ('padre@exemplo.com',      'padre'),
--   ('secretaria@exemplo.com', 'secretaria'),
--   ('pascom@exemplo.com',     'pascom')
-- ) as v(email, role)
-- join auth.users u on lower(u.email) = lower(v.email)
-- cross join parishes p
-- where p.slug = 'santo-antonio-jaragua'
-- on conflict (user_id, parish_id) do update set role = excluded.role;

-- =========================================================
-- SECRETARIA 24H — mesmo conteúdo de supabase/secretaria24h.sql (a área
-- 'secretaria24h' do can_access já está na matriz lá em cima).
-- Para um banco que já tem o resto do schema, basta rodar só o secretaria24h.sql.
-- =========================================================
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
