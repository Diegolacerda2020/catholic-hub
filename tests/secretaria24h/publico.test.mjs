// Rodada pré-piloto: página pública nova e multi-paróquia no Chrome real.
// Home por ações, evento de hoje, destaques litúrgicos (datas fixas), Sala das Velas, Agenda unificada,
// "Adicionar à minha agenda", notícias recentes sem depender do espelho, busca/troca de paróquia,
// ativação não automática e isolamento entre Santo Antônio, Santa Clara e N. Sra. das Graças.
// Sem internet: notícias e Supabase são simulados. Screenshots em shots/publico/.
import { fileURLToPath } from 'node:url';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {criarBackend, CLIENTE} from './supabase-falso.mjs';
import {criarBanco, ponte} from './banco.mjs';
import {esperar} from './ui.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots/publico', import.meta.url)); fs.mkdirSync(SHOTS, {recursive:true});
const CLI = CLIENTE.replace('gte(){ return b; },', 'gte(){ return b; }, order(){ return b; }, limit(){ return b; },');
const TIPOS = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json'};
const PORTA = 8803;
const hojeIso = new Date().toISOString().slice(0, 10);
// Notícias: o Worker só tem o espelho de 3 dias atrás; a API oficial (simulada) tem a notícia de hoje.
const ESPELHO_VELHO = {fonte:'espelho:api', atualizadoEm:new Date(Date.now() - 72 * 3600e3).toISOString(), itens:[{titulo:'Notícia antiga de três dias atrás', data:'2026-09-25', dataTexto:'25/09/2026', rotulo:'Arquidiocese', prioridade:1, resumo:'', imagem:'', url:'https://arquidiocesebh.org.br/noticias/antiga/'}]};
const OFICIAL_HOJE = [{Link:'https://arquidiocesebh.org.br/noticias/publicada-hoje/', Resumo:'Notícia publicada hoje no portal oficial', DataRegistro:hojeIso + 'T11:00:00', class_list:[], Imagem:''},
  {Link:'https://arquidiocesebh.org.br/noticias/antiga/', Resumo:'Notícia antiga de três dias atrás', DataRegistro:'2026-09-25T09:00:00', class_list:[], Imagem:''}];
