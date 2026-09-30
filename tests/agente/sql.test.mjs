// Assistente Paroquial sobre o SQL de verdade (PGlite imitando o Supabase: roles anon/authenticated, auth.uid(), RLS).
// As 3 paróquias vêm do diretorio_ativacao.sql (Santa Clara e Graças começam vazias). O núcleo usa o MESMO
// adapter do navegador (criarBackendSupabase) sobre um cliente que imita o supabase-js, logado como cada usuário.
// Nunca usa o Supabase real.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const require = createRequire(import.meta.url);
const Core = require('../../agente-core.js');
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const ler = f => fs.readFileSync(REPO + f, 'utf8');
let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500)); };
const texto = r => [...(r.linhas || []), ...(r.itens || []).flatMap(i => [i.titulo, i.detalhe]), ...(r.rodape || []), ...(r.confirmacao ? r.confirmacao.campos.flat().concat(r.confirmacao.avisos || []) : [])].join('\n');

export const STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;
async function criarBanco({agente = true} = {}){
  const db = new PGlite({extensions:{pgcrypto}});
  await db.exec(STUB);
  for (const f of ['supabase/schema.sql', 'supabase/secretaria24h.sql', 'supabase/demo_secretaria_seed.sql', 'supabase/diretorio.sql', 'supabase/diretorio_santuarios.sql',
    'supabase/diretorio_privacidade.sql', 'supabase/diretorio_seed.sql', 'supabase/diretorio_ativacao.sql']) await db.exec(ler(f));
  if (agente) await db.exec(ler('supabase/agente.sql'));
  return db;
}

// Uma consulta por vez, cada uma numa transação com o papel e o usuário certos.
let fila = Promise.resolve();
function como(db, uid, fn){
  const run = () => db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    return fn(tx);
  });
  const p = fila.then(run, run); fila = p.catch(() => {}); return p;
}
// Cliente que imita o supabase-js (só o que o adapter usa), executando como o usuário logado.
const TIPOS = {p_parish:'uuid', p_request:'uuid', p_service:'uuid', p_public_note:'boolean', p_confirmed:'boolean', p_limit:'integer', p_changes:'jsonb', p_answers:'jsonb'};
function cliente(db, uid){
  const erro = e => ({data:null, error:{code:e.code || 'XX000', message:e.message}});
  async function rodar(q){
    try {
      const vals = [], w = q.filtros.map(([c, op, v]) => { vals.push(v); return `${c} ${op} $${vals.length}`; });
      if (q.op === 'insert'){
        const cols = Object.keys(q.row), v = cols.map(c => q.row[c]);
        const r = await como(db, uid, tx => tx.query(`insert into ${q.table} (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning ${q.ret || '*'}`, v));
        return {data:q.single ? r.rows[0] : r.rows, error:null};
      }
      const sql = `select ${q.cols} from ${q.table}${w.length ? ' where ' + w.join(' and ') : ''}${q.ordem ? ` order by ${q.ordem[0]} ${q.ordem[1] ? 'asc' : 'desc'}` : ''}${q.lim ? ' limit ' + q.lim : ''}`;
      const r = await como(db, uid, tx => tx.query(sql, vals));
      return {data:JSON.parse(JSON.stringify(q.single ? r.rows[0] : r.rows)), error:null};
    } catch(e){ return erro(e); }
  }
  return {
    from(table){
      const q = {table, op:'select', cols:'*', filtros:[], ordem:null, lim:null};
      const b = {
        select(c){ if (q.op === 'select') q.cols = c || '*'; else q.ret = c || '*'; return b; },
        insert(row){ q.op = 'insert'; q.row = row; return b; },
        eq(c, v){ q.filtros.push([c, '=', v]); return b; }, gte(c, v){ q.filtros.push([c, '>=', v]); return b; }, lt(c, v){ q.filtros.push([c, '<', v]); return b; },
        order(c, o = {}){ q.ordem = [c, o.ascending !== false]; return b; }, limit(n){ q.lim = n; return b; }, single(){ q.single = true; return b; },
        then(a, r){ return rodar(q).then(a, r); }
      };
      return b;
    },
    async rpc(fn, args = {}){
      try {
        const nomes = Object.keys(args);
        const r = await como(db, uid, tx => tx.query(`select ${fn}(${nomes.map((n, i) => `${n} => $${i + 1}::${TIPOS[n] || 'text'}`).join(', ')}) as r`,
          nomes.map(n => TIPOS[n] === 'jsonb' ? JSON.stringify(args[n]) : args[n])));
        return {data:JSON.parse(JSON.stringify(r.rows[0].r ?? null)), error:null};
      } catch(e){ return erro(e); }
    }
  };
}

