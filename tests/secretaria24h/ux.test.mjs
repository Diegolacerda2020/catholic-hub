// Painel responsivo (celular / tablet / computador), Início por papel, badge, avisos, 🔔 e
// "Minhas solicitações". Chrome real; resto do app no Supabase falso e a Secretaria 24h no SQL
// real (PGlite), como no navegador.test.mjs. Screenshots em shots/ux/.
import { fileURLToPath } from 'node:url';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {criarBackend, CLIENTE} from './supabase-falso.mjs';
import {criarBanco, ponte, como} from './banco.mjs';
import {esperar} from './ui.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots/ux', import.meta.url)); fs.mkdirSync(SHOTS, {recursive:true});
const CLI = CLIENTE.replace('gte(){ return b; },', 'gte(){ return b; }, order(){ return b; }, limit(){ return b; },');
const TIPOS = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8'};
const PORTA = 8802;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/config.js'){ res.writeHead(200, {'content-type':TIPOS['.js']}); return res.end('window.CENTRAL_CONFIG = {supabase:{url:"https://fake.supabase.co", anonKey:"x"}, parishSlug:"santo-antonio-jaragua"};'); }
  if (u.pathname.startsWith('/api/')){ res.writeHead(404); return res.end(); } // Worker de notícias/liturgia não roda aqui (404 esperado)
  const f = path.join(REPO, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.resolve(REPO)) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'content-type':TIPOS[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(PORTA);

// ---------- dados de exemplo (fictícios) ----------
const banco = await criarBanco();
const {B, op: opFake} = criarBackend({});
const hoje = new Date(), iso = d => d.toISOString(), dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const mmdd = d => ymd(d).slice(5), agora = iso(hoje);
const emHoras = h => new Date(Date.now() + h*3600e3);
B.estado.data = {cfg:{nome:'Paróquia Santo Antônio – Jaraguá', missas:'Sábado: 18h00\nDomingo: 07h30, 09h30 e 18h00', padroeiro:'Santo Antônio', endereco:'Praça Santo Antônio, 2 – Jaraguá', telefone:'(31) 3427-2866', forania:'Santo Antônio (Pampulha)', regiao:'RENSC', tom:'acolhedor', emoji:true, assinatura:'Deus abençoe!', youtube:'', rec:{}, pix:'', secretaria:'Segunda a sexta, 8h às 12h e 14h às 18h', whats:'', email:''},
  modelos:{aniversario:'Parabéns, {nome}!', bodas:'Parabéns, {nome}!', dizimista:'Obrigado, {nome}!'},
  pessoas:[{id:1, nome:'Maria das Graças Silva', whats:'31988887771', aniv:mmdd(hoje), casamento:'', grupo:'dizimista', consent:true},
    {id:2, nome:'José e Ana Pereira', whats:'31988887772', aniv:mmdd(dia(40)), casamento:(hoje.getFullYear()-25)+'-'+mmdd(hoje), grupo:'geral', consent:true}],
  avisos:[{id:1, ts:Date.now()-864e5, titulo:'Quermesse de Santo Antônio', texto:'Barraquinhas e missa festiva.', evento:null},
    {id:2, ts:Date.now()-3*864e5, titulo:'Inscrições para a catequese', texto:'Abertas na secretaria.', evento:null}],
  intencoes:[{id:7, ts:Date.now()-5*3600e3, tipo:'falecidos', por:'Sebastião Pereira (7º dia)', data:ymd(dia(2)), hora:'10h', nome:'Rita Pereira', whats:'31977770001', status:'nova'},
    {id:8, ts:Date.now()-20*3600e3, tipo:'gracas', por:'Pelos 15 anos de casamento', data:ymd(dia(2)), hora:'10h', nome:'Ana', whats:'', status:'confirmada'}],
  velas:[], log:[], enviadosHoje:{dia:'', ids:[]}};
const C = (id, name) => ({id, parish_id:'p-1', name, slug:id, patron:'', address:'', phone:'', description:'', photo_url:null, mass_schedule:'', active:true, created_at:agora, updated_at:agora});
B.t.communities.push(C('c-1', 'Comunidade São José'), C('c-2', 'Comunidade Nossa Senhora Aparecida'));
const EV = (id, title, ini, extra = {}) => ({id, parish_id:'p-1', community_id:null, scope:'parish', title, description:'', starts_at:iso(ini), ends_at:null, location:'Matriz', public:true, highlight_home:false, image_url:null, created_by:'u-sec', google_event_id:null, cancelled:false, created_at:agora, updated_at:agora, ...extra});
const hojeAs = h => { const d = new Date(); d.setHours(h, 0, 0, 0); return d; };
B.t.events.push(EV('e-1', 'Reunião do conselho pastoral', hojeAs(20)), EV('e-2', 'Terço dos homens', hojeAs(19)), EV('e-3', 'Batizados do mês', emHoras(50)), EV('e-4', 'Festa de São Francisco', emHoras(120), {community_id:'c-2', scope:'community', location:'Comunidade Aparecida'}));
const TT = (id, name, extra = {}) => ({id, parish_id:'p-1', community_id:null, name, whatsapp:'3199000' + id.slice(2).padStart(4, '0'), birth_date:null, marriage_date:null, joined_on:'2020-01-01', status:'active', consent:true, notes:null, created_at:agora, updated_at:agora, ...extra});
for (let i = 1; i <= 12; i++) B.t.tither_profiles.push(TT('t-' + i, ['Antônio Ferreira','Beatriz Lima','Carlos Mendes','Denise Rocha','Eduardo Alves','Fátima Souza','Geraldo Nunes','Helena Castro','Isabel Duarte','João Batista','Lúcia Prado','Marcos Vieira'][i-1], i === 3 ? {birth_date:'1970-' + mmdd(hoje)} : i === 12 ? {joined_on:ymd(dia(-10))} : {}));
const mes = ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
for (let i = 1; i <= 8; i++) B.t.tither_contributions.push({id:'k-' + i, parish_id:'p-1', tither_id:'t-' + i, reference_month:mes, received_at:agora, notes:null, created_at:agora, updated_at:agora});
B.t.tither_leads.push({id:'l-1', parish_id:'p-1', community_id:null, name:'Rodrigo Almeida', whatsapp:'31966660001', contact_preference:'whatsapp', consent:true, status:'new', tither_id:null, created_at:iso(emHoras(-1)), updated_at:agora});
// solicitações reais fictícias além das 5 DEMO do seed (fila mais cheia, para desempenho)
const criar = (svc, nome, wa, ans = {}) => como(banco.db, null, tx => tx.query(`select public_create_service_request('santo-antonio-jaragua', $1, $2, $3, 'whatsapp', $4::jsonb) r`, [svc, nome, wa, JSON.stringify(ans)])).then(r => r.rows[0].r);
const NOMES = ['Ana Beatriz Costa','Bruno Henrique Dias','Cláudia Regina Melo','Daniel Souza Lima','Elaine Cristina Rocha','Fernando Luís Paiva','Gabriela Nunes','Hugo Martins','Irene Batista','Jorge Amaral'];
for (let i = 0; i < 40; i++) await criar(i % 3 ? 'outro' : 'catequese', NOMES[i % 10] + ' ' + (i + 1), '3198' + String(1000000 + i * 7).padStart(7, '0'),
  i % 3 ? {mensagem:'Gostaria de uma informação sobre a secretaria.'} : {nome_catequizando:'Criança ' + i});
await banco.db.exec(`update service_requests set status = (array['in_progress','waiting_user','completed','completed','closed'])[1 + (abs(hashtext(id::text)) % 5)] where not is_demo`);
await banco.db.exec(`update service_requests set status = 'new' where id in (select id from service_requests where not is_demo order by created_at desc limit 2)`);
const op = ponte(opFake, banco, {});

// ---------- navegador ----------
const browser = await puppeteer.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
let ok = 0, falha = 0; const t_ = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 400)); };
let t;
const errosGlobais = [], ignorados = [];
async function aparelho({hash = '', largura = 390, altura = 844, escuro = false} = {}){
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({width:largura, height:altura, deviceScaleFactor:1});
  if (escuro) await page.emulateMediaFeatures([{name:'prefers-color-scheme', value:'dark'}]);
  await page.exposeFunction('__sb', q => op(q)); await page.evaluateOnNewDocument(CLI);
  page.erros = [];
  page.on('pageerror', e => { page.erros.push(e.message); errosGlobais.push(e.message); });
  page.on('console', m => { if (m.type() !== 'error') return; const t = m.text();
    if (/404|Failed to load resource/.test(t)) { ignorados.push(t); return; } page.erros.push(t); errosGlobais.push(t); });
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORTA}/${hash}`, {waitUntil:'networkidle0', timeout:60000}); await esperar(400);
  return page;
}
const clk = (p, sel) => p.$eval(sel, e => { e.scrollIntoView({block:'center'}); e.click(); });
const entrar = async (p, email) => { await p.type('#l-em', email); await p.type('#l-pw', '123456'); await clk(p, '#l-btn'); await esperar(1200); };
const texto = p => p.evaluate(() => document.getElementById('view').innerText);
const semRolagemLateral = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const vis = (p, sel) => p.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight) && getComputedStyle(e).visibility !== 'hidden').catch(() => false);
const foto = async (p, nome, inteira = false) => { await esperar(300); await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({path:path.join(SHOTS, nome + '.png'), fullPage:inteira}); };
const ir = async (p, k) => { await p.evaluate(k => document.querySelector(`#tabs [data-tab="${k}"]`).click(), k); await esperar(700); };
const layout = p => p.evaluate(() => { const n = document.getElementById('tabs').getBoundingClientRect(), m = document.getElementById('view').getBoundingClientRect();
  return {navEsq: n.left < 5 && n.height > 300, navBaixo: n.bottom >= innerHeight - 2 && n.height < 120, navLarg: Math.round(n.width), mainLarg: Math.round(m.width), mainEsq: Math.round(m.left)}; });
