-- Central Paroquial — DOAÇÕES por paróquia (somente estrutura; revisão manual; NÃO executado).
--
-- Por que: a página da paróquia ganha o botão "💝 Quero fazer uma doação", que leva a uma página com Pix
-- e/ou um link externo de pagamento com cartão. A plataforma NÃO recebe, NÃO guarda e NÃO intermedeia
-- dinheiro: o Pix vai direto para a conta da paróquia e o cartão é pago no site do provedor que a própria
-- paróquia contratou (checkout externo).
--
-- O que cria:
--   parish_donation_settings (uma linha por paróquia, isolada por parish_id). Só dados PÚBLICOS de recebimento:
--     pix_enabled, pix_key, pix_key_type, pix_beneficiary, pix_city, card_enabled, payment_provider, checkout_url.
--     NÃO existe coluna para número de cartão, CVV, validade, senha, token, client_secret, access token ou
--     qualquer credencial. As funções de gravação só aceitam os campos acima (qualquer outro é recusado).
--   public_donation_settings(slug)  → visitante: só o que está LIGADO (Pix e/ou cartão) da paróquia ativa.
--   staff_get_donation_settings / staff_save_donation_settings → equipe: ler e salvar.
-- Quem configura: área 'doacoes' do can_access() que já existe → padre e suporte (admin).
--   Secretaria e PASCOM NÃO configuram (dados de recebimento de dinheiro ficam com o responsável pela paróquia).
--   Nenhuma mudança no can_access(), em parishes, parish_state, parish_users ou auth.users.
-- Estado inicial: nenhuma linha → doações DESLIGADAS nas 3 paróquias (o botão não aparece).
-- Pode rodar 2x.
--
-- Risco: baixo. Tabela e funções novas; nada existente muda. O front atual trata a função ausente como
-- "doações não configuradas" (botão escondido).
-- Rollback: drop function public_donation_settings(text), staff_get_donation_settings(uuid),
--   staff_save_donation_settings(uuid, jsonb); drop table parish_donation_settings.

create table if not exists parish_donation_settings (
  parish_id        uuid primary key references parishes(id) on delete cascade,
  pix_enabled      boolean not null default false,
  pix_key          text,
  pix_key_type     text,
  pix_beneficiary  text,
  pix_city         text,
  card_enabled     boolean not null default false,
  payment_provider text,
  checkout_url     text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint parish_donation_pix_ck check (
    (pix_key_type is null or pix_key_type in ('cpf','cnpj','email','telefone','aleatoria'))
    and length(coalesce(pix_key, '')) <= 77 and length(coalesce(pix_beneficiary, '')) <= 25 and length(coalesce(pix_city, '')) <= 15
    and (not pix_enabled or (pix_key is not null and pix_key_type is not null and pix_beneficiary is not null and pix_city is not null))),
  constraint parish_donation_card_ck check (
    length(coalesce(payment_provider, '')) <= 60
    and (checkout_url is null or (checkout_url ~ '^https://[^\s]+$' and length(checkout_url) <= 500
         and checkout_url !~* '[?&#](access_token|client_secret|secret|token|senha|password|api_key|apikey)='))
    and (not card_enabled or checkout_url is not null))
);

-- Ninguém lê nem grava direto pela API: só pelas funções abaixo (que conferem a permissão e os campos).
alter table parish_donation_settings enable row level security;
revoke all on parish_donation_settings from anon, authenticated;
drop policy if exists parish_donation_staff_read on parish_donation_settings;
create policy parish_donation_staff_read on parish_donation_settings for select to authenticated using (can_access(parish_id, 'doacoes'));
grant select on parish_donation_settings to authenticated;

-- ---------- Público: o que a página mostra ----------
create or replace function public_donation_settings(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.pix_enabled or s.card_enabled then jsonb_strip_nulls(jsonb_build_object(
      'pix', case when s.pix_enabled then jsonb_build_object('key', s.pix_key, 'key_type', s.pix_key_type, 'beneficiary', s.pix_beneficiary, 'city', s.pix_city) end,
      'card', case when s.card_enabled then jsonb_build_object('provider', s.payment_provider, 'checkout_url', s.checkout_url) end))
    end
  from parishes p join parish_donation_settings s on s.parish_id = p.id
  where p.slug = p_slug and p.active;
$$;
revoke all on function public_donation_settings(text) from public;
grant execute on function public_donation_settings(text) to anon, authenticated;

-- ---------- Equipe (padre / suporte) ----------
create or replace function staff_get_donation_settings(p_parish uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if not can_access(p_parish, 'doacoes') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  select to_jsonb(s) - 'updated_by' into r from parish_donation_settings s where s.parish_id = p_parish;
  return coalesce(r, jsonb_build_object('parish_id', p_parish, 'pix_enabled', false, 'card_enabled', false));
end $$;
revoke all on function staff_get_donation_settings(uuid) from public, anon;
grant execute on function staff_get_donation_settings(uuid) to authenticated;

create or replace function staff_save_donation_settings(p_parish uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  permitidos text[] := array['pix_enabled','pix_key','pix_key_type','pix_beneficiary','pix_city','card_enabled','payment_provider','checkout_url'];
  extra text;
begin
  if not can_access(p_parish, 'doacoes') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados inválidos' using errcode = '22023'; end if;
  -- só os campos públicos de recebimento; qualquer outro (cartão, CVV, token, segredo...) é recusado
  select k into extra from jsonb_object_keys(p_dados) k where k <> all(permitidos) limit 1;
  if extra is not null then raise exception 'Campo não permitido: %', extra using errcode = '22023'; end if;
  insert into parish_donation_settings as s (parish_id, pix_enabled, pix_key, pix_key_type, pix_beneficiary, pix_city,
      card_enabled, payment_provider, checkout_url, updated_at, updated_by)
  values (p_parish,
    coalesce((p_dados->>'pix_enabled')::boolean, false),
    nullif(btrim(p_dados->>'pix_key'), ''), nullif(btrim(p_dados->>'pix_key_type'), ''),
    nullif(btrim(p_dados->>'pix_beneficiary'), ''), nullif(btrim(p_dados->>'pix_city'), ''),
    coalesce((p_dados->>'card_enabled')::boolean, false),
    nullif(btrim(p_dados->>'payment_provider'), ''), nullif(btrim(p_dados->>'checkout_url'), ''),
    now(), auth.uid())
  on conflict (parish_id) do update set
    pix_enabled = excluded.pix_enabled, pix_key = excluded.pix_key, pix_key_type = excluded.pix_key_type,
    pix_beneficiary = excluded.pix_beneficiary, pix_city = excluded.pix_city, card_enabled = excluded.card_enabled,
    payment_provider = excluded.payment_provider, checkout_url = excluded.checkout_url, updated_at = now(), updated_by = auth.uid();
  return staff_get_donation_settings(p_parish);
end $$;
revoke all on function staff_save_donation_settings(uuid, jsonb) from public, anon;
grant execute on function staff_save_donation_settings(uuid, jsonb) to authenticated;

-- Conferência: 0 linhas = doações desligadas em todas as paróquias
select count(*) as paroquias_com_doacao_configurada from parish_donation_settings;
