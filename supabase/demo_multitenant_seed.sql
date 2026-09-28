-- Central Paroquial — pacote DEMO multi-paróquia (dados totalmente fictícios).
-- Paróquias: santo-antonio-jaragua, santa-clara-e-sao-francisco-mineirao, nossa-senhora-das-gracas-ibirite.
-- Rode DEPOIS de schema.sql, secretaria24h.sql e das 3 migrações do diretório. Pode rodar 2x (ou mais).
--
-- COMO OS DADOS DEMO SÃO IDENTIFICADOS
--   Tabelas com id uuid (events, tither_profiles, tither_contributions, tither_leads, service_catalog,
--   service_requests, service_request_history): o id é DETERMINÍSTICO,
--     md5('cp-demo-v1|' || parish_id || '|<tipo>|' || n)::uuid
--   Cada paróquia tem os próprios ids (entra o parish_id), nunca compartilhados. Rodar de novo não duplica
--   (on conflict do nothing), mesmo que a equipe tenha editado os textos; o cleanup apaga exatamente estes ids.
--   Marcas visíveis, além do id: service_requests.is_demo = true; tither_profiles.notes começa com [DEMO];
--   events.description termina com [Evento de demonstração]; service_catalog.code começa com demo_.
--   Itens em parish_state (avisos, intenções, velas): id numérico determinístico por paróquia, na faixa
--   1.000.000.000.000–1.017.000.000.000 (ids normais do app ficam acima de 1.700.000.000.000.000),
--   mais "demo": true no item.
--
-- O QUE NÃO FAZ
--   Não cria usuários, auth.users nem parish_users. Não cria comunidades. Não altera nem apaga nenhum registro
--   existente: só INSERT de linhas novas e, em parish_state, só ACRESCENTA itens às listas (os itens que já
--   estão lá ficam como estão). Nomes e WhatsApps são inventados; nada de horário real de missa, programação
--   oficial, comunidade real ou valor em dinheiro.
--
-- SANTO ANTÔNIO já tem DEMO dos seeds antigos (demo_seed.sql: dizimistas, contribuições e eventos;
-- demo_secretaria_seed.sql: Secretaria 24h). Onde houver esse DEMO antigo, esta categoria é PULADA para não
-- duplicar. Na prática, Santo Antônio ganha só o que faltava: avisos, intenções, velas e interessados.
--
-- Serviços da Secretaria 24h DEMO (paróquias sem o DEMO antigo) ficam INATIVOS: servem só para as solicitações
-- de demonstração aparecerem na fila da equipe; a página pública não oferece esses serviços.

do $$
declare
  p record;
  pid uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  mes date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  agora_ms bigint := floor(extract(epoch from now()) * 1000);
  base bigint;
  dom date; -- próximo domingo (para as intenções)
  ids uuid[];
