// Onboarding público e "Minha paróquia". Não usa Supabase real.
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {criarBackend, CLIENTE} from './supabase-falso.mjs';
import {esperar} from './ui.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const TIPOS = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json'};
const PORTA = 8814;
const SA = 'santo-antonio-jaragua';
const SC = 'santa-clara-e-sao-francisco-mineirao';
const NG = 'nossa-senhora-das-gracas-ibirite';
const PREF = 'central_paroquial_minha_paroquia';
const CLI = CLIENTE.replace('gte(){ return b; },', 'gte(){ return b; }, order(){ return b; }, limit(){ return b; },');

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/config.js'){
    res.writeHead(200, {'content-type':TIPOS['.js']});
    return res.end(`window.CENTRAL_CONFIG = {supabase:{url:"https://fake.supabase.co", anonKey:"x"}, parishSlug:"${SA}", noticiasOficial:"", noticiasEspelho:"", contato:{email:"suporte.thunderdynamics@gmail.com", whatsapp:"5531997509221"}};`);
  }
  if (u.pathname === '/api/noticias' || u.pathname === '/api/liturgia'){ res.writeHead(404); return res.end(); }
  const f = path.join(REPO, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.resolve(REPO)) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'content-type':TIPOS[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
await new Promise(ok => srv.listen(PORTA, ok));

const {op} = criarBackend({});
const browser = await puppeteer.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
let ok = 0, falha = 0;
const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 400)); };

async function pagina({url = '/', ctx = null, largura = 390, altura = 844} = {}){
  const c = ctx || await browser.createBrowserContext();
  const p = await c.newPage();
  await p.setViewport({width:largura, height:altura, deviceScaleFactor:1});
  await p.exposeFunction('__sb', q => op(q));
  await p.evaluateOnNewDocument(CLI);
  p.erros = [];
  p.on('pageerror', e => p.erros.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) p.erros.push(m.text()); });
  await p.goto(`http://localhost:${PORTA}${url}`, {waitUntil:'networkidle0', timeout:60000});
  await esperar(500);
  p.ctx = c;
  return p;
}
const texto = p => p.evaluate(() => document.getElementById('view').innerText);
const cab = p => p.evaluate(() => document.querySelector('header.top').innerText);
const pref = p => p.evaluate(k => localStorage.getItem(k), PREF);
async function buscar(p, q){
  await p.click('#buscaPar', {clickCount:3});
  await p.type('#buscaPar', q);
  await esperar(900);
}
async function escolher(p, slug){
  await Promise.all([
    p.waitForNavigation({waitUntil:'networkidle0', timeout:60000}).catch(() => null),
    p.click(`[data-dir-minha="${slug}"]`)
  ]);
  await esperar(700);
}

console.log('== Minha paróquia');
{
  const p = await pagina();
  const tx = await texto(p);
  t('caso 1: primeiro acesso mostra escolha, sem abrir Santo Antônio como Home', tx.includes('Qual é a sua paróquia?') && !tx.includes('Aviso de Santo Antônio'), tx);
  t('caso 1: sem erros de JS', !p.erros.length, p.erros.join(' | '));
}
{
  const p = await pagina();
  await buscar(p, 'jaragua');
  t('caso 2: busca jaragua encontra Santo Antônio', (await texto(p)).includes('Santo Antônio') && (await p.$(`[data-dir-minha="${SA}"]`)));
}
{
  const p = await pagina();
  await buscar(p, 'gracas');
  t('caso 3: busca sem acento gracas encontra Nossa Senhora das Graças', (await texto(p)).includes('Nossa Senhora das Graças') && (await p.$(`[data-dir-minha="${NG}"]`)));
}
{
  const p = await pagina();
  await buscar(p, 'mineirao');
  t('caso 4: busca mineirao encontra Santa Clara/São Francisco', (await texto(p)).includes('Santa Clara') && (await texto(p)).includes('São Francisco') && (await p.$(`[data-dir-minha="${SC}"]`)));
}
{
  const ctx = await browser.createBrowserContext();
  const p = await pagina({ctx});
  await buscar(p, 'mineirao');
  await escolher(p, SC);
  t('caso 5: escolher Santa Clara salva slug correto', await pref(p) === SC, await pref(p));
  t('caso 5: entra na Home da Santa Clara', (await texto(p)).includes('Santa Clara') && !(await texto(p)).includes('Qual é a sua paróquia?'));
  const q = await pagina({ctx});
  t('caso 6: nova abertura da raiz abre Santa Clara automaticamente', (await texto(q)).includes('Santa Clara') && !(await texto(q)).includes('Qual é a sua paróquia?'), await texto(q));
  await q.click('#trocarMinha');
  await esperar(300);
  await buscar(q, 'gracas');
  await escolher(q, NG);
  t('caso 7: troca para Graças atualiza preferência', await pref(q) === NG, await pref(q));
  const r = await pagina({ctx, url:`/?p=${SA}`});
  t('caso 8: visitar Santo Antônio não troca favorita Graças', await pref(r) === NG, await pref(r));
  t('caso 8: visita mostra ação explícita para tornar minha paróquia', (await texto(r)).includes('Tornar esta minha paróquia'));
}
{
  const ctx = await browser.createBrowserContext();
  const p = await pagina({ctx, url:`/?p=${SC}`});
  t('caso 9: link direto abre Santa Clara sem onboarding', (await cab(p)).includes('Santa Clara') && !(await texto(p)).includes('Qual é a sua paróquia?'), await texto(p));
  t('caso 9: link direto não salva favorita sozinho', await pref(p) === null, await pref(p));
}
{
  const ctx = await browser.createBrowserContext();
  const p0 = await pagina({ctx});
  await p0.evaluate(k => localStorage.setItem(k, 'paroquia-invalida'), PREF);
  const p = await pagina({ctx});
  await esperar(1000);
  t('caso 10: preferência inválida volta ao onboarding', (await texto(p)).includes('Qual é a sua paróquia?'), await texto(p));
}
{
  const p = await pagina();
  await buscar(p, 'cristo operario planalto');
  const tx = await texto(p);
  t('caso 11: listed/inativa não é tratada como Home ativa', tx.includes('Central Paroquial ainda não ativada') && !await p.$('[data-dir-minha]'), tx);
}
{
  const p = await pagina();
  await p.click('#semMinha');
  await esperar(500);
  t('caso 12: ainda não tenho uma paróquia abre exploração do diretório', (await texto(p)).includes('Encontre sua paróquia ou santuário') && await p.$('#buscaPar'));
}
{
  const ctx = await browser.createBrowserContext();
  const p = await pagina({ctx, url:`/?p=${SC}`});
  const sc = (await cab(p)) + '\n' + await texto(p);
  const q = await pagina({ctx, url:`/?p=${NG}`});
  const ng = (await cab(q)) + '\n' + await texto(q);
  t('caso 13: tenants não misturam nomes na Home', sc.includes('Santa Clara') && !sc.includes('Nossa Senhora das Graças') && ng.includes('Nossa Senhora das Graças') && !ng.includes('Santa Clara'), {sc, ng});
}

await browser.close();
srv.close();
console.log(`\nMinha paróquia: ${ok} ok, ${falha} falha(s)`);
if (falha) process.exit(1);
