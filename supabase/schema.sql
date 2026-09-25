-- Central Paroquial — esquema mínimo para o piloto multiusuário.
-- Rode este script inteiro no SQL Editor do Supabase (projeto do piloto).
-- O estado original da paróquia continua guardado como um JSON só (coluna
-- "data"), igual ao objeto S do protótipo. A partir do MVP 2, comunidades,
-- agenda, dizimistas e interessados ficam em tabelas próprias (mais abaixo).
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
      when 'secretaria' then p_area in ('avisos','agenda','comunidades','dizimistas','pessoas','intencoes','mensagens','ajustes')
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
