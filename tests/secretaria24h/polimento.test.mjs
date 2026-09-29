// Última rodada de polimento público (pré-piloto), no Chrome real:
//   - diretório: "Encontre sua paróquia ou santuário", filtros, cartões com chips, santuários (São Paulo da Cruz etc.);
//   - responsividade por largura (390, 768, 1024, 1366, 1920) nas 12 telas públicas, com screenshots;
//   - faixa "Acesso rápido" nas subpáginas; Sala das Velas nova; Doações (Pix + cartão externo) e permissões;
//   - screenshots ANTES (index.html do commit inicial da rodada) e DEPOIS da Sala das Velas e do Diretório.
// Sem internet e sem Supabase real: backend simulado. Valores de doação de TESTE (domínio .invalid), só aqui.
import { fileURLToPath } from 'node:url';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {criarBackend, CLIENTE} from './supabase-falso.mjs';
import {criarBanco, ponte} from './banco.mjs';
import {esperar} from './ui.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const ANTES = process.env.ANTES || 'e0f0096'; // HEAD no início da rodada
const SHOTS = fileURLToPath(new URL('./shots/polimento', import.meta.url)); fs.mkdirSync(SHOTS, {recursive:true});
const CLI = CLIENTE.replace('gte(){ return b; },', 'gte(){ return b; }, order(){ return b; }, limit(){ return b; },');
const TIPOS = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json'};
const PORTA = 8804;
const indexAntes = execSync(`git show ${ANTES}:index.html`, {cwd:REPO});
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const js = (d, st = 200) => { res.writeHead(st, {'content-type':'application/json', 'access-control-allow-origin':'*'}); res.end(JSON.stringify(d)); };
  if (u.pathname === '/config.js'){ res.writeHead(200, {'content-type':TIPOS['.js']}); return res.end(`window.CENTRAL_CONFIG = {supabase:{url:"https://fake.supabase.co", anonKey:"x"}, parishSlug:"santo-antonio-jaragua", noticiasOficial:"/teste/oficial.json", noticiasEspelho:"", contato:{email:"suporte.thunderdynamics@gmail.com", whatsapp:"5531997509221"}};`); }
  if (u.pathname === '/api/noticias' || u.pathname === '/api/liturgia'){ res.writeHead(404); return res.end(); }
  if (u.pathname === '/teste/oficial.json') return js([{Link:'https://arquidiocesebh.org.br/noticias/a/', Resumo:'Notícia de teste da Arquidiocese', DataRegistro:new Date().toISOString().slice(0, 19), class_list:[], Imagem:''}]);
  if (u.pathname === '/antes.html'){ res.writeHead(200, {'content-type':TIPOS['.html']}); return res.end(indexAntes); }
  const f = path.join(REPO, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.resolve(REPO)) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'content-type':TIPOS[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(PORTA);

// ---------- dados ----------
const banco = await criarBanco();
const {B, op: opFake} = criarBackend({});
const agora = new Date().toISOString(), emHoras = h => new Date(Date.now() + h * 3600e3).toISOString();
const hojeAs = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const VELAS = n => Array.from({length:n}, (_, i) => ({id:i + 1, ts:Date.now() - i * 60e3, para:'alguem', por:'Nome Privado ' + i, pedido:'Pedido privado ' + i, nome:'Fiel ' + i, rezar:true}));
B.estado.data = {cfg:{nome:'Paróquia Santo Antônio – Jaraguá', padroeiro:'Santo Antônio', missas:'Sábado: 18h00\nDomingo: 07h30, 09h30 e 18h00', endereco:'Praça Santo Antônio, 2 – Jaraguá', telefone:'(31) 3427-2866', forania:'Santo Antônio (Pampulha)', regiao:'Região Episcopal Nossa Senhora da Conceição – RENSC', secretaria:'Segunda a sexta, 8h às 12h', tom:'acolhedor', emoji:true, assinatura:'Deus abençoe!', youtube:'', rec:{}, pix:'', whats:'', email:''},
  modelos:{aniversario:'a {nome}', bodas:'b {nome}', dizimista:'d {nome}'}, pessoas:[], avisos:[{id:1, ts:Date.now() - 864e5, titulo:'Aviso de Santo Antônio', texto:'Só de Santo Antônio.', evento:null}], intencoes:[],
  velas:VELAS(12), log:[], enviadosHoje:{dia:'', ids:[]}};
const EV = (id, title, ini, extra = {}) => ({id, parish_id:'p-1', community_id:null, scope:'parish', title, description:'', starts_at:ini, ends_at:null, location:'Salão Paroquial', public:true, highlight_home:false, image_url:null, created_by:'u-sec', google_event_id:null, cancelled:false, created_at:agora, updated_at:agora, ...extra});
B.t.events.push(EV('e-hoje', 'Almoço Beneficente', hojeAs(23, 30)), EV('e-prox', 'Missa de São Francisco na comunidade', emHoras(72), {location:'Matriz'}),
  EV('e-cat', 'Encontro de catequistas', emHoras(48)), EV('e-coral', 'Ensaio do coral', emHoras(100)), EV('e-apar', 'Terço de Nossa Senhora Aparecida', emHoras(24 * 10)));
const op = ponte(opFake, banco, {});

const browser = await puppeteer.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
let ok = 0, falha = 0; const t_ = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 500)); };
const errosGlobais = [];
async function aparelho({url = '/?p=santo-antonio-jaragua', largura = 390, altura = 844, movimento = false} = {}){
  const c = await browser.createBrowserContext(); const page = await c.newPage();
  await page.setViewport({width:largura, height:altura, deviceScaleFactor:1});
  if (movimento) await page.emulateMediaFeatures([{name:'prefers-reduced-motion', value:'no-preference'}]);
  await page.exposeFunction('__sb', q => op(q)); await page.evaluateOnNewDocument(CLI);
  await page.evaluateOnNewDocument(() => { window.__abertos = []; window.open = (u) => { window.__abertos.push(String(u)); return null; }; });
  page.erros = [];
  page.on('pageerror', e => { page.erros.push(e.message); errosGlobais.push(e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource|ERR_|net::/.test(m.text())) { page.erros.push(m.text()); errosGlobais.push(m.text()); } });
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORTA}${url}`, {waitUntil:'networkidle0', timeout:60000}); await esperar(500);
  return page;
}
const clk = (p, sel) => p.$eval(sel, e => { e.scrollIntoView({block:'center'}); e.click(); });
const texto = p => p.evaluate(() => document.getElementById('view').innerText);
const semRolagemLateral = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const foto = async (p, nome, inteira = true) => { await esperar(300); await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({path:path.join(SHOTS, nome + '.png'), fullPage:inteira}); };
const publico = async p => { await p.evaluate(() => { if (S.mode !== 'publico') document.getElementById('mPublico').click(); }); await esperar(500); };
const ir = async (p, tela, extra = '') => { await p.evaluate((tela, extra) => { if (extra === 'devocao') S.devVendo = 'sao-miguel'; if (tela === 'velas') velaStep = 'inicio'; S.pubTab = tela; render(); scrollTo(0, 0); }, tela, extra); await esperar(500); };
const colunas = (p, sel) => p.$eval(sel, e => getComputedStyle(e).gridTemplateColumns.split(' ').filter(x => x && x !== 'none').length).catch(() => 0);
const buscar = async (p, q) => { await p.$eval('#buscaPar', e => { e.value = ''; }); await p.type('#buscaPar', q); await esperar(900); };
const cartoes = p => p.$$eval('#dirRes .dir-card', l => l.map(c => ({titulo:c.querySelector('.dir-nome').textContent.trim(), local:c.querySelector('.dir-local')?.textContent.trim() || '', chips:[...c.querySelectorAll('.chip')].map(x => x.textContent.trim()), acao:c.querySelector('.dir-acao').textContent.trim()})));
const TESTE_PIX = {pix_enabled:true, pix_key:'doacoes@paroquia-teste.invalid', pix_key_type:'email', pix_beneficiary:'PAROQUIA TESTE', pix_city:'BELO HORIZONTE'};
const TESTE_CARTAO = {card_enabled:true, payment_provider:'Provedor de teste', checkout_url:'https://checkout.exemplo.invalid/doar'};

// ================= diretório =================
console.log('== diretório: paróquias e santuários');
{ const p = await aparelho(); await publico(p);
  await clk(p, '#hdrName'); await esperar(1200);
  let t = await texto(p);
  t_('título e subtítulo novos', t.includes('Encontre sua paróquia ou santuário') && t.includes('Pesquise por nome, bairro, cidade ou forania.'));
  t_('filtros Todos / Paróquias / Santuários (Todos marcado)', JSON.stringify(await p.$$eval('[data-dirt]', l => l.map(b => [b.textContent, b.getAttribute('aria-pressed')]))) === JSON.stringify([['Todos','true'],['Paróquias','false'],['Santuários','false']]));
  await buscar(p, 'sao paulo da cruz'); let c = await cartoes(p);
  t_('"sao paulo da cruz": UM cartão, o do santuário', c.length >= 1 && c[0].titulo === 'Santuário Arquidiocesano São Paulo da Cruz' && c.filter(x => /Paulo da Cruz/.test(x.titulo)).length === 1, JSON.stringify(c.slice(0, 3)));
  t_('São Paulo da Cruz: "Barreiro de Baixo · Belo Horizonte"', c[0]?.local === 'Barreiro de Baixo · Belo Horizonte', c[0]?.local);
  t_('São Paulo da Cruz: chips [Paróquia] [Santuário Arquidiocesano] + não ativada', ['Paróquia', 'Santuário Arquidiocesano', 'Central Paroquial ainda não ativada'].every(x => c[0]?.chips.includes(x)), c[0]?.chips);
  t_('São Paulo da Cruz: [Solicitar ativação]', c[0]?.acao === 'Solicitar ativação');
  await foto(p, 'diretorio-sao-paulo-da-cruz-390');
  await buscar(p, 'São Paulo da Cruz'); c = await cartoes(p); t_('com acento e maiúsculas: o mesmo resultado', c[0]?.titulo === 'Santuário Arquidiocesano São Paulo da Cruz');
  for (const [q, achar] of [['sto antonio jaragua', x => /Santo Antônio/.test(x.titulo) && /Jaraguá/.test(x.local) && x.acao === 'Escolher esta paróquia'],
    ['N. S. das Graças Ibirité', x => /Nossa Senhora das Graças/.test(x.titulo) && x.acao === 'Escolher esta paróquia'], ['santa clara', x => /Santa Clara e São Francisco/.test(x.titulo) && x.acao === 'Escolher esta paróquia'],
    ['são judas tadeu graça', x => x.titulo === 'Santuário Arquidiocesano São Judas Tadeu' && x.chips.includes('Paróquia')], ['piedade', x => /Piedade/.test(x.titulo) && x.chips.includes('Santuário Estadual')],
    ['schoenstatt', x => /Schoenstatt/.test(x.titulo) && !x.chips.includes('Paróquia') && x.chips.includes('Santuário')], ['saúde e paz', x => /Saúde e da Paz/.test(x.titulo) && !x.chips.includes('Paróquia')],
    ['lagoinha', x => /Conceição dos Pobres/.test(x.titulo) && x.chips.includes('Santuário Arquidiocesano')]]){
    await buscar(p, q); c = await cartoes(p); t_(`busca "${q}"`, c.some(achar), JSON.stringify(c.slice(0, 4).map(x => [x.titulo, x.local, x.chips.join('/')])));
  }
  await buscar(p, 'sao judas tadeu'); c = await cartoes(p);
  t_('"são judas tadeu": várias, e o da Graça aparece UMA vez (paróquia e santuário juntos)', c.length >= 5 && c.filter(x => x.local.startsWith('Graça')).length === 1, JSON.stringify(c.map(x => x.titulo + '/' + x.local)));
  await p.$eval('#buscaPar', e => { e.value = ''; e.dispatchEvent(new Event('input')); }); await esperar(500);
  await clk(p, '[data-dirt="santuario"]'); await esperar(1000); c = await cartoes(p);
  t_('filtro Santuários (sem texto): os 15 santuários do catálogo', c.length === 15 && c.every(x => x.chips.some(ch => /Santuário/.test(ch))), c.length);
  t_('filtro Santuários: título "Santuários do Catálogo 2026"', (await texto(p)).includes('Santuários do Catálogo 2026'));
  await foto(p, 'diretorio-santuarios-390');
  await buscar(p, 'francisco'); c = await cartoes(p);
  t_('Santuários + "francisco": só santuários (Igrejinha da Pampulha)', c.length >= 1 && c.every(x => x.chips.some(ch => /Santuário/.test(ch))) && c.some(x => /São Francisco de Assis/.test(x.titulo)), JSON.stringify(c.map(x => x.titulo)));
  await clk(p, '[data-dirt="paroquia"]'); await esperar(1000); c = await cartoes(p);
  t_('Paróquias + "francisco": o santuário independente da Pampulha não aparece; paróquias sim', c.length >= 3 && c.every(x => x.chips.some(ch => /Paróquia|Curato|Área/.test(ch))), JSON.stringify(c.map(x => x.titulo)));
  await clk(p, '[data-dirt="todos"]'); await esperar(300);
  await buscar(p, 'sao paulo da cruz');
  await p.evaluate(() => document.querySelector('#dirRes [data-dir-abrir]').click()); await esperar(900); t = await texto(p);
  t_('ficha de São Paulo da Cruz: nome do santuário, chips e a fonte (Catálogo 2026)', t.includes('Santuário Arquidiocesano São Paulo da Cruz') && t.includes('Santuário Arquidiocesano') && t.includes('Paróquia') && t.includes('Dados institucionais de referência: Catálogo 2026 — Arquidiocese de Belo Horizonte.'));
  t_('ficha: CTA de ativação com o contato da Central', t.includes('Você representa esta paróquia ou santuário?') && !!(await p.$('#ativacao [data-cp="whatsapp"]')));
  const hc = await p.evaluate(() => document.querySelector('header.top').innerText);
  t_('cabeçalho: "Santuário Arquidiocesano São Paulo da Cruz – Barreiro de Baixo"', hc.includes('Santuário Arquidiocesano São Paulo da Cruz – Barreiro de Baixo'), hc);
  await foto(p, 'ficha-sao-paulo-da-cruz-390');
  t_('nenhuma ativação automática', !B.log.some(x => /directory|parishes/.test(x) && !x.startsWith('rpc:public_directory')));
  t_('diretório: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= responsividade: 12 telas × 5 larguras =================
console.log('== responsividade');
const LARG = {igreja:[1100, 1180], agenda:[1100, 1240], escolher:[1100, 1240], velas:[1100, 1240], devocao:[600, 760], liturgia:[600, 760], rezar:[600, 760], intencao:[700, 880], secretaria:[700, 880], contato:[700, 880], doacoes:[900, 1000]};
const TELAS = [['home', 'igreja'], ['velas', 'velas'], ['diretorio', 'escolher'], ['busca', 'escolher', 'busca'], ['agenda', 'agenda'], ['devocional', 'devocao', 'devocao'],
  ['liturgia', 'liturgia'], ['oracoes', 'rezar'], ['intencao', 'intencao'], ['s24', 'secretaria'], ['doacoes', 'doacoes'], ['paroquia', 'contato']];
const FOTOS = {390:['home', 'velas', 'diretorio', 'doacoes'], 768:['home', 'velas', 'diretorio'], 1024:['diretorio', 'agenda', 'velas'], 1366:['home', 'velas', 'diretorio', 'agenda', 'doacoes'], 1920:['home', 'velas', 'diretorio']};
B.doacoes['p-1'] = {parish_id:'p-1', ...TESTE_PIX, ...TESTE_CARTAO};
for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1366, 768], [1920, 1080]]){
  const p = await aparelho({largura:w, altura:h}); await publico(p);
  const falhas = [];
  for (const [nome, tela, extra] of TELAS){
    if (tela === 'secretaria'){ await ir(p, 'igreja'); await clk(p, '.acoes-grid [data-s24-abrir]'); await esperar(700); }
    else await ir(p, tela, extra);
    if (extra === 'busca') await buscar(p, 'nossa senhora');
    if (!(await semRolagemLateral(p))) falhas.push(nome + ': rolagem lateral');
    const larg = await p.$eval('#view', e => e.getBoundingClientRect().width), [min, max] = LARG[tela] || [0, 9999];
    if (w >= 768 && larg > max + 49) falhas.push(`${nome}: largura ${larg} > ${max}`);
    if (w >= 1366 && larg < min) falhas.push(`${nome}: largura ${larg} < ${min} (esticou pouco)`);
    if (w === 390 && larg > 390) falhas.push(`${nome}: mais largo que a tela`);
    if (FOTOS[w].includes(nome)) await foto(p, `${nome}-${w}`, true);
  }
  t_(`${w}: 12 telas sem rolagem lateral e na largura certa`, !falhas.length, falhas.join(' | '));
  // navegação: embaixo no celular; no topo a partir do tablet
  const nav = await p.$eval('#tabs', e => { const r = e.getBoundingClientRect(); return {top:r.top, bottom:r.bottom, pos:getComputedStyle(e).position}; });
  t_(`${w}: barra de seções ${w >= 768 ? 'no topo' : 'embaixo'}`, w >= 768 ? nav.top < 200 && nav.pos === 'sticky' : nav.bottom >= h - 2 && nav.pos === 'fixed', JSON.stringify(nav));
  await ir(p, 'escolher'); await buscar(p, 'nossa senhora');
  const cd = await colunas(p, '#dirRes .dir-grade');
  t_(`${w}: diretório em ${w < 768 ? 1 : w < 1200 ? 2 : 3} coluna(s) de cartões`, cd === (w < 768 ? 1 : w < 1200 ? 2 : 3), cd);
  await ir(p, 'igreja');
  const home = await p.evaluate(() => { const a = document.querySelector('.home-princ').getBoundingClientRect(), b = document.querySelector('.home-lat').getBoundingClientRect(); return {lado:Math.abs(a.top - b.top) < 4 && b.left > a.right - 1, acoes:getComputedStyle(document.querySelector('.acoes-grid')).gridTemplateColumns.split(' ').filter(x => x !== '0px').length}; });
  t_(`${w}: Home ${w >= 1024 ? 'em duas colunas (notícias ao lado)' : 'em uma coluna, na ordem do celular'}`, w >= 1024 ? home.lado : !home.lado, JSON.stringify(home));
  if (w >= 1200) t_(`${w}: as 5 ações lado a lado`, home.acoes === 5, home.acoes);
  await ir(p, 'agenda');
  const ag = await colunas(p, '.ag-grade');
  t_(`${w}: Agenda ${w < 768 ? 'em uma coluna' : 'em grade de dias (' + ag + ' colunas)'}`, w < 768 ? ag <= 1 : ag >= 2, ag);
  t_(`${w}: sem erros de JS`, !p.erros.length, p.erros.join(' | '));
}

// ================= acesso rápido =================
console.log('== acesso rápido');
{ const p = await aparelho(); await publico(p);
  t_('Home: sem a faixa (a Home já tem as ações)', !(await p.$('.acesso-rapido')));
  for (const tela of ['liturgia', 'rezar', 'intencao', 'velas', 'devocao', 'doacoes']){
    await ir(p, tela, tela === 'devocao' ? 'devocao' : '');
    const f = await p.$$eval('.acesso-rapido button', l => l.map(b => [b.textContent, b.getAttribute('aria-current')]));
    t_(`${tela}: faixa com Liturgia, Rezar, Intenção, Vela, Secretaria 24h`, JSON.stringify(f.map(x => x[0])) === JSON.stringify(['Liturgia', 'Rezar', 'Intenção', 'Vela', 'Secretaria 24h']), JSON.stringify(f));
  }
  await ir(p, 'liturgia'); await clk(p, '.acesso-rapido [data-acao="velas"]'); await esperar(400);
  t_('clicar "Vela" abre a Sala das Velas, com "Vela" marcado', await p.evaluate(() => S.pubTab === 'velas' && document.querySelector('.acesso-rapido [aria-current="page"]')?.textContent === 'Vela'));
  await clk(p, '.acesso-rapido [data-s24-abrir]'); await esperar(600);
  t_('clicar "Secretaria 24h" abre a Secretaria', (await texto(p)).includes('Como podemos ajudar?'));
  t_('faixa rola sozinha no celular (a página não rola para o lado)', await semRolagemLateral(p));
  await ir(p, 'liturgia'); await foto(p, 'acesso-rapido-liturgia-390', false);
  const d = await aparelho({largura:1366, altura:768}); await publico(d); await ir(d, 'velas'); await foto(d, 'acesso-rapido-velas-1366', false);
  t_('acesso rápido: sem erros de JS', ![...p.erros, ...d.erros].length, [...p.erros, ...d.erros].join(' | '));
}

// ================= Sala das Velas =================
console.log('== Sala das Velas');
{ const medir = async (n, w = 390) => { B.estado.data.velas = VELAS(n); const p = await aparelho({largura:w, altura:w === 390 ? 844 : 768, movimento:true}); await publico(p); await ir(p, 'velas');
    const r = await p.evaluate(() => ({vela:document.querySelector('.sala-velas .mv').getBoundingClientRect().width, desenhadas:document.querySelectorAll('.sala-velas .mv').length,
      prateleiras:document.querySelectorAll('.sala-velas .prateleira').length, brilho:getComputedStyle(document.querySelector('.sala')).getPropertyValue('--brilho').trim(), txt:document.getElementById('view').innerText,
      anim:getComputedStyle(document.querySelector('.mv i')).animationName})); return {p, ...r}; };
  const tres = await medir(3), cinquenta = await medir(50), muitas = await medir(187);
  for (const s of ['Sala das Velas', 'Uma comunidade unida em oração.', '3 velas acesas nas últimas 24 horas.', 'Acender minha vela', 'Seu pedido permanece privado. A equipe da paróquia acolhe as intenções apresentadas.', 'Senhor, acolhei as intenções de todos que rezam conosco.'])
    t_(`texto: "${s}"`, tres.txt.includes(s));
  t_('poucas velas = velas maiores', tres.vela > cinquenta.vela * 1.6, `${tres.vela} × ${cinquenta.vela}`);
  t_('50 velas em prateleiras de 10', cinquenta.desenhadas === 50 && cinquenta.prateleiras === 5);
  t_('187: 50 desenhadas + "+137 pessoas rezando conosco"', muitas.desenhadas === 50 && muitas.txt.includes('+137 pessoas rezando conosco'));
  t_('brilho do ambiente cresce com o número real', +tres.brilho < +cinquenta.brilho, `${tres.brilho} × ${cinquenta.brilho}`);
  t_('nenhum nome nem pedido aparece', !/Nome Privado|Pedido privado|Fiel \d/.test(muitas.txt));
  t_('chama anima com movimento liberado', tres.anim === 'tremula');
  await foto(tres.p, 'velas-3-390'); await foto(muitas.p, 'velas-187-390');
  const r = await aparelho(); await publico(r); await ir(r, 'velas');
  t_('prefers-reduced-motion: chama parada', await r.evaluate(() => getComputedStyle(document.querySelector('.mv i')).animationName) === 'none');
  const tempo = await muitas.p.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 10; i++) render(); return (performance.now() - t0) / 10; });
  t_(`desenhar a Sala com 50 velas: ${tempo.toFixed(1)} ms`, tempo < 50);
  const zero = await aparelho({url:'/?p=santa-clara-e-sao-francisco-mineirao'}); await publico(zero); await ir(zero, 'velas');
  t_('0 velas: uma vela apagada e "Seja o primeiro…" (sem número inventado)', await zero.evaluate(() => document.querySelectorAll('.sala-velas .mv.apagada').length === 1 && document.getElementById('view').innerText.includes('Seja o primeiro a acender uma vela hoje.')));
  const g = await medir(12, 1920); await foto(g.p, 'velas-12-1920');
  t_('velas: sem erros de JS', ![tres, cinquenta, muitas].some(x => x.p.erros.length) && !r.erros.length && !zero.erros.length);
  B.estado.data.velas = VELAS(12);
}

// ================= antes × depois =================
console.log('== antes × depois (Sala das Velas e Diretório)');
for (const [versao, url] of [['antes', '/antes.html'], ['depois', '/']]){
  for (const w of [390, 1366]){
    const p = await aparelho({url, largura:w, altura:w === 390 ? 844 : 768}); await publico(p);
    await p.evaluate(() => { velaStep = 'inicio'; S.pubTab = 'velas'; render(); }); await esperar(400); await foto(p, `${versao}-velas-${w}`);
    await p.evaluate(() => { S.pubTab = 'escolher'; render(); }); await esperar(900);
    await p.type('#buscaPar', 'sao paulo da cruz'); await esperar(900); await foto(p, `${versao}-diretorio-${w}`);
    if (versao === 'antes' && w === 390) t_('ANTES: São Paulo da Cruz sem o nome do santuário', !(await texto(p)).includes('Santuário Arquidiocesano São Paulo da Cruz'));
  }
}

// ================= doações =================
console.log('== doações');
{ B.doacoes = {};
  let p = await aparelho(); await publico(p); await clk(p, '#tabs [data-tab="contato"]'); await esperar(900);
  t_('sem configuração: botão de doação aparece junto do dizimista', !!(await p.$('.cta-doa')) && (await texto(p)).includes('Quero ser dizimista'));
  await ir(p, 'doacoes'); {
    const sem = await texto(p);
    t_('sem configuração: página orienta falar com a secretaria, sem Pix/cartão fictício', sem.includes('ainda não cadastrou seus meios de doação') && sem.includes('Falar com a secretaria') && !sem.includes(TESTE_PIX.pix_key) && !sem.includes('Doar com cartão'), sem);
  }
  B.doacoes['p-1'] = {parish_id:'p-1', ...TESTE_PIX, ...TESTE_CARTAO};
  p = await aparelho(); await publico(p); await clk(p, '#tabs [data-tab="contato"]'); await esperar(900);
  const pos = await p.evaluate(() => { const d = document.querySelector('.cta-diz'), b = document.querySelector('.cta-doa'); return b && d ? {abaixo:b.getBoundingClientRect().top >= d.getBoundingClientRect().bottom, txt:b.textContent} : null; });
  t_('configurado: "💝 Quero fazer uma doação" logo abaixo de "Quero ser dizimista"', pos?.abaixo && pos.txt === '💝 Quero fazer uma doação', JSON.stringify(pos));
  await clk(p, '.cta-doa'); await esperar(1500); let t = await texto(p);
  t_('página de Doações: Pix com chave, beneficiário e cidade', t.includes('Pix') && t.includes(TESTE_PIX.pix_key) && t.includes('PAROQUIA TESTE') && t.includes('BELO HORIZONTE'));
  t_('[Copiar chave] e [Copiar código Pix (copia e cola)]', !!(await p.$('#copiaChave')) && !!(await p.$('#copiaPix')));
  const cc = await p.evaluate(() => pixCopiaECola(DOA.dados.pix));
  t_('código Pix no padrão BR Code (payload + CRC16)', /^00020126\d{2}0014br\.gov\.bcb\.pix01\d{2}doacoes@paroquia-teste\.invalid5204000053039865802BR59\d{2}PAROQUIA TESTE60\d{2}BELO HORIZONTE62070503\*\*\*6304[0-9A-F]{4}$/.test(cc) && cc.slice(-4) === await p.evaluate(s => crc16Pix(s), cc.slice(0, -4)), cc);
  t_('CRC16 confere com o exemplo do padrão ("123456789" → 29B1)', await p.evaluate(() => crc16Pix('123456789')) === '29B1');
  await p.waitForFunction(() => document.querySelector('#pixQR svg') || /copia e cola/.test(document.getElementById('pixQR')?.innerText || ''), {timeout:15000}).catch(() => {});
  const qr = await p.$eval('#pixQR', e => ({svg:!!e.querySelector('svg'), txt:e.innerText}));
  t_('QR Code desenhado (ou, sem internet, aviso para usar o copia e cola)', qr.svg || qr.txt.includes('Use o código Pix copia e cola'), JSON.stringify(qr));
  const cart = await p.$eval('#doarCartao', a => ({href:a.href, target:a.target, rel:a.rel, txt:a.textContent}));
  t_('[Doar com cartão] abre o checkout EXTERNO em outra aba', cart.href === TESTE_CARTAO.checkout_url && cart.target === '_blank' && /noopener/.test(cart.rel) && /noreferrer/.test(cart.rel) && cart.txt === 'Doar com cartão', JSON.stringify(cart));
  t_('nenhum campo de cartão na página (a plataforma não processa cartão)', !(await p.$('#view input')));
  t_('aviso: a plataforma não intermedeia', t.includes('não recebe nem intermedeia'));
  const lado = async q => q.$$eval('.doa-card', l => { const [a, b] = l.map(x => x.getBoundingClientRect()); return Math.abs(a.top - b.top) < 2 && b.left > a.right; });
  t_('390: Pix e cartão empilhados', !(await lado(p)));
  await foto(p, 'doacoes-pix-cartao-390');
  const d = await aparelho({largura:1366, altura:768}); await publico(d); await ir(d, 'doacoes'); await esperar(1200);
  t_('1366: Pix e cartão lado a lado', await lado(d));
  await foto(d, 'doacoes-pix-cartao-1366');
  B.doacoes['p-1'] = {parish_id:'p-1', ...TESTE_PIX, card_enabled:false};
  p = await aparelho(); await publico(p); await ir(p, 'doacoes'); await esperar(1000);
  t_('só Pix: um cartão só, sem botão de cartão', (await p.$$('.doa-card')).length === 1 && !(await p.$('#doarCartao')));
  B.doacoes['p-1'] = {parish_id:'p-1', pix_enabled:false, ...TESTE_CARTAO};
  p = await aparelho(); await publico(p); await ir(p, 'doacoes'); await esperar(1000);
  t_('só cartão: sem Pix', (await p.$$('.doa-card')).length === 1 && !(await p.$('#pixQR')) && !!(await p.$('#doarCartao')));
  B.doacoes['p-1'] = {parish_id:'p-1', ...TESTE_PIX, ...TESTE_CARTAO};
  const sc = await aparelho({url:'/?p=santa-clara-e-sao-francisco-mineirao'}); await publico(sc); await clk(sc, '#tabs [data-tab="contato"]'); await esperar(900);
  t_('isolamento: Santa Clara abre doações sem herdar a configuração de Santo Antônio', !!(await sc.$('.cta-doa')) && !(await texto(sc)).includes(TESTE_PIX.pix_key));
  const ng = await aparelho({url:'/?p=nossa-senhora-das-gracas-ibirite'}); await publico(ng); await ir(ng, 'doacoes'); await esperar(900);
  t_('isolamento: N. Sra. das Graças sem doações configuradas', (await texto(ng)).includes('ainda não cadastrou seus meios de doação') && !(await texto(ng)).includes(TESTE_PIX.pix_key));
  t_('doações públicas: sem erros de JS', ![...p.erros, ...d.erros, ...sc.erros, ...ng.erros].length, [...p.erros, ...d.erros].join(' | '));
}

// ================= doações: quem configura =================
console.log('== doações: permissões no painel');
{ B.doacoes = {};
  const entrar = async (email) => { const s = await aparelho({url:'/#painel', largura:1366, altura:768}); await s.type('#l-em', email); await s.type('#l-pw', '123456'); await clk(s, '#l-btn'); await esperar(1200);
    await s.evaluate(() => { S.tab = 'ajustes'; render(); }); await esperar(900); return s; };
  for (const email of ['secretaria@teste', 'pascom@teste']){
    const s = await entrar(email);
    t_(`${email.split('@')[0]}: NÃO vê a configuração de doações`, !(await s.$('#doaF')) && !(await texto(s)).includes('Salvar doações'));
  }
  const s = await entrar('padre@teste');
  t_('padre: vê Ajustes › Doações (tudo desligado)', !!(await s.$('#doaF')) && await s.$eval('#doaF', f => !f.pix_enabled.checked && !f.card_enabled.checked));
  const nomes = await s.$$eval('#doaF input, #doaF select', l => l.map(e => e.name));
  t_('formulário só com dados públicos de recebimento (nada de cartão, CVV, senha, token, segredo)', JSON.stringify(nomes) === JSON.stringify(['pix_enabled', 'pix_key_type', 'pix_key', 'pix_beneficiary', 'pix_city', 'card_enabled', 'payment_provider', 'checkout_url']), nomes);
  await s.$eval('#doaF', f => { f.pix_enabled.checked = true; f.pix_key.value = 'teste'; }); await clk(s, '#doaF button'); await esperar(500);
  t_('Pix ligado sem os dados: não salva', !B.doacoes['p-1']);
  await s.$eval('#doaF', f => { f.card_enabled.checked = true; f.pix_enabled.checked = false; f.checkout_url.value = 'https://checkout.exemplo.invalid/?access_token=abc'; }); await clk(s, '#doaF button'); await esperar(500);
  t_('link com token: não salva', !B.doacoes['p-1']);
  await s.$eval('#doaF', (f, P) => { f.pix_enabled.checked = true; f.pix_key_type.value = P.pix_key_type; f.pix_key.value = P.pix_key; f.pix_beneficiary.value = P.pix_beneficiary; f.pix_city.value = P.pix_city; f.card_enabled.checked = false; f.checkout_url.value = ''; }, TESTE_PIX);
  await clk(s, '#doaF button'); await esperar(700);
  t_('padre salva o Pix da própria paróquia', B.doacoes['p-1']?.pix_enabled === true && B.doacoes['p-1'].pix_key === TESTE_PIX.pix_key && !B.doacoes['p-2'] && !B.doacoes['p-3']);
  await foto(s, 'ajustes-doacoes-padre-1366', true);
  const r = await op({kind:'rpc', fn:'staff_save_donation_settings', uid:'u-sec', args:{p_parish:'p-1', p_dados:TESTE_PIX}});
  t_('secretaria direto na função: recusado', r.error?.code === '42501');
  const r2 = await op({kind:'rpc', fn:'staff_save_donation_settings', uid:'u-padre', args:{p_parish:'p-1', p_dados:{...TESTE_PIX, cvv:'123'}}});
  t_('campo secreto direto na função: recusado', /Campo não permitido/.test(r2.error?.message || ''));
  t_('permissões: sem erros de JS', !s.erros.length, s.erros.join(' | '));
  B.doacoes = {};
}

// ================= acessibilidade =================
console.log('== acessibilidade');
{ B.doacoes['p-1'] = {parish_id:'p-1', ...TESTE_PIX, ...TESTE_CARTAO};
  const a11y = p => p.evaluate(() => {
    const vis = e => !!(e.offsetWidth || e.offsetHeight);
    const semNome = [...document.querySelectorAll('#view button, #view a, #tabs button, header button')].filter(e => vis(e) && !(e.getAttribute('aria-label') || e.textContent.trim()));
    const semRotulo = [...document.querySelectorAll('#view input:not([type=hidden]):not([type=radio]):not([type=checkbox]), #view select, #view textarea')].filter(e => vis(e) && !(e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`))));
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    return {semNome:semNome.length, semRotulo:semRotulo.map(e => e.id || e.name), dup, titulos:document.querySelectorAll('#view h2, #view h3').length};
  });
  const p = await aparelho({largura:1366, altura:768}); await publico(p);
  for (const [nome, tela, extra] of TELAS.filter(x => x[1] !== 'secretaria')){
    await ir(p, tela, extra); if (extra === 'busca') await buscar(p, 'santuario');
    const r = await a11y(p);
    t_(`${nome}: botões/links com nome, campos com rótulo, IDs únicos, com títulos`, !r.semNome && !r.semRotulo.length && !r.dup.length && r.titulos > 0, JSON.stringify(r));
  }
  await ir(p, 'escolher');
  t_('filtros do diretório: botões com aria-pressed', await p.$$eval('[data-dirt]', l => l.length === 3 && l.every(b => b.hasAttribute('aria-pressed'))));
  t_('acesso rápido: navegação com rótulo', await p.evaluate(() => { S.pubTab = 'liturgia'; render(); return document.querySelector('nav.acesso-rapido')?.getAttribute('aria-label') === 'Acesso rápido'; }));
  t_('QR Code com descrição para leitor de tela', await p.evaluate(() => { S.pubTab = 'doacoes'; render(); return /QR Code Pix/.test(document.getElementById('pixQR')?.getAttribute('aria-label') || ''); }));
  // tamanho do alvo de toque no celular
  const m = await aparelho(); await publico(m); await ir(m, 'escolher'); await m.type('#buscaPar', 'santuario'); await esperar(900);
  const alvo = await m.$$eval('#view .dir-acao .btn, [data-dirt], .acesso-rapido button', l => Math.min(...l.map(b => b.getBoundingClientRect().height)));
  t_(`celular: botões do diretório com altura ≥ 32px (${alvo.toFixed(0)}px)`, alvo >= 32);
  B.doacoes = {};
}

console.log(`\nerros de JS no total: ${errosGlobais.length}`);
console.log(`\n${ok} ok, ${falha} falha(s)`);
await browser.close(); process.exit(falha ? 1 : 0);
