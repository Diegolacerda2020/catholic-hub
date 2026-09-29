// Hardening antes da homologação: minimização de dados pessoais do Catálogo + contato da Central Paroquial.
//   - nenhum nome de responsável (pároco, reitor…) no diretório público, no JSON importado, no seed, no index.html;
//   - contato com evidência de ser pessoal (retido pelo importador) não aparece;
//   - busca sem resultado → "Não encontrou sua paróquia?" (WhatsApp e e-mail da Central, mensagem exata);
//   - listed → "Você representa esta paróquia ou santuário?"; active → sem CTA de ativação;
//   - rodapé: fonte, aviso de independência e contato; tudo sem rolagem lateral em 5 larguras.
// Os nomes usados para conferir vêm do JSON ANTIGO (commit a9ec650), só em memória, durante o teste.
import { fileURLToPath } from 'node:url';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {criarBackend, CLIENTE} from './supabase-falso.mjs';
import {esperar} from './ui.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots/privacidade', import.meta.url)); fs.mkdirSync(SHOTS, {recursive:true});
const CLI = CLIENTE.replace('gte(){ return b; },', 'gte(){ return b; }, order(){ return b; }, limit(){ return b; },');
const TIPOS = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json'};
const PORTA = 8805;
const WA = '5531997509221', EMAIL = 'suporte.thunderdynamics@gmail.com';
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/noticias' || u.pathname === '/api/liturgia' || u.pathname === '/teste/oficial.json'){ res.writeHead(404); return res.end(); }
  if (u.pathname === '/config.js'){ // o config.js DE VERDADE do repositório, só trocando o Supabase pelo simulado
    res.writeHead(200, {'content-type':TIPOS['.js']});
    return res.end(fs.readFileSync(path.join(REPO, 'config.js'), 'utf8').replace(/supabase:\s*\{[^}]*\}/, 'supabase:{url:"https://fake.supabase.co", anonKey:"x"}') + '\nwindow.CENTRAL_CONFIG.noticiasOficial = "/teste/oficial.json"; window.CENTRAL_CONFIG.noticiasEspelho = "";');
  }
  const f = path.join(REPO, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.resolve(REPO)) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'content-type':TIPOS[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(PORTA);

let ok = 0, falha = 0; const t_ = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 500)); };

// ---------- referência: os nomes que existiam antes (só em memória) ----------
const antigo = JSON.parse(execSync('git show a9ec650:docs/diretorio-importacao.json', {cwd:REPO}).toString()).diretorio;
const NOMES = [...new Set(antigo.flatMap(d => [d.pastor_name, d.rector_name]).filter(Boolean))];
const REDE_ANTIGA = JSON.parse(execSync('git show a9ec650:index.html', {cwd:REPO}).toString().match(/const REDE = (\[.*?\]);\n/)[1]);
const NOMES_REDE = [...new Set(REDE_ANTIGA.map(r => (r.resp || '').replace(/^[^:]*:\s*/, '').replace(/[,.]+$/, '').trim()).filter(n => n.length > 8))];
const EMAIL_PESSOAL = antigo.find(d => d.catalog_code === '197').email; // e-mail com o nome do responsável (retido pelo importador)
const contem = (txt, nomes) => nomes.filter(n => txt.includes(n));

