// Harness de UI: serve o repositório localmente e abre no Chrome headless.
// modo 'demo': config.js vazio (dados só no navegador). modo 'real': config.js do repositório (Supabase real, só leitura pública).
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export const REPO = path.resolve(process.env.REPO || (process.env.REPO || fileURLToPath(new URL('../..', import.meta.url))) + '');
const TIPOS = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json'};

export function servir(modo, porta){
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/config.js' && modo === 'demo'){ res.writeHead(200, {'content-type':TIPOS['.js']}); return res.end('window.CENTRAL_CONFIG = {supabase:{url:"",anonKey:""}, parishSlug:"santo-antonio-jaragua"};'); }
    if (u.pathname.startsWith('/api/')){ res.writeHead(404); return res.end(); }
    const f = path.join(REPO, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!f.startsWith(REPO) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
    res.writeHead(200, {'content-type': TIPOS[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
  });
  return new Promise(ok => srv.listen(porta, () => ok(srv)));
}

export async function abrir(url, {largura = 390} = {}){
  const browser = await puppeteer.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
  const page = await browser.newPage();
  await page.setViewport({width:largura, height:844, deviceScaleFactor:1});
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(url, {waitUntil:'networkidle0'});
  return {browser, page, erros};
}

export const esperar = ms => new Promise(r => setTimeout(r, ms));
export async function clicarTexto(page, seletor, texto){
  const ok = await page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find(e => e.textContent.replace(/\s+/g,' ').trim().includes(t)); if (!el) return false; el.click(); return true; }, seletor, texto);
  if (!ok) throw new Error(`não achei "${texto}" em ${seletor}`);
  await esperar(150);
}
export const texto = page => page.evaluate(() => document.getElementById('view').innerText);
export async function aba(page, rotulo){
  const naBarra = await page.evaluate(r => [...document.querySelectorAll("#tabs button")].some(b => b.textContent.includes(r)), rotulo);
  if (naBarra) return clicarTexto(page, "#tabs button", rotulo);
  await clicarTexto(page, "#tabs button", "Mais"); await clicarTexto(page, "[data-mais]", rotulo);
}
