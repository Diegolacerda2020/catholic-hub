// Secretaria 24h no Chrome de verdade, com login e banco: o resto do app usa o Supabase falso
// (fakesb.mjs) e a Secretaria 24h usa o SQL real num Postgres local (s24db.mjs).
// Cobre: fiel anônimo, padre, secretaria, PASCOM, multi-paróquia, falhas isoladas e screenshots.
import { fileURLToPath } from 'node:url';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {criarBackend, CLIENTE} from './supabase-falso.mjs';
import {criarBanco, ponte, como, UID, SLUG_B} from './banco.mjs';
import {esperar, texto, clicarTexto} from './ui.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots', import.meta.url)); fs.mkdirSync(SHOTS, {recursive:true});
const CLI = CLIENTE.replace('gte(){ return b; },', 'gte(){ return b; }, order(){ return b; }, limit(){ return b; },');
const TIPOS = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8'};
const SRV = {slug:'santo-antonio-jaragua', modulo:'ok'};
const PORTA = 8801;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/config.js'){ res.writeHead(200, {'content-type':TIPOS['.js']}); return res.end(`window.CENTRAL_CONFIG = {supabase:{url:"https://fake.supabase.co", anonKey:"x"}, parishSlug:${JSON.stringify(SRV.slug)}};`); }
  if (u.pathname === '/secretaria24h.js' && SRV.modulo === '404'){ res.writeHead(404); return res.end(); }
  if (u.pathname === '/secretaria24h.js' && SRV.modulo === 'quebrado'){ res.writeHead(200, {'content-type':TIPOS['.js']}); return res.end('throw new Error("módulo quebrado de propósito");'); }
  if (u.pathname.startsWith('/api/')){ res.writeHead(404); return res.end(); }
  const f = path.join(REPO, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.resolve(REPO)) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'content-type':TIPOS[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(PORTA);

const banco = await criarBanco();
const {B, op: opFake} = criarBackend({});
B.estado.data = {cfg:{nome:'Paróquia Santo Antônio – Jaraguá', missas:'Terça-feira: 19h30\nSábado: 18h00\nDomingo: 07h30, 09h30 e 18h00', padroeiro:'Santo Antônio', endereco:'Praça Santo Antônio, 2 – Jaraguá', telefone:'(31) 3427-2866', forania:'Santo Antônio (Pampulha)', regiao:'RENSC', tom:'acolhedor', emoji:true, assinatura:'Deus abençoe!', youtube:'', rec:{}, pix:'', secretaria:'Segunda a sexta, 8h às 12h e 14h às 18h', whats:'', email:''},
  modelos:{aniversario:'a {nome}', bodas:'b {nome}', dizimista:'d {nome}'}, pessoas:[], avisos:[{id:1, ts:Date.now()-864e5, titulo:'Aviso da paróquia', texto:'Continua aparecendo.', evento:null}], intencoes:[], velas:[], log:[], enviadosHoje:{dia:'', ids:[]}};
B.t.communities.push({id:'c-1', parish_id:'p-1', name:'Comunidade São José', slug:'sao-jose', patron:'São José', address:'Rua A, 1', phone:'', description:'', photo_url:null, mass_schedule:'Domingo 9h', active:true, created_at:new Date().toISOString(), updated_at:new Date().toISOString()});
B.t.tither_profiles.push({id:'t-1', parish_id:'p-1', community_id:null, name:'Dizimista Teste', whatsapp:'31990000001', birth_date:null, marriage_date:null, joined_on:'2020-01-01', status:'active', consent:true, notes:null, created_at:new Date().toISOString(), updated_at:new Date().toISOString()});
const OP = {falha:null};
const op = ponte(opFake, banco, OP);

const browser = await puppeteer.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
let ok = 0, falha = 0; const t_ = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 300)); };
const errosGlobais = [];
async function aparelho({hash = '', largura = 390, escuro = false} = {}){
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({width:largura, height:844, deviceScaleFactor:1});
  if (escuro) await page.emulateMediaFeatures([{name:'prefers-color-scheme', value:'dark'}]);
  await page.exposeFunction('__sb', q => op(q)); await page.evaluateOnNewDocument(CLI);
  page.erros = [];
  page.on('pageerror', e => { page.erros.push(e.message); errosGlobais.push(e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) { page.erros.push(m.text()); errosGlobais.push(m.text()); } });
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORTA}/${hash}`, {waitUntil:'networkidle0', timeout:60000}); await esperar(500);
  return page;
}
const entrar = async (p, email) => { await p.type('#l-em', email); await p.type('#l-pw', '123456'); await clk(p, '#l-btn'); await esperar(900); };
const semRolagemLateral = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Página inteira: cabeçalho e barra fixos viram estáticos só durante a foto (senão o puppeteer os desenha no meio).
const foto = async (p, nome) => { await esperar(250);
  await p.evaluate(() => { const st = document.createElement('style'); st.id = '__foto'; st.textContent = 'header.top{position:static!important} nav.tabs,.toast{display:none!important} main{padding-bottom:14px!important}'; document.head.appendChild(st); window.scrollTo(0, 0); });
  await p.screenshot({path:path.join(SHOTS, nome + '.png'), fullPage:true});
  await p.evaluate(() => document.getElementById('__foto')?.remove()); };
const vis = (p, sel) => p.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
const tipo = async (p, sel, v) => { await p.$eval(sel, e => e.value = ''); await p.type(sel, v); };
let t;
const clk = (p, sel) => p.$eval(sel, e => { e.scrollIntoView({block:'center'}); e.click(); });

// ---------------------------------------------------------------- fiel (anônimo)
console.log('== fiel anônimo (390 px)');
const fiel = await aparelho();
await clk(fiel, '#mPublico').catch(() => {}); await esperar(400);
t_('barra pública sem aba nova', JSON.stringify(await fiel.$$eval('#tabs button', l => l.map(b => b.dataset.tab))) === '["igreja","agenda","comunidades","avisos","contato"]');
t_('card na Home', await vis(fiel, '.s24-card') && (await texto(fiel)).includes('Secretaria paroquial, sempre aberta'));
t_('Home sem rolagem lateral', await semRolagemLateral(fiel));
await fiel.$eval('.s24-card', e => e.scrollIntoView({block:'center'}));
await fiel.screenshot({path:path.join(SHOTS, '01-home-card-390.png')});
await clk(fiel, '[data-s24-abrir]'); await esperar(400); t = await texto(fiel);
t_('catálogo via RPC com 6 serviços', (await fiel.$$('.s24-serv')).length === 6);
t_('aviso de horário e horário da secretaria', t.includes('O atendimento pela equipe acontece no horário normal da secretaria') && t.includes('Segunda a sexta, 8h às 12h'));
t_('catálogo sem rolagem lateral', await semRolagemLateral(fiel)); await foto(fiel, '02-catalogo-390');
await clk(fiel, '[data-s24-servico="certidao"]'); await esperar(300);
await fiel.select('#s24-c-tipo_documento', 'Certidão de Batismo');
await fiel.type('#s24-c-nome_pessoa', 'Ana Lúcia Ferreira'); await fiel.type('#s24-c-data_sacramento', 'por volta de 1990');
await fiel.type('#s24-c-observacoes', 'Preciso para o casamento.');
await fiel.type('#s24-nome', 'Ana Lúcia Ferreira'); await fiel.type('#s24-wa', '(31) 98877-6655');
await clk(fiel, 'input[name=ok]');
t_('formulário sem rolagem lateral', await semRolagemLateral(fiel)); await foto(fiel, '03-formulario-390');
// duplo clique
await fiel.evaluate(() => { const b = document.getElementById('s24Enviar'); b.click(); b.click(); }); await esperar(900);
const proto = await fiel.$eval('.s24-proto', e => e.textContent).catch(() => '');
t_('protocolo recebido', /^SA-\d{4}-[0-9A-F]{8}$/.test(proto), proto);
const nA = (await banco.db.query(`select count(*)::int n from service_requests where whatsapp='31988776655'`)).rows[0].n;
t_('duplo clique gera 1 solicitação só', nA === 1, nA);
t_('confirmação sem rolagem lateral', await semRolagemLateral(fiel)); await foto(fiel, '04-confirmacao-390');
// reenvio pelo formulário (internet ruim) devolve o mesmo protocolo
await clk(fiel, '#tabs [data-tab="igreja"]'); await esperar(300); await clk(fiel, '[data-s24-abrir]'); await esperar(300);
await clk(fiel, '[data-s24-servico="certidao"]'); await esperar(300);
await fiel.select('#s24-c-tipo_documento', 'Certidão de Batismo'); await fiel.type('#s24-c-nome_pessoa', 'Ana'); await fiel.type('#s24-nome', 'Ana'); await fiel.type('#s24-wa', '31988776655'); await clk(fiel, 'input[name=ok]');
await clk(fiel, '#s24Enviar'); await esperar(900);
t_('reenvio em 5 min devolve o mesmo protocolo', await fiel.$eval('.s24-proto', e => e.textContent).catch(() => '') === proto);
// consulta
const consultar = async (p, pr, wa) => { await clk(p, '#tabs [data-tab="igreja"]').catch(() => {}); await esperar(250); await clk(p, '[data-s24-abrir]'); await esperar(300); await clk(p, '[data-s24-ir="consulta"]'); await esperar(200); await tipo(p, '#s24-p', pr); await tipo(p, '#s24-pw', wa); await clk(p, '#s24Consultar'); await esperar(700); return texto(p); };
t = await consultar(fiel, proto, '31 98877-6655');
t_('protocolo + WhatsApp corretos mostram status', t.includes('Certidão / documento paroquial') && t.includes('Solicitação recebida'));
t = await consultar(fiel, proto, '31999998888');
t_('WhatsApp incorreto não revela existência', t.includes('Não encontramos uma solicitação') && !t.includes('Certidão / documento paroquial'));
t = await consultar(fiel, 'SA-2026-00000000', '31988776655');
t_('protocolo incorreto não revela existência', t.includes('Não encontramos uma solicitação') && !t.includes('Certidão / documento paroquial'));
t_('fiel não lê tabela direto', await fiel.evaluate(async () => { const r = await NUVEM.sb.from('service_requests').select('*').eq('parish_id', 'p-1'); return !!r.error; }));
t_('fiel não executa RPC da equipe', await fiel.evaluate(async () => { const r = await NUVEM.sb.rpc('staff_update_service_request', {p_request:'00000000-0000-0000-0000-000000000000', p_status:'closed', p_note:null, p_public_note:false}); return !!r.error; }));
// atalhos
await clk(fiel, '#tabs [data-tab="igreja"]'); await esperar(250); await clk(fiel, '[data-s24-abrir]'); await esperar(300);
await clk(fiel, '[data-s24-intencao]'); await esperar(400);
t_('atalho: intenção de Missa (fluxo existente)', await fiel.evaluate(() => S.pubTab === 'agenda' && !!document.getElementById('intF')));
await clk(fiel, '#tabs [data-tab="contato"]'); await esperar(300);
t_('botão Secretaria 24h na página Paróquia', (await fiel.$$eval('#view [data-s24-abrir]', l => l.map(b => b.textContent))).join().includes('Secretaria 24h'));
await clk(fiel, '#view [data-s24-abrir]'); await esperar(300);
await clk(fiel, '[data-pub="dizimista"]'); await esperar(300);
t_('atalho: Quero ser dizimista (fluxo existente)', await fiel.evaluate(() => S.pubTab === 'dizimista' && !!document.getElementById('dzPubF')));

// ---------------------------------------------------------------- equipe
async function equipe(email, rotulo){
  console.log(`== ${rotulo}`);
  const p = await aparelho({hash:'#painel'}); await entrar(p, email);
  const itens = await p.evaluate(() => maisItens().map(([k]) => k));
  return {p, itens};
}
const reqId = (await banco.db.query(`select id from service_requests where protocol=$1`, [proto])).rows[0].id;
for (const [email, rotulo, nome] of [['padre@teste', 'PADRE', 'padre'], ['secretaria@teste', 'SECRETARIA', 'sec']]){
  const {p, itens} = await equipe(email, rotulo);
  t_(`${rotulo}: vê o item em Mais`, itens.includes('secretaria24h'));
  await p.evaluate(() => { S.tab = 'mais'; render(); }); await esperar(200);
  await clicarTexto(p, '[data-mais]', 'Secretaria 24h'); await esperar(900); t = await texto(p);
  t_(`${rotulo}: vê a fila (1 real + 5 demo)`, (await p.$$('.s24-row')).length === 6 && t.includes('Ana Lúcia Ferreira'), (await p.$$('.s24-row')).length);
  t_(`${rotulo}: 4 cards`, (await p.$$('.s24-cards .stat')).length === 4);
  if (nome === 'sec'){ t_('painel sem rolagem lateral', await semRolagemLateral(p)); await foto(p, '06-painel-390'); }
  await p.evaluate(id => document.querySelector(`[data-s24-req="${id}"]`).click(), reqId); await esperar(900); t = await texto(p);
  t_(`${rotulo}: detalhe com respostas`, t.includes('Respostas do formulário') && t.includes('Certidão de Batismo') && t.includes('(31) 98877-6655'));
  const novo = nome === 'padre' ? 'in_progress' : 'waiting_user';
  await p.select('#s24-st', novo); await p.type('#s24-nota', `Nota interna do ${rotulo}`); await clk(p, '#s24Salvar'); await esperar(1200);
  await p.type('#s24-nota', `Mensagem pública do ${rotulo}`); await clk(p, 'input[name=publica]'); await clk(p, '#s24Salvar'); await esperar(1200); t = await texto(p);
  const h = (await banco.db.query(`select status, note, public_note, created_by from service_request_history where request_id=$1 order by created_at`, [reqId])).rows;
  if (process.env.DBG) console.log(JSON.stringify(h));
  const meu = h.filter(x => x.created_by === UID[nome === 'padre' ? 'u-padre' : 'u-sec']);
  t_(`${rotulo}: altera status`, (await banco.db.query(`select status from service_requests where id=$1`, [reqId])).rows[0].status === novo);
  t_(`${rotulo}: cria nota interna`, meu.some(x => x.note === `Nota interna do ${rotulo}` && !x.public_note));
  t_(`${rotulo}: cria nota pública`, meu.some(x => x.note === `Mensagem pública do ${rotulo}` && x.public_note));
  t_(`${rotulo}: histórico mostra interna e visível`, t.includes('nota interna') && t.includes('visível para o fiel'));
  if (nome === 'sec'){ t_('detalhe sem rolagem lateral', await semRolagemLateral(p)); await foto(p, '07-detalhe-390'); }
  t_(`${rotulo}: sem erros de JS`, !p.erros.length, p.erros.join(' | '));
}
t = await consultar(fiel, proto, '31988776655');
t_('fiel: nota pública aparece', t.includes('Mensagem pública do PADRE') && t.includes('Mensagem pública do SECRETARIA') && t.includes('Aguardando seu retorno'));
t_('fiel: nota interna nunca aparece', !t.includes('Nota interna'));
t_('consulta sem rolagem lateral', await semRolagemLateral(fiel)); await foto(fiel, '05-consulta-390');

{ const {p, itens} = await equipe('pascom@teste', 'PASCOM');
  t_('PASCOM: não vê o item', !itens.includes('secretaria24h'), itens);
  await p.evaluate(() => { S.tab = 'secretaria24h'; render(); }); await esperar(300);
  t_('PASCOM: forçar a tela volta ao início', await p.evaluate(() => S.tab) === 'comunicar');
  const r = await p.evaluate(async () => { const a = await NUVEM.sb.from('service_requests').select('*').eq('parish_id', NUVEM.parishId); const c = await NUVEM.sb.from('service_request_history').select('*'); return [a.data?.length ?? -1, c.data?.length ?? -1]; });
  t_('PASCOM: não lê solicitações nem histórico', r[0] === 0 && r[1] === 0, r);
  const s = await p.evaluate(async id => (await NUVEM.sb.rpc('staff_update_service_request', {p_request:id, p_status:'closed', p_note:null, p_public_note:false})).error?.code, reqId);
  t_('PASCOM: RPC da equipe negada', s === '42501', s);
  t_('PASCOM: status não mudou', (await banco.db.query(`select status from service_requests where id=$1`, [reqId])).rows[0].status === 'waiting_user');
}

// ---------------------------------------------------------------- desktop + modo escuro
console.log('== desktop (1280 px) e modo escuro');
for (const [larg, suf, escuro] of [[1280, '1280', false], [390, '390-escuro', true]]){
  const p = await aparelho({largura:larg, escuro});
  await clk(p, '#mPublico').catch(() => {}); await esperar(300);
  await p.$eval('.s24-card', e => e.scrollIntoView({block:'center'})); await p.screenshot({path:path.join(SHOTS, `01-home-card-${suf}.png`)});
  await clk(p, '[data-s24-abrir]'); await esperar(300); await foto(p, `02-catalogo-${suf}`);
  await clk(p, '[data-s24-servico="batismo"]'); await esperar(300); await foto(p, `03-formulario-${suf}`);
  t_(`${suf}: sem rolagem lateral`, await semRolagemLateral(p));
  const s = await aparelho({hash:'#painel', largura:larg, escuro}); await entrar(s, 'secretaria@teste');
  await s.evaluate(() => { S.tab = 'secretaria24h'; render(); }); await esperar(900); await foto(s, `06-painel-${suf}`);
  await s.evaluate(id => document.querySelector(`[data-s24-req="${id}"]`).click(), reqId); await esperar(900); await foto(s, `07-detalhe-${suf}`);
  t_(`${suf}: painel sem rolagem lateral`, await semRolagemLateral(s));
}
{ // confirmação e consulta no desktop
  const p = await aparelho({largura:1280}); await clk(p, '#mPublico').catch(() => {}); await esperar(300);
  await clk(p, '[data-s24-abrir]'); await esperar(300); await clk(p, '[data-s24-servico="outro"]'); await esperar(300);
  await p.type('#s24-c-mensagem', 'Gostaria de saber o horário das confissões.'); await p.type('#s24-nome', 'José Teste'); await p.type('#s24-wa', '31977776666'); await clk(p, 'input[name=ok]');
  await clk(p, '#s24Enviar'); await esperar(900); await foto(p, '04-confirmacao-1280');
  await clk(p, '[data-s24-acompanhar]'); await esperar(900); await foto(p, '05-consulta-1280');
  t_('desktop: confirmação → acompanhar mostra o resultado', (await texto(p)).includes('Outro assunto'));
}

// ---------------------------------------------------------------- multi-paróquia no front
console.log('== multi-paróquia (front com o slug da paróquia B)');
SRV.slug = SLUG_B;
{ const p = await aparelho(); await clk(p, '#mPublico').catch(() => {}); await esperar(300);
  await p.evaluate(() => { S.pubTab = 'secretaria'; render(); }); await esperar(600); t = await texto(p);
  t_('B: página mostra só o catálogo da B', t.includes('Visita a enfermos (B)') && t.includes('Segunda via de certidão (B)') && !t.includes('Matrimônio') && (await p.$$('.s24-serv')).length === 2);
  await clk(p, '[data-s24-servico="visita_enfermos"]'); await esperar(300);
  await p.type('#s24-nome', 'Fiel da B'); await p.type('#s24-wa', '31955554444'); await clk(p, 'input[name=ok]'); await clk(p, '#s24Enviar'); await esperar(900);
  const pb = await p.$eval('.s24-proto', e => e.textContent).catch(() => '');
  const row = (await banco.db.query(`select parish_id from service_requests where protocol=$1`, [pb])).rows[0];
  t_('B: solicitação gravada na paróquia B', row?.parish_id === banco.PID_B, pb);
  t = await consultar(p, proto, '31988776655');
  t_('B: protocolo da A + telefone certo consultado na B não aparece', t.includes('Não encontramos uma solicitação'));
}
SRV.slug = 'santo-antonio-jaragua';

// ---------------------------------------------------------------- falhas isoladas
async function passeio(p, rotulo){
  // Home, Agenda (+ intenções), Comunidades, Avisos, Paróquia, e no painel Dizimistas / Acompanhamento / Intenções
  const r = {};
  for (const k of ['igreja','agenda','comunidades','avisos','contato']){ await p.evaluate(k => document.querySelector(`#tabs [data-tab="${k}"]`).click(), k); await esperar(250); r[k] = await texto(p); }
  t_(`${rotulo}: Home Igreja continua`, r.igreja.includes('Hoje na Igreja') && r.igreja.includes('Notícias da Igreja'));
  t_(`${rotulo}: Agenda e intenções continuam`, r.agenda.includes('Agenda da paróquia') && r.agenda.includes('Pedir intenção de missa'));
  t_(`${rotulo}: Comunidades continuam`, r.comunidades.includes('Comunidade São José'));
  t_(`${rotulo}: Avisos continuam`, r.avisos.includes('Aviso da paróquia'));
  t_(`${rotulo}: Paróquia continua`, r.contato.includes('Secretaria paroquial'));
  return r;
}
async function painelPasseio(rotulo){
  const s = await aparelho({hash:'#painel'}); await entrar(s, 'secretaria@teste');
  const r = {};
  for (const k of ['dizimistas','intencoes','agenda','comunicar']){ await s.evaluate(k => document.querySelector(`#tabs [data-tab="${k}"]`).click(), k); await esperar(300); r[k] = await texto(s); }
  t_(`${rotulo}: Dizimistas continua`, r.dizimistas.includes('Dizimista Teste'));
  await s.evaluate(() => document.querySelector('#tabs [data-tab="dizimistas"]').click()); await esperar(300);
  await clk(s, '[data-dzv="acomp"]'); await esperar(400);
  t = await texto(s); t_(`${rotulo}: Acompanhamento do dízimo continua`, t.includes('Acompanhamento do dízimo') && t.includes('Dizimista Teste'), t.slice(0, 200));
  t_(`${rotulo}: Intenções continuam`, r.intencoes.includes('Intenções de missa'));
  return s;
}
for (const modo of ['rede', 'ausente']){
  console.log(`== falha: RPC/tabelas da Secretaria 24h com erro (${modo})`);
  OP.falha = modo;
  const p = await aparelho(); await clk(p, '#mPublico').catch(() => {}); await esperar(400);
  t_(`${modo}: Home sem o card (não quebra)`, !(await p.$('.s24-card')) && (await texto(p)).includes('Hoje na Igreja'));
  await passeio(p, modo);
  await p.evaluate(() => { S.pubTab = 'secretaria'; render(); }); await esperar(500); t = await texto(p);
  t_(`${modo}: dentro da Secretaria 24h: mensagem amigável`, t.includes('A Secretaria 24h está temporariamente indisponível. Os demais serviços da paróquia continuam funcionando.'));
  if (modo === 'rede') await foto(p, '08-indisponivel-390');
  const s = await painelPasseio(modo);
  await s.evaluate(() => { S.tab = 'secretaria24h'; render(); }); await esperar(900); t = await texto(s);
  t_(`${modo}: painel da Secretaria 24h: mensagem amigável`, t.includes('A Secretaria 24h está temporariamente indisponível'));
  t_(`${modo}: nenhum erro de JS escapou`, !p.erros.length && !s.erros.length, [...p.erros, ...s.erros].join(' | '));
}
OP.falha = null;
{ console.log('== falha: RPC cai com a pessoa dentro da Secretaria 24h');
  const p = await aparelho(); await clk(p, '#mPublico').catch(() => {}); await esperar(300);
  await clk(p, '[data-s24-abrir]'); await esperar(300); await clk(p, '[data-s24-servico="outro"]'); await esperar(300);
  await p.type('#s24-c-mensagem', 'Teste de queda'); await p.type('#s24-nome', 'Maria'); await p.type('#s24-wa', '31966665555'); await clk(p, 'input[name=ok]');
  OP.falha = 'rede'; await clk(p, '#s24Enviar'); await esperar(900);
  const toast = await p.$eval('.toast', e => e.textContent).catch(() => '');
  t_('envio com falha: mensagem amigável e formulário preservado', toast.includes('temporariamente indisponível') && await p.$eval('#s24-c-mensagem', e => e.value) === 'Teste de queda', toast);
  await tipo(p, '#s24-wa', '31966665555'); // o fiel tenta de novo depois
  OP.falha = null; await clk(p, '#s24Enviar'); await esperar(900);
  t_('quando volta, o mesmo formulário envia', /^SA-/.test(await p.$eval('.s24-proto', e => e.textContent).catch(() => '')));
  // exceção dentro do módulo (dado inesperado) não sobe para o app
  await clk(p, '#tabs [data-tab="igreja"]'); await esperar(250); await clk(p, '[data-s24-abrir]'); await esperar(300);
  await p.evaluate(() => { window.__sec = S.cfg.secretaria; S.cfg.secretaria = {toString(){ throw new Error('dado inesperado'); }}; render(); }); await esperar(300); t = await texto(p);
  await p.evaluate(() => { S.cfg.secretaria = window.__sec; });
  t_('exceção interna do módulo: mensagem amigável', t.includes('temporariamente indisponível'));
  await p.evaluate(() => document.querySelector('#tabs [data-tab="agenda"]').click()); await esperar(300);
  t_('exceção interna do módulo: Agenda segue', (await texto(p)).includes('Agenda da paróquia'));
  t_('exceção interna do módulo: nenhum erro de JS escapou', !p.erros.length, p.erros.join(' | '));
}
for (const modulo of ['404', 'quebrado']){
  console.log(`== falha: secretaria24h.js ${modulo === '404' ? 'não carregou (404)' : 'carregou com erro'}`);
  SRV.modulo = modulo;
  const p = await aparelho(); await clk(p, '#mPublico').catch(() => {}); await esperar(300);
  t_(`${modulo}: window.S24 ausente, Home sem card`, await p.evaluate(() => !window.S24) && !(await p.$('.s24-card')));
  await passeio(p, modulo);
  await p.evaluate(() => { S.pubTab = 'secretaria'; render(); }); await esperar(300);
  t_(`${modulo}: tela da Secretaria cai na Home`, (await texto(p)).includes('Hoje na Igreja'));
  const s = await painelPasseio(modulo);
  t_(`${modulo}: sem item em Mais`, !(await s.evaluate(() => maisItens().some(([k]) => k === 'secretaria24h'))));
  const errs = [...p.erros, ...s.erros].filter(e => !e.includes('módulo quebrado de propósito'));
  t_(`${modulo}: nenhum outro erro de JS`, !errs.length, errs.join(' | '));
}
SRV.modulo = 'ok';

// ---------------------------------------------------------------- f.data.onchange no navegador real
console.log('== formulário de intenção (f.data.onchange) no Chrome real');
{ const p = await aparelho(); await clk(p, '#mPublico').catch(() => {}); await esperar(300);
  await clk(p, '#tabs [data-tab="agenda"]'); await esperar(300);
  const d = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await p.$eval('#i-data', (i, v) => { i.value = v; i.dispatchEvent(new Event('change')); }, d); await esperar(300);
  t_('Chrome: trocar a data da intenção funciona, sem erro', await p.$eval('#i-data', i => i.value) === d && !p.erros.length, p.erros.join(' | '));
}

console.log(`\nerros de JS no total: ${errosGlobais.filter(e => !e.includes('módulo quebrado de propósito')).length}`);
console.log(`\n${ok} ok, ${falha} falha(s)`);
await browser.close(); process.exit(falha ? 1 : 0);
