// Proxy /api/noticias. Cache de ~1 hora. Se a fonte cair, devolve o último resultado válido (marcado como desatualizado).
import { buscarNoticias } from './noticias.js';

const FRESCO_MS = 60 * 60 * 1000;
const CHAVE = 'noticias-arquidiocese-v1';
const CACHE_REQ = new Request('https://central-paroquial.internal/' + CHAVE);
const CORS = {'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, OPTIONS'};
let memoria = null; // cache da instância; KV (opcional) e Cache API dão persistência entre instâncias

const json = (dados, status = 200, extra = {}) => new Response(JSON.stringify(dados), {status, headers:{'content-type':'application/json; charset=utf-8', ...CORS, ...extra}});
const fresco = d => d && Date.now() - Date.parse(d.atualizadoEm) < FRESCO_MS;

async function lerCache(env){
  let achado = memoria;
  try { if (!fresco(achado) && env.NOTICIAS_CACHE){ const v = await env.NOTICIAS_CACHE.get(CHAVE, 'json'); if (v && (!achado || v.atualizadoEm > achado.atualizadoEm)) achado = v; } } catch(e){}
  try { if (!fresco(achado)){ const r = await caches.default.match(CACHE_REQ); if (r){ const v = await r.json(); if (!achado || v.atualizadoEm > achado.atualizadoEm) achado = v; } } } catch(e){}
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

export async function responderNoticias(request, env, ctx, buscar = buscarNoticias){
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:CORS});
  if (request.method !== 'GET') return json({erro:'Método não permitido'}, 405);
  const salvo = await lerCache(env);
  if (fresco(salvo)) return json(salvo, 200, {'cache-control':'public, max-age=600', 'x-cache':'HIT'});
  try {
    const novo = await buscar();
    ctx.waitUntil(gravarCache(env, novo));
    return json(novo, 200, {'cache-control':'public, max-age=600', 'x-cache':'MISS'});
  } catch(e){
    console.warn('Notícias: fonte indisponível', e?.message);
    if (salvo) return json({...salvo, desatualizado:true}, 200, {'cache-control':'public, max-age=300', 'x-cache':'STALE'});
    return json({itens:[], erro:'Fonte indisponível no momento', origem:{nome:'Arquidiocese de Belo Horizonte', url:'https://arquidiocesebh.org.br/noticias/'}}, 503, {'cache-control':'no-store'});
  }
}
