// Notícias da Arquidiocese de Belo Horizonte (arquidiocesebh.org.br).
// Ordem das fontes (da mais estruturada para a menos):
//   1. API REST do WordPress (/wp-json/wp/v2/noticias): título, data, região/categoria, imagem, link
//   2. RSS (/noticias/feed/): resumo curto; também substitui a API se ela falhar
//   3. HTML da página /noticias/: só se a API e o RSS falharem
// Nunca copia a matéria: guarda só título, data, rótulo, resumo curto (até ~180 caracteres), imagem e link.

export const BASE = 'https://arquidiocesebh.org.br';
const API = BASE + '/wp-json/wp/v2/noticias?per_page=100';
const FEED = BASE + '/noticias/feed/';
const PAGINA = BASE + '/noticias/';
const MAX_ITENS = 12;
const MAX_RESUMO = 180;

const REGIOES = {rensc:'RENSC', rensa:'RENSA', rensb:'RENSB', rense:'RENSE', renser:'RENSER'};
const CATEGORIAS = {
  'categoria-noticias-santuario':'Santuários', 'categoria-noticias-santuarios':'Santuários',
  'categoria-noticias-catedral-cristo-rei':'Catedral Cristo Rei', 'categoria-noticias-memorial-arquidiocese':'Memorial da Arquidiocese',
  'category-comdeus-podcast-da-arquidiocese-de-bh':'ComDeus'
};

const ENTIDADES = {amp:'&', quot:'"', apos:"'", lt:'<', gt:'>', nbsp:' ', hellip:'…', ndash:'–', mdash:'—', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”', laquo:'«', raquo:'»', ordm:'º', ordf:'ª'};
export const decodificar = s => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m);
const texto = html => decodificar(String(html ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function resumoCurto(html){
  let t = texto(html)
    .replace(/\s*The post .*$/i, '').replace(/\s*O post .* apareceu primeiro em .*$/i, '')
    .replace(/\s*\[(…|\.\.\.)\]\s*$/, '').replace(/\s*Fonte\s*$/, '').trim();
  if (t.length > MAX_RESUMO) t = t.slice(0, MAX_RESUMO).replace(/\s+\S*$/, '').replace(/[,;:.\s–—-]+$/, '') + '…';
  return t;
}
// Link canônico da notícia (sem ?app=1 etc.); só aceita páginas do próprio portal.
export function linkNoticia(u){
  try { const x = new URL(String(u).trim()); if (x.origin !== BASE) return ''; x.search = ''; x.hash = ''; return x.href; } catch(e){ return ''; }
}
const imagemSegura = u => { try { const x = new URL(String(u).trim()); return x.origin === BASE ? x.href : ''; } catch(e){ return ''; } };
const dataBR = iso => iso ? iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4) : '';

// prioridade: 0 = RENSC, 1 = geral da Arquidiocese, 2 = demais regiões/categorias
function classificar(classes){
  const reg = classes.map(c => (c.match(/^regiao-([\w-]+)$/) || [])[1]).find(Boolean);
  if (reg) return {rotulo: REGIOES[reg] || reg.toUpperCase(), prioridade: reg === 'rensc' ? 0 : 2};
  const cat = classes.find(c => CATEGORIAS[c]);
  if (cat) return {rotulo: CATEGORIAS[cat], prioridade: 2};
  return {rotulo:'Arquidiocese', prioridade:1};
}

export function deApi(lista){
  if (!Array.isArray(lista)) return [];
  return lista.map(x => {
    const url = linkNoticia(x?.Link), titulo = texto(x?.Resumo);
    const iso = /^\d{4}-\d{2}-\d{2}/.test(x?.DataRegistro || '') ? x.DataRegistro.slice(0,10) : '';
    if (!url || !titulo || !iso) return null;
    return {titulo, data:iso, dataTexto:dataBR(iso), ...classificar(Array.isArray(x.class_list) ? x.class_list : []), resumo:'', imagem:imagemSegura(x.Imagem), url};
  }).filter(Boolean);
}

export function deRss(xml){
  return String(xml ?? '').split(/<item>/).slice(1).map(bloco => {
    const tag = t => (bloco.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
    const url = linkNoticia(texto(tag('link'))), titulo = texto(tag('title'));
    const quando = new Date(texto(tag('pubDate')));
    if (!url || !titulo || isNaN(quando)) return null;
    const iso = new Date(quando.getTime() - 3*3600e3).toISOString().slice(0,10); // horário de Brasília
    return {titulo, data:iso, dataTexto:dataBR(iso), rotulo:'Arquidiocese', prioridade:1, resumo:resumoCurto(tag('description')), imagem:'', url};
  }).filter(Boolean);
}

export function deHtml(html){
  return String(html ?? '').split(/<li class="col-md-6/).slice(1).map(bloco => {
    const url = linkNoticia((bloco.match(/href="(https:\/\/arquidiocesebh\.org\.br\/noticias\/[^"]+)"/) || [])[1] || '');
    const titulo = texto((bloco.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
    const d = (bloco.match(/data-relacionada">\s*(\d{2})\/(\d{2})\/(\d{4})/) || []);
    if (!url || !titulo || !d[0]) return null;
    const iso = `${d[3]}-${d[2]}-${d[1]}`;
    const reg = (bloco.match(/\/regiao\/([\w-]+)"/) || [])[1];
    return {titulo, data:iso, dataTexto:dataBR(iso), ...classificar(reg ? ['regiao-'+reg] : []), resumo:'', imagem:imagemSegura((bloco.match(/<img[^>]+src="([^"]+)"/) || [])[1] || ''), url};
  }).filter(Boolean);
}

export function priorizar(itens){
  const vistos = new Set();
  return itens.filter(i => !vistos.has(i.url) && vistos.add(i.url))
    .sort((a, b) => a.prioridade - b.prioridade || b.data.localeCompare(a.data))
    .slice(0, MAX_ITENS);
}

export async function buscarNoticias(f = fetch){
  const pedir = async (url, tipo) => {
    const r = await f(url, {headers:{'user-agent':'CentralParoquial/1.0 (+https://diegolacerda2020.github.io/catholic-hub/)', accept: tipo}, signal: AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return tipo === 'application/json' ? r.json() : r.text();
  };
  const [api, ...feeds] = await Promise.allSettled([
    pedir(API, 'application/json'),
    ...[1, 2, 3].map(p => pedir(p > 1 ? `${FEED}?paged=${p}` : FEED, 'application/rss+xml'))
  ]);
  const doRss = feeds.flatMap(r => r.status === 'fulfilled' ? deRss(r.value) : []);
  const resumos = new Map(doRss.map(i => [i.url, i.resumo]));
  let itens = api.status === 'fulfilled' ? deApi(api.value) : [], fonte = 'api';
  if (!itens.length && doRss.length){ itens = doRss; fonte = 'rss'; }
  if (!itens.length){ itens = deHtml(await pedir(PAGINA, 'text/html')); fonte = 'html'; }
  if (!itens.length) throw new Error('Nenhuma notícia encontrada na fonte');
  itens.forEach(i => { if (!i.resumo && resumos.get(i.url)) i.resumo = resumos.get(i.url); });
  return {fonte, atualizadoEm:new Date().toISOString(), origem:{nome:'Arquidiocese de Belo Horizonte', url:PAGINA}, itens:priorizar(itens)};
}