console.log('== arquivos públicos e importados');
t_(`referência: ${NOMES.length} nomes do Catálogo e ${NOMES_REDE.length} da lista RENSC (antes)`, NOMES.length > 250 && NOMES_REDE.length > 50);
const json = fs.readFileSync(path.join(REPO, 'docs/diretorio-importacao.json'), 'utf8'), dados = JSON.parse(json);
const CAMPOS_PESSOAIS = /pastor|rector|reitor|paroco|vigario|responsavel|clergy|cura_/i;
t_('JSON importado: nenhum campo de responsável', dados.diretorio.every(d => !Object.keys(d).some(k => CAMPOS_PESSOAIS.test(k))), Object.keys(dados.diretorio[0]).join());
t_('JSON importado: nenhum nome de responsável', !contem(json, NOMES).length, contem(json, NOMES).slice(0, 3));
const seed = fs.readFileSync(path.join(REPO, 'supabase/diretorio_seed.sql'), 'utf8');
t_('seed: sem colunas de responsável', !/pastor_|rector_/.test(seed));
t_('seed: nenhum nome de responsável', !contem(seed, NOMES).length, contem(seed, NOMES).slice(0, 3));
const rec = fs.readFileSync(path.join(REPO, 'docs/diretorio-reconciliacao.md'), 'utf8');
t_('relatório de reconciliação: nenhum nome de responsável', !contem(rec, NOMES).length, contem(rec, NOMES).slice(0, 3));
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
t_('index.html: lista RENSC sem o campo "resp"', !/"resp"\s*:/.test(html));
t_('index.html: nenhum nome de responsável (Catálogo nem RENSC)', !contem(html, [...NOMES, ...NOMES_REDE]).length, contem(html, [...NOMES, ...NOMES_REDE]).slice(0, 3));
t_('contato com evidência de ser pessoal (Cód. 197) fora do JSON, do seed e do index.html', !!EMAIL_PESSOAL && ![json, seed, html].some(x => x.includes(EMAIL_PESSOAL)));
t_('relatório lista o contato retido SEM o valor', rec.includes('Cód. 197') && !rec.includes(EMAIL_PESSOAL));
const cfg = fs.readFileSync(path.join(REPO, 'config.js'), 'utf8');
t_('config.js: contato da Central = e-mail e WhatsApp oficiais da plataforma', cfg.includes(`email: '${EMAIL}'`) && cfg.includes(`whatsapp: '${WA}'`));
const SQLS = ['diretorio.sql', 'diretorio_santuarios.sql', 'diretorio_ativacao.sql'].map(f => fs.readFileSync(path.join(REPO, 'supabase', f), 'utf8')).join('\n');
t_('migrations do diretório: nenhuma cria ou lê campo de responsável', !/pastor_|rector_name|'paroco'/.test(SQLS));

// ---------- navegador ----------
const {B, op} = criarBackend({});
B.estado.data = {cfg:{nome:'Paróquia Santo Antônio – Jaraguá', padroeiro:'Santo Antônio', paroco:'Pe. Antônio Roberto', endereco:'Praça Santo Antônio, 2 – Jaraguá', telefone:'(31) 3427-2866', forania:'Santo Antônio (Pampulha)', regiao:'Região Episcopal Nossa Senhora da Conceição – RENSC', secretaria:'Segunda a sexta, 8h às 12h', missas:'', whats:'', email:''}, avisos:[], velas:[], intencoes:[]};
const browser = await puppeteer.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
const erros = [];
async function aparelho({url = '/?p=santo-antonio-jaragua', largura = 390, altura = 844} = {}){
  const c = await browser.createBrowserContext(); const page = await c.newPage();
  await page.setViewport({width:largura, height:altura, deviceScaleFactor:1});
  await page.exposeFunction('__sb', q => op(q)); await page.evaluateOnNewDocument(CLI);
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource|ERR_|net::/.test(m.text())) erros.push(m.text()); });
  await page.goto(`http://localhost:${PORTA}${url}`, {waitUntil:'networkidle0', timeout:60000}); await esperar(500);
  await page.evaluate(() => { if (S.mode !== 'publico') document.getElementById('mPublico').click(); }); await esperar(400);
  return page;
}
const texto = p => p.evaluate(() => document.getElementById('view').innerText);
const semRolagemLateral = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const ir = async (p, tela) => { await p.evaluate(tela => { S.pubTab = tela; render(); scrollTo(0, 0); }, tela); await esperar(600); };
const buscar = async (p, q) => { await p.$eval('#buscaPar', e => { e.value = ''; }); await p.type('#buscaPar', q); await esperar(900); };
const abrirFicha = async (p, q) => { await ir(p, 'escolher'); await buscar(p, q); await p.evaluate(() => document.querySelector('#dirRes [data-dir-abrir]').click()); await esperar(900); };
const links = p => p.$$eval('[data-cp]', l => l.map(a => ({tipo:a.dataset.cp, href:a.getAttribute('href'), txt:a.textContent.trim(), dentro:a.closest('section, footer')?.id || a.closest('footer')?.className})));
const foto = async (p, nome) => { await esperar(250); await p.screenshot({path:path.join(SHOTS, nome + '.png'), fullPage:true}); };