begin
  for p in select * from (values
      ('santo-antonio-jaragua',                '3199501'),
      ('santa-clara-e-sao-francisco-mineirao', '3199502'),
      ('nossa-senhora-das-gracas-ibirite',     '3199503')) v(slug, tel)
  loop
    select id into pid from parishes where slug = p.slug;
    if pid is null then raise notice 'Paróquia % não existe: pulada.', p.slug; continue; end if;
    base := 1000000000000 + (('x' || substr(md5(pid::text), 1, 6))::bit(24)::bigint) * 1000;
    dom := hoje + ((7 - extract(dow from hoje)::int) % 7) + case when extract(dow from hoje) = 0 then 7 else 0 end;

    -- ---------- Eventos (4): hoje à noite, em 5, 12 e 26 dias ----------
    ids := array(select md5('cp-demo-v1|' || pid || '|evento|' || n)::uuid from generate_series(1, 4) n);
    if exists (select 1 from events where parish_id = pid and description like '%[Evento de demonstração]' and id <> all(ids)) then
      raise notice '%: eventos DEMO antigos encontrados, eventos pulados.', p.slug;
    else
      insert into events (id, parish_id, community_id, scope, title, description, starts_at, ends_at, location, public, highlight_home, cancelled)
      select md5('cp-demo-v1|' || pid || '|evento|' || v.n)::uuid, pid, null, 'parish', v.titulo, v.texto || E'\n\n[Evento de demonstração]',
             ((hoje + v.dias) + v.ini) at time zone 'America/Sao_Paulo', ((hoje + v.dias) + v.fim) at time zone 'America/Sao_Paulo',
             'Local a confirmar', true, v.destaque, false
      from (values
        (1, 'Terço em família',        'Momento de oração do terço aberto a todas as famílias.',            0, time '19:30', time '20:30', false),
        (2, 'Almoço Beneficente',      'Almoço de confraternização em prol das obras da paróquia.',         5, time '12:00', time '15:00', true),
        (3, 'Encontro de Casais',      'Encontro de formação e convivência para casais.',                   12, time '19:00', time '21:00', false),
        (4, 'Noite de Louvor',         'Noite de louvor e adoração com os grupos da paróquia.',             26, time '19:30', time '21:30', false)
      ) v(n, titulo, texto, dias, ini, fim, destaque)
      on conflict do nothing;
    end if;

    -- ---------- Dizimistas (8) e contribuições (sem valores) ----------
    ids := array(select md5('cp-demo-v1|' || pid || '|dizimista|' || n)::uuid from generate_series(1, 8) n);
    if exists (select 1 from tither_profiles where parish_id = pid and notes like '[DEMO]%' and id <> all(ids)) then
      raise notice '%: dizimistas DEMO antigos encontrados, dizimistas e contribuições pulados.', p.slug;
    else
      insert into tither_profiles (id, parish_id, community_id, name, whatsapp, birth_date, marriage_date, joined_on, status, consent, notes)
      select md5('cp-demo-v1|' || pid || '|dizimista|' || v.n)::uuid, pid, null, v.nome, p.tel || lpad(v.n::text, 4, '0'),
             v.nasc, v.casou, v.entrou, v.status, v.consent, '[DEMO] ' || v.nota
      from (values
        -- 1968 é bissexto: o aniversário cai hoje em qualquer dia do ano
        (1, 'Ana Exemplo Lima',        make_date(1968, extract(month from hoje)::int, extract(day from hoje)::int), null::date, (hoje - interval '9 years')::date, 'active', true, 'Aniversário hoje (demonstração).'),
        (2, 'Bruno Exemplo Costa',     make_date(1975, 4, 12), make_date(2001, extract(month from hoje)::int, 20), (hoje - interval '6 years')::date, 'active', true, 'Bodas neste mês (demonstração).'),
        (3, 'Carla Exemplo Rocha',     make_date(1982, 9, 3),  null, (hoje - interval '4 years')::date, 'active', true, 'Contribuição do mês registrada.'),
        (4, 'Daniel Exemplo Moura',    make_date(1990, 1, 27), null, (hoje - interval '3 years')::date, 'active', true, 'Contribuição do mês registrada.'),
        (5, 'Elisa Exemplo Prado',     make_date(1959, 6, 8),  null, (hoje - interval '12 years')::date, 'active', true, 'Contribuição do mês ainda não registrada.'),
        (6, 'Fábio Exemplo Nunes',     make_date(1986, 11, 19), null, (hoje - interval '2 years')::date, 'active', false, 'Sem autorização para mensagens.'),
        (7, 'Gabriela Exemplo Dias',   make_date(1994, 2, 14), null, hoje - 12, 'active', true, 'Nova dizimista.'),
        (8, 'Hélio Exemplo Barros',    make_date(1950, 7, 30), null, (hoje - interval '15 years')::date, 'inactive', false, 'Dizimista inativo.')
      ) v(n, nome, nasc, casou, entrou, status, consent, nota)
      on conflict do nothing;

      -- mês atual para 1–4 e 7; histórico dos últimos meses para parte deles
      insert into tither_contributions (id, parish_id, tither_id, reference_month, received_at, notes)
      select md5('cp-demo-v1|' || pid || '|contribuicao|' || v.n || '|' || k)::uuid, pid, md5('cp-demo-v1|' || pid || '|dizimista|' || v.n)::uuid,
             (mes - make_interval(months => k))::date,
             (least((mes - make_interval(months => k))::date + 3 + v.n, hoje) + time '12:00') at time zone 'America/Sao_Paulo',
             '[DEMO] Registro de demonstração.'
      from (values (1, array[0,1,2,3]), (2, array[0,1,2]), (3, array[0,1]), (4, array[0,2,3]), (5, array[1,2,3]), (6, array[2]), (7, array[0])) v(n, meses)
      cross join unnest(v.meses) k
      where (mes - make_interval(months => k))::date >= date_trunc('month', (select joined_on from tither_profiles where id = md5('cp-demo-v1|' || pid || '|dizimista|' || v.n)::uuid))::date
      on conflict do nothing;
    end if;

    -- ---------- "Quero ser dizimista": interessados (2) ----------
    insert into tither_leads (id, parish_id, community_id, name, whatsapp, contact_preference, consent, status, created_at, updated_at)
    select md5('cp-demo-v1|' || pid || '|interessado|' || v.n)::uuid, pid, null, v.nome, p.tel || lpad((100 + v.n)::text, 4, '0'), v.pref, true, 'new',
           now() - make_interval(hours => v.h), now() - make_interval(hours => v.h)
    from (values (1, 'Igor Exemplo Teixeira', 'whatsapp', 3), (2, 'Joana Exemplo Freitas', 'ligacao', 28)) v(n, nome, pref, h)
    on conflict do nothing;

    -- ---------- Secretaria 24h: 3 serviços DEMO inativos + 4 solicitações com histórico ----------
    ids := array(select md5('cp-demo-v1|' || pid || '|solicitacao|' || n)::uuid from generate_series(1, 4) n);
    if exists (select 1 from service_requests where parish_id = pid and is_demo and id <> all(ids)) then
      raise notice '%: Secretaria 24h DEMO antiga encontrada, Secretaria 24h pulada.', p.slug;
    else
      insert into service_catalog (id, parish_id, code, title, description, form_fields, active, sort_order)
      select md5('cp-demo-v1|' || pid || '|servico|' || v.n)::uuid, pid, v.code, v.titulo, 'Serviço de demonstração.', v.campos::jsonb, false, 900 + v.n
      from (values
        (1, 'demo_certidao', 'Certidão / documento paroquial', '[{"name":"tipo_documento","label":"Tipo de documento","type":"select","required":true,"options":["Certidão de Batismo","Certidão de Crisma","Certidão de Matrimônio","Outro"]},{"name":"nome_pessoa","label":"Nome completo da pessoa","type":"text","required":true}]'),
        (2, 'demo_batismo',  'Batismo',                        '[{"name":"nome_pessoa","label":"Nome da criança/pessoa","type":"text","required":true},{"name":"observacoes","label":"Observações","type":"textarea"}]'),
        (3, 'demo_outro',    'Outro assunto',                  '[{"name":"mensagem","label":"Como podemos ajudar?","type":"textarea","required":true}]')
      ) v(n, code, titulo, campos)
      on conflict do nothing;

      insert into service_requests (id, parish_id, service_id, protocol, requester_name, whatsapp, contact_preference, answers, status, is_demo, created_at, updated_at)
      select md5('cp-demo-v1|' || pid || '|solicitacao|' || v.n)::uuid, pid, md5('cp-demo-v1|' || pid || '|servico|' || v.servico)::uuid,
             'SA-' || to_char(hoje, 'YYYY') || '-' || upper(substr(md5('cp-demo-v1|' || pid || '|protocolo|' || v.n), 1, 8)),
             v.nome, p.tel || lpad((200 + v.n)::text, 4, '0'), 'whatsapp', v.respostas::jsonb, v.status, true,
             now() - make_interval(hours => v.h), now() - make_interval(hours => greatest(v.h / 3, 0))
      from (values
        (1, 1, 'Lara Exemplo Campos',  'new',          2,   '{"tipo_documento":"Certidão de Batismo","nome_pessoa":"Lara Exemplo Campos"}'),
        (2, 2, 'Mário Exemplo Duarte', 'in_progress',  30,  '{"nome_pessoa":"Criança Exemplo Duarte","observacoes":"Pedido de demonstração."}'),
        (3, 3, 'Nina Exemplo Araújo',  'waiting_user', 70,  '{"mensagem":"Gostaria de uma informação (demonstração)."}'),
        (4, 3, 'Otávio Exemplo Reis',  'completed',    200, '{"mensagem":"Pedido de demonstração já atendido."}')
      ) v(n, servico, nome, status, h, respostas)
      on conflict do nothing;

      insert into service_request_history (id, request_id, parish_id, status, note, public_note, created_by, created_at)
      select md5('cp-demo-v1|' || pid || '|historico|' || v.n || '|' || v.k)::uuid, md5('cp-demo-v1|' || pid || '|solicitacao|' || v.n)::uuid, pid,
             v.status, v.nota, v.publica, null, r.created_at + make_interval(hours => v.depois, secs => v.k)
      from (values
        (1, 1, 'new',          'Solicitação recebida.', true, 0),
        (2, 1, 'new',          'Solicitação recebida.', true, 0),
        (2, 2, 'in_progress',  'Recebemos seu pedido. A secretaria vai entrar em contato (demonstração).', true, 10),
        (2, 3, 'in_progress',  'Nota interna de demonstração.', false, 11),
        (3, 1, 'new',          'Solicitação recebida.', true, 0),
        (3, 2, 'waiting_user', 'Aguardando retorno do fiel (demonstração).', true, 20),
        (4, 1, 'new',          'Solicitação recebida.', true, 0),
        (4, 2, 'completed',    'Atendimento concluído (demonstração).', true, 48)
      ) v(n, k, status, nota, publica, depois)
      join service_requests r on r.id = md5('cp-demo-v1|' || pid || '|solicitacao|' || v.n)::uuid
      on conflict do nothing;
    end if;

    -- ---------- parish_state: avisos (3), intenções (3), velas (6). Só acrescenta; não mexe no que já existe ----------
    update parish_state ps set data = ps.data
      || jsonb_build_object('avisos', coalesce(ps.data->'avisos', '[]'::jsonb) || coalesce((select jsonb_agg(x) from jsonb_array_elements(jsonb_build_array(
            jsonb_build_object('id', base + 1, 'ts', agora_ms - 2 * 3600000, 'titulo', 'Inscrições abertas para a catequese', 'texto', 'Procure a secretaria para mais informações. [Aviso de demonstração]', 'evento', null, 'demo', true),
            jsonb_build_object('id', base + 2, 'ts', agora_ms - 26 * 3600000, 'titulo', 'Campanha do agasalho', 'texto', 'Doações podem ser entregues na secretaria. [Aviso de demonstração]', 'evento', null, 'demo', true),
            jsonb_build_object('id', base + 3, 'ts', agora_ms - 72 * 3600000, 'titulo', 'Reunião das pastorais', 'texto', 'Encontro mensal de coordenadores de pastorais. [Aviso de demonstração]', 'evento', null, 'demo', true)
          )) x where not coalesce(ps.data->'avisos', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', x->'id'))), '[]'::jsonb))
      || jsonb_build_object('intencoes', coalesce(ps.data->'intencoes', '[]'::jsonb) || coalesce((select jsonb_agg(x) from jsonb_array_elements(jsonb_build_array(
            jsonb_build_object('id', base + 11, 'ts', agora_ms - 5 * 3600000, 'tipo', 'falecidos', 'por', 'Pedro Exemplo Viana (7º dia)', 'data', to_char(dom, 'YYYY-MM-DD'), 'hora', 'Horário a confirmar', 'nome', 'Família Exemplo Viana', 'whats', '', 'status', 'nova', 'demo', true),
            jsonb_build_object('id', base + 12, 'ts', agora_ms - 20 * 3600000, 'tipo', 'gracas', 'por', 'Ação de graças da família Exemplo', 'data', to_char(dom, 'YYYY-MM-DD'), 'hora', 'Horário a confirmar', 'nome', 'Rita Exemplo Sales', 'whats', '', 'status', 'confirmada', 'demo', true),
            jsonb_build_object('id', base + 13, 'ts', agora_ms - 30 * 3600000, 'tipo', 'saude', 'por', 'Saúde de Sérgio Exemplo', 'data', to_char(dom + 7, 'YYYY-MM-DD'), 'hora', 'Horário a confirmar', 'nome', 'Tânia Exemplo Melo', 'whats', '', 'status', 'nova', 'demo', true)
          )) x where not coalesce(ps.data->'intencoes', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', x->'id'))), '[]'::jsonb))
      || jsonb_build_object('velas', coalesce(ps.data->'velas', '[]'::jsonb) || coalesce((select jsonb_agg(x) from jsonb_array_elements((select jsonb_agg(
            jsonb_build_object('id', base + 20 + k, 'ts', agora_ms - k * 2 * 3600000, 'para', (array['mim','alguem','almas','gracas','mim','alguem'])[k], 'por', '',
                               'pedido', 'Pedido de demonstração.', 'nome', '', 'rezar', k % 2 = 1, 'demo', true)) from generate_series(1, 6) k)) x
          where not coalesce(ps.data->'velas', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', x->'id'))), '[]'::jsonb))
    where ps.parish_id = pid
      -- nada novo a acrescentar: não reescreve a linha (rodar de novo não muda updated_at)
      and not (coalesce(ps.data->'avisos', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', base + 1), jsonb_build_object('id', base + 2), jsonb_build_object('id', base + 3))
           and coalesce(ps.data->'intencoes', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', base + 11), jsonb_build_object('id', base + 12), jsonb_build_object('id', base + 13))
           and coalesce(ps.data->'velas', '[]'::jsonb) @> (select jsonb_agg(jsonb_build_object('id', base + 20 + k)) from generate_series(1, 6) k));
  end loop;
end $$;

-- ---------- Conferência: DEMO deste pacote por paróquia ----------
select p.slug,
  (select count(*) from events e, generate_series(1, 4) n where e.id = md5('cp-demo-v1|' || p.id || '|evento|' || n)::uuid) as eventos,
  (select count(*) from tither_profiles t, generate_series(1, 8) n where t.id = md5('cp-demo-v1|' || p.id || '|dizimista|' || n)::uuid) as dizimistas,
  (select count(*) from tither_contributions c where c.tither_id in (select md5('cp-demo-v1|' || p.id || '|dizimista|' || n)::uuid from generate_series(1, 8) n)) as contribuicoes,
  (select count(*) from tither_leads l, generate_series(1, 2) n where l.id = md5('cp-demo-v1|' || p.id || '|interessado|' || n)::uuid) as interessados,
  (select count(*) from service_requests r, generate_series(1, 4) n where r.id = md5('cp-demo-v1|' || p.id || '|solicitacao|' || n)::uuid) as solicitacoes_s24,
  (select count(*) from jsonb_array_elements(coalesce(ps.data->'avisos', '[]')) x where (x->>'demo')::boolean) as avisos,
  (select count(*) from jsonb_array_elements(coalesce(ps.data->'intencoes', '[]')) x where (x->>'demo')::boolean) as intencoes,
  (select count(*) from jsonb_array_elements(coalesce(ps.data->'velas', '[]')) x where (x->>'demo')::boolean) as velas
from parishes p left join parish_state ps on ps.parish_id = p.id
where p.slug in ('santo-antonio-jaragua', 'santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite')
order by p.slug;
