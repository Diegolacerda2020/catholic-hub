// Secretaria 24h: multi-paróquia (29B) e migração realista a partir do banco de produção (31).
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { STUB, ler, SLUG_B } from './banco.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const base = f => execSync(`git show bbb34e1:${f}`, {cwd:REPO}).toString();
let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 300)); };
const erro = async p => { try { await p; return null; } catch(e){ return e.message; } };
async function como(db, uid, fn){
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const TABELAS = ['parishes','parish_users','parish_state','events','communities','tither_profiles','tither_contributions','tither_leads'];
const foto = async db => Object.fromEntries(await Promise.all(TABELAS.map(async tb => [tb, JSON.stringify((await db.query(`select * from ${tb} order by 1, 2`)).rows)])));

// ======================================================= 31. migração realista
console.log('== 31. banco equivalente à produção (bbb34e1 + dados) + secretaria24h.sql 2x');
const db = new PGlite({extensions:{pgcrypto}});
await db.exec(STUB);
await db.exec(base('supabase/schema.sql'));             // schema que está em produção
await db.exec(base('supabase/demo_seed.sql'));          // 12 dizimistas DEMO, contribuições, 4 eventos DEMO
const U = {padre:'00000000-0000-0000-0000-0000000000a1', sec:'00000000-0000-0000-0000-0000000000b1', pascom:'00000000-0000-0000-0000-0000000000c1', outra:'00000000-0000-0000-0000-0000000000d1'};
await db.exec(`
  insert into auth.users values ('${U.padre}','padre@x'),('${U.sec}','sec@x'),('${U.pascom}','pascom@x'),('${U.outra}','outra@x');
  insert into parish_users select '${U.padre}', id, 'padre' from parishes where slug='santo-antonio-jaragua';
  insert into parish_users select '${U.sec}', id, 'secretaria' from parishes where slug='santo-antonio-jaragua';
  insert into parish_users select '${U.pascom}', id, 'pascom' from parishes where slug='santo-antonio-jaragua';
  update parish_state set data = '{"cfg":{"nome":"Paróquia Santo Antônio – Jaraguá","secretaria":"Seg a sex"},"avisos":[{"id":1,"titulo":"Aviso real"}],"intencoes":[{"id":2,"por":"Fulano","status":"nova"}],"velas":[{"id":3,"ts":1}],"log":[]}';
  insert into communities (parish_id, name, slug) select id, 'Comunidade Real', 'real' from parishes where slug='santo-antonio-jaragua';
  insert into tither_leads (parish_id, name, whatsapp, consent) select id, 'Interessado Real', '31988880000', true from parishes where slug='santo-antonio-jaragua';
`);
const matriz = async () => { const r = {};
  for (const [k, uid] of Object.entries(U)) r[k] = await como(db, uid, async () => (await db.query(`select ${['avisos','agenda','comunidades','dizimistas','pessoas','intencoes','mensagens','ajustes','noticias','uso'].map(a => `can_access(p.id,'${a}') "${a}"`).join(',')} from parishes p where slug='santo-antonio-jaragua'`)).rows[0]);
  return JSON.stringify(r); };
const funcoes = async () => JSON.stringify((await db.query(`select proname, md5(prosrc) from pg_proc where proname in ('get_public_parish','public_submit','public_tither_interest','convert_tither_lead','is_parish_member','touch_parish_state') order by 1`)).rows);
const policies = async () => JSON.stringify((await db.query(`select tablename, policyname, cmd, qual, with_check from pg_policies where tablename = any($1) order by 1, 2`, [TABELAS])).rows);
const grants = async () => JSON.stringify((await db.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_name = any($1) and grantee in ('anon','authenticated') order by 1,2,3`, [TABELAS])).rows);
const publico = async () => JSON.stringify((await db.query(`select get_public_parish('santo-antonio-jaragua') g`)).rows[0].g);
const antes = {dados: await foto(db), matriz: await matriz(), funcoes: await funcoes(), policies: await policies(), grants: await grants(), publico: await publico()};
const n = JSON.parse(antes.dados.tither_profiles).length;
const dzDemo = JSON.parse(antes.dados.tither_profiles).filter(x => (x.notes || '').startsWith('[DEMO]')).length;
console.log(`  (antes: ${n} dizimistas, ${dzDemo} DEMO, ${JSON.parse(antes.dados.tither_contributions).length} contribuições, ${JSON.parse(antes.dados.events).length} eventos)`);

t('secretaria24h.sql 1ª vez sem erro', !await erro(db.exec(ler('supabase/secretaria24h.sql'))));
const meio = {cat: (await db.query('select * from service_catalog order by code')).rows};
t('secretaria24h.sql 2ª vez sem erro', !await erro(db.exec(ler('supabase/secretaria24h.sql'))));
const depois = {dados: await foto(db), matriz: await matriz(), funcoes: await funcoes(), policies: await policies(), grants: await grants(), publico: await publico()};
for (const tb of TABELAS) t(`${tb} igual antes/depois`, antes.dados[tb] === depois.dados[tb]);
t('catálogo inicial não duplica (6 depois da 2ª vez, mesmos ids)', JSON.stringify(meio.cat) === JSON.stringify((await db.query('select * from service_catalog order by code')).rows) && meio.cat.length === 6);
t('permissões antigas de padre/secretaria/PASCOM iguais', antes.matriz === depois.matriz, depois.matriz);
t('get_public_parish, public_submit, public_tither_interest, convert_tither_lead inalteradas', antes.funcoes === depois.funcoes);
t('policies das tabelas existentes inalteradas', antes.policies === depois.policies);
t('grants das tabelas existentes inalterados', antes.grants === depois.grants);
t('get_public_parish devolve o mesmo JSON', antes.publico === depois.publico);
t('12 dizimistas DEMO e contribuições continuam', dzDemo === 12);
// e o schema.sql novo inteiro por cima também não muda nada
t('schema.sql novo por cima: sem erro', !await erro(db.exec(ler('supabase/schema.sql'))));
const depois2 = await foto(db);
t('schema.sql novo por cima: dados existentes iguais', TABELAS.every(tb => antes.dados[tb] === depois2[tb]));

// também a partir do MVP 2 sem tither_contributions (produção antiga)
{ const d2 = new PGlite({extensions:{pgcrypto}}); await d2.exec(STUB);
  await d2.exec(execSync('git show 4fc9da4:supabase/schema.sql', {cwd:REPO}).toString()); // MVP 2 sem tither_contributions
  t('migração 2x também roda no MVP 2 sem tither_contributions', !await erro(d2.exec(ler('supabase/secretaria24h.sql'))) && !await erro(d2.exec(ler('supabase/secretaria24h.sql')))); }

// ======================================================= 29B. multi-paróquia
console.log('== 29B. multi-paróquia');
await db.exec(`
  insert into parishes (slug, name) values ('${SLUG_B}', 'Paróquia Teste Multiparóquia');
  insert into parish_users select '${U.outra}', id, 'secretaria' from parishes where slug='${SLUG_B}';
  insert into service_catalog (parish_id, code, title, form_fields, sort_order) select id, v.c, v.t, v.f::jsonb, v.o from parishes, (values
    ('certidao', 'Certidão (B)', '[{"name":"nome","label":"Nome","type":"text","required":true}]', 1),
    ('visita_enfermos', 'Visita a enfermos (B)', '[]', 2)) v(c, t, f, o) where slug = '${SLUG_B}';
`);
const cat = s => db.query('select public_service_catalog($1) c', [s]).then(r => r.rows[0].c);
const criar = (s, code, wa, ans) => db.query(`select public_create_service_request($1,$2,'Fulano de Tal',$3,'whatsapp',$4::jsonb) r`, [s, code, wa, JSON.stringify(ans)]).then(r => r.rows[0].r);
const get = (s, p, wa) => db.query('select public_get_service_request($1,$2,$3) r', [s, p, wa]).then(r => r.rows[0].r);
let pA, pB;
await como(db, null, async () => {
  const a = await cat('santo-antonio-jaragua'), b = await cat(SLUG_B);
  t('catálogos diferentes por paróquia', a.length === 6 && b.length === 2 && b.map(x => x.code).join() === 'certidao,visita_enfermos' && a.find(x => x.code === 'certidao').title !== b.find(x => x.code === 'certidao').title);
  t('public_service_catalog só traz o slug informado', !a.some(x => x.title.includes('(B)')) && b.every(x => x.title.includes('(B)')));
  t('serviço que só existe na B não é aceito na A', (await erro(criar('santo-antonio-jaragua', 'visita_enfermos', '31970000001', {})))?.includes('servico_indisponivel'));
  pA = (await criar('santo-antonio-jaragua', 'certidao', '31970000001', {tipo_documento:'Outro', nome_pessoa:'X'})).protocol;
  pB = (await criar(SLUG_B, 'certidao', '31970000001', {nome:'Y'})).protocol;
  t('mesmo código "certidao" em cada paróquia usa o formulário dela', pA && pB && pA !== pB);
  t('protocolo da A + telefone certo consultado na B: NULL', await get(SLUG_B, pA, '31970000001') === null);
  t('protocolo da B + telefone certo consultado na A: NULL', await get('santo-antonio-jaragua', pB, '31970000001') === null);
  t('cada protocolo na própria paróquia: encontrado', (await get('santo-antonio-jaragua', pA, '31970000001'))?.service_title === 'Certidão / documento paroquial' && (await get(SLUG_B, pB, '31970000001'))?.service_title === 'Certidão (B)');
  t('mesmo WhatsApp em paróquias diferentes não conta como envio repetido', pA !== pB);
});
const [idA, idB] = await Promise.all([pA, pB].map(async p => (await db.query('select id from service_requests where protocol=$1', [p])).rows[0].id));
await como(db, U.outra, async () => {
  t('usuário da B não lê solicitações da A', (await db.query(`select count(*)::int n from service_requests where protocol=$1`, [pA])).rows[0].n === 0);
  t('usuário da B lê as da B', (await db.query(`select protocol from service_requests`)).rows.map(r => r.protocol).join() === pB);
  t('usuário da B não lê catálogo nem histórico da A', (await db.query(`select count(*)::int n from service_catalog where title not like '%(B)'`)).rows[0].n === 0 && (await db.query(`select count(*)::int n from service_request_history where request_id=$1`, [idA])).rows[0].n === 0);
  t('usuário da B não altera solicitação da A', (await erro(db.query(`select staff_update_service_request($1,'closed',null,false)`, [idA])))?.includes('Sem permissão'));
  t('usuário da B altera a da B', !await erro(db.query(`select staff_update_service_request($1,'in_progress','ok',true)`, [idB])));
});
await como(db, U.sec, async () => {
  t('secretaria da A não lê nada da B', (await db.query(`select count(*)::int n from service_requests where protocol=$1`, [pB])).rows[0].n === 0 && (await db.query(`select count(*)::int n from service_catalog where title like '%(B)'`)).rows[0].n === 0);
  t('secretaria da A não altera a da B', (await erro(db.query(`select staff_update_service_request($1,'closed',null,false)`, [idB])))?.includes('Sem permissão'));
});
t('histórico sempre na mesma paróquia da solicitação', (await db.query(`select count(*)::int n from service_request_history h join service_requests r on r.id=h.request_id where h.parish_id<>r.parish_id`)).rows[0].n === 0);
t('FK impede histórico apontando para outra paróquia', !!await erro(db.query(`insert into service_request_history (request_id, parish_id, status) select $1, id, 'new' from parishes where slug=$2`, [idA, SLUG_B])));
t('FK impede solicitação da A com serviço da B', !!await erro(db.query(`insert into service_requests (parish_id, service_id, protocol, requester_name, whatsapp) select pa.id, sc.id, 'SA-2026-ABCDEF12', 'Teste', '31970000009' from parishes pa, service_catalog sc join parishes pb on pb.id=sc.parish_id where pa.slug='santo-antonio-jaragua' and pb.slug=$1 limit 1`, [SLUG_B])));

// ======================================================= slug fixo só onde pode
console.log('== slug do piloto no código');
const grep = f => (ler(f).match(/santo-antonio-jaragua/g) || []).length;
t('secretaria24h.js sem o slug do piloto', grep('secretaria24h.js') === 0);
t('secretaria24h.css sem o slug do piloto', grep('secretaria24h.css') === 0);
const sql = ler('supabase/secretaria24h.sql'), corpoFuncoes = sql.slice(0, sql.indexOf('Catálogo inicial da paróquia piloto'));
t('funções/tabelas/RLS do SQL sem o slug do piloto (só a carga inicial e a conferência)', !corpoFuncoes.includes('santo-antonio-jaragua'), corpoFuncoes.match(/.*santo-antonio-jaragua.*/g));

console.log(`\n${ok} ok, ${falha} falha(s)`); process.exit(falha ? 1 : 0);
