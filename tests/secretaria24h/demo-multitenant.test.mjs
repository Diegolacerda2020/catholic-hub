// Pacote DEMO multi-paróquia (supabase/demo_multitenant_seed.sql + demo_multitenant_cleanup.sql) no SQL real (PGlite),
// sobre um banco equivalente à produção depois da homologação do diretório:
// schema de bbb34e1 + DEMO antigo de Santo Antônio + Secretaria 24h + diretório + ativação das 3 paróquias
// + dados "reais" de Santo Antônio (para provar que não mudam).
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { execSync } from 'node:child_process';
import { STUB, ler } from './banco.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const base = f => execSync(`git show bbb34e1:${f}`, {cwd:REPO}).toString();
let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 500)); };
const erro = async p => { try { await p; return null; } catch(e){ return e.message; } };
async function como(db, uid, fn){
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
const SA = 'santo-antonio-jaragua', SC = 'santa-clara-e-sao-francisco-mineirao', NG = 'nossa-senhora-das-gracas-ibirite';

const db = new PGlite({extensions:{pgcrypto}});
await db.exec(STUB);
await db.exec(base('supabase/schema.sql'));
await db.exec(base('supabase/demo_seed.sql'));
await db.exec(ler('supabase/secretaria24h.sql'));
await db.exec(ler('supabase/demo_secretaria_seed.sql'));
for (const f of ['supabase/diretorio.sql', 'supabase/diretorio_seed.sql', 'supabase/diretorio_ativacao.sql']) await db.exec(ler(f));
const PID = {}; for (const s of [SA, SC, NG]) PID[s] = (await rows(`select id from parishes where slug=$1`, [s]))[0].id;
// equipe real de Santo Antônio + usuários de TESTE para B e C (só neste banco local)
const U = {[SA]:'00000000-0000-0000-0000-0000000000b1', [SC]:'00000000-0000-0000-0000-00000000bb01', [NG]:'00000000-0000-0000-0000-00000000cc01'};
await db.exec(`insert into auth.users values ('${U[SA]}','sec@sa'),('${U[SC]}','sec@sc'),('${U[NG]}','sec@ng');
  insert into parish_users values ('${U[SA]}','${PID[SA]}','secretaria'),('${U[SC]}','${PID[SC]}','secretaria'),('${U[NG]}','${PID[NG]}','secretaria');`);
// dados "reais" de Santo Antônio
await db.exec(`update parish_state set data = data || '{"cfg":{"nome":"Paróquia Santo Antônio – Jaraguá","missas":"Domingo: 07h30"},"avisos":[{"id":1790000000000001,"ts":1790000000000,"titulo":"Aviso real"}],"intencoes":[{"id":1790000000000002,"por":"Intenção real","status":"nova","data":"2099-01-01","hora":"10h"}],"velas":[{"id":1790000000000003,"ts":1,"para":"mim"}]}'::jsonb where parish_id='${PID[SA]}';
  insert into events (parish_id, title, starts_at) values ('${PID[SA]}', 'Evento real', now() + interval '3 day');
  insert into tither_profiles (parish_id, name, whatsapp) values ('${PID[SA]}', 'Dizimista real', '31988887777');
  insert into tither_leads (parish_id, name, whatsapp, consent) values ('${PID[SA]}', 'Interessado real', '31988886666', true);`);
await como(db, null, () => db.query(`select public_create_service_request('${SA}', 'outro', 'Fiel real', '31977775555', 'whatsapp', '{"mensagem":"pedido real"}'::jsonb)`));

const TAB = ['parishes','parish_users','parish_state','events','communities','tither_profiles','tither_contributions','tither_leads','service_catalog','service_requests','service_request_history'];
const foto = async (filtro = '') => Object.fromEntries(await Promise.all(TAB.map(async tb => [tb, (await rows(`select * from ${tb} ${tb === 'parishes' ? (filtro ? `where id ${filtro}` : '') : tb === 'parish_users' ? (filtro ? `where parish_id ${filtro}` : '') : (filtro ? `where parish_id ${filtro}` : '')} order by 1, 2`)).map(r => JSON.stringify(r))])));
const usuariosAntes = (await rows(`select count(*)::int n from auth.users`))[0].n, vinculosAntes = (await rows(`select count(*)::int n from parish_users`))[0].n;
const antes = await foto();
const conferencia = async () => Object.fromEntries((await rows(ler('supabase/demo_multitenant_seed.sql').split('-- ---------- Conferência')[1].replace(/^[^\n]*\n/, ''))).map(r => [r.slug, r]));
const semear = () => db.exec(ler('supabase/demo_multitenant_seed.sql'));
const limpar = (slugs = [SA, SC, NG]) => db.exec(slugs ? ler('supabase/demo_multitenant_cleanup.sql').replace(/alvos text\[\] := array\[[^\]]*\](?:::text\[\])?; -- ←/,`alvos text[] := array[${slugs.map(s => `'${s}'`).join(', ')}]; -- ←`) : ler('supabase/demo_multitenant_cleanup.sql'));