const SRV = {noticias:'espelho'};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const js = (d, st = 200) => { res.writeHead(st, {'content-type':'application/json', 'access-control-allow-origin':'*'}); res.end(JSON.stringify(d)); };
  if (u.pathname === '/config.js'){ res.writeHead(200, {'content-type':TIPOS['.js']}); return res.end(`window.CENTRAL_CONFIG = {supabase:{url:"https://fake.supabase.co", anonKey:"x"}, parishSlug:"santo-antonio-jaragua", noticiasOficial:"/teste/oficial.json", noticiasEspelho:"", contato:{email:"suporte.thunderdynamics@gmail.com", whatsapp:"5531997509221"}};`); }
  if (u.pathname === '/api/noticias') return SRV.noticias === 'espelho' ? js(ESPELHO_VELHO) : (res.writeHead(404), res.end());
  if (u.pathname === '/api/liturgia'){ res.writeHead(404); return res.end(); }
  if (u.pathname === '/teste/oficial.json') return js(OFICIAL_HOJE);
  const f = path.join(REPO, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.resolve(REPO)) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'content-type':TIPOS[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(PORTA);

// ---------- dados ----------
const banco = await criarBanco();
const {B, op: opFake} = criarBackend({});
const agora = new Date().toISOString(), emHoras = h => new Date(Date.now() + h * 3600e3).toISOString();
const hojeAs = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
B.estado.data = {cfg:{nome:'Paróquia Santo Antônio – Jaraguá', padroeiro:'Santo Antônio', missas:'Sábado: 18h00\nDomingo: 07h30, 09h30 e 18h00', endereco:'Praça Santo Antônio, 2 – Jaraguá', telefone:'(31) 3427-2866', forania:'Santo Antônio (Pampulha)', regiao:'Região Episcopal Nossa Senhora da Conceição – RENSC', secretaria:'Segunda a sexta, 8h às 12h', tom:'acolhedor', emoji:true, assinatura:'Deus abençoe!', youtube:'', rec:{}, pix:'', whats:'', email:''},
  modelos:{aniversario:'a {nome}', bodas:'b {nome}', dizimista:'d {nome}'}, pessoas:[], avisos:[{id:1, ts:Date.now() - 864e5, titulo:'Aviso de Santo Antônio', texto:'Só de Santo Antônio.', evento:null}], intencoes:[],
  velas:Array.from({length:10}, (_, i) => ({id:i + 1, ts:Date.now() - i * 3600e3, para:'alguem', por:'Nome Privado ' + i, pedido:'Pedido privado ' + i, nome:'Fiel ' + i, rezar:true})), log:[], enviadosHoje:{dia:'', ids:[]}};
const EV = (id, title, ini, extra = {}) => ({id, parish_id:'p-1', community_id:null, scope:'parish', title, description:'', starts_at:ini, ends_at:null, location:'Salão Paroquial', public:true, highlight_home:false, image_url:null, created_by:'u-sec', google_event_id:null, cancelled:false, created_at:agora, updated_at:agora, ...extra});
B.t.events.push(EV('e-hoje', 'Almoço Beneficente', hojeAs(23, 30)), EV('e-prox', 'Missa de São Francisco na comunidade', emHoras(72), {location:'Matriz'}), EV('e-apar', 'Terço de Nossa Senhora Aparecida', emHoras(24 * 10)));
const op = ponte(opFake, banco, {});

const browser = await puppeteer.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
let ok = 0, falha = 0; const t_ = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 400)); };
const errosGlobais = [];
// data fixa (para testar destaques): troca só o "agora" do navegador
const RELOGIO = d => `(() => { const D = Date, delta = ${Date.parse(d)} - D.now(); class F extends D { constructor(...a){ super(...(a.length ? a : [D.now() + delta])); } static now(){ return D.now() + delta; } } globalThis.Date = F; })();`;
async function aparelho({url = '/', largura = 390, altura = 844, ua = null, data = null, ctx = null} = {}){
  const c = ctx || await browser.createBrowserContext(); const page = await c.newPage();
  await page.setViewport({width:largura, height:altura, deviceScaleFactor:1});
  if (ua) await page.setUserAgent(ua);
  await page.exposeFunction('__sb', q => op(q)); await page.evaluateOnNewDocument(CLI);
  if (data) await page.evaluateOnNewDocument(RELOGIO(data));
  await page.evaluateOnNewDocument(() => { window.__abertos = []; window.open = (u) => { window.__abertos.push(String(u)); return null; }; });
  page.erros = [];
  page.on('pageerror', e => { page.erros.push(e.message); errosGlobais.push(e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) { page.erros.push(m.text()); errosGlobais.push(m.text()); } });
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORTA}${url}`, {waitUntil:'networkidle0', timeout:60000}); await esperar(500);
  page.ctx = c;
  return page;
}
const clk = (p, sel) => p.$eval(sel, e => { e.scrollIntoView({block:'center'}); e.click(); });
const texto = p => p.evaluate(() => document.getElementById('view').innerText);
const cab = p => p.evaluate(() => document.querySelector('header.top').innerText);
const semRolagemLateral = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const foto = async (p, nome, inteira = true) => { await esperar(300); await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({path:path.join(SHOTS, nome + '.png'), fullPage:inteira}); };
const publico = async p => { await p.evaluate(() => { if (S.mode !== 'publico') document.getElementById('mPublico').click(); }); await esperar(500); };
const acao = async (p, k) => { await clk(p, `.acoes-grid [data-acao="${k}"]`); await esperar(500); };

// ================= Home pública =================
console.log('== Home pública (Santo Antônio)');
for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1366, 768], [1920, 1080]]){
  const p = await aparelho({largura:w, altura:h}); await publico(p);
  const t = await texto(p);
  if (w === 390){
    const acoes = await p.$$eval('.acoes-grid .acao b', l => l.map(b => b.textContent));
    t_('Home começa com as 5 ações, no mesmo nível', JSON.stringify(acoes) === JSON.stringify(['Liturgia de hoje','Rezar','Pedir intenção de Missa','Acender uma vela','Secretaria 24h']), acoes);
    const participar = await p.$$eval('.participar-grid .acao b', l => l.map(b => b.textContent));
    t_('Home mostra Dizimista + Doações em "Participar da paróquia"', JSON.stringify(participar) === JSON.stringify(['Quero ser dizimista','Quero fazer uma doação']), participar);
    t_('sem o bloco repetido "Hoje na Igreja" (nome + data + título)', !t.includes('Hoje na Igreja') && await p.evaluate(() => document.querySelector('#view > :not(.sr)')?.classList.contains('acoes-grid')));
    t_('Liturgia é uma ação (não um bloco de texto grande)', !t.includes('Leituras e Evangelho no site oficial') && await p.$('.acoes-grid [data-acao="liturgia"]') !== null);
    t_('evento de HOJE em destaque', t.includes('HOJE NA PARÓQUIA') || t.includes('Hoje na paróquia') && t.includes('Almoço Beneficente'));
    t_('evento de hoje com horário, local e "Ver detalhes"', await p.$eval('.hoje-ev', e => e.innerText.includes('23h30') && e.innerText.includes('Salão Paroquial') && e.innerText.includes('Ver detalhes')));
    t_('ordem: ações → evento de hoje → destaque → próximo evento → notícias', await p.evaluate(() => { const y = s => document.querySelector(s)?.getBoundingClientRect().top ?? -1; const h2 = t => [...document.querySelectorAll('#view h2')].find(x => x.textContent.includes(t));
      const pos = [y('.acoes-grid'), y('.hoje-ev'), y('.destaque'), h2('Próximo evento')?.getBoundingClientRect().top, h2('Notícias')?.getBoundingClientRect().top]; return pos.every((v, i) => v > 0 && (!i || v > pos[i - 1])); }));
    await esperar(800);
    t_('notícia de HOJE chega (Worker só tinha o espelho de 3 dias atrás)', (await texto(p)).includes('Notícia publicada hoje no portal oficial'));
    const meta = await p.evaluate(() => NOTICIAS.meta);
    t_('fonte e idade registradas só internamente', meta?.fonte === 'navegador:api' && meta.maisNova === hojeIso && !(await texto(p)).match(/espelho|navegador:api|\bidade\b|obtidoEm/i), JSON.stringify(meta));
  }
  t_(`${w}: Home sem rolagem lateral`, await semRolagemLateral(p));
  await foto(p, `home-santo-antonio-${w}`, w === 390 || w === 1366);
  t_(`${w}: sem erros de JS`, !p.erros.length, p.erros.join(' | '));
}

// ================= ações =================
console.log('== ações');
{ const p = await aparelho(); await publico(p);
  await acao(p, 'liturgia'); let t = await texto(p);
  t_('Liturgia abre a experiência de Liturgia', t.includes('Liturgia de hoje') && t.includes('cor litúrgica') && t.includes('Ler as leituras de hoje')); await foto(p, 'liturgia-390');
  await clk(p, '[data-pub="igreja"]'); await esperar(300);
  await acao(p, 'intencao'); t = await texto(p);
  t_('"Pedir intenção de Missa" abre direto o formulário que já existe', !!(await p.$('#intF')) && t.includes('Pedir intenção de missa') && t.includes('Horário de missas')); await foto(p, 'intencao-390');
  await clk(p, '[data-pub="igreja"]'); await esperar(300);
  await acao(p, 'rezar'); t = await texto(p);
  t_('Rezar abre as orações', t.includes('Terço') || t.includes('Rosário'));
  await clk(p, '[data-pub="igreja"]'); await esperar(300);
  await clk(p, '.acoes-grid [data-s24-abrir]'); await esperar(500);
  t_('Secretaria 24h abre pela ação', (await texto(p)).includes('Como podemos ajudar?'));
  t_('ações: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= Rezar por paróquia =================
console.log('== Rezar por paróquia');
{ const p = await aparelho({largura:1366, altura:768}); await publico(p); await acao(p, 'rezar');
  const t = await texto(p);
  t_('Santo Antônio: mantém a oração do padroeiro correto', t.includes('Oração a Santo Antônio') && t.includes('Nosso padroeiro'));
  await foto(p, 'rezar-santo-antonio-1366');
  t_('Santo Antônio Rezar: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}
{ const p = await aparelho({url:'/?p=nossa-senhora-das-gracas-ibirite', largura:1366, altura:768}); await publico(p); await acao(p, 'rezar');
  const t = await texto(p);
  t_('Graças: não herda Santo Antônio', !t.includes('Oração a Santo Antônio') && t.includes('Oração a Nossa Senhora das Graças') && t.includes('Nossa padroeira'), t);
  await clk(p, '[data-rezar^="padroeiro:"]'); await esperar(400);
  const o = await texto(p);
  t_('Graças: nova oração própria aparece', o.includes('Lembrai-vos, ó puríssima Virgem Maria') && o.includes('Supliquemos o auxílio de Nossa Senhora das Graças') && o.includes('santa Medalha Milagrosa') && !o.includes('Glorioso Santo Antônio'), o);
  await foto(p, 'rezar-gracas-1366');
  t_('Graças Rezar: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}
{ const p = await aparelho({url:'/?p=santa-clara-e-sao-francisco-mineirao', largura:1366, altura:768}); await publico(p); await acao(p, 'rezar');
  const t = await texto(p);
  t_('Santa Clara e São Francisco: mostra os dois padroeiros corretos', !t.includes('Oração a Santo Antônio') && t.includes('Oração a Santa Clara') && t.includes('Nossa padroeira') && t.includes('Oração a São Francisco') && t.includes('Nosso padroeiro'), t);
  await foto(p, 'rezar-santa-clara-1366');
  t_('Santa Clara Rezar: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}
{ const p = await aparelho({url:'/?p=paroquia-sem-padroeiro', largura:1366, altura:768}); await publico(p); await acao(p, 'rezar');
  const t = await texto(p);
  t_('paróquia sem padroeiro configurado: não herda Santo Antônio', !t.includes('Oração a Santo Antônio') && !t.includes('Nosso padroeiro'), t);
  t_('paróquia sem padroeiro Rezar: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}

// ================= Dizimista + Doações na Home =================
console.log('== Dizimista + Doações na Home');
{ const p = await aparelho(); await publico(p);
  t_('Santo Antônio: Home mostra Dizimista + Doações', (await texto(p)).includes('Quero ser dizimista') && (await texto(p)).includes('Quero fazer uma doação'));
  await clk(p, '[data-acao="dizimista"]'); await esperar(400);
  t_('Home › Dizimista abre o fluxo existente', !!(await p.$('#dzPubF')) && (await texto(p)).includes('Ser dizimista é participar'));
  await clk(p, '[data-pub="igreja"]'); await esperar(300);
  await clk(p, '[data-acao="doacoes"]'); await esperar(900); let t = await texto(p);
  t_('sem configuração financeira: Doações abre orientação útil e secretaria', t.includes('ainda não cadastrou seus meios de doação') && t.includes('Falar com a secretaria') && !t.includes('Pix') && !t.includes('Doar com cartão'), t);
  B.doacoes['p-1'] = {parish_id:'p-1', pix_enabled:true, pix_key:'doacoes@paroquia-teste.invalid', pix_key_type:'email', pix_beneficiary:'PAROQUIA TESTE', pix_city:'BELO HORIZONTE', card_enabled:true, payment_provider:'Teste', checkout_url:'https://pagamentos.paroquia-teste.invalid/doar'};
  const q = await aparelho(); await publico(q); await clk(q, '[data-acao="doacoes"]'); await esperar(1200); t = await texto(q);
  t_('com configuração financeira simulada: meios continuam aparecendo', t.includes('Pix') && t.includes('doacoes@paroquia-teste.invalid') && t.includes('PAROQUIA TESTE') && t.includes('Doar com cartão'), t);
  t_('Dizimista + Doações: sem erros de JS', ![...p.erros, ...q.erros].length, [...p.erros, ...q.erros].join(' | '));
  delete B.doacoes['p-1'];
}

// ================= Sala das Velas =================
console.log('== Sala das Velas');
{ const p = await aparelho(); await p.emulateMediaFeatures([{name:'prefers-reduced-motion', value:'no-preference'}]); await publico(p); await acao(p, 'velas');
  let t = await texto(p);
  t_('Sala das Velas: 10 velas desenhadas', (await p.$$('.sala-velas .mv:not(.apagada)')).length === 10 && t.includes('10 velas acesas nas últimas 24 horas'));
  t_('nenhum nome nem pedido aparece', !/Nome Privado|Pedido privado|Fiel \d/.test(t));
  t_('chama em CSS (sem GIF) e parada com "menos movimento"', await p.evaluate(() => !document.querySelector('.sala img') && getComputedStyle(document.querySelector('.mv i')).animationName === 'tremula'));
  await foto(p, 'sala-das-velas-390');
  await clk(p, '#velaIr'); await esperar(300);
  t_('"Acender minha vela" abre o formulário', !!(await p.$('#velaF')));
  await p.click('input[name=para][value=almas]'); await clk(p, '#velaF button.gold'); await esperar(900);
  t_('vela acesa', (await texto(p)).includes('Sua vela está acesa'));
  // muitas velas: limite visual de 50
  B.estado.data.velas = Array.from({length:187}, (_, i) => ({id:1000 + i, ts:Date.now() - i * 60e3, para:'mim', por:'', pedido:'', nome:'', rezar:false}));
  const q = await aparelho({url:'/'}); await publico(q); await acao(q, 'velas');
  t = await texto(q);
  t_('187 velas: 50 desenhadas + "+137 pessoas rezando conosco"', (await q.$$('.sala-velas .mv')).length === 50 && t.includes('+137 pessoas rezando conosco'), t.slice(0, 200));
  await foto(q, 'sala-das-velas-187-390');
  const r = await aparelho(); await r.emulateMediaFeatures([{name:'prefers-reduced-motion', value:'reduce'}]); await publico(r); await acao(r, 'velas');
  t_('prefers-reduced-motion: chama parada', await r.evaluate(() => getComputedStyle(document.querySelector('.mv i')).animationName) === 'none');
  const tempo = await q.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 10; i++) render(); return (performance.now() - t0) / 10; });
  t_(`desenhar a Sala com 50 velas: ${tempo.toFixed(1)} ms`, tempo < 50);
  t_('velas: sem erros de JS', ![...p.erros, ...q.erros, ...r.erros].length, [...p.erros, ...q.erros].join(' | '));
}

// ================= destaques litúrgicos (datas fixas) =================
console.log('== destaques litúrgicos');
{ const casos = [['2026-09-20T10:00:00-03:00', []], ['2026-09-28T10:00:00-03:00', ['São Miguel Arcanjo', 'Nossa Senhora Aparecida']], ['2026-10-06T10:00:00-03:00', ['Novena de Nossa Senhora Aparecida']], ['2026-10-12T10:00:00-03:00', ['Nossa Senhora Aparecida']], ['2026-10-20T10:00:00-03:00', []]];
  for (const [d, esperado] of casos){
    const p = await aparelho({data:d}); await publico(p);
    const tit = await p.$$eval('.destaque h3', l => l.map(h => h.textContent));
    t_(`${d.slice(0, 10)}: destaques ${JSON.stringify(esperado)}`, JSON.stringify(tit) === JSON.stringify(esperado), tit);
    if (d.startsWith('2026-09-28')){
      const s = await p.$eval('.destaque', e => e.innerText);
      t_('28/09: "29 de setembro · São Miguel Arcanjo · Vamos rezar? [Rezar com São Miguel]"', /29 de setembro/i.test(s) && s.includes('Vamos rezar?') && s.includes('Rezar com São Miguel'));
      t_('28/09: Aparecida "Estamos nos preparando…" com [Rezar] e [Ver programação]', (await p.$$eval('.destaque', l => l[1].innerText)).includes('Estamos nos preparando para a Padroeira do Brasil') && (await p.$$('.destaque [data-dev-prog]')).length === 1);
      await foto(p, 'destaque-28-09-390');
      await clk(p, '.destaque [data-dev="sao-miguel"]'); await esperar(400);
      const t = await texto(p);
      t_('página devocional: título, apresentação, oração', t.includes('São Miguel Arcanjo') && t.includes('Santos Arcanjos') && t.includes('São Miguel Arcanjo, defendei-nos no combate'));
      await foto(p, 'devocional-sao-miguel-390');
      await p.evaluate(() => { S.devVendo = 'aparecida'; S.pubTab = 'devocao'; render(); }); await esperar(300);
      const ta = await texto(p);
      t_('página devocional Aparecida: evento da paróquia relacionado + link oficial', ta.includes('Terço de Nossa Senhora Aparecida') && !!(await p.$('a[href="https://www.a12.com/"]')));
      await foto(p, 'devocional-aparecida-390');
    }
    if (d.startsWith('2026-10-06')){
      const s = await p.$eval('.destaque', e => e.innerText);
      t_('06/10: "Novena de Nossa Senhora Aparecida — Dia 4 de 9 [Rezar hoje]"', s.includes('Dia 4 de 9') && s.includes('Rezar hoje'));
      await foto(p, 'destaque-novena-dia4-390');
    }
    t_(`${d.slice(0, 10)}: sem erros de JS`, !p.erros.length, p.erros.join(' | '));
  }
}

// ================= Agenda unificada + um só botão =================
console.log('== Agenda unificada e "Adicionar à minha agenda"');
{ const p = await aparelho({data:'2026-09-28T10:00:00-03:00'}); await publico(p);
  await clk(p, '#tabs [data-tab="agenda"]'); await esperar(500);
  let t = await texto(p);
  t_('eventos da paróquia e datas da Igreja no mesmo lugar', t.includes('Almoço Beneficente') && t.includes('Santos Arcanjos Miguel, Gabriel e Rafael') && t.includes('Nossa Senhora Aparecida, Padroeira do Brasil'));
  t_('categorias visuais (ícone + texto)', t.includes('Festa') && t.includes('Solenidade') && t.includes('Toda a paróquia'));
  t_('períodos em andamento (Quaresma de São Miguel, Mês da Bíblia)', /em andamento/i.test(t) && t.includes('Quaresma de São Miguel') && t.includes('Mês da Bíblia'));
  const botoes = await p.$$eval('.notice.evento', l => l.map(a => [...a.querySelectorAll('a, button')].map(b => b.textContent.trim())));
  t_('cada evento: UM só botão, "Adicionar à minha agenda"', botoes.length >= 3 && botoes.every(b => b.length === 1 && b[0].includes('Adicionar à minha agenda')), JSON.stringify(botoes));
  t_('nenhum "Google Agenda" nem "ICS" na tela', !/Google Agenda|\bICS\b|\.ics/i.test(t));
  await foto(p, 'agenda-unificada-390');
  await clk(p, '[data-agf="igreja"]'); await esperar(300); t = await texto(p);
  t_('filtro "Calendário da Igreja"', !t.includes('Almoço Beneficente') && t.includes('Solenidade'));
  await clk(p, '[data-agf="paroquia"]'); await esperar(300); t = await texto(p);
  t_('filtro "Paróquia"', t.includes('Almoço Beneficente') && !t.includes('Santos Arcanjos'));
  await clk(p, '[data-agf="todos"]'); await esperar(300);
  await clk(p, '[data-agenda-add="e-prox"]'); await esperar(300);
  const ab = await p.evaluate(() => window.__abertos);
  t_('computador (Windows/Chrome): abre o Google Agenda com o evento', ab.length === 1 && ab[0].startsWith('https://calendar.google.com/calendar/render?') && ab[0].includes('Missa+de+S%C3%A3o+Francisco') && ab[0].includes('ctz=America%2FSao_Paulo'), ab);
  const android = await aparelho({ua:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'}); await publico(android);
  await clk(android, '#tabs [data-tab="agenda"]'); await esperar(400); await clk(android, '[data-agenda-add="e-prox"]'); await esperar(300);
  t_('Android: Google Agenda (abre o app)', (await android.evaluate(() => window.__abertos))[0]?.startsWith('https://calendar.google.com/'));
  const ios = await aparelho({ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'}); await publico(ios);
  await clk(ios, '#tabs [data-tab="agenda"]'); await esperar(400);
  await ios.evaluate(() => { window.__ics = null; const o = URL.createObjectURL; URL.createObjectURL = b => { b.text().then(x => window.__ics = x); return o(b); }; HTMLAnchorElement.prototype.click = function(){ window.__download = this.download; }; });
  await clk(ios, '[data-agenda-add="e-prox"]'); await esperar(400);
  const ics = await ios.evaluate(() => ({ics:window.__ics, nome:window.__download, abertos:window.__abertos}));
  t_('iPhone: arquivo de calendário (.ics) para o app Calendário, sem Google', ics.nome?.endsWith('.ics') && /BEGIN:VEVENT[\s\S]*SUMMARY:Missa de São Francisco/.test(ics.ics || '') && !ics.abertos.length, JSON.stringify(ics).slice(0, 200));
  await clk(p, '#tabs [data-tab="igreja"]'); await esperar(300); await clk(p, '[data-ev-ver="e-hoje"]'); await esperar(400);
  t_('"Ver detalhes" do evento de hoje abre o evento', (await texto(p)).includes('Almoço Beneficente') && (await p.$$('[data-agenda-add]')).length === 1);
  t_('agenda: sem erros de JS', ![...p.erros, ...android.erros, ...ios.erros].length, [...p.erros, ...android.erros, ...ios.erros].join(' | '));
}
{ // sem evento hoje: o bloco some
  const salvo = B.t.events.splice(0, 1);
  const p = await aparelho(); await publico(p);
  t_('sem evento hoje: bloco "Hoje na paróquia" não aparece (nem "Nenhum evento hoje")', !(await p.$('.hoje-ev')) && !/Hoje na paróquia|Nenhum evento hoje/i.test(await texto(p)));
  B.t.events.unshift(...salvo);
}

// ================= Encontre sua paróquia / trocar / ativação =================
console.log('== busca, troca e ativação');
let ctxFiel;
{ const p = await aparelho(); ctxFiel = p.ctx; await publico(p);
  await clk(p, '#hdrName'); await esperar(1500);
  let t = await texto(p);
  t_('Trocar abre "Encontre sua paróquia" com as ativas', t.includes('Encontre sua paróquia') && t.includes('Com a Central Paroquial') && t.includes('Santa Clara e São Francisco'), t.slice(0, 400));
  await p.type('#buscaPar', 'ibirité graças'); await esperar(800);
  t = await texto(p);
  t_('busca por município + nome: N. Sra. das Graças ativa', t.includes('Nossa Senhora das Graças') && t.includes('Centro · Ibirité') && t.includes('✓ Central Paroquial ativa'));
  await foto(p, 'busca-ativa-390');
  await p.$eval('#buscaPar', e => e.value = ''); await p.type('#buscaPar', 'bom pastor'); await esperar(800);
  t = await texto(p);
  t_('paróquia listed: "Central Paroquial ainda não ativada" + [Solicitar ativação]', t.includes('Bom Pastor') && t.includes('Central Paroquial ainda não ativada') && !!(await p.$('[data-dir-ativar]')));
  await p.evaluate(() => document.querySelector('[data-dir-ativar]').click()); await esperar(900);
  t = await texto(p);
  t_('Solicitar ativação: "Você representa esta paróquia ou santuário?" + WhatsApp e e-mail da Central', t.includes('Você representa esta paróquia ou santuário?') && !!(await p.$('#ativacao a[href^="https://wa.me/5531997509221"]')) && !!(await p.$('#ativacao a[href^="mailto:suporte.thunderdynamics@gmail.com"]')));
  t_('ficha da listed: endereço institucional do Catálogo, SEM nome de pároco', t.includes('Praça da Comunidade, 94') && !t.includes('Mateus Lopes') && !/Pároco:|Reitor:/.test(t));
  t_('nenhuma ativação automática (nada gravado)', !B.log.some(x => /directory|parishes/.test(x) && !x.startsWith('rpc:public_directory')));
  await foto(p, 'solicitar-ativacao-390');
  await clk(p, '#voltarAtual'); await esperar(400);
  await clk(p, '#hdrName'); await esperar(400);
  await p.type('#buscaPar', 'mineirão'); await esperar(800);
  await p.evaluate(() => [...document.querySelectorAll('[data-dir-abrir]')].find(b => b.textContent.trim() === 'Acessar').click());
  await p.waitForNavigation({waitUntil:'networkidle0'}).catch(() => {}); await esperar(700);
  t_('Acessar paróquia ativa: mesmo código, contexto pelo endereço (?p=slug)', p.url().includes('?p=santa-clara-e-sao-francisco-mineirao'));
  t = await texto(p); const c = await cab(p);
  t_('Santa Clara: cabeçalho com o próprio nome', c.includes('Paróquia Santa Clara e São Francisco – Mineirão'));
  t_('Santa Clara: nada de Santo Antônio na Home', !/Almoço Beneficente|Aviso de Santo Antônio|Santo Antônio/.test(t), t.slice(0, 300));
  t_('Santa Clara: Home mostra Dizimista + Doações', t.includes('Quero ser dizimista') && t.includes('Quero fazer uma doação'), t);
  t_('Santa Clara: sem Secretaria 24h (não tem catálogo) e sem evento de hoje', !(await p.$('.acoes-grid [data-s24-abrir]')) && !(await p.$('.hoje-ev')));
  await foto(p, 'home-santa-clara-390');
  await clk(p, '#tabs [data-tab="agenda"]'); await esperar(400); t = await texto(p);
  t_('Santa Clara: horários "Informações serão publicadas em breve."', t.includes('Informações serão publicadas em breve.') && !t.includes('07h30'));
  await clk(p, '#tabs [data-tab="avisos"]'); await esperar(300);
  t_('Santa Clara: avisos vazios', (await texto(p)).includes('Nenhum aviso no momento.'));
  await clk(p, '#tabs [data-tab="contato"]'); await esperar(400); t = await texto(p);
  t_('Santa Clara: endereço institucional do catálogo, SEM nome de pároco', t.includes('Rua Mafalda Guimarães Corrieri, 610') && !t.includes('Bráulio') && !/Pároco:/.test(t));
  await foto(p, 'paroquia-santa-clara-390');
  await p.evaluate(() => { S.pubTab = 'velas'; velaStep = 'inicio'; render(); }); await esperar(300);
  t_('Santa Clara: Sala das Velas com as velas DELA (0), não as de Santo Antônio', (await texto(p)).includes('Seja o primeiro a acender uma vela hoje.'));
  await clk(p, '#velaIr'); await p.click('input[name=para][value=mim]'); await clk(p, '#velaF button.gold'); await esperar(900);
  t_('vela acesa em Santa Clara vai para Santa Clara', (B.estados['p-2'].data.velas || []).length === 1 && B.estado.data.velas.length === 187);
  const chaves = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('central-paroquial-v02')).sort());
  t_('estado separado por paróquia neste aparelho', JSON.stringify(chaves) === JSON.stringify(['central-paroquial-v02', 'central-paroquial-v02@santa-clara-e-sao-francisco-mineirao']), chaves);
  await p.evaluate(() => { S.pubTab = 'escolher'; render(); }); await esperar(500); t = await texto(p);
  t_('Recentes: Santa Clara e a ativa anterior', t.includes('Recentes') && t.includes('Bom Pastor'));
  await foto(p, 'trocar-recentes-390');
  t_('busca/troca: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}
for (const [slug, nome] of [['nossa-senhora-das-gracas-ibirite', 'Nossa Senhora das Graças – Ibirité']]){
  for (const w of [390, 1366]){
    const p = await aparelho({url:'/?p=' + slug, largura:w, altura:w === 390 ? 844 : 768}); await publico(p);
    const t = await texto(p);
    t_(`${slug} (${w}): Home própria`, (await cab(p)).includes(nome) && !t.includes('Almoço Beneficente'));
    t_(`${slug} (${w}): Home mostra Dizimista + Doações`, t.includes('Quero ser dizimista') && t.includes('Quero fazer uma doação'), t);
    await foto(p, `home-gracas-${w}`, w === 390);
    t_(`${slug} (${w}): sem erros de JS`, !p.erros.length, p.erros.join(' | '));
  }
}
{ // equipe de outra paróquia: abre a página certa e só vê a própria paróquia
  const p = await aparelho({url:'/#painel', largura:1366, altura:768}); await p.type('#l-em', 'sc@teste'); await p.type('#l-pw', '123456'); await clk(p, '#l-btn');
  await p.waitForNavigation({waitUntil:'networkidle0'}).catch(() => {}); await esperar(1200);
  t_('secretaria de Santa Clara entrando pela página de Santo Antônio vai para ?p=santa-clara#painel', p.url().includes('?p=santa-clara-e-sao-francisco-mineirao') && p.url().endsWith('#painel'));
  const c = await cab(p), t = await texto(p);
  t_('painel de Santa Clara: nome dela, nada de Santo Antônio', c.includes('Santa Clara e São Francisco') && !/Santo Antônio|Almoço Beneficente/.test(t + c), (c + t).slice(0, 300));
  await foto(p, 'painel-santa-clara-1366', false);
  t_('painel Santa Clara: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}
{ // banco ainda sem o diretório (produção hoje): busca usa a lista REDE, sem quebrar
  B.diretorio = false;
  const p = await aparelho(); await publico(p); await clk(p, '#hdrName'); await esperar(400);
  await p.type('#buscaPar', 'são bernardo'); await esperar(800);
  const t = await texto(p);
  t_('sem diretorio.sql: busca cai na lista REDE e funciona', t.includes('São Bernardo') && t.includes('RENSC'));
  t_('sem diretorio.sql: sem erros de JS', !p.erros.length, p.erros.join(' | '));
  B.diretorio = true;
}

// ================= conteúdo DEMO identificado (não parece oficial) =================
console.log('== etiqueta "Demonstração"');
{ // o mesmo formato que o supabase/demo_multitenant_seed.sql grava
  const salvoEv = B.t.events.slice(), salvoEst = structuredClone(B.estado.data);
  B.t.events.push(EV('e-demo-hoje', 'Terço em família', hojeAs(23, 45), {description:'Momento de oração do terço aberto a todas as famílias.\n\n[Evento de demonstração]', location:'Local a confirmar'}));
  B.estado.data.avisos.push({id:1004000000001, ts:Date.now() - 2 * 3600e3, titulo:'Campanha do agasalho', texto:'Doações podem ser entregues na secretaria. [Aviso de demonstração]', evento:null, demo:true});
  B.estado.data.intencoes.push({id:1004000000011, ts:Date.now(), tipo:'falecidos', por:'Pedro Exemplo Viana (7º dia)', data:new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), hora:'Horário a confirmar', nome:'Família Exemplo Viana', whats:'', status:'nova', demo:true});
  const p = await aparelho(); await publico(p);
  t_('Home: evento DEMO de hoje com a etiqueta', await p.$$eval('.hoje-ev', l => l.find(x => x.innerText.includes('Terço em família'))?.querySelector('.selo-demo')?.textContent === 'Demonstração'));
  t_('Home: evento real de hoje SEM etiqueta', await p.$$eval('.hoje-ev', l => !l.find(x => x.innerText.includes('Almoço Beneficente')).querySelector('.selo-demo')));
  await foto(p, 'demo-etiqueta-home-390', false);
  await clk(p, '#tabs [data-tab="avisos"]'); await esperar(400);
  const av = await p.$$eval('#view .notice', l => l.map(n => ({t:n.querySelector('h3')?.textContent, demo:!!n.querySelector('.selo-demo'), txt:n.innerText})));
  t_('Avisos: aviso DEMO com a etiqueta, aviso real sem', av.find(x => x.t === 'Campanha do agasalho')?.demo === true && av.find(x => x.t === 'Aviso de Santo Antônio')?.demo === false, JSON.stringify(av));
  t_('Avisos: o texto técnico [Aviso de demonstração] não aparece', !av.some(x => x.txt.includes('[Aviso de demonstração]')));
  await foto(p, 'demo-etiqueta-avisos-390');
  await clk(p, '#tabs [data-tab="agenda"]'); await esperar(400);
  const ev = await p.$$eval('.notice.evento', l => l.map(n => ({t:n.querySelector('h3')?.textContent, demo:!!n.querySelector('.selo-demo'), txt:n.innerText})));
  t_('Agenda: evento DEMO com a etiqueta, eventos reais sem', ev.find(x => x.t === 'Terço em família')?.demo === true && ev.filter(x => x.t !== 'Terço em família').every(x => !x.demo), JSON.stringify(ev.map(x => [x.t, x.demo])));
  t_('Agenda: o texto técnico [Evento de demonstração] não aparece', !ev.some(x => x.txt.includes('[Evento de demonstração]')));
  await foto(p, 'demo-etiqueta-agenda-390');
  t_('Intenções não aparecem na página pública (só no painel)', !(await p.evaluate(() => document.body.innerText.includes('Pedro Exemplo Viana'))));
  const s = await aparelho({url:'/#painel', largura:1366, altura:768}); await s.type('#l-em', 'secretaria@teste'); await s.type('#l-pw', '123456'); await clk(s, '#l-btn'); await esperar(1200);
  await s.evaluate(() => document.querySelector('#tabs [data-tab="intencoes"]').click()); await esperar(500);
  t_('Painel › Intenções: intenção DEMO com a etiqueta', await s.$$eval('#view .row', l => l.find(r => r.innerText.includes('Pedro Exemplo Viana'))?.querySelector('.selo-demo')?.textContent === 'Demonstração'));
  await foto(s, 'demo-etiqueta-intencoes-painel-1366', false);
  await s.evaluate(() => document.querySelector('#tabs [data-tab="comunicar"]').click()); await esperar(500);
  t_('Painel › Publicados recentemente: aviso DEMO com a etiqueta, real sem', await s.$$eval('#view .row', l => { const d = l.find(r => r.innerText.includes('Campanha do agasalho')), r = l.find(x => x.innerText.includes('Aviso de Santo Antônio')); return !!d?.querySelector('.selo-demo') && !r?.querySelector('.selo-demo'); }));
  await s.evaluate(() => document.querySelector('#tabs [data-tab="agenda"]').click()); await esperar(500);
  t_('Painel › Agenda: evento DEMO com a etiqueta', await s.$$eval('#view .row', l => !!l.find(r => r.innerText.includes('Terço em família'))?.querySelector('.selo-demo')));
  t_('etiqueta: sem erros de JS', ![...p.erros, ...s.erros].length, [...p.erros, ...s.erros].join(' | '));
  B.t.events.length = 0; B.t.events.push(...salvoEv); B.estado.data = salvoEst;
}

// ================= acessibilidade básica das telas novas =================
console.log('== acessibilidade básica');
{ const a11y = p => p.evaluate(() => {
    const vis = e => !!(e.offsetWidth || e.offsetHeight);
    const semNome = [...document.querySelectorAll('#view button, #view a, #tabs button, header button')].filter(e => vis(e) && !(e.getAttribute('aria-label') || e.textContent.trim()));
    const semRotulo = [...document.querySelectorAll('#view input:not([type=hidden]):not([type=radio]):not([type=checkbox]), #view select, #view textarea')].filter(e => vis(e) && !e.closest('.hp') && !(e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest('label')));
    const h = [...document.querySelectorAll('#view h2, #view h3')].length;
    return {semNome:semNome.length, semRotulo:semRotulo.map(e => e.id || e.name), titulos:h};
  });
  const p = await aparelho({data:'2026-09-28T10:00:00-03:00'}); await publico(p);
  const telas = [['Home', () => {}], ['Liturgia', () => acao(p, 'liturgia')], ['Intenção', async () => { await clk(p, '[data-pub="igreja"]'); await acao(p, 'intencao'); }],
    ['Sala das Velas', async () => { await clk(p, '[data-pub="igreja"]'); await acao(p, 'velas'); }], ['Agenda', async () => { await clk(p, '#tabs [data-tab="agenda"]'); await esperar(400); }],
    ['Página devocional', async () => { await p.evaluate(() => { S.devVendo = 'sao-miguel'; S.pubTab = 'devocao'; render(); }); await esperar(300); }],
    ['Encontre sua paróquia', async () => { await p.evaluate(() => { S.pubTab = 'escolher'; render(); }); await esperar(800); }]];
  for (const [nome, ir] of telas){ await ir(); const r = await a11y(p); t_(`${nome}: todo botão/link com nome, todo campo com rótulo, com títulos`, !r.semNome && !r.semRotulo.length && r.titulos > 0, JSON.stringify(r)); }
  t_('Sala das Velas: velas descritas para leitor de tela', await p.evaluate(() => { S.pubTab = 'velas'; velaStep = 'inicio'; render(); return /velas? acesas? nas últimas 24 horas|Nenhuma vela/.test(document.querySelector('.sala-velas').getAttribute('aria-label')); }));
}

console.log(`\nerros de JS no total: ${errosGlobais.length}`);
console.log(`\n${ok} ok, ${falha} falha(s)`);
await browser.close(); process.exit(falha ? 1 : 0);
