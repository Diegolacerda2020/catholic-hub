// Assistente Paroquial no Chrome de verdade, com login.
// O resto do app usa o Supabase falso das suítes da Secretaria 24h; tudo o que o Assistente toca
// (events, communities, Secretaria 24h, auditoria, diretório) vai para o SQL real no PGlite, com RLS,
// executado como o usuário logado. Nunca usa o Supabase real.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { criarBackend, TENANTS } from '../secretaria24h/supabase-falso.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots', import.meta.url)); fs.mkdirSync(SHOTS, {recursive:true});
const ler = f => fs.readFileSync(path.join(REPO, f), 'utf8');
let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 400)); };
const esperar = ms => new Promise(r => setTimeout(r, ms));
const SA = 'santo-antonio-jaragua', SC = 'santa-clara-e-sao-francisco-mineirao', NG = 'nossa-senhora-das-gracas-ibirite';

// ---------------------------------------------------------------- banco real (PGlite)
const db = new PGlite({extensions:{pgcrypto}});
await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated; grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on functions to anon, authenticated;`);
for (const f of ['supabase/schema.sql', 'supabase/secretaria24h.sql', 'supabase/demo_secretaria_seed.sql', 'supabase/diretorio.sql', 'supabase/diretorio_santuarios.sql',
  'supabase/diretorio_privacidade.sql', 'supabase/diretorio_seed.sql', 'supabase/diretorio_ativacao.sql', 'supabase/agente.sql']) await db.exec(ler(f));
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const PID = {}; for (const r of await q(`select id, slug from parishes`)) PID[r.slug] = r.id;
const PMAP = {[TENANTS[SA]]:PID[SA], [TENANTS[SC]]:PID[SC], [TENANTS[NG]]:PID[NG]}; // p-1/p-2/p-3 do Supabase falso → uuid real
const UID = {'u-sec':'00000000-0000-0000-0000-0000000000b1', 'u-sc':'00000000-0000-0000-0000-0000000000c1', 'u-padre-sc':'00000000-0000-0000-0000-0000000000c2',
  'u-pascom-sc':'00000000-0000-0000-0000-0000000000c3', 'u-ng-sec':'00000000-0000-0000-0000-0000000000a1'};
await db.exec(`insert into service_catalog (parish_id, code, title, description, instructions, form_fields, active, sort_order)
  select '${PID[SC]}', code, title, description, instructions, form_fields, true, sort_order from service_catalog where parish_id = '${PID[SA]}' and active and code not like 'demo_%';
  insert into service_catalog (parish_id, code, title, form_fields) values ('${PID[NG]}', 'outro', 'Outro assunto', '[]');
  insert into auth.users values ${Object.entries(UID).map(([k, v]) => `('${v}', '${k}')`).join(', ')};
  insert into parish_users values ('${UID['u-sec']}', '${PID[SA]}', 'secretaria'), ('${UID['u-sc']}', '${PID[SC]}', 'secretaria'), ('${UID['u-padre-sc']}', '${PID[SC]}', 'padre'),
    ('${UID['u-pascom-sc']}', '${PID[SC]}', 'pascom'), ('${UID['u-ng-sec']}', '${PID[NG]}', 'secretaria');`);
const cert = (await q(`select form_fields from service_catalog where parish_id=$1 and code='certidao'`, [PID[SC]]))[0].form_fields;
const ansCert = Object.fromEntries(cert.filter(f => f.required).map(f => [f.name, f.type === 'select' ? f.options[0] : f.type === 'date' ? '2020-01-01' : 'Teste']));

// Executa como o usuário (RLS), uma transação por chamada
let fila = Promise.resolve();
function como(uid, fn){
  const run = () => db.transaction(async tx => { await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']); await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`); return fn(tx); });
  const p = fila.then(run, run); fila = p.catch(() => {}); return p;
}
// o fiel pede pelo caminho público, como anon
const pedido = async (slug, code, wa, ans = {}) => (await como(null, tx => tx.query(`select public_create_service_request($1, $2, 'Fiel de Teste', $3, 'whatsapp', $4::jsonb) r`, [slug, code, wa, JSON.stringify(ans)]))).rows[0].r;
const TIPOS = {p_parish:'uuid', p_request:'uuid', p_public_note:'boolean', p_confirmed:'boolean', p_limit:'integer', p_answers:'jsonb'};
const pSC1 = await pedido(SC, 'certidao', '31990001001', ansCert), pSC2 = await pedido(SC, 'certidao', '31990001002', ansCert), pNG = await pedido(NG, 'outro', '31990002001');
const PG_TAB = new Set(['events','communities','service_catalog','service_requests','service_request_history','agent_audit_log']);
const PG_RPC = new Set(['public_service_catalog','public_create_service_request','public_get_service_request','staff_update_service_request','agent_log_action','public_directory_search','public_directory_entry']);
const {B, op:fake} = criarBackend({});
const chamadas = [];
async function op(q_){
  if (q_.kind === 'login' || (q_.kind === 'rpc' ? !PG_RPC.has(q_.fn) : !PG_TAB.has(q_.table))) return fake(q_);
  chamadas.push(q_.kind === 'rpc' ? 'rpc:' + q_.fn : q_.kind + ':' + q_.table);
  const uid = q_.uid ? UID[q_.uid] : null, map = v => PMAP[v] || v;
  try {
    if (q_.kind === 'rpc'){
      const n = Object.keys(q_.args || {});
      const r = await como(uid, tx => tx.query(`select ${q_.fn}(${n.map((k, i) => `${k} => $${i + 1}::${TIPOS[k] || 'text'}`).join(', ')}) r`, n.map(k => TIPOS[k] === 'jsonb' ? JSON.stringify(q_.args[k]) : k === 'p_parish' ? map(q_.args[k]) : q_.args[k])));
      return {data:JSON.parse(JSON.stringify(r.rows[0].r ?? null))};
    }
    const vals = [], w = (q_.filtros || []).map(([c, o, v]) => { vals.push(c === 'parish_id' ? map(v) : v); return `${c} ${o} $${vals.length}`; });
    const onde = w.length ? ' where ' + w.join(' and ') : '';
    let sql;
    if (q_.kind === 'insert'){ const p = {...q_.payload, ...(q_.payload.parish_id ? {parish_id:map(q_.payload.parish_id)} : {})}, cols = Object.keys(p); vals.push(...cols.map(c => p[c])); sql = `insert into ${q_.table} (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning ${q_.ret || '*'}`; }
    else if (q_.kind === 'update'){ const cols = Object.keys(q_.payload), base = vals.length; vals.push(...cols.map(c => q_.payload[c])); sql = `update ${q_.table} set ${cols.map((c, i) => `${c} = $${base + i + 1}`).join(', ')}${onde} returning *`; }
    else if (q_.kind === 'delete') sql = `delete from ${q_.table}${onde}`;
    else sql = `select ${q_.cols || '*'} from ${q_.table}${onde}${q_.ordem ? ` order by ${q_.ordem[0]} ${q_.ordem[1] ? 'asc' : 'desc'}` : ''}${q_.lim ? ' limit ' + q_.lim : ''}`;
    const r = await como(uid, tx => tx.query(sql, vals));
    const rows = JSON.parse(JSON.stringify(r.rows));
    return {data:q_.single ? rows[0] ?? null : rows, ...(q_.single && !rows.length ? {error:{code:'PGRST116', message:'0 rows'}} : {})};
  } catch(e){ return {error:{code:e.code || 'XX000', message:e.message}}; }
}
const CLIENTE = `window.supabase = { createClient(){
  const KEY = 'fake-sb-sessao'; let sessao = JSON.parse(localStorage.getItem(KEY) || 'null');
  const chamar = q => window.__sb({...q, uid: sessao?.user?.id || null});
  const builder = table => { const q = {table, kind:'select', eq:[], filtros:[], single:false};
    const b = { select(c){ if (q.kind === 'select') q.cols = c; else q.ret = c; return b; }, insert(p){ q.kind = 'insert'; q.payload = p; return b; },
      update(p){ q.kind = 'update'; q.payload = p; return b; }, delete(){ q.kind = 'delete'; return b; },
      eq(c, v){ q.eq.push([c, v]); q.filtros.push([c, '=', v]); return b; }, gte(c, v){ q.filtros.push([c, '>=', v]); return b; }, lt(c, v){ q.filtros.push([c, '<', v]); return b; },
      order(c, o){ q.ordem = [c, !(o && o.ascending === false)]; return b; }, limit(n){ q.lim = n; return b; }, single(){ q.single = true; return b; },
      then(ok, err){ return chamar(q).then(ok, err); } }; return b; };
  return { auth:{ async getSession(){ return {data:{session:sessao}}; },
      async signInWithPassword({email, password}){ const r = await chamar({kind:'login', email, senha:password}); if (r.data){ sessao = r.data.session; localStorage.setItem(KEY, JSON.stringify(sessao)); } return r.error ? {data:{}, error:r.error} : r; },
      async signOut(){ sessao = null; localStorage.removeItem(KEY); return {}; } },
    from: builder, rpc(fn, args){ return chamar({kind:'rpc', fn, args}); } };
}};`;