console.log('== seed');
t('seed roda sem erro', !(await erro(semear())));
let c = await conferencia();
const num = o => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'slug').map(([k, v]) => [k, +v]));
t('Santa Clara: cenário completo', (({contribuicoes, ...o}) => JSON.stringify(o) === JSON.stringify({eventos:4, dizimistas:8, interessados:2, solicitacoes_s24:4, avisos:3, intencoes:3, velas:6}) && contribuicoes >= 14)(num(c[SC])), JSON.stringify(num(c[SC])));
t('N. Sra. das Graças: cenário completo', JSON.stringify(num(c[NG])) === JSON.stringify(num(c[SC])), JSON.stringify(num(c[NG])));
t('Santo Antônio: só o que faltava (DEMO antigo de eventos, dizimistas e Secretaria 24h não é duplicado)', JSON.stringify(num(c[SA])) === JSON.stringify({eventos:0, dizimistas:0, contribuicoes:0, interessados:2, solicitacoes_s24:0, avisos:3, intencoes:3, velas:6}), JSON.stringify(num(c[SA])));
const legadoSA = (await rows(`select (select count(*) from events where parish_id=$1 and description like '%[Evento de demonstração]')::int ev, (select count(*) from tither_profiles where parish_id=$1 and notes like '[DEMO]%')::int diz, (select count(*) from service_requests where parish_id=$1 and is_demo)::int s24`, [PID[SA]]))[0];
t('Santo Antônio continua com o DEMO antigo: 4 eventos, 12 dizimistas, 5 solicitações', legadoSA.ev === 4 && legadoSA.diz === 12 && legadoSA.s24 === 5, JSON.stringify(legadoSA));

console.log('== nada existente mudou; nenhum usuário/vínculo criado');
const depois1 = await foto();
const mudados = [];
for (const tb of TAB){ const nov = new Set(depois1[tb]); for (const r of antes[tb]) if (!nov.has(r)) mudados.push(tb); }
t('todo registro que já existia está idêntico (exceto parish_state, que só ganha itens)', mudados.filter(x => x !== 'parish_state').length === 0, [...new Set(mudados)].join());
const estAntes = Object.fromEntries(antes.parish_state.map(r => { const o = JSON.parse(r); return [o.parish_id, o.data]; }));
const estDepois = Object.fromEntries((await rows(`select parish_id, data from parish_state`)).map(r => [r.parish_id, r.data]));
const soAcrescentou = Object.entries(estAntes).every(([pid, d]) => Object.keys(d).every(k => Array.isArray(d[k]) ? JSON.stringify(estDepois[pid][k].slice(0, d[k].length)) === JSON.stringify(d[k]) : JSON.stringify(estDepois[pid][k]) === JSON.stringify(d[k])));
t('parish_state: itens e configurações que já existiam ficaram iguais (só acrescentou no fim das listas)', soAcrescentou);
t('dados reais de Santo Antônio intactos (aviso, intenção, vela, evento, dizimista, interessado, solicitação)',
  ['Aviso real'].every(x => estDepois[PID[SA]].avisos.some(a => a.titulo === x)) && estDepois[PID[SA]].intencoes.some(i => i.por === 'Intenção real') && estDepois[PID[SA]].velas.some(v => v.id === 1790000000000003)
  && (await rows(`select count(*)::int n from events where title='Evento real'`))[0].n === 1 && (await rows(`select count(*)::int n from service_requests where requester_name='Fiel real'`))[0].n === 1);
t('nenhum auth.users criado', (await rows(`select count(*)::int n from auth.users`))[0].n === usuariosAntes);
t('nenhum parish_users criado', (await rows(`select count(*)::int n from parish_users`))[0].n === vinculosAntes);

console.log('== idempotência');
const aposUm = JSON.stringify(await foto());
t('seed 2ª vez roda sem erro', !(await erro(semear())));
t('seed 2x: banco idêntico (nada duplicado, parish_state nem reescrito)', JSON.stringify(await foto()) === aposUm);

console.log('== ids independentes');
const idsDe = async s => (await rows(`select id::text from events where parish_id=$1 union all select id::text from tither_profiles where parish_id=$1 union all select id::text from tither_leads where parish_id=$1
  union all select id::text from service_requests where parish_id=$1 union all select id::text from service_catalog where parish_id=$1 union all select id::text from service_request_history where parish_id=$1 union all select id::text from tither_contributions where parish_id=$1`, [PID[s]])).map(r => r.id);
