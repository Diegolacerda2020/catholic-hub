-- Central Paroquial - Governanca Fase 1
-- Visao somente leitura da equipe da propria paroquia.
-- Seguro para rodar de novo. Nao cria usuarios, nao altera vinculos.

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
