// Diretório Arquidiocesano + 3 paróquias ativas + isolamento entre tenants, no SQL de verdade (PGlite).
// Parte do banco equivalente à produção atual (schema de bbb34e1 + dados DEMO + Secretaria 24h aplicada),
// roda diretorio.sql, diretorio_seed.sql e diretorio_ativacao.sql DUAS vezes cada e confere:
//   - nada existente mudou (a não ser o directory_id de Santo Antônio);
//   - 278 entradas do Catálogo 2026 por tipo; só 3 ativas; ninguém ativa pela internet;
//   - tenants novos começam vazios, sem nada copiado de Santo Antônio;
//   - cada equipe só enxerga a própria paróquia em todas as tabelas e funções.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { execSync } from 'node:child_process';
import { STUB, ler } from './banco.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const base = f => execSync(`git show bbb34e1:${f}`, {cwd:REPO}).toString();
let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 400)); };
const erro = async p => { try { await p; return null; } catch(e){ return e.message; } };
async function como(db, uid, fn){
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const q1 = async (db, sql, p = []) => (await db.query(sql, p)).rows;

console.log('== banco equivalente à produção + diretório 2x');
const db = new PGlite({extensions:{pgcrypto}});
await db.exec(STUB);
await db.exec(base('supabase/schema.sql'));
await db.exec(base('supabase/demo_seed.sql'));
await db.exec(ler('supabase/secretaria24h.sql'));
await db.exec(ler('supabase/demo_secretaria_seed.sql'));
await db.exec(`update parish_state set data = data || '{"cfg":{"nome":"Paróquia Santo Antônio – Jaraguá","endereco":"Praça Santo Antônio, 2","missas":"Domingo: 07h30","pix":"chave-sa"},"avisos":[{"id":1,"ts":1,"titulo":"Aviso de Santo Antônio"}],"intencoes":[{"id":2,"por":"Intenção de SA","status":"nova","data":"2099-01-01"}],"velas":[]}'::jsonb`);

const TABELAS = ['parishes','parish_users','parish_state','events','communities','tither_profiles','tither_contributions','tither_leads','service_catalog','service_requests','service_request_history'];
const foto = async () => Object.fromEntries(await Promise.all(TABELAS.map(async tb => [tb, JSON.stringify(await q1(db, `select * from ${tb} order by 1, 2`))])));
const antes = await foto();
const sa0 = (await q1(db, `select id from parishes where slug='santo-antonio-jaragua'`))[0].id;

for (let i = 1; i <= 2; i++){
  for (const f of ['supabase/diretorio.sql', 'supabase/diretorio_seed.sql', 'supabase/diretorio_ativacao.sql']){
    const e = await erro(db.exec(ler(f)));
    t(`${f} (${i}ª vez) roda sem erro`, !e, e);
  }
}
const depois = await foto();
for (const tb of TABELAS.filter(x => x !== 'parishes' && x !== 'parish_state')) t(`${tb}: nenhum registro existente mudou`, antes[tb] === depois[tb]);
const saAntes = JSON.parse(antes.parish_state).find(r => r.parish_id === sa0), saDepois = (await q1(db, `select * from parish_state where parish_id=$1`, [sa0]))[0];
t('parish_state de Santo Antônio idêntico', JSON.stringify(saAntes) === JSON.stringify(saDepois));
const pa = await q1(db, `select slug, name, active from parishes where slug='santo-antonio-jaragua'`);
t('parishes de Santo Antônio igual (só ganhou directory_id)', JSON.stringify(pa) === JSON.stringify(JSON.parse(antes.parishes).filter(r => r.slug === 'santo-antonio-jaragua').map(({slug, name, active}) => ({slug, name, active}))));

console.log('== diretório');
const tipos = Object.fromEntries((await q1(db, `select type, count(*)::int n from parish_directory group by type`)).map(r => [r.type, r.n]));
t('278 entradas do Catálogo 2026 (sem duplicar na 2ª carga)', (await q1(db, `select count(*)::int n from parish_directory`))[0].n === 278, tipos);
t('por tipo: 273 territoriais, 2 pessoais, 1 militar, 1 curato, 1 área pastoral', tipos.paroquia_territorial === 273 && tipos.paroquia_pessoal === 2 && tipos.paroquia_militar === 1 && tipos.curato === 1 && tipos.area_pastoral === 1 && Object.keys(tipos).length === 5, JSON.stringify(tipos));
t('curato e área pastoral NÃO são paróquia', (await q1(db, `select count(*)::int n from parish_directory where type like 'paroquia%' and (name ilike 'curato%' or catalog_code = '292')`))[0].n === 0);
const st = Object.fromEntries((await q1(db, `select status, count(*)::int n from parish_directory group by status`)).map(r => [r.status, r.n]));
t('exatamente 3 active, 275 listed', st.active === 3 && st.listed === 275, JSON.stringify(st));
const ativas = await q1(db, `select d.catalog_code, d.slug, p.slug tenant, p.name from parish_directory d join parishes p on p.directory_id = d.id order by 1`);
t('3 tenants ligados ao diretório', JSON.stringify(ativas.map(a => [a.catalog_code, a.tenant])) === JSON.stringify([['009','nossa-senhora-das-gracas-ibirite'],['013','santo-antonio-jaragua'],['207','santa-clara-e-sao-francisco-mineirao']]), JSON.stringify(ativas));
t('nomes dos tenants novos', ativas.map(a => a.name).includes('Paróquia Santa Clara e São Francisco – Mineirão') && ativas.map(a => a.name).includes('Paróquia Nossa Senhora das Graças – Ibirité'), ativas.map(a => a.name));
t('parishes: 3 tenants no total (as outras paróquias NÃO viram tenant)', (await q1(db, `select count(*)::int n from parishes`))[0].n === 3);

const busca = (q, uid = null) => como(db, uid, async () => (await q1(db, `select public_directory_search($1, 30) r`, [q]))[0].r);
let r = await busca('ibirite graças');
t('busca "ibirite graças": N. Sra. das Graças ativa, com tenant', r[0]?.name === 'Nossa Senhora das Graças' && r[0].active && r[0].tenant_slug === 'nossa-senhora-das-gracas-ibirite', JSON.stringify(r).slice(0, 300));
r = await busca('MINEIRÃO');
t('busca sem acento e sem maiúscula (Mineirão)', r.some(x => x.tenant_slug === 'santa-clara-e-sao-francisco-mineirao'));
r = await busca('são bernardo');
t('paróquia listed aparece sem tenant (não ativa)', r.length && r.every(x => !x.active && x.tenant_slug === null), JSON.stringify(r).slice(0, 200));
r = await busca('pampulha');
t('busca por forania', r.some(x => x.forania === 'Santo Antônio (Pampulha)'));
r = await busca('contagem');
t('busca por município', r.length >= 10 && r.every(x => x.municipality === 'Contagem' || /contagem/i.test(x.name + x.neighborhood + x.forania)));
r = await busca('');
t('sem texto: só as 3 ativas', r.length === 3 && r.every(x => x.active));
r = await busca("'; drop table parishes; --");
t('busca com texto malicioso não quebra', Array.isArray(r) && (await q1(db, `select count(*)::int n from parishes`))[0].n === 3);
const ficha = (await como(db, null, async () => q1(db, `select public_directory_entry('santa-clara-e-sao-francisco-mineirao') r`)))[0].r;
t('ficha pública com dados do catálogo', ficha.address === 'Rua Mafalda Guimarães Corrieri, 610' && ficha.pastor_name === 'Pe. Bráulio Francisco Tibúrcio' && ficha.catalog_code === '207' && ficha.active);

console.log('== ninguém ativa pela internet');
for (const [quem, uid] of [['anon', null], ['equipe logada', '00000000-0000-0000-0000-0000000000b1']]){
  t(`${quem}: não lê o diretório direto`, !!(await como(db, uid, () => erro(db.query(`select * from parish_directory`)))));
  t(`${quem}: não muda status`, !!(await como(db, uid, () => erro(db.query(`update parish_directory set status='active' where catalog_code='030'`)))));
  t(`${quem}: não cria tenant`, !!(await como(db, uid, () => erro(db.query(`insert into parishes (slug, name) values ('bom-pastor-dom-cabral','x')`)))));
  t(`${quem}: não chama as funções internas`, !!(await como(db, uid, () => erro(db.query(`select dir_tenant_slug(gen_random_uuid(), 'active')`)))));
}
const fnPublicas = (await q1(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).map(x => x.proname);
t('funções abertas ao visitante: nenhuma nova que escreva no diretório', fnPublicas.filter(f => /dir|directory/.test(f)).join() === 'public_directory_entry,public_directory_search', fnPublicas.join());
t('Bom Pastor (listed) continua listed', (await q1(db, `select status from parish_directory where catalog_code='030'`))[0].status === 'listed');

console.log('== tenants novos começam vazios (nada de Santo Antônio)');
const pub = async slug => (await como(db, null, async () => q1(db, `select get_public_parish($1) g`, [slug])))[0].g;
for (const slug of ['santa-clara-e-sao-francisco-mineirao', 'nossa-senhora-das-gracas-ibirite']){
  const g = await pub(slug), s = JSON.stringify(g);
  t(`${slug}: página pública responde com o próprio nome`, g && g.slug === slug && g.cfg.nome === g.name);
  t(`${slug}: sem avisos, eventos, comunidades nem velas`, g.avisos.length === 0 && g.events.length === 0 && g.communities.length === 0 && g.velasHoje === 0);
  t(`${slug}: nenhum dado de Santo Antônio`, !/Santo Antônio|Jaraguá|chave-sa|Domingo: 07h30|Aviso de Santo/.test(s), s.slice(0, 300));
  t(`${slug}: missas vazias (sem inventar horário)`, g.cfg.missas === '');
  t(`${slug}: sem catálogo da Secretaria 24h (não copiou o de SA)`, (await como(db, null, async () => q1(db, `select public_service_catalog($1) c`, [slug])))[0].c.length === 0);
}
const gra = await pub('nossa-senhora-das-gracas-ibirite');
t('N. Sra. das Graças: endereço/telefone/pároco do catálogo', gra.cfg.endereco === 'Rua Hilário Ferreira Freitas, 166 – Centro – Ibirité – MG, CEP 32400-000' && gra.cfg.telefone === '(31) 99518-0567' && /Willams/.test(gra.cfg.paroco), JSON.stringify(gra.cfg));

console.log('== isolamento entre as 3 paróquias');
const SL = {A:'santo-antonio-jaragua', B:'santa-clara-e-sao-francisco-mineirao', C:'nossa-senhora-das-gracas-ibirite'};
const PID = {}; for (const [k, s] of Object.entries(SL)) PID[k] = (await q1(db, `select id from parishes where slug=$1`, [s]))[0].id;
const U = {A:'00000000-0000-0000-0000-00000000aa01', B:'00000000-0000-0000-0000-00000000bb01', C:'00000000-0000-0000-0000-00000000cc01'};
const P = {A:'00000000-0000-0000-0000-00000000aa02', B:'00000000-0000-0000-0000-00000000bb02', C:'00000000-0000-0000-0000-00000000cc02'};
for (const k of 'ABC'){
  await db.exec(`insert into auth.users values ('${U[k]}','sec${k}@x'),('${P[k]}','padre${k}@x');
    insert into parish_users values ('${U[k]}','${PID[k]}','secretaria'),('${P[k]}','${PID[k]}','padre');
    insert into communities (parish_id, name, slug) values ('${PID[k]}','Comunidade ${k}','com-${k.toLowerCase()}-iso');
    insert into events (parish_id, title, starts_at) values ('${PID[k]}','Evento ${k}', now() + interval '1 day');
    insert into tither_profiles (id, parish_id, name, whatsapp) values (gen_random_uuid(),'${PID[k]}','Dizimista ${k}','3199000${k.charCodeAt(0)}');
    insert into tither_contributions (parish_id, tither_id, reference_month) select '${PID[k]}', id, date_trunc('month', now())::date from tither_profiles where name='Dizimista ${k}';
    insert into tither_leads (parish_id, name, whatsapp, consent) values ('${PID[k]}','Interessado ${k}','3198800${k.charCodeAt(0)}0', true);
    insert into service_catalog (parish_id, code, title) values ('${PID[k]}','outro_${k.toLowerCase()}','Serviço ${k}') on conflict do nothing;`);
  await como(db, null, () => db.query(`select public_submit($1, 'intencao', $2::jsonb), public_submit($1, 'vela', '{"para":"mim","pedido":"Pedido ${k}"}'::jsonb)`, [SL[k], JSON.stringify({tipo:'outra', por:'Intenção ' + k, data:'2099-01-01', nome:'Fiel ' + k})]));
  await como(db, null, () => db.query(`select public_create_service_request($1, $2, 'Fiel ${k}', '3197000000${'ABC'.indexOf(k)}', 'whatsapp', '{}'::jsonb)`, [SL[k], 'outro_' + k.toLowerCase()]));
}
const TAB_EQUIPE = ['parishes','parish_users','parish_state','communities','events','tither_profiles','tither_contributions','tither_leads','service_catalog','service_requests','service_request_history'];
for (const k of 'ABC') for (const [papel, uid] of [['secretaria', U[k]], ['padre', P[k]]]){
  const vaz = [];
  for (const tb of TAB_EQUIPE){
    const col = tb === 'parishes' ? 'id' : 'parish_id';
    const rows = await como(db, uid, async () => q1(db, `select ${col}::text pid from ${tb}`));
    if (!rows.length || rows.some(x => x.pid !== PID[k])) vaz.push(`${tb}(${rows.length})`);
  }
  t(`${k} (${papel}): vê só a própria paróquia em ${TAB_EQUIPE.length} tabelas`, !vaz.length, vaz.join(' '));
}
for (const k of 'ABC'){
  const outro = k === 'A' ? 'B' : 'A';
  const estado = (await como(db, U[k], async () => q1(db, `select data from parish_state`)))[0]?.data || {};
  const ints = (estado.intencoes || []).map(i => i.por), velas = (estado.velas || []).map(v => v.pedido);
  t(`${k}: intenções e velas só da própria paróquia`, ints.includes('Intenção ' + k) && !ints.some(p => /^Intenção [ABC]$/.test(p) && p !== 'Intenção ' + k) && velas.includes('Pedido ' + k) && !velas.includes('Pedido ' + outro), JSON.stringify({ints, velas}));
  const reqOutro = (await q1(db, `select id from service_requests where parish_id=$1 and requester_name='Fiel ${outro}'`, [PID[outro]]))[0].id;
  t(`${k}: não altera solicitação de outra paróquia`, (await como(db, U[k], () => erro(db.query(`select staff_update_service_request($1, 'closed', null, false)`, [reqOutro]))))?.includes('Sem permissão'));
  t(`${k}: não grava evento em outra paróquia`, !!(await como(db, U[k], () => erro(db.query(`insert into events (parish_id, title, starts_at) values ($1, 'invasão', now())`, [PID[outro]])))));
  await como(db, U[k], () => db.query(`update tither_profiles set name='x' where parish_id=$1`, [PID[outro]]));
  t(`${k}: não edita dizimista de outra paróquia`, (await q1(db, `select count(*)::int n from tither_profiles where name='x'`))[0].n === 0);
  const g = await pub(SL[k]);
  t(`${k}: página pública só com os próprios eventos/comunidades/velas`, g.events.some(e => e.title === 'Evento ' + k) && !g.events.some(e => /^Evento [ABC]$/.test(e.title) && e.title !== 'Evento ' + k) && g.communities.some(c => c.name === 'Comunidade ' + k) && !g.communities.some(c => /^Comunidade [ABC]$/.test(c.name) && c.name !== 'Comunidade ' + k) && g.velasHoje === 1, JSON.stringify({ev:g.events.map(e => e.title), co:g.communities.map(c => c.name), v:g.velasHoje}));
  const cat = (await como(db, null, async () => q1(db, `select public_service_catalog($1) c`, [SL[k]])))[0].c.map(s => s.title);
  t(`${k}: catálogo da Secretaria 24h só o próprio`, cat.includes('Serviço ' + k) && !cat.includes('Serviço ' + outro), cat);
}
const protoA = (await q1(db, `select protocol, whatsapp from service_requests where requester_name='Fiel A'`))[0];
t('protocolo de A consultado na página de B não aparece', (await como(db, null, async () => q1(db, `select public_get_service_request($1, $2, $3) r`, [SL.B, protoA.protocol, protoA.whatsapp])))[0].r === null);

console.log(`\n${ok} ok, ${falha} falha(s)`);
process.exit(falha ? 1 : 0);