const MSG_INCLUSAO = 'Olá! Não encontrei minha paróquia na Central Paroquial e gostaria de solicitar a inclusão.\n\nParóquia:\nCidade:\nBairro:';
console.log('== busca sem resultado: pedido de inclusão');
{ const p = await aparelho(); await ir(p, 'escolher'); await buscar(p, 'paroquia que nao existe xyz');
  const t = await texto(p), l = await links(p);
  t_('0 resultados: "Não encontrou sua paróquia?" + texto', t.includes('Não encontrou sua paróquia?') && t.includes('Envie os dados para nossa equipe e vamos verificar a inclusão no diretório.'));
  const wa = l.find(x => x.dentro === 'inclusao' && x.tipo === 'whatsapp'), em = l.find(x => x.dentro === 'inclusao' && x.tipo === 'email');
  t_('botões [Solicitar inclusão pelo WhatsApp] [Enviar e-mail]', wa?.txt === 'Solicitar inclusão pelo WhatsApp' && em?.txt === 'Enviar e-mail', JSON.stringify(l));
  t_('WhatsApp: wa.me/5531997509221 com a mensagem EXATA (nada preenchido pela pessoa)', wa?.href === `https://wa.me/${WA}?text=${encodeURIComponent(MSG_INCLUSAO)}`, wa?.href);
  const u = new URL(em.href.replace('mailto:', 'http://x/'));
  t_('e-mail: suporte.thunderdynamics@gmail.com, assunto e a mesma mensagem', em.href.startsWith(`mailto:${EMAIL}?`) && u.searchParams.get('subject') === 'Inclusão no diretório — Central Paroquial' && u.searchParams.get('body') === MSG_INCLUSAO, em.href);
  t_('WhatsApp abre em outra aba, com noopener', await p.$eval('#inclusao [data-cp="whatsapp"]', a => a.target === '_blank' && /noopener/.test(a.rel)));
  await buscar(p, 'bom pastor');
  t_('com resultados: sem o bloco de inclusão', !(await p.$('#inclusao')));
}

console.log('== instituição listed: pedido de ativação');
{ const p = await aparelho(); await abrirFicha(p, 'sao paulo da cruz');
  const t = await texto(p), l = await links(p);
  t_('"Você representa esta paróquia ou santuário?" + texto curto', t.includes('Você representa esta paróquia ou santuário?') && t.includes('Fale com nossa equipe para conhecer a Central Paroquial e solicitar a ativação desta página.'));
  const wa = l.find(x => x.dentro === 'ativacao' && x.tipo === 'whatsapp'), em = l.find(x => x.dentro === 'ativacao' && x.tipo === 'email');
  const msg = 'Olá! Gostaria de solicitar informações sobre a ativação da página da minha paróquia na Central Paroquial.\n\nParóquia: Santuário Arquidiocesano São Paulo da Cruz\nCidade: Belo Horizonte';
  t_('[Solicitar ativação] no WhatsApp com a mensagem EXATA (nome e cidade da instituição)', wa?.txt === 'Solicitar ativação' && wa.href === `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`, wa?.href);
  t_('[Enviar e-mail] para a Central com a mesma mensagem', em && new URL(em.href.replace('mailto:', 'http://x/')).searchParams.get('body') === msg && em.href.startsWith(`mailto:${EMAIL}?`));
  t_('ficha: sem nome de responsável, sem "Pároco:"/"Reitor:"', !contem(t, NOMES).length && !/Pároco:|Reitor:|Administrador Paroquial:/.test(t));
  t_('ficha: fonte e aviso de independência no rodapé', t.includes('Dados institucionais de referência: Catálogo 2026 — Arquidiocese de Belo Horizonte.') && t.includes('A Central Paroquial é uma plataforma independente. A presença de uma instituição neste diretório não significa adesão ou vínculo comercial com a plataforma.'));
  await foto(p, 'listed-sao-paulo-da-cruz-390');
  // várias fichas e listas: nenhum nome
  const vistos = [];
  for (const q of ['bom pastor', 'piedade', 'lagoinha', 'sao judas tadeu', 'santo antonio', 'nossa senhora', 'siriacos']){
    await ir(p, 'escolher'); await buscar(p, q); vistos.push(await p.evaluate(() => document.documentElement.outerHTML));
    await p.evaluate(() => document.querySelector('#dirRes [data-dir-ativar], #dirRes [data-dir-abrir]')?.click()); await esperar(800);
    vistos.push(await p.evaluate(() => document.documentElement.outerHTML));
  }
  const tudo = vistos.join('\n');
  t_('diretório público (buscas + 7 fichas): nenhum nome de responsável no HTML', !contem(tudo, [...NOMES, ...NOMES_REDE]).length, contem(tudo, NOMES).slice(0, 3));
  t_('ficha dos Siríacos (Cód. 197): e-mail pessoal NÃO aparece', !tudo.includes(EMAIL_PESSOAL));
  const ficha = await op({kind:'rpc', fn:'public_directory_entry', args:{p_slug:'sao-paulo-da-cruz-barreiro-de-baixo'}});
  t_('RPC pública (simulada): ficha sem campos de responsável', ficha.data && !Object.keys(ficha.data).some(k => CAMPOS_PESSOAIS.test(k)), Object.keys(ficha.data || {}).join());
}