// ---------------------------------------------------------------- servidor local
const TIPOS_ARQ = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8'};
const SRV = {sem:null};
const PORTA = 8811;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/config.js'){ res.writeHead(200, {'content-type':TIPOS_ARQ['.js']}); return res.end(`window.CENTRAL_CONFIG = {supabase:{url:"https://fake.supabase.co", anonKey:"x"}, parishSlug:${JSON.stringify(SA)}, noticiasOficial:"", noticiasEspelho:""};`); }
  if (SRV.sem && u.pathname === '/' + SRV.sem){ res.writeHead(404); return res.end(); }
  if (u.pathname.startsWith('/api/')){ res.writeHead(404); return res.end(); }
  const f = path.join(REPO, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.resolve(REPO)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'content-type':TIPOS_ARQ[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(PORTA);

const browser = await puppeteer.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
async function aparelho({hash = '#painel', largura = 390, escuro = false} = {}){
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({width:largura, height:844, deviceScaleFactor:1});
  if (escuro) await page.emulateMediaFeatures([{name:'prefers-color-scheme', value:'dark'}]);
  await page.exposeFunction('__sb', x => op(x)); await page.evaluateOnNewDocument(CLIENTE);
  page.erros = [];
  page.on('pageerror', e => page.erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) page.erros.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORTA}/?p=${SC}${hash}`, {waitUntil:'networkidle0', timeout:60000}); await esperar(400);
  return page;
}
const clk = (p, sel) => p.$eval(sel, e => { e.scrollIntoView({block:'center'}); e.click(); });
const entrar = async (p, email) => { await p.type('#l-em', email); await p.type('#l-pw', '123456'); await clk(p, '#l-btn'); await esperar(1200); };
const view = p => p.evaluate(() => document.getElementById('view').innerText);
const ultima = p => p.evaluate(() => [...document.querySelectorAll('.ag-ele .ag-bolha')].at(-1)?.innerText || '');
async function diga(p, txt){
  await p.$eval('#agTxt', e => { e.value = ''; }); await p.type('#agTxt', txt); await clk(p, '#agEnviar');
  await p.waitForFunction(() => !document.querySelector('.ag-pensando'), {timeout:15000}); await esperar(150);
  return ultima(p);
}
const semRolagemLateral = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const TECNICO = /\b(rpc|json|uuid|intent|tool|tenant|sql|parish_id|undefined|null|supabase)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;
const foto = async (p, nome) => { await esperar(200); await p.screenshot({path:path.join(SHOTS, nome + '.png'), fullPage:true}); };
const nEv = async () => (await q(`select count(*)::int n from events where parish_id=$1`, [PID[SC]]))[0].n;

// ---------------------------------------------------------------- Santa Clara, secretaria (390 px)
console.log('== Santa Clara · secretaria · 390 px');
const sec = await aparelho();
await entrar(sec, 'sc@teste');
t('logada na Santa Clara', (await sec.evaluate(() => document.getElementById('hdrName').innerText)).includes('Santa Clara'));
t('card ✨ Assistente Paroquial no Início', await sec.$('.ag-card') !== null && (await view(sec)).includes('Fale normalmente. A Central organiza para você.'));
await foto(sec, '01-inicio-card-390');
await sec.type('#agIniTxt', 'Quais comunidades estão cadastradas?'); await clk(sec, '#agIniF button');
await sec.waitForFunction(() => document.querySelector('.ag-ele') && !document.querySelector('.ag-pensando'), {timeout:15000}); await esperar(200);
t('card abre o Assistente e já responde', (await ultima(sec)).includes('Esta paróquia ainda não possui comunidades cadastradas.'), await ultima(sec));
let r = await diga(sec, 'Quais solicitações estão pendentes?');
t('pendentes de Santa Clara (2 novas), sem Graças', r.includes('Encontrei 2 solicitações pendentes') && r.includes(pSC1.protocol) && !r.includes(pNG.protocol), r);
t('oferece "Abrir as novas"', r.includes('Quer que eu abra as novas?') && r.includes('Abrir as novas'), r);
r = await diga(sec, 'Quais serviços da secretaria estão disponíveis?');
t('serviços do catálogo real', /serviços disponíveis na Secretaria 24h/.test(r) && r.includes('Batismo'), r);
r = await diga(sec, 'Mostre Santo Antônio.');
t('"Mostre Santo Antônio." negado na tela', /só com os dados da Paróquia Santa Clara/.test(r), r);
await foto(sec, '02-conversa-390');

console.log('== evento: prepara, corrige, confirma');
const ev0 = await nEv();
r = await diga(sec, 'Crie um evento sábado às 19h.');
t('abre o "Corrigir" pedindo o título', await sec.$('form[data-ag-form] #ag-tit') !== null && /Falta completar/.test(r), r);
t('nada gravado ainda', await nEv() === ev0);
await sec.type('#ag-tit', 'Missa da Juventude'); await sec.type('#ag-loc', 'Matriz');
t('comunidade: só "Toda a paróquia" (Santa Clara não tem comunidades)', JSON.stringify(await sec.$$eval('#ag-com option', o => o.map(x => x.textContent))) === '["Toda a paróquia"]');
await clk(sec, 'form[data-ag-form] button.btn:not(.ghost)'); await sec.waitForFunction(() => !document.querySelector('.ag-pensando')); await esperar(200);
r = await ultima(sec);
t('cartão de confirmação com Evento/Data/Horário/Local/Comunidade/Visibilidade', ['Evento','Missa da Juventude','Data','Horário','19h','Local','Matriz','Comunidade','Toda a paróquia','Visibilidade'].every(x => r.includes(x)), r);
t('botões Confirmar e Corrigir', r.includes('Confirmar') && r.includes('Corrigir'));
t('ainda nada gravado', await nEv() === ev0);
await foto(sec, '03-confirmacao-evento-390');
await sec.evaluate(() => { const b = [...document.querySelectorAll('[data-ag-conf]')].at(-1); b.click(); b.click(); }); // duplo clique
await sec.waitForFunction(() => !document.querySelector('.ag-pensando'), {timeout:15000}); await esperar(300);
r = await ultima(sec);
t('gravou 1 evento (duplo clique não duplica)', await nEv() === ev0 + 1 && /Pronto! O evento “Missa da Juventude” foi criado/.test(r), r);
const ev = (await q(`select source, created_by, title from events where parish_id=$1 order by created_at desc limit 1`, [PID[SC]]))[0];
t('evento com origem "agente" e autora a secretaria', ev.source === 'agente' && ev.created_by === UID['u-sc'], ev);
await sec.evaluate(() => [...document.querySelectorAll('.ag-ele')].at(-1).querySelector('[data-ag-acao]').click()); await esperar(600);
t('"Abrir a Agenda" mostra o evento no painel', (await view(sec)).includes('Missa da Juventude'), (await view(sec)).slice(0, 300));

console.log('== solicitação: prepara, confirma');
await sec.evaluate(() => { S.tab = 'assistente'; render(); }); await esperar(200);
const st = async p => (await q(`select status from service_requests where protocol=$1`, [p]))[0].status;
r = await diga(sec, `Marque ${pSC1.protocol} como em atendimento`);
t('cartão da mudança de situação', r.includes('Situação atual') && r.includes('Recebida') && r.includes('Em atendimento'), r);
t('situação não muda antes de confirmar', await st(pSC1.protocol) === 'new');
await clk(sec, '.ag-conf:last-of-type [data-ag-conf]').catch(() => sec.evaluate(() => [...document.querySelectorAll('[data-ag-conf]')].at(-1).click()));
await sec.waitForFunction(() => !document.querySelector('.ag-pensando'), {timeout:15000}); await esperar(200);
t('muda depois de confirmar', await st(pSC1.protocol) === 'in_progress' && (await ultima(sec)).includes('agora está em atendimento'), await ultima(sec));
r = await diga(sec, `Marque ${pSC2.protocol} como concluída`);
await sec.evaluate(() => [...document.querySelectorAll('[data-ag-canc]')].at(-1).click());
await sec.waitForFunction(() => !document.querySelector('.ag-pensando')); await esperar(200);
t('Cancelar não altera', await st(pSC2.protocol) === 'new' && (await ultima(sec)).includes('não fiz nenhuma alteração'));
const tela = await view(sec);
t('tela sem termos técnicos nem ids', !TECNICO.test(tela), (tela.match(TECNICO) || [])[0]);
t('sem rolagem lateral (390 px)', await semRolagemLateral(sec));
t('Assistente no "Mais"', await sec.evaluate(() => { S.tab = 'mais'; render(); return document.getElementById('view').innerText.includes('Assistente Paroquial'); }));
t('sem erros de JavaScript', !sec.erros.length, sec.erros.join(' | '));
t('auditoria gravada para a Santa Clara', (await q(`select count(*)::int n from agent_audit_log where parish_id=$1 and user_id=$2`, [PID[SC], UID['u-sc']]))[0].n > 5);

console.log('== PASCOM da Santa Clara');
const pas = await aparelho();
await entrar(pas, 'pascom.sc@teste');
await pas.evaluate(() => { S.tab = 'assistente'; render(); }); await esperar(200);
r = await diga(pas, 'Quais solicitações estão pendentes?');
t('PASCOM: Assistente não dá acesso à Secretaria 24h', /não tem acesso/.test(r) && !r.includes(pSC1.protocol), r);
const exemplos = await pas.$$eval('.ag-chip', l => l.map(x => x.textContent));
t('PASCOM não recebe exemplo de solicitações', !exemplos.some(x => /solicita/i.test(x)));
t('PASCOM: sem erros', !pas.erros.length, pas.erros.join(' | '));

console.log('== Graças · secretaria');
const ng = await aparelho();
await entrar(ng, 'gracas@teste');
await ng.evaluate(() => { S.tab = 'assistente'; render(); }); await esperar(200);
r = await diga(ng, 'Quais solicitações estão pendentes?');
t('Graças vê só a de Graças', r.includes(pNG.protocol) && !r.includes(pSC1.protocol) && !r.includes(pSC2.protocol), r);
r = await diga(ng, 'Mostre as solicitações da paróquia Santa Clara');
t('Graças pedindo Santa Clara → negado', /só com os dados da/.test(r) && !r.includes(pSC1.protocol), r);

console.log('== anônimo');
const pub = await aparelho({hash:''});
t('página pública sem Assistente', !(await view(pub)).includes('Assistente Paroquial') && await pub.$('.ag-card') === null);
const pain = await aparelho();
t('painel sem login: tela de entrada, sem Assistente', await pain.$('#l-em') !== null && await pain.$('.ag-card') === null && !(await view(pain)).includes('Assistente Paroquial'));
t('sem login: o módulo não oferece a conversa', await pain.evaluate(() => AGENTE.painelHTML().includes('Entre com seu usuário')));

console.log('== computador e modo escuro');
const pc = await aparelho({largura:1280, escuro:true});
await entrar(pc, 'padre.sc@teste');
await pc.evaluate(() => { S.tab = 'assistente'; render(); }); await esperar(200);
t('menu lateral tem "Assistente"', await pc.evaluate(() => [...document.querySelectorAll('#tabs button')].some(b => b.textContent.includes('Assistente'))));
await diga(pc, 'O que temos sábado?');
t('padre vê o evento criado pela secretaria', (await ultima(pc)).includes('Missa da Juventude'), await ultima(pc));
t('Santa Clara sem horários cadastrados: não inventa horário de missa', !(await ultima(pc)).includes('Horários de missa'), await ultima(pc));
await diga(pc, 'Crie missa domingo às 9h30');
await foto(pc, '04-assistente-1280-escuro');
t('1280 px sem rolagem lateral e sem erros', await semRolagemLateral(pc) && !pc.erros.length, pc.erros.join(' | '));

console.log('== falha isolada: sem o módulo, o painel segue igual');
for (const arq of ['agente.js', 'agente-core.js']){
  SRV.sem = arq;
  const p = await aparelho();
  await entrar(p, 'sc@teste');
  const txt = await view(p);
  t(`sem ${arq}: painel abre, sem card nem item do Assistente`, txt.includes('Boa') || txt.includes('Bom') ? await p.$('.ag-card') === null && !(await p.evaluate(() => MAIS.some(([k]) => k === 'assistente'))) : false, txt.slice(0, 200));
  t(`sem ${arq}: sem erros`, !p.erros.length, p.erros.join(' | '));
}
SRV.sem = null;

await browser.close();
console.log(`\n${ok} ok, ${falha} falhas · screenshots em tests/agente/shots/`);
process.exit(falha ? 1 : 0);
