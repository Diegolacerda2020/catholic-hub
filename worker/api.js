// Proxy /api/noticias. Ordem: fonte oficial (API → RSS → HTML, em worker/noticias.js) → espelho → último cache.
// Cache de 1 hora quando veio da fonte oficial; de 10 minutos quando veio do espelho (para tentar a fonte de novo logo).
// Hoje o portal manda o certificado intermediário errado e o runtime do Cloudflare recusa a conexão: aí entra o
// espelho noticias.json (branch "dados"). O navegador do fiel ainda tenta a API oficial direto quando a resposta
// daqui vier do espelho ou estiver velha (ver carregarNoticias no index.html).
// Campos internos na resposta: fonte, atualizadoEm (quando a lista foi extraída), obtidoEm (quando o Worker
// buscou), idadeMin (idade da lista em minutos). Nada disso aparece para o fiel.
import { buscarNoticias } from './noticias.js';

export const ESPELHO = 'https://raw.githubusercontent.com/Diegolacerda2020/catholic-hub/dados/noticias.json';
async function buscarComEspelho(){
  try { return await buscarNoticias(); }
  catch(erroFonte){
    const r = await fetch(ESPELHO, {signal: AbortSignal.timeout(8000)});
    if (!r.ok) throw erroFonte;
    const d = await r.json();
    if (!Array.isArray(d?.itens) || !d.itens.length) throw erroFonte;
    return {...d, fonte:'espelho:' + (d.fonte || '')};
  }
}

const FRESCO_MS = 60 * 60 * 1000, FRESCO_ESPELHO_MS = 10 * 60 * 1000;
const CHAVE = 'noticias-arquidiocese-v1';
const CACHE_REQ = new Request('https://central-paroquial.internal/' + CHAVE);
const CORS = {'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, OPTIONS'};
let memoria = null; // cache da instância; KV (opcional) e Cache API dão persistência entre instâncias

const json = (dados, status = 200, extra = {}) => new Response(JSON.stringify(dados), {status, headers:{'content-type':'application/json; charset=utf-8', ...CORS, ...extra}});
const quando = d => d.obtidoEm || d.atualizadoEm; // obtidoEm: quando o Worker buscou (o espelho pode ter atualizadoEm antigo)
const fresco = d => d && Date.now() - Date.parse(quando(d)) < (String(d.fonte).startsWith('espelho') ? FRESCO_ESPELHO_MS : FRESCO_MS);
const comIdade = d => ({...d, idadeMin: d.atualizadoEm ? Math.max(0, Math.round((Date.now() - Date.parse(d.atualizadoEm)) / 60000)) : null});

async function lerCache(env){
  let achado = memoria;
  try { if (!fresco(achado) && env.NOTICIAS_CACHE){ const v = await env.NOTICIAS_CACHE.get(CHAVE, 'json'); if (v && (!achado || quando(v) > quando(achado))) achado = v; } } catch(e){}
  try { if (!fresco(achado)){ const r = await caches.default.match(CACHE_REQ); if (r){ const v = await r.json(); if (!achado || quando(v) > quando(achado)) achado = v; } } } catch(e){}
  return memoria = achado;
}
async function gravarCache(env, dados){
  memoria = dados;
  const texto = JSON.stringify(dados);
  await Promise.allSettled([
    env.NOTICIAS_CACHE?.put(CHAVE, texto),
    caches.default.put(CACHE_REQ, new Response(texto, {headers:{'content-type':'application/json', 'cache-control':'public, max-age=2592000'}}))
  ]);
}

export async function responderNoticias(request, env, ctx, buscar = buscarComEspelho){
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:CORS});
  if (request.method !== 'GET') return json({erro:'Método não permitido'}, 405);
  const salvo = await lerCache(env);
  if (fresco(salvo)) return json(comIdade(salvo), 200, {'cache-control':'public, max-age=600', 'x-cache':'HIT'});
  try {
    const novo = {...await buscar(), obtidoEm:new Date().toISOString()};
    ctx.waitUntil(gravarCache(env, novo));
    return json(comIdade(novo), 200, {'cache-control':'public, max-age=600', 'x-cache':'MISS'});
  } catch(e){
    console.warn('Notícias: fonte indisponível', e?.message);
    if (salvo) return json(comIdade({...salvo, desatualizado:true}), 200, {'cache-control':'public, max-age=300', 'x-cache':'STALE'});
    return json({itens:[], erro:'Fonte indisponível no momento', origem:{nome:'Arquidiocese de Belo Horizonte', url:'https://arquidiocesebh.org.br/noticias/'}}, 503, {'cache-control':'no-store'});
  }
}