// ---------------------------------------------------------------- banco
console.log('== banco: schema + Secretaria 24h + diretório/ativação (3 paróquias) + agente.sql');
const db = await criarBanco({agente:false});
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const PID = {}; for (const r of await q(`select id, slug from parishes`)) PID[r.slug] = r.id;
const SA = 'santo-antonio-jaragua', SC = 'santa-clara-e-sao-francisco-mineirao', NG = 'nossa-senhora-das-gracas-ibirite';
t('3 tenants ativos', PID[SA] && PID[SC] && PID[NG], PID);
// Catálogo de Santa Clara igual ao santa_clara_real_secretaria24h.sql (cópia dos serviços reais de Santo Antônio)
await db.exec(`insert into service_catalog (parish_id, code, title, description, instructions, form_fields, active, sort_order)
  select '${PID[SC]}', code, title, description, instructions, form_fields, true, sort_order from service_catalog where parish_id = '${PID[SA]}' and active and code not like 'demo_%' on conflict do nothing;
  insert into service_catalog (parish_id, code, title, form_fields) values ('${PID[NG]}', 'outro', 'Outro assunto (Graças)', '[]') on conflict do nothing;`);
const U = {scSec:'00000000-0000-0000-0000-00000000c001', scPadre:'00000000-0000-0000-0000-00000000c002', scPascom:'00000000-0000-0000-0000-00000000c003',
  ngSec:'00000000-0000-0000-0000-00000000a001', ngPadre:'00000000-0000-0000-0000-00000000a002', saSec:'00000000-0000-0000-0000-00000000b001', saAdmin:'00000000-0000-0000-0000-00000000b002'};
