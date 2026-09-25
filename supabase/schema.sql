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
create or replace function touch_parish_state() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

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

grant execute on function get_public_parish(text) to anon, authenticated;

-- ---------- Paróquia piloto ----------
insert into parishes (slug, name, active)
values ('santo-antonio-jaragua', 'Paróquia Santo Antônio – Jaraguá', true)
on conflict (slug) do nothing;

insert into parish_state (parish_id, data)
select id, '{}'::jsonb from parishes where slug = 'santo-antonio-jaragua'
on conflict (parish_id) do nothing;

-- Depois de criar os usuários (padre, secretaria) em Authentication > Users,
-- vincule cada um à paróquia com algo como:
--
-- insert into parish_users (user_id, parish_id, role)
-- select '<uuid-do-usuario>', id, 'secretaria' from parishes where slug = 'santo-antonio-jaragua';