const I = {}; for (const s of [SA, SC, NG]) I[s] = new Set(await idsDe(s));
t('nenhum id repetido entre as 3 paróquias', ![...I[SC]].some(x => I[SA].has(x) || I[NG].has(x)) && ![...I[NG]].some(x => I[SA].has(x)));
const jsonIds = s => [...estDepois[PID[s]].avisos, ...estDepois[PID[s]].intencoes, ...estDepois[PID[s]].velas].filter(x => x.demo).map(x => x.id);
t('itens DEMO de parish_state com ids próprios de cada paróquia', jsonIds(SC).every(x => !jsonIds(SA).includes(x) && !jsonIds(NG).includes(x)) && jsonIds(SC).length === 12);
const protos = await rows(`select protocol from service_requests where is_demo`);
t('protocolos DEMO únicos', new Set(protos.map(r => r.protocol)).size === protos.length);
t('serviços DEMO inativos: a página pública de B e C não oferece a Secretaria 24h', (await rows(`select public_service_catalog($1) a, public_service_catalog($2) b`, [SC, NG])).every(r => r.a.length === 0 && r.b.length === 0));

console.log('== isolamento (cada equipe só vê a própria paróquia)');
const TAB_EQ = ['events','tither_profiles','tither_contributions','tither_leads','service_catalog','service_requests','service_request_history','parish_state'];
for (const s of [SA, SC, NG]){
  const outros = [];
  for (const tb of TAB_EQ){ const r = await como(db, U[s], async () => rows(`select parish_id::text p from ${tb}`)); if (!r.length || r.some(x => x.p !== PID[s])) outros.push(`${tb}(${r.length})`); }
  t(`${s}: vê só os próprios dados (DEMO e reais)`, !outros.length, outros.join(' '));
}
t('visitante não lê nenhuma tabela direto', (await Promise.all(TAB_EQ.map(tb => como(db, null, () => erro(db.query(`select * from ${tb}`)))))).every(Boolean));

console.log('== alteração independente');
const almoco = async () => Object.fromEntries((await rows(`select p.slug, e.title, e.starts_at::text s from events e join parishes p on p.id=e.parish_id where e.id in (select md5('cp-demo-v1|' || p2.id || '|evento|2')::uuid from parishes p2)`)).map(r => [r.slug, r.title + '|' + r.s]));
const alm0 = await almoco();
await como(db, U[SC], () => db.query(`update events set title = 'Almoço Beneficente (alterado por Santa Clara)', starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = md5('cp-demo-v1|' || $1 || '|evento|2')::uuid`, [PID[SC]]));
const alm1 = await almoco();
t('Santa Clara alterou o próprio evento DEMO', alm1[SC].startsWith('Almoço Beneficente (alterado por Santa Clara)'));
t('o evento correspondente de Graças não mudou', alm1[NG] === alm0[NG]);
t('Santa Clara tentando alterar o evento de Graças: 0 linhas', (await como(db, U[SC], async () => (await db.query(`update events set title='invasão' where id = md5('cp-demo-v1|' || $1 || '|evento|2')::uuid`, [PID[NG]])).affectedRows)) === 0 && (await almoco())[NG] === alm0[NG]);
const reqs = async () => Object.fromEntries((await rows(`select p.slug || ':' || r.requester_name k, r.status || '|' || (select count(*) from service_request_history h where h.request_id=r.id) v from service_requests r join parishes p on p.id=r.parish_id`)).map(x => [x.k, x.v]));
const r0 = await reqs();
await como(db, U[NG], () => db.query(`select staff_update_service_request(md5('cp-demo-v1|' || $1 || '|solicitacao|1')::uuid, 'in_progress', 'Atendendo (Graças)', true)`, [PID[NG]]));
const r1 = await reqs();
const mudou = Object.keys(r1).filter(k => r1[k] !== r0[k]);
t('Graças alterou a própria solicitação DEMO (status + histórico)', mudou.length === 1 && mudou[0] === `${NG}:Lara Exemplo Campos` && r1[mudou[0]].startsWith('in_progress|'), mudou.join());
t('nenhuma solicitação de outra paróquia mudou', mudou.every(k => k.startsWith(NG + ':')));
t('Graças não altera a solicitação DEMO de Santa Clara', (await como(db, U[NG], () => erro(db.query(`select staff_update_service_request(md5('cp-demo-v1|' || $1 || '|solicitacao|1')::uuid, 'closed', null, false)`, [PID[SC]]))))?.includes('Sem permissão'));
// equipe de Santa Clara cria um registro próprio (não DEMO) e apaga um dizimista DEMO
await como(db, U[SC], async () => { await db.query(`insert into events (parish_id, title, starts_at) values ($1, 'Evento criado pela equipe de Santa Clara', now() + interval '2 day')`, [PID[SC]]);
  await db.query(`delete from tither_profiles where id = md5('cp-demo-v1|' || $1 || '|dizimista|8')::uuid`, [PID[SC]]); });