console.log('== instituição ACTIVE: sem CTA de ativação');
{ const p = await aparelho({url:'/?p=santa-clara-e-sao-francisco-mineirao'});
  for (const tela of ['igreja', 'contato', 'agenda', 'avisos']){ await ir(p, tela); t_(`Santa Clara (ativa) › ${tela}: sem CTA de ativação dela ("Você representa…")`, !(await p.$('#ativacao')) && !/Você representa esta paróquia/.test(await texto(p))); }
  await ir(p, 'contato'); const t = await texto(p);
  t_('Santa Clara › Paróquia: sem nome de pároco do Catálogo', !contem(t, NOMES).length && !/Pároco:/.test(t));
  const r = await p.$$eval('.pub-rodape [data-cp]', l => l.map(a => a.getAttribute('href')));
  t_('ativa: só o contato geral no rodapé (WhatsApp + e-mail da Central)', r.length === 2 && r[0].startsWith(`https://wa.me/${WA}?text=`) && r[1].startsWith(`mailto:${EMAIL}?`), JSON.stringify(r));
  t_('ativa: rodapé sem o aviso do diretório (não é página do diretório)', !(await p.$eval('.pub-rodape', f => f.innerText)).includes('Catálogo 2026'));
  await ir(p, 'escolher'); await buscar(p, 'mineirao');
  t_('cartão da ativa no diretório: [Escolher esta paróquia], sem [Solicitar ativação]', await p.$$eval('#dirRes .dir-card', l => { const c = l.find(x => /Santa Clara/.test(x.innerText)); return !!c && /Escolher esta paróquia/.test(c.innerText) && !/Solicitar ativação/.test(c.innerText); }));
  const sa = await aparelho(); const home = await texto(sa);
  t_('Home (Santo Antônio): contato geral discreto no rodapé, sem CTA de ativação', home.includes('Falar com a Central Paroquial') && !/Você representa esta paróquia|Solicitar ativação/.test(home));
  await ir(sa, 'contato'); const contato = await texto(sa);
  t_('Contato público (Santo Antônio): não expõe nome de pároco cadastrado internamente', !/Pe\. Antônio|Antônio Roberto|Pároco:/.test(contato), contato);
  await foto(sa, 'rodape-home-390');
}

console.log('== responsividade dos blocos novos');
for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1366, 768], [1920, 1080]]){
  const p = await aparelho({largura:w, altura:h}), falhas = [];
  await ir(p, 'escolher'); await buscar(p, 'paroquia que nao existe xyz');
  if (!(await p.$('#inclusao'))) falhas.push('sem bloco de inclusão');
  if (!(await semRolagemLateral(p))) falhas.push('inclusão: rolagem lateral');
  const b = await p.$$eval('#inclusao .btn', l => l.map(x => { const r = x.getBoundingClientRect(); return {l:r.left, r:r.right, h:r.height, w:innerWidth}; }));
  if (b.some(x => x.l < 0 || x.r > x.w + 1 || x.h < 40)) falhas.push('botões de inclusão fora da tela ou baixos: ' + JSON.stringify(b));
  await foto(p, `zero-resultados-${w}`);
  await abrirFicha(p, 'sao paulo da cruz');
  if (!(await p.$('#ativacao'))) falhas.push('sem CTA de ativação');
  if (!(await semRolagemLateral(p))) falhas.push('ativação: rolagem lateral');
  const rod = await p.$eval('.pub-rodape', f => { const r = f.getBoundingClientRect(); return {l:r.left, r:r.right, txt:f.innerText}; });
  if (rod.l < 0 || rod.r > await p.evaluate(() => innerWidth) + 1 || !rod.txt.includes('plataforma independente')) falhas.push('rodapé: ' + JSON.stringify(rod).slice(0, 120));
  await foto(p, `listed-ativacao-${w}`);
  await ir(p, 'igreja'); if (!(await semRolagemLateral(p))) falhas.push('home com rodapé: rolagem lateral');
  t_(`${w}: inclusão, ativação, contato e aviso sem overflow`, !falhas.length, falhas.join(' | '));
}

t_('sem erros de JS', !erros.length, erros.join(' | '));
console.log(`\n${ok} ok, ${falha} falha(s)`);
await browser.close(); process.exit(falha ? 1 : 0);
