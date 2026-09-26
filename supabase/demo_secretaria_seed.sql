-- Central Paroquial — dados de DEMONSTRAÇÃO da Secretaria 24h (totalmente fictícios).
-- Rode no SQL Editor do Supabase DEPOIS do secretaria24h.sql. Pode ser rodado de novo: não duplica.
--
-- Como identificar e apagar depois (supabase/demo_secretaria_cleanup.sql):
--   solicitações: is_demo = true (o histórico delas é apagado junto, em cascata)
--
-- Só INSERT … WHERE NOT EXISTS: não cria paróquia nem serviço, não altera nenhum registro existente.
-- Nomes e WhatsApps são inventados (sequência de teste 31990002001–31990002005).
-- Sem CPF, documento, endereço ou e-mail. Protocolos gerados como os reais (SA-AAAA-XXXXXXXX).
-- Precisa do catálogo inicial da paróquia piloto (criado pelo secretaria24h.sql).

-- ---------- Solicitações fictícias (5) ----------
with p as (
  select id from parishes where slug = 'santo-antonio-jaragua'
),
demo (n, code, name, whatsapp, pref, status, horas_atras, answers) as (values
  (1, 'certidao',          'Beatriz Nogueira Campos',   '31990002001', 'whatsapp', 'new',          3,
   '{"tipo_documento":"Certidão de Batismo","nome_pessoa":"Beatriz Nogueira Campos","data_sacramento":"por volta de 1994","nome_pais":"Roberto Campos e Sílvia Nogueira","local":"Matriz Santo Antônio","observacoes":"Preciso para o casamento."}'),
  (2, 'batismo',           'Rafael Teixeira Moura',     '31990002002', 'qualquer', 'in_progress',  28,
   '{"nome_pessoa":"Helena Teixeira Moura","data_nascimento":"2026-06-12","nome_responsaveis":"Rafael Teixeira Moura e Camila Duarte Moura","data_desejada":"2026-11-15","comunidade":"Matriz","observacoes":""}'),
  (3, 'matrimonio',        'Gustavo Henrique Prado',    '31990002003', 'whatsapp', 'waiting_user', 76,
   '{"nome_noivo":"Gustavo Henrique Prado","nome_noiva":"Larissa Mendes Coelho","data_desejada":"2027-05-22","comunidade":"Matriz Santo Antônio","observacoes":"Gostaríamos de saber sobre o curso de noivos."}'),
  (4, 'catequese',         'Juliana Castro Vieira',     '31990002004', 'ligacao',  'completed',    240,
   '{"nome_catequizando":"Pedro Castro Vieira","data_nascimento":"2017-03-08","nome_responsavel":"Juliana Castro Vieira","comunidade":"Matriz","observacoes":""}'),
  (5, 'atendimento_padre', 'Sebastião Ramos Pereira',   '31990002005', 'whatsapp', 'new',          1,
   '{"assunto":"Bênção da casa nova","melhor_periodo":"Tarde","observacoes":"Mudamos para o bairro há pouco tempo."}')
)
insert into service_requests (parish_id, service_id, protocol, requester_name, whatsapp, contact_preference, answers, status, is_demo, created_at, updated_at)
select p.id, sc.id,
       'SA-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8)),
       demo.name, demo.whatsapp, demo.pref, demo.answers::jsonb, demo.status, true,
       now() - make_interval(hours => demo.horas_atras),
       now() - make_interval(hours => greatest(demo.horas_atras / 3, 0))
from demo
cross join p
join service_catalog sc on sc.parish_id = p.id and sc.code = demo.code
where not exists (
  select 1 from service_requests r
  where r.parish_id = p.id and r.is_demo and r.requester_name = demo.name
);

-- ---------- Histórico das solicitações fictícias ----------
-- Só para solicitação DEMO que ainda não tem histórico (rodar de novo não duplica).
-- publica = true aparece para o fiel no acompanhamento; false é nota interna.
with p as (
  select id from parishes where slug = 'santo-antonio-jaragua'
),
hist (name, ordem, status, note, publica, horas_depois) as (values
  ('Beatriz Nogueira Campos', 1, 'new',          'Solicitação recebida.', true, 0),

  ('Rafael Teixeira Moura',   1, 'new',          'Solicitação recebida.', true, 0),
  ('Rafael Teixeira Moura',   2, 'in_progress',  'Recebemos seu pedido. A secretaria vai enviar pelo WhatsApp as orientações da preparação para o Batismo.', true, 14),
  ('Rafael Teixeira Moura',   3, 'in_progress',  'Conferir datas de batizado de novembro com o padre.', false, 15),

  ('Gustavo Henrique Prado',  1, 'new',          'Solicitação recebida.', true, 0),
  ('Gustavo Henrique Prado',  2, 'in_progress',  null, true, 20),
  ('Gustavo Henrique Prado',  3, 'waiting_user', 'Enviamos a lista de documentos pelo WhatsApp. Assim que puder, responda com a data de preferência.', true, 30),

  ('Juliana Castro Vieira',   1, 'new',          'Solicitação recebida.', true, 0),
  ('Juliana Castro Vieira',   2, 'in_progress',  null, true, 12),
  ('Juliana Castro Vieira',   3, 'completed',    'Inscrição feita na turma de sábado, 9h. Seja bem-vindo à catequese!', true, 48),
  ('Juliana Castro Vieira',   4, 'completed',    'Responsável avisada por ligação.', false, 49),

  ('Sebastião Ramos Pereira', 1, 'new',          'Solicitação recebida.', true, 0)
)
insert into service_request_history (request_id, parish_id, status, note, public_note, created_by, created_at)
select r.id, r.parish_id, hist.status, hist.note, hist.publica, null,
       r.created_at + make_interval(hours => hist.horas_depois, secs => hist.ordem)
from hist
cross join p
join service_requests r on r.parish_id = p.id and r.is_demo and r.requester_name = hist.name
where not exists (select 1 from service_request_history h where h.request_id = r.id);

-- ---------- Conferência ----------
-- Anote um protocolo e o WhatsApp para testar "Acompanhar solicitação" na página pública.
select r.protocol, sc.title as servico, r.requester_name as nome, r.whatsapp, r.status,
       r.created_at at time zone 'America/Sao_Paulo' as recebida_em,
       (select count(*) from service_request_history h where h.request_id = r.id) as historico
from service_requests r
join service_catalog sc on sc.id = r.service_id
where r.is_demo
  and r.parish_id = (select id from parishes where slug = 'santo-antonio-jaragua')
order by r.created_at desc;