// Termos técnicos nunca aparecem para quem usa o painel.
const semTecnico = async p => !/\b(new|in_progress|waiting_user|completed|closed|null|undefined|NaN)\b/.test(await texto(p));
// Acessibilidade básica: todo botão/link tem nome; todo campo tem rótulo.
const a11y = p => p.evaluate(() => {
  const sem = [...document.querySelectorAll('#view button, #view a, #tabs button, header button')].filter(e => e.offsetParent && !(e.getAttribute('aria-label') || e.textContent.trim()));
  const campos = [...document.querySelectorAll('#view input:not([type=hidden]):not([type=radio]):not([type=checkbox]), #view select, #view textarea')].filter(e => e.offsetParent && !e.closest('.hp') && !(e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest('label')));
  return {botoesSemNome: sem.length, camposSemRotulo: campos.map(e => e.id || e.name)};
});

// ================= CELULAR 390 × 844 =================
console.log('== celular 390 × 844 (secretaria)');
{ const p = await aparelho({hash:'#painel'}); await entrar(p, 'secretaria@teste');
  const L = await layout(p);
  t_('celular: barra embaixo (não virou mini desktop)', L.navBaixo && !L.navEsq, JSON.stringify(L));
  t_('celular: barra com Início, Comunicar, Agenda, Intenções, Mais', JSON.stringify(await p.$$eval('#tabs button', l => l.filter(b => b.offsetParent).map(b => b.dataset.tab))) === '["inicio","comunicar","agenda","intencoes","mais"]');
  let t = await texto(p);
  t_('celular: abre no Início da secretaria', /Bom dia|Boa tarde|Boa noite/.test(t) && t.includes('Secretaria 24h') && t.includes('Abrir fila da Secretaria 24h'));
  t_('Início: 4 números da Secretaria 24h', (await p.$$('.ini-stats .stat')).length === 4 && t.includes('Concluídas hoje'));
  t_('Início: Hoje (agenda, intenções, avisos, aniversários) e ações rápidas', ['Agenda','Intenções','Avisos','Aniversários e bodas','Ações rápidas','Publicar aviso','Criar evento'].every(x => t.toUpperCase().includes(x.toUpperCase())), t.slice(0, 600));
  t_('Início: agenda com 2 compromissos hoje', /2\s*compromissos hoje/i.test(t));
  t_('Mais: badge soma as pendências (Secretaria 24h + outras)', await p.$eval('#tabs [data-tab="mais"] .badge', e => +e.firstChild.textContent).catch(() => 0) >= 7);
  t_('celular: sem rolagem lateral (Início)', await semRolagemLateral(p)); await foto(p, 'm390-01-inicio-secretaria'); await foto(p, 'm390-01b-inicio-secretaria-inteiro', true);
  t_('celular: sem termo técnico no Início', await semTecnico(p));
  await clk(p, '[data-ir="s24"]'); await esperar(900);
  t_('celular: fila mostra só a lista (sem detalhe)', await vis(p, '.s24-md-lista') && !(await vis(p, '.s24-md-det')));
  t_('celular: marca "Nova" nas não abertas', (await p.$$('.s24-row .s24-nova')).length >= 3);
  t_('celular: sem rolagem lateral (fila)', await semRolagemLateral(p)); await foto(p, 'm390-02-fila');
  await p.$eval('.s24-row', e => e.click()); await esperar(900);
  t_('celular: detalhe ocupa a tela (lista escondida)', await vis(p, '.s24-md-det') && !(await vis(p, '.s24-md-lista')) && (await texto(p)).includes('Respostas do formulário'));
  t_('celular: status em português no detalhe', (await p.$$eval('#s24-st option', l => l.map(o => o.textContent))).join('|') === 'Recebida|Em atendimento|Aguardando resposta do fiel|Concluída|Encerrada');
  t_('celular: sem rolagem lateral (detalhe)', await semRolagemLateral(p)); await foto(p, 'm390-03-detalhe');
  const a = await a11y(p); t_('celular: botões com nome e campos com rótulo', !a.botoesSemNome && !a.camposSemRotulo.length, JSON.stringify(a));
  t_('celular: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= TABLET =================
for (const [w, h] of [[768, 1024], [1024, 768]]){
  console.log(`== tablet ${w} × ${h}`);
  const p = await aparelho({hash:'#painel', largura:w, altura:h}); await entrar(p, 'secretaria@teste');
  const L = await layout(p);
  t_(`${w}: trilho lateral com ícone + nome`, L.navEsq && L.navLarg >= 90 && L.navLarg <= 110, JSON.stringify(L));
  const nomes = await p.$$eval('#tabs button', l => l.filter(b => b.offsetParent).map(b => b.innerText.trim().split('\n')[0]));
  t_(`${w}: todas as áreas visíveis, com texto (não só ícone)`, nomes.includes('Secretaria 24h') && nomes.includes('Dizimistas') && nomes.includes('Ajustes') && !nomes.includes('Mais') && nomes.every(Boolean), nomes.join(','));
  t_(`${w}: sem rolagem lateral (Início)`, await semRolagemLateral(p)); await foto(p, `t${w}-01-inicio`);
  await ir(p, 'secretaria24h');
  t_(`${w}: sem rolagem lateral (fila)`, await semRolagemLateral(p)); await foto(p, `t${w}-02-fila`);
  await p.$eval('.s24-row', e => e.click()); await esperar(900);
  const lado = await vis(p, '.s24-md-lista') && await vis(p, '.s24-md-det');
  t_(`${w}: ${w >= 1024 ? 'lista e detalhe lado a lado' : 'detalhe em tela cheia (pouca largura)'}`, w >= 1024 ? lado : !lado && await vis(p, '.s24-md-det'));
  await foto(p, `t${w}-03-fila-detalhe`);
  t_(`${w}: sem erros de JS`, !p.erros.length, p.erros.join(' | '));
}

// ================= COMPUTADOR 1366 × 768 (secretaria) =================
console.log('== computador 1366 × 768 (secretaria)');
let reqNova;
{ const p = await aparelho({hash:'#painel', largura:1366, altura:768}); await entrar(p, 'secretaria@teste');
  const L = await layout(p);
  t_('1366: menu lateral fixo e conteúdo largo', L.navEsq && L.navLarg >= 220 && L.mainLarg >= 1050, JSON.stringify(L));
  t_('1366: cabeçalho com paróquia, perfil, 🔔 e Sair', await p.evaluate(() => { const h = document.querySelector('header.top'); return h.getBoundingClientRect().height <= 70 && h.innerText.toUpperCase().includes('CENTRAL PAROQUIAL') && h.innerText.includes('Secretaria ·') && !document.getElementById('sino').hidden && !document.getElementById('btnSair').hidden; }));
  const badge = await p.$eval('#tabs [data-tab="secretaria24h"] .badge', e => +e.firstChild.textContent).catch(() => 0);
  const novasBanco = (await banco.db.query(`select count(*)::int n from service_requests where status='new'`)).rows[0].n;
  t_('1366: badge da Secretaria 24h no menu = solicitações novas', badge === novasBanco && badge > 0, `${badge} x ${novasBanco}`);
  t_('1366: Secretaria 24h em destaque no menu (não escondida em Mais)', await vis(p, '#tabs [data-tab="secretaria24h"]') && !(await vis(p, '#tabs [data-tab="mais"]')));
  t_('1366: sem rolagem lateral (Início)', await semRolagemLateral(p)); await foto(p, 'd1366-01-inicio-secretaria');
  const a = await a11y(p); t_('1366: botões com nome e campos com rótulo (Início)', !a.botoesSemNome && !a.camposSemRotulo.length, JSON.stringify(a));
  // 🔔
  const n = await p.$eval('#sinoN', e => e.hidden ? 0 : +e.textContent);
  t_('🔔 mostra o número de novas atividades', n >= novasBanco + 2, n); // + interessado + intenção nova
  await clk(p, '#sino'); await esperar(300);
  t = await p.$eval('#sinoPainel', e => e.innerText);
  t_('🔔 lista solicitação, interessado e intenção', t.includes('Nova solicitação') && t.includes('Novo interessado em ser dizimista') && t.includes('Nova intenção de missa'));
  await foto(p, 'd1366-02-sino');
  await p.keyboard.press('Escape'); await esperar(200);
  t_('🔔 fecha com Esc e zera o número', await p.$eval('#sinoPainel', e => e.hidden) && await p.$eval('#sinoN', e => e.hidden));
  // fila master-detail
  await ir(p, 'secretaria24h');
  t_('1366: fila com resumo no topo, filtros e busca sempre visíveis', await vis(p, '.s24-cards') && await vis(p, '.s24-md-lista .filtros') && await vis(p, '#s24Busca'));
  t_('1366: sem seleção, o painel da direita orienta', (await texto(p)).includes('Selecione uma solicitação na lista'));
  const y0 = await p.evaluate(() => { document.querySelectorAll('.s24-row')[6].scrollIntoView({block:'center'}); return scrollY; });
  await p.evaluate(() => document.querySelectorAll('.s24-row')[6].click()); await esperar(900);
  t_('1366: master-detail: lista e detalhe lado a lado, sem abrir/voltar', await vis(p, '.s24-md-lista') && await vis(p, '.s24-md-det') && (await texto(p)).includes('Respostas do formulário'));
  t_('1366: a lista não pula para o topo ao abrir', Math.abs(await p.evaluate(() => scrollY) - y0) < 5);
  t_('1366: linha aberta marcada', (await p.$$('.s24-row[aria-current="true"]')).length === 1);
  t_('1366: sem termo técnico na fila', await semTecnico(p));
  t_('1366: sem rolagem lateral (fila)', await semRolagemLateral(p)); await foto(p, 'd1366-03-secretaria24h-master-detail');
  // chega uma solicitação nova com o painel aberto
  const r = await criar('certidao', 'Maria Aparecida dos Santos', '31955551234', {tipo_documento:'Certidão de Batismo', nome_pessoa:'Maria Aparecida dos Santos'});
  reqNova = (await banco.db.query(`select id from service_requests where protocol=$1`, [r.protocol])).rows[0].id;
  await ir(p, 'agenda'); await ir(p, 'secretaria24h'); await esperar(600);
  const toast = await p.$eval('.aviso-toast', e => e.innerText).catch(() => '');
  t_('aviso do sistema quando chega solicitação (sem alert)', toast.includes('Nova solicitação') && toast.includes('Certidão / documento paroquial') && toast.includes('Maria Aparecida') && toast.includes('Ver solicitação'), toast);
  t_('badge sobe junto', await p.$eval('#tabs [data-tab="secretaria24h"] .badge', e => +e.firstChild.textContent) === novasBanco + 1);
  await foto(p, 'd1366-04-aviso-nova-solicitacao');
  await p.evaluate(() => document.querySelector('.aviso-toast .at-acao').click()); await esperar(900);
  t_('"Ver solicitação" abre direto o detalhe', (await texto(p)).includes('Maria Aparecida dos Santos') && await p.$eval('.s24-row[aria-current="true"]', e => e.innerText.includes('Maria Aparecida')).catch(() => false));
  t_('ao abrir, a marca "Nova" some daquela solicitação', await p.$eval('.s24-row[aria-current="true"]', e => !e.querySelector('.s24-nova')));
  // agenda e dizimistas no computador
  await ir(p, 'agenda'); t_('1366: Agenda', (await texto(p)).includes('Reunião do conselho pastoral') && await semRolagemLateral(p)); await foto(p, 'd1366-05-agenda');
  await ir(p, 'dizimistas'); t_('1366: Dizimistas', (await texto(p)).includes('Antônio Ferreira') && await semRolagemLateral(p)); await foto(p, 'd1366-06-dizimistas');
  await p.evaluate(() => document.querySelector('[data-dzv="acomp"]').click()); await esperar(500);
  t_('1366: Acompanhamento do dízimo', (await texto(p)).includes('Acompanhamento do dízimo')); await foto(p, 'd1366-07-dizimo');
  for (const k of ['comunicar','intencoes','mensagens','pessoas','comunidades','uso','ajustes']){ await ir(p, k); if (!await semRolagemLateral(p)) t_(`1366: ${k} sem rolagem lateral`, false); }
  t_('1366: todas as áreas abrem sem rolagem lateral', true);
  await ir(p, 'comunicar'); await foto(p, 'd1366-08-comunicar');
  t_('1366: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= COMPUTADOR 1920 × 1080 (padre) =================
console.log('== computador 1920 × 1080 (padre)');
{ const p = await aparelho({hash:'#painel', largura:1920, altura:1080}); await entrar(p, 'padre@teste');
  let t = await texto(p);
  t_('padre: Início gerencial (não abre na fila)', await p.evaluate(() => S.tab) === 'inicio' && t.toUpperCase().includes('COMO ESTÁ A PARÓQUIA HOJE') && !(await p.$('.s24-row')));
  t_('padre: cartões Secretaria 24h, Agenda, Aniversários, Dízimo, Avisos, Intenções, Interessados, Novos dizimistas',
    ['SECRETARIA 24H','AGENDA','ANIVERSÁRIOS E BODAS','DÍZIMO DE','AVISOS','INTENÇÕES','QUERO SER DIZIMISTA','NOVOS DIZIMISTAS'].every(x => t.toUpperCase().includes(x)), t.slice(0, 800));
  t_('padre: dízimo do mês com percentual (8 de 12)', t.includes('67%') && t.includes('8 de 12'));
  t_('padre: conteúdo aproveita a tela (sem faixas vazias enormes)', await p.evaluate(() => document.querySelector('.ini-cards').getBoundingClientRect().width) >= 1300);
  t_('padre: sem rolagem lateral', await semRolagemLateral(p)); await foto(p, 'd1920-01-inicio-padre');
  await p.evaluate(() => [...document.querySelectorAll('.ini-card')].find(b => b.innerText.includes('DÍZIMO DE') || b.innerText.toUpperCase().includes('DÍZIMO DE')).click()); await esperar(600);
  t_('padre: cartão do Dízimo abre o acompanhamento', (await texto(p)).includes('Acompanhamento do dízimo'));
  await ir(p, 'inicio'); await p.evaluate(() => document.querySelector('.ini-card[data-ir="interessados"]').click()); await esperar(600);
  t_('padre: cartão de interessados abre a lista', (await texto(p)).includes('Rodrigo Almeida'));
  await ir(p, 'secretaria24h'); await p.evaluate(() => document.querySelector('.s24-row').click()); await esperar(900);
  t_('padre: vê e abre solicitação', (await texto(p)).includes('Atualizar atendimento'));
  await foto(p, 'd1920-02-secretaria24h');
  t_('padre: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= PASCOM =================
console.log('== PASCOM (1366)');
{ const p = await aparelho({hash:'#painel', largura:1366, altura:768}); await entrar(p, 'pascom@teste');
  const itens = await p.$$eval('#tabs button', l => l.filter(b => b.offsetParent).map(b => b.dataset.tab));
  t_('PASCOM: menu sem Secretaria 24h e sem Dizimistas', !itens.includes('secretaria24h') && !itens.includes('dizimistas'), itens.join());
  const t = await texto(p);
  t_('PASCOM: Início de comunicação, sem dados privados', t.includes('Publicar aviso') && !t.includes('Secretaria 24h') && !t.toUpperCase().includes('DÍZIMO') && !t.includes('Rodrigo'));
  await clk(p, '#sino'); await esperar(300);
  const s = await p.$eval('#sinoPainel', e => e.innerText);
  t_('PASCOM: 🔔 sem solicitações nem interessados', !s.includes('Nova solicitação') && !s.includes('interessado'), s);
  await p.keyboard.press('Escape');
  await foto(p, 'd1366-09-inicio-pascom');
  t_('PASCOM: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= fiel: Minhas solicitações =================
console.log('== fiel: Minhas solicitações (390)');
{ const p = await aparelho(); await clk(p, '#mPublico').catch(() => {}); await esperar(300);
  await clk(p, '[data-s24-abrir]'); await esperar(400);
  t_('sem solicitações ainda: não mostra a seção', !(await texto(p)).includes('Minhas solicitações'));
  await clk(p, '[data-s24-servico="batismo"]'); await esperar(300);
  await p.type('#s24-c-nome_pessoa', 'Pedro Henrique'); await p.type('#s24-c-observacoes', 'Resposta que não pode ficar guardada');
  await p.type('#s24-nome', 'Carla Menezes'); await p.type('#s24-wa', '(31) 98111-2233'); await clk(p, 'input[name=ok]');
  await clk(p, '#s24Enviar'); await esperar(900);
  const proto = await p.$eval('.s24-proto', e => e.textContent);
  const guardado = await p.evaluate(() => localStorage.getItem('central-paroquial-s24-minhas'));
  t_('guarda só protocolo, serviço, data, WhatsApp normalizado e situação', guardado.includes(proto) && guardado.includes('31981112233') && guardado.includes('Batismo') && !guardado.includes('Pedro') && !guardado.includes('não pode ficar') && !guardado.includes('Carla'), guardado);
  await clk(p, '[data-pub="igreja"]'); await esperar(300); await clk(p, '[data-s24-abrir]'); await esperar(400);
  let t = await texto(p);
  t_('Minhas solicitações aparece com o protocolo', t.includes('Minhas solicitações') && t.includes(proto) && t.includes('Consultar outra solicitação'));
  await foto(p, 'm390-04-minhas-solicitacoes', true);
  await clk(p, `[data-s24-minha="${proto}"]`); await esperar(900);
  t = await texto(p);
  t_('Acompanhar: preenche protocolo + WhatsApp sozinho e consulta', t.includes('Situação atual') && t.includes('Batismo') && await p.$eval('#s24-p', e => e.value) === proto);
  await foto(p, 'm390-05-acompanhar-automatico');
  await clk(p, '[data-s24-ir="inicio"]'); await esperar(300); await clk(p, `[data-s24-esquecer="${proto}"]`); await esperar(300);
  t_('Remover deste aparelho', !(await texto(p)).includes(proto) && !(await p.evaluate(() => localStorage.getItem('central-paroquial-s24-minhas'))).includes(proto));
  t_('fiel: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= erro ao salvar: mensagem humana + Tentar novamente =================
console.log('== erro ao salvar (1366)');
{ const p = await aparelho({hash:'#painel', largura:1366, altura:768}); await entrar(p, 'secretaria@teste');
  await ir(p, 'secretaria24h'); await p.evaluate(id => document.querySelector(`[data-s24-req="${id}"]`).click(), reqNova); await esperar(900);
  await p.select('#s24-st', 'in_progress');
  await p.evaluate(() => { window.__rpc = NUVEM.sb.rpc; NUVEM.sb.rpc = async () => ({error:{code:'42501', message:'RPC failed 42501'}}); });
  await clk(p, '#s24Salvar'); await esperar(600);
  const e = await p.$eval('.aviso-toast.erro', x => x.innerText).catch(() => '');
  t_('erro sem código técnico e com "Tentar novamente"', e.includes('Não foi possível salvar agora') && e.includes('Tentar novamente') && !e.includes('42501') && !e.includes('RPC'), e);
  await foto(p, 'd1366-10-erro-tentar-novamente');
  await p.evaluate(() => { NUVEM.sb.rpc = window.__rpc; document.querySelector('.aviso-toast.erro .at-acao').click(); }); await esperar(1200);
  t_('"Tentar novamente" salva o que estava escrito', (await banco.db.query(`select status from service_requests where id=$1`, [reqNova])).rows[0].status === 'in_progress');
  t_('confirmação clara', (await p.$eval('.toast', x => x.textContent).catch(() => '')).includes('✓ Status atualizado'));
}

// ================= modo escuro no computador =================
{ const p = await aparelho({hash:'#painel', largura:1366, altura:768, escuro:true}); await entrar(p, 'secretaria@teste');
  await foto(p, 'd1366-11-inicio-escuro'); await ir(p, 'secretaria24h'); await p.evaluate(() => document.querySelector('.s24-row').click()); await esperar(900);
  await foto(p, 'd1366-12-fila-escuro'); t_('escuro: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= desempenho =================
console.log('== desempenho');
{ const p = await aparelho({hash:'#painel', largura:1366, altura:768}); await entrar(p, 'secretaria@teste');
  const n = (await banco.db.query(`select count(*)::int n from service_requests`)).rows[0].n;
  const ms = await p.evaluate(() => { const t = []; for (const k of ['inicio','secretaria24h','inicio','secretaria24h']){ S.tab = k; const a = performance.now(); render(); t.push(performance.now() - a); } return t.map(Math.round); });
  console.log(`  desenho (ms) Início/fila com ${n} solicitações:`, ms.join(' / '));
  t_('desenhar Início e fila leva menos de 100 ms', Math.max(...ms) < 100, ms);
}

console.log(`\n404 esperados (Worker /api não roda localmente): ${ignorados.length}`);
console.log(`erros de JS no total: ${errosGlobais.length}`);
console.log(`\n${ok} ok, ${falha} falha(s)`);
await browser.close(); process.exit(falha ? 1 : 0);
