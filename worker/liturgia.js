// Liturgia do dia (/api/liturgia?data=AAAA-MM-DD): só metadados (celebração, tempo, cor e REFERÊNCIAS
// bíblicas). Nunca o texto das leituras: o texto oficial fica no site da Edições CNBB, com link na página.
//
// Fonte: variável LITURGIA_URL do Worker (Cloudflare > Workers > central-paroquial > Settings > Variables),
// um endereço com {data} que devolva JSON neste formato (uso autorizado pela fonte):
//   {"celebracao":"Sexta-feira da 25ª Semana do Tempo Comum", "tempo":"Tempo Comum", "cor":"verde",
//    "leituras":[{"tipo":"1ª leitura","ref":"Ecl 3,1-11"}, {"tipo":"Salmo","ref":"Sl 143"}, {"tipo":"Evangelho","ref":"Lc 9,18-22"}]}
// Sem fonte configurada, ou se ela falhar, responde {disponivel:false} e a página usa o calendário local.
// Não usamos a API interna do site da CNBB: ela recusa acesso de terceiros (HTTP 403).

const CORS = {'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, OPTIONS'};
const CORES = ['verde','roxo','branco','vermelho','rosa','preto'];
const TIPOS = ['1ª leitura','Salmo','2ª leitura','Evangelho','Leitura','Aclamação'];
const json = (dados, status = 200, cache = 'public, max-age=1800') => new Response(JSON.stringify(dados), {status, headers:{'content-type':'application/json; charset=utf-8', 'cache-control':cache, ...CORS}});
const curto = (s, max) => typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const hojeSP = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo'}).format(new Date());

// Aceita só o que é metadado: textos curtos, referências no formato bíblico, cor e tipos conhecidos.
export function limparLiturgia(d, data){
  if (!d || typeof d !== 'object' || !Array.isArray(d.leituras)) return null;
  const leituras = d.leituras.map(x => ({tipo:curto(x?.tipo, 20), ref:curto(x?.ref, 60)}))
    .filter(x => TIPOS.includes(x.tipo) && /^[\p{L}\d][\p{L}\d .,;:–—\-()]*$/u.test(x.ref))
    .slice(0, 6);
  if (!leituras.length) return null;
  const cor = curto(d.cor, 12).toLowerCase();
  return {disponivel:true, data, celebracao:curto(d.celebracao, 140), tempo:curto(d.tempo, 60), cor:CORES.includes(cor) ? cor : '', leituras,
    fonte:{nome:'Liturgia Diária – Edições CNBB', url:'https://liturgiadiaria.edicoescnbb.com.br/'}};
}

export async function responderLiturgia(request, env, ctx, f = fetch){
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:CORS});
  if (request.method !== 'GET') return json({erro:'Método não permitido'}, 405, 'no-store');
  const pedida = new URL(request.url).searchParams.get('data') || '';
  const data = /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : hojeSP();
  if (!env?.LITURGIA_URL) return json({disponivel:false, data, motivo:'sem-fonte'});
  const chave = new Request('https://central-paroquial.internal/liturgia/' + data);
  try { const c = await caches.default.match(chave); if (c) return json(await c.json()); } catch(e){}
  try {
    const r = await f(env.LITURGIA_URL.replace('{data}', data), {headers:{accept:'application/json'}, signal:AbortSignal.timeout(8000)});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const limpo = limparLiturgia(await r.json(), data);
    if (!limpo) throw new Error('formato inesperado');
    ctx?.waitUntil?.(caches.default.put(chave, new Response(JSON.stringify(limpo), {headers:{'cache-control':'public, max-age=21600'}})).catch(() => {}));
    return json(limpo);
  } catch(e){
    console.warn('Liturgia: fonte indisponível', e?.message);
    return json({disponivel:false, data, motivo:'fonte-indisponivel'}, 200, 'public, max-age=300');
  }
}
