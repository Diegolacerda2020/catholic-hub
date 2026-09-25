# Banco do piloto (Supabase)

Passo a passo para ligar o piloto. Leva uns 15 minutos.

## 1. Criar o projeto e rodar o SQL

1. Crie um projeto em https://supabase.com (região São Paulo, se possível).
2. Abra **SQL Editor → New query**, cole o conteúdo inteiro de `schema.sql` e clique em **Run**.
   O script pode ser rodado de novo sem problema (não apaga dados).

Ele cria as tabelas `parishes`, `parish_users` e `parish_state`, as tabelas do MVP 2 (`communities`,
`events`, `tither_profiles`, `tither_leads`), as regras de acesso (RLS), as funções da página pública
e a paróquia piloto (`santo-antonio-jaragua`).

> **Já tem o piloto rodando?** Para atualizar para o MVP 2, basta rodar o `schema.sql` inteiro de novo.
> Ele só cria o que falta (`create table if not exists`, `create or replace function`) e recria as policies.
> Não há `DROP TABLE`, `TRUNCATE` nem `DELETE`: avisos, pessoas, intenções, velas, configurações e log
> continuam no `parish_state` exatamente como estão.

## 2. Configurar a autenticação

Em **Authentication → Sign In / Providers → Email**:

- deixe **Email** ligado;
- desligue **Allow new users to sign up** (só você cria usuários; ninguém se cadastra sozinho).

## 3. Criar os usuários (padre, secretaria, PASCOM)

Em **Authentication → Users → Add user → Create new user**, para cada pessoa:

- e-mail e senha;
- marque **Auto Confirm User**.

## 4. Vincular os usuários à paróquia

No SQL Editor, troque os e-mails pelos reais e rode:

```sql
insert into parish_users (user_id, parish_id, role)
select u.id, p.id, v.role
from (values
  ('padre@exemplo.com',      'padre'),
  ('secretaria@exemplo.com', 'secretaria'),
  ('pascom@exemplo.com',     'pascom')
) as v(email, role)
join auth.users u on lower(u.email) = lower(v.email)
cross join parishes p
where p.slug = 'santo-antonio-jaragua'
on conflict (user_id, parish_id) do update set role = excluded.role;
```

Confira: `select * from parish_users;` deve mostrar uma linha por pessoa.
Papéis aceitos: `padre`, `secretaria`, `pascom`, `admin` (suporte). O papel aparece no cabeçalho e no
registro da aba Uso. O que cada papel pode fazer está em [Permissões por papel](#permissões-por-papel).

Quem entra sem vínculo vê "Acesso ainda não liberado" e não acessa nada.

## 5. Preencher o `config.js` (raiz do repositório)

Em **Project Settings → API** (ou **API Keys**), copie:

- **Project URL** → `url`
- chave **anon public** (ou **Publishable key**) → `anonKey`

```js
window.CENTRAL_CONFIG = {
  supabase: { url: 'https://xxxx.supabase.co', anonKey: 'eyJ...' },
  parishSlug: 'santo-antonio-jaragua'
};
```

Faça commit e push. Em 1 ou 2 minutos o GitHub Pages publica.

A chave anon é pública por natureza e pode ficar no site: quem protege os dados é o RLS.
**Nunca** coloque a chave `service_role` / `secret` no `config.js` nem em nenhum outro arquivo do repositório.

## 6. Primeiro login

O primeiro membro da equipe que entrar grava no banco o conteúdo inicial: dados da paróquia,
horários de missa e modelos de mensagem. Pessoas, intenções e avisos começam vazios.
Os dados de exemplo do protótipo **não** vão para o banco.

## O que fica sincronizado

Fica no banco (`parish_state.data`): dados da paróquia (`cfg`), modelos de mensagem, pessoas,
avisos, intenções, velas, log de uso e mensagens já enviadas no dia.

Fica só no aparelho: aba aberta, rascunho em digitação, filtros de busca e "minha paróquia".

Cada aparelho salva cerca de 1 segundo depois da última alteração e busca novidades a cada 15 segundos
(e sempre que a aba volta a ficar visível). Se dois aparelhos salvarem quase juntos, o segundo percebe
e junta as alterações item a item. Assim, um aviso publicado num aparelho não é apagado pelo outro.

## Tabelas do MVP 2

| Tabela | Para quê | Observações |
|---|---|---|
| `communities` | Comunidades da paróquia | `unique(parish_id, slug)`; sem exclusão física (desativar com `active = false`) |
| `events` | Agenda | `scope` = `parish` ou `community` (com `community_id` obrigatório); `cancelled` em vez de apagar; `image_url` e `google_event_id` prontos para o futuro |
| `tither_profiles` | Dizimistas (relacionamento pastoral) | Sem valores, contribuições ou dados bancários; `notes` nunca é pública |
| `tither_leads` | "Quero ser dizimista" | Entrada só pela função `public_tither_interest`; `status`: `new`, `contacted`, `converted`, `closed` |

A comunidade de um evento, dizimista ou interessado precisa ser da mesma paróquia (chave estrangeira composta
`(community_id, parish_id)`).

Os avisos continuam no `parish_state`. Os novos ganham `scope` (`parish`/`community`), `communityId` e, quando
vêm de um evento, `eventId`. Avisos antigos, sem `scope`, valem para toda a paróquia.

### Funções

| Função | Quem chama | O que faz |
|---|---|---|
| `get_public_parish(slug)` | visitante | dados públicos: `cfg`, avisos, nº de velas, comunidades ativas e eventos públicos não cancelados |
| `public_submit(slug, kind, item)` | visitante | intenção de missa ou vela (sem mudança) |
| `public_tither_interest(slug, item)` | visitante | grava um interessado validado; mesmo WhatsApp pendente não duplica; até 30 por hora por paróquia |
| `convert_tither_lead(lead_id)` | padre/secretaria | cria (ou reaproveita pelo WhatsApp) o dizimista e marca o interessado como convertido |
| `can_access(parish, area)` / `is_parish_member(parish)` | policies | matriz de acesso por papel |

## Permissões por papel

A matriz fica num lugar só: `can_access()` no banco (e `pode()` no `index.html`, que só esconde telas).

| Área | Padre / Suporte | Secretaria | PASCOM |
|---|---|---|---|
| Comunicar, Mensagens, Pessoas, Intenções, Uso, Ajustes (`parish_state`) | sim | sim | sim (como no piloto; restringir é o próximo passo) |
| Agenda e Comunidades | sim | sim | sim |
| Dizimistas e interessados | sim | sim | **não** |

## Regras de acesso (resumo)

| Quem | Acesso a `parish_state` | O que vê |
|---|---|---|
| Membro da paróquia (logado) | lê e altera só a da própria paróquia | tudo da própria paróquia |
| Logado em outra paróquia ou sem vínculo | nenhum | nada do piloto |
| Visitante sem login (leitura) | nenhum acesso direto | só `get_public_parish()`: dados da paróquia, avisos, número de velas, comunidades ativas e eventos públicos |
| Visitante sem login (envio) | só `public_submit()` e `public_tither_interest()` | acrescenta 1 intenção, vela ou interessado validado; não lê nada |

Nas tabelas do MVP 2, o visitante (`anon`) não tem nenhum privilégio. O usuário logado só enxerga linhas da
própria paróquia, e dizimistas/interessados só com papel `padre`, `secretaria` ou `admin`. WhatsApp, datas e
observações de dizimistas nunca saem pela função pública.

Pelo site, ninguém cria paróquias, cria vínculos ou apaga estados. Isso só se faz pelo SQL Editor.