await db.exec(`insert into auth.users values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@teste')`).join(', ')};
  insert into parish_users values ('${U.scSec}', '${PID[SC]}', 'secretaria'), ('${U.scPadre}', '${PID[SC]}', 'padre'), ('${U.scPascom}', '${PID[SC]}', 'pascom'),
    ('${U.ngSec}', '${PID[NG]}', 'secretaria'), ('${U.ngPadre}', '${PID[NG]}', 'padre'), ('${U.saSec}', '${PID[SA]}', 'secretaria'), ('${U.saAdmin}', '${PID[SA]}', 'admin');`);
// Solicitações reais de Santa Clara e Graças pelo caminho público (fiel anônimo)
const anon = cliente(db, null);
const respostas = campos => Object.fromEntries((campos || []).filter(f => f.required).map(f => [f.name, f.type === 'date' ? '2020-01-01' : f.type === 'select' ? f.options[0] : 'Teste']));
const criarPedido = async (slug, code, nome, wa, campos) => (await anon.rpc('public_create_service_request', {p_slug:slug, p_service_code:code, p_name:nome, p_whatsapp:wa, p_contact_preference:'whatsapp', p_answers:respostas(campos)}).then(r => { if (r.error) console.log('   erro:', r.error.message); return r.data; }));
const outroSC = (await q(`select code, form_fields from service_catalog where parish_id=$1 and form_fields = '[]'::jsonb limit 1`, [PID[SC]]))[0]
  || (await q(`select code from service_catalog where parish_id=$1 and code='outro'`, [PID[SC]]))[0];
const campos = (await q(`select code, form_fields from service_catalog where parish_id=$1 order by sort_order`, [PID[SC]]));
const semObrig = campos.find(c => !(c.form_fields || []).some(f => f.required)) || campos[0];
const pSC1 = await criarPedido(SC, semObrig.code, 'Fiel Santa Clara Um', '31990001001', semObrig.form_fields);
const pSC2 = await criarPedido(SC, semObrig.code, 'Fiel Santa Clara Dois', '31990001002', semObrig.form_fields);
const pNG = await criarPedido(NG, 'outro', 'Fiel Graças', '31990002001');
t('solicitações criadas pelo fluxo público', pSC1?.protocol && pSC2?.protocol && pNG?.protocol, {pSC1, pNG, code:semObrig.code});
const idSC1 = (await q(`select id from service_requests where protocol=$1`, [pSC1.protocol]))[0].id;
const idNG = (await q(`select id from service_requests where protocol=$1`, [pNG.protocol]))[0].id;
const idSA = (await q(`select id from service_requests where parish_id=$1 limit 1`, [PID[SA]]))[0].id;
t('Santo Antônio tem as solicitações de demonstração', !!idSA);

// agente.sql 2x, sem mudar nada que já existe
const TABS = ['parishes','parish_users','parish_state','communities','tither_profiles','service_catalog','service_requests','service_request_history'];
const foto = async () => JSON.stringify(await Promise.all(TABS.map(tb => q(`select * from ${tb} order by 1`)))) + JSON.stringify(await q(`select id, title, starts_at, parish_id from events order by id`));
const antes = await foto();
for (const i of [1, 2]){ let e = null; try { await db.exec(ler('supabase/agente.sql')); } catch(x){ e = x.message; } t(`agente.sql rodou (${i}ª vez)`, !e, e); }
t('agente.sql não muda nenhum dado existente', await foto() === antes);
t('events.source existe com padrão "painel"', (await q(`select column_default from information_schema.columns where table_name='events' and column_name='source'`))[0]?.column_default?.includes('painel'));
t('can_access não foi alterada (PASCOM continua sem secretaria24h)', !(await q(`select pg_get_functiondef('can_access(uuid,text)'::regprocedure) d`))[0].d.match(/pascom' then p_area in \([^)]*secretaria24h/));

// ---------------------------------------------------------------- agentes por usuário
let AGORA = new Date();
const NOMES = {[SA]:'Paróquia Santo Antônio – Jaraguá', [SC]:'Paróquia Santa Clara e São Francisco – Mineirão', [NG]:'Paróquia Nossa Senhora das Graças – Ibirité'};
function sessao(uid, papel, slug){
  const backend = Core.criarBackendSupabase(cliente(db, uid), {slug});
  const ag = Core.criarAgente({backend, agora:() => AGORA});
  const ent = (extra = {}) => ({channel:'painel', sender:{userId:uid, papel}, parish:{id:PID[slug], slug, nome:NOMES[slug]}, timestamp:AGORA.toISOString(), ...extra});
  return {ag, backend, ent, diga:m => ag.receber(ent({message:m}))};
}
const scSec = sessao(U.scSec, 'secretaria', SC), scPadre = sessao(U.scPadre, 'padre', SC), scPascom = sessao(U.scPascom, 'pascom', SC);
const ngSec = sessao(U.ngSec, 'secretaria', NG), saSec = sessao(U.saSec, 'secretaria', SA), saAdmin = sessao(U.saAdmin, 'admin', SA);

console.log('== Santa Clara secretaria → só Santa Clara');
let r = await scSec.diga('Quais solicitações estão pendentes?');
t('vê as 2 solicitações de Santa Clara', /Encontrei 2 solicitações pendentes/.test(texto(r)) && texto(r).includes(pSC1.protocol) && texto(r).includes(pSC2.protocol), texto(r));
t('não vê Graças nem Santo Antônio', !texto(r).includes(pNG.protocol) && !(await q(`select protocol from service_requests where parish_id=$1`, [PID[SA]])).some(x => texto(r).includes(x.protocol)));
r = await scSec.diga('Mostre Santo Antônio.');
t('"Mostre Santo Antônio." → negado (nome real do diretório)', r.tipo === 'negado', texto(r));
r = await scSec.diga('Quais solicitações de Nossa Senhora das Graças estão pendentes?');
t('pedir Graças pelo nome → negado', r.tipo === 'negado', texto(r));
r = await scSec.diga('Mostre a solicitação ' + pNG.protocol);
t('protocolo de Graças → "não encontrei nesta paróquia"', /Não encontrei essa solicitação nesta paróquia/.test(texto(r)), texto(r));
r = await scSec.diga('Quais serviços da secretaria estão disponíveis?');
t('serviços: catálogo real de Santa Clara', r.itens?.length === campos.length && !texto(r).includes('Graças'), texto(r));
r = await scSec.diga('Quais comunidades estão cadastradas?');
t('Santa Clara sem comunidades: "ainda não possui comunidades cadastradas"', texto(r) === 'Esta paróquia ainda não possui comunidades cadastradas.', texto(r));

console.log('== evento: não grava antes; grava depois da confirmação');
const nEv = async pid => (await q(`select count(*)::int n from events where parish_id=$1`, [pid]))[0].n;
const ev0 = await nEv(PID[SC]);
r = await scSec.diga('Crie missa sábado às 19h na comunidade São José');
t('comunidade inexistente: cartão pede escolha, sem inventar', r.tipo === 'confirmacao' && r.confirmacao.faltando.includes('comunidade') && r.confirmacao.editar.comunidades.length === 0, texto(r));
t('nenhuma comunidade criada', (await q(`select count(*)::int n from communities where parish_id=$1`, [PID[SC]]))[0].n === 0);
r = await scSec.ag.corrigir(scSec.ent({confirmacaoId:r.confirmacao.id}), {comunidadeId:'', titulo:'Missa da Comunidade', local:'Matriz'});
t('corrigido para Toda a paróquia', !r.confirmacao.faltando.length && Object.fromEntries(r.confirmacao.campos).Comunidade === 'Toda a paróquia', texto(r));
t('não gravou antes da confirmação', await nEv(PID[SC]) === ev0);
const idConf = r.confirmacao.id;
let c = await ngSec.ag.confirmar(ngSec.ent({confirmacaoId:idConf}));
t('secretaria de Graças não confirma a ação de Santa Clara', c.tipo !== 'feito' && await nEv(PID[SC]) === ev0, texto(c));
c = await scSec.ag.confirmar(scSec.ent({confirmacaoId:idConf}));
t('gravou após a confirmação', c.tipo === 'feito' && await nEv(PID[SC]) === ev0 + 1, c);
const ev = (await q(`select * from events where parish_id=$1 order by created_at desc limit 1`, [PID[SC]]))[0];
t('evento com paróquia da sessão, autor, origem "agente", escopo paróquia', ev.title === 'Missa da Comunidade' && ev.created_by === U.scSec && ev.source === 'agente' && ev.scope === 'parish' && ev.community_id === null && ev.public === true, ev);
const pub = (await q(`select get_public_parish($1) p`, [SC]))[0].p;
t('aparece na agenda pública, sem expor a origem', pub.events?.some(e => e.title === 'Missa da Comunidade') && !pub.events.some(e => 'source' in e || 'created_by' in e), pub.events);
r = await scSec.diga('O que temos sábado?');
t('agenda de sábado mostra o evento criado', texto(r).includes('Missa da Comunidade'), texto(r));

console.log('== solicitação: não muda antes; muda depois da confirmação');
const st = async id => (await q(`select status from service_requests where id=$1`, [id]))[0].status;
const nHist = async id => (await q(`select count(*)::int n from service_request_history where request_id=$1`, [id]))[0].n;
r = await scSec.diga(`Marque ${pSC1.protocol} como em atendimento`);
t('prepara (estado real in_progress)', r.tipo === 'confirmacao' && Object.fromEntries(r.confirmacao.campos)['Nova situação'] === 'Em atendimento', texto(r));
t('não mudou antes da confirmação', await st(idSC1) === 'new' && await nHist(idSC1) === 1);
c = await scSec.ag.confirmar(scSec.ent({confirmacaoId:r.confirmacao.id}));
t('mudou após a confirmação (staff_update_service_request)', c.tipo === 'feito' && await st(idSC1) === 'in_progress', texto(c));
const h = (await q(`select status, note, public_note, created_by from service_request_history where request_id=$1 order by created_at desc limit 1`, [idSC1]))[0];
t('histórico: mudança pública, sem texto, com autor', h.status === 'in_progress' && h.note === null && h.public_note === true && h.created_by === U.scSec, h);
const vis = (await anon.rpc('public_get_service_request', {p_slug:SC, p_protocol:pSC1.protocol, p_whatsapp:'31990001001'})).data;
t('o fiel vê a nova situação no acompanhamento', vis?.status === 'in_progress', vis);

console.log('== Graças secretaria → não acessa Santa Clara (mesmo forçando)');
r = await ngSec.diga('Quais solicitações estão pendentes?');
t('Graças vê só a própria', texto(r).includes(pNG.protocol) && !texto(r).includes(pSC1.protocol) && !texto(r).includes(pSC2.protocol), texto(r));
t('forçar o id de Santa Clara: RLS devolve vazio', (await ngSec.backend.listarSolicitacoes({parishId:PID[SC]})).length === 0);
t('forçar eventos de Santa Clara: nenhum (não é membro)', (await ngSec.backend.listarEventos({parishId:PID[SC], inicio:'2000-01-01', fim:'2100-01-01'})).length === 0);
let e = null; try { await ngSec.backend.atualizarSolicitacao({requestId:idSC1, status:'completed'}); } catch(x){ e = x; }
t('forçar mudança em solicitação de Santa Clara: 42501', e?.code === '42501' && await st(idSC1) === 'in_progress', e);
e = null; try { await ngSec.backend.criarEvento({parishId:PID[SC], evento:{title:'Invasão', starts_at:new Date(Date.now() + 864e5).toISOString(), scope:'parish', source:'agente'}}); } catch(x){ e = x; }
t('forçar evento em Santa Clara: RLS bloqueia', !!e && await nEv(PID[SC]) === ev0 + 1, e);
const falso = sessao(U.ngSec, 'secretaria', SC); // cliente adulterado dizendo que a paróquia é Santa Clara
r = await falso.diga('Quais solicitações estão pendentes?');
t('sessão adulterada (paróquia trocada no cliente): o banco não entrega nada', !texto(r).includes(pSC1.protocol) && !texto(r).includes(pSC2.protocol), texto(r));
r = await falso.diga('Crie missa amanhã às 20h');
c = r.confirmacao ? await falso.ag.confirmar(falso.ent({confirmacaoId:r.confirmacao.id})) : r;
t('sessão adulterada: criar evento em Santa Clara falha e nada é gravado', c.tipo !== 'feito' && await nEv(PID[SC]) === ev0 + 1, texto(c));

console.log('== Santo Antônio isolado; suporte (admin) só no tenant vinculado');
r = await saSec.diga('Quais solicitações estão pendentes?');
t('Santo Antônio não vê Santa Clara nem Graças', !texto(r).includes(pSC2.protocol) && !texto(r).includes(pNG.protocol), texto(r));
t('admin de Santo Antônio não lê Santa Clara', (await saAdmin.backend.listarSolicitacoes({parishId:PID[SC]})).length === 0 && (await saAdmin.backend.listarComunidades({parishId:PID[SC]})).length === 0);
e = null; try { await saAdmin.backend.atualizarSolicitacao({requestId:idNG, status:'closed'}); } catch(x){ e = x; }
t('admin de Santo Antônio não altera Graças', e?.code === '42501' && await st(idNG) === 'new');

console.log('== PASCOM não ganha Secretaria 24h');
r = await scPascom.diga('Quais solicitações estão pendentes?');
t('Assistente nega à PASCOM', r.tipo === 'negado', texto(r));
t('mesmo direto no banco: PASCOM não lê solicitações', (await scPascom.backend.listarSolicitacoes({parishId:PID[SC]})).length === 0);
e = null; try { await scPascom.backend.atualizarSolicitacao({requestId:idSC1, status:'completed'}); } catch(x){ e = x; }
t('PASCOM não muda status (42501)', e?.code === '42501');

console.log('== anônimo: sem Assistente administrativo');
const anonB = Core.criarBackendSupabase(anon, {slug:SC});
t('anon não lê solicitações', !!(await anon.from('service_requests').select('id').eq('parish_id', PID[SC])).error);
t('anon não lê eventos direto', !!(await anon.from('events').select('id').eq('parish_id', PID[SC])).error);
e = null; try { await anonB.atualizarSolicitacao({requestId:idSC1, status:'closed'}); } catch(x){ e = x; } t('anon não altera status', !!e && await st(idSC1) === 'in_progress');
t('anon não grava auditoria', !!(await anon.rpc('agent_log_action', {p_parish:PID[SC], p_channel:'painel', p_tool:'x_y', p_result:'ok', p_confirmed:false})).error);
r = await Core.criarAgente({backend:anonB}).receber({channel:'painel', parish:{id:PID[SC], nome:'x'}, message:'Quais solicitações estão pendentes?'});
t('núcleo recusa sem usuário', r.tipo === 'negado');

console.log('== auditoria (agent_audit_log)');
const aud = await q(`select * from agent_audit_log where parish_id=$1 order by created_at`, [PID[SC]]);
t('registrou as ferramentas usadas em Santa Clara', aud.some(a => a.tool === 'consultar_solicitacoes' && a.user_id === U.scSec) && aud.some(a => a.tool === 'criar_evento_confirmado' && a.result === 'ok' && a.human_confirmed) && aud.some(a => a.tool === 'atualizar_solicitacao_confirmada' && a.human_confirmed));
t('negação cross-tenant registrada', aud.some(a => a.tool === 'outra_paroquia' && a.result === 'negado'));
t('só colunas mínimas (sem mensagem)', Object.keys(aud[0]).sort().join() === 'channel,created_at,human_confirmed,id,parish_id,result,tool,user_id', Object.keys(aud[0]));
t('Graças não gravou auditoria em Santa Clara (o adulterado foi recusado)', !aud.some(a => a.user_id === U.ngSec));
t('secretaria não lê a auditoria', (await cliente(db, U.scSec).from('agent_audit_log').select('id').eq('parish_id', PID[SC])).data.length === 0);
t('padre de Santa Clara lê a auditoria da própria paróquia', (await cliente(db, U.scPadre).from('agent_audit_log').select('id').eq('parish_id', PID[SC])).data.length === aud.length);
t('padre de Graças não lê Santa Clara', (await cliente(db, U.ngPadre).from('agent_audit_log').select('id').eq('parish_id', PID[SC])).data.length === 0);
t('não dá para gravar auditoria em outra paróquia', (await cliente(db, U.ngSec).rpc('agent_log_action', {p_parish:PID[SC], p_channel:'painel', p_tool:'teste', p_result:'ok', p_confirmed:false})).error?.code === '42501');
t('nem inserir direto na tabela', !!(await cliente(db, U.scSec).from('agent_audit_log').insert({parish_id:PID[SC], channel:'painel', tool:'x', result:'ok'}).select('id').single()).error);

console.log('== proposta: staff_update_service (não ativa no Assistente)');
await db.exec(ler('supabase/agente_servicos_proposta.sql')); await db.exec(ler('supabase/agente_servicos_proposta.sql'));
const svc = (await q(`select id, title, code, form_fields from service_catalog where parish_id=$1 order by sort_order limit 1`, [PID[SC]]))[0];
let x = await cliente(db, U.scSec).rpc('staff_update_service', {p_service:svc.id, p_changes:{title:'Batismo – novo texto', active:true}});
t('secretaria de Santa Clara edita campos permitidos', !x.error && x.data.title === 'Batismo – novo texto', x);
for (const k of ['code', 'form_fields', 'parish_id', 'id']){
  x = await cliente(db, U.scSec).rpc('staff_update_service', {p_service:svc.id, p_changes:{[k]:'x'}});
  t(`campo "${k}" não permitido`, /campo_nao_permitido/.test(x.error?.message), x);
}
x = await cliente(db, U.scPascom).rpc('staff_update_service', {p_service:svc.id, p_changes:{title:'PASCOM'}});
t('PASCOM não edita', x.error?.code === '42501');
x = await cliente(db, U.ngSec).rpc('staff_update_service', {p_service:svc.id, p_changes:{title:'Graças'}});
t('Graças não edita serviço de Santa Clara', x.error?.code === '42501');
x = await anon.rpc('staff_update_service', {p_service:svc.id, p_changes:{title:'anon'}});
t('anon não executa', !!x.error);
t('escrita direta na tabela continua fechada', !!(await cliente(db, U.scSec).from('service_catalog').insert({parish_id:PID[SC], code:'novo', title:'Novo'}).select('id').single()).error);
t('código e formulário intactos', JSON.stringify((await q(`select code, form_fields from service_catalog where id=$1`, [svc.id]))[0]) === JSON.stringify({code:svc.code, form_fields:svc.form_fields}));

console.log('== banco SEM agente.sql (produção de hoje): o Assistente funciona do mesmo jeito');
const db2 = await criarBanco({agente:false});
const pid2 = (await db2.query(`select id from parishes where slug=$1`, [SC])).rows[0].id;
await db2.exec(`insert into auth.users values ('${U.scSec}', 's@t'); insert into parish_users values ('${U.scSec}', '${pid2}', 'secretaria');`);
const b2 = Core.criarBackendSupabase(cliente(db2, U.scSec), {slug:SC});
const ag2 = Core.criarAgente({backend:b2});
const ent2 = m => ({channel:'painel', sender:{userId:U.scSec, papel:'secretaria'}, parish:{id:pid2, slug:SC, nome:NOMES[SC]}, message:m});
r = await ag2.receber(ent2('Crie missa amanhã às 20h'));
c = await ag2.confirmar({...ent2(''), confirmacaoId:r.confirmacao.id});
t('cria evento sem a coluna source (tenta de novo sem ela)', c.tipo === 'feito' && (await db2.query(`select count(*)::int n from events where parish_id=$1`, [pid2])).rows[0].n === 1, texto(c));
r = await ag2.receber(ent2('Quais comunidades estão cadastradas?'));
t('sem agent_log_action: auditoria não derruba a resposta', /ainda não possui comunidades/.test(texto(r)), texto(r));

console.log(`\n${ok} ok, ${falha} falhas`);
process.exit(falha ? 1 : 0);