t('Santa Clara apagou um dizimista DEMO dela; os de SA e Graças continuam', (await rows(`select count(*)::int n from tither_profiles where id in (select md5('cp-demo-v1|' || id || '|dizimista|8')::uuid from parishes)`))[0].n === 1);
t('seed de novo depois das edições: não duplica e não desfaz a edição', !(await erro(semear())) && (await almoco())[SC].startsWith('Almoço Beneficente (alterado') && +(await conferencia())[SC].eventos === 4);

console.log('== cleanup seletivo (só Santa Clara)');
const outrosAntes = JSON.stringify(await foto(`<> '${PID[SC]}'`));
t('cleanup de Santa Clara roda sem erro', !(await erro(limpar([SC]))));
const outrosDepois = await foto(`<> '${PID[SC]}'`), oa = JSON.parse(outrosAntes);
const dif = Object.keys(oa).filter(k => JSON.stringify(oa[k]) !== JSON.stringify(outrosDepois[k])).map(k => k + ': ' + oa[k].filter(x => !outrosDepois[k].includes(x)).slice(0, 2).join(' || ').slice(0, 300) + ' => ' + outrosDepois[k].filter(x => !oa[k].includes(x)).slice(0, 2).join(' || ').slice(0, 300));
t('Santo Antônio e Graças: absolutamente nada mudou', !dif.length, dif.join(' ### '));
c = await conferencia();
t('Santa Clara: DEMO do pacote zerado', Object.values(num(c[SC])).every(v => v === 0), JSON.stringify(num(c[SC])));
t('Santa Clara: o que a equipe criou continua', (await rows(`select count(*)::int n from events where title='Evento criado pela equipe de Santa Clara'`))[0].n === 1);
t('Santa Clara: serviços DEMO removidos, estado sem itens DEMO', (await rows(`select count(*)::int n from service_catalog where parish_id=$1`, [PID[SC]]))[0].n === 0 && !JSON.stringify((await rows(`select data from parish_state where parish_id=$1`, [PID[SC]]))[0].data).includes('"demo"'));
t('Graças e Santo Antônio seguem com o DEMO delas', +c[NG].eventos === 4 && +c[NG].solicitacoes_s24 === 4 && +c[SA].avisos === 3);
t('cleanup não toca no DEMO antigo de Santo Antônio', (await rows(`select count(*)::int n from service_requests where parish_id=$1 and is_demo`, [PID[SA]]))[0].n === 5);

console.log('== cleanup sem escolher paróquia não apaga nada');
{ const antesVazio = JSON.stringify(await foto()); const e = await erro(db.exec(ler('supabase/demo_multitenant_cleanup.sql')));
  t('lista vazia: para com aviso e não apaga nada', /Nada foi apagado: escreva na linha/.test(e || '') && JSON.stringify(await foto()) === antesVazio, e);
  const e2 = await erro(limpar(['paroquia-que-nao-existe'])); t('paróquia desconhecida: para e não apaga nada', /paróquia desconhecida/.test(e2 || '') && JSON.stringify(await foto()) === antesVazio, e2); }
console.log('== cleanup de todas + seed de novo');
t('cleanup de todas', !(await erro(limpar())) && Object.values(await conferencia()).every(r => Object.values(num(r)).every(v => v === 0)));
t('dados reais de Santo Antônio continuam', (await rows(`select count(*)::int n from service_requests where requester_name='Fiel real'`))[0].n === 1 && JSON.stringify((await rows(`select data->'avisos' a from parish_state where parish_id=$1`, [PID[SA]]))[0].a) === JSON.stringify(estAntes[PID[SA]].avisos));
t('seed recria o cenário', !(await erro(semear())) && +(await conferencia())[SC].solicitacoes_s24 === 4);
t('no fim: nenhum auth.users nem parish_users a mais', (await rows(`select count(*)::int n from auth.users`))[0].n === usuariosAntes && (await rows(`select count(*)::int n from parish_users`))[0].n === vinculosAntes);

console.log(`\n${ok} ok, ${falha} falha(s)`);
process.exit(falha ? 1 : 0);
