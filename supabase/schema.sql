-- Central Paroquial — esquema mínimo para o piloto multiusuário.
-- Rode este script inteiro no SQL Editor do Supabase (projeto do piloto).
-- Não normaliza o modelo de dados: o estado da paróquia continua guardado
-- como um JSON só (coluna "data"), igual ao objeto S do protótipo.

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

-- ---------- Leitura pública (página do fiel, sem login) ----------
-- security definer: ignora RLS por dentro, mas só devolve os campos
-- que já eram públicos na página (avisos, dados da paróquia, horários,
-- quantidade de velas). Nunca devolve pessoas, intenções ou log.
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
    )
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
