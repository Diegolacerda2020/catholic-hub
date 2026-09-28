// Confere se as notícias que o Central Paroquial mostra estão em dia com o portal oficial da Arquidiocese.
// Uma requisição por fonte (nada de varredura). Sai com código 1 se alguma fonte estiver atrasada demais.
//
// O servidor do portal manda o certificado intermediário errado; o Node (como o Worker) recusa. Rode com:
//   NODE_EXTRA_CA_CERTS=scripts/certs/globalsign-rsa-ov-ssl-ca-2018.pem node scripts/conferir-noticias.mjs
// Uso: node scripts/conferir-noticias.mjs [URL do /api/noticias publicado]  [--limite-horas=6]
//   ex.: node scripts/conferir-noticias.mjs https://central-paroquial.<conta>.workers.dev/api/noticias
import { deApi, priorizar } from '../worker/noticias.js';
import { ESPELHO } from '../worker/api.js';

const OFICIAL = 'https://arquidiocesebh.org.br/wp-json/wp/v2/noticias?per_page=20';
const arg = process.argv.slice(2);
const LIMITE_H = +(arg.find(a => a.startsWith('--limite-horas='))?.split('=')[1] || 6);
const WORKER = arg.find(a => /^https?:/.test(a));

const pegar = async url => { const r = await fetch(url, {headers:{accept:'application/json', 'user-agent':'CentralParoquial/1.0 (conferencia)'}, signal:AbortSignal.timeout(15000)}); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const topo = itens => itens.map(i => i.data).sort().at(-1) || '';
const horas = (a, b) => (Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 3600e3;

let problema = false;
let oficial;
try {
  oficial = priorizar(deApi(await pegar(OFICIAL)));
  console.log(`Portal oficial: ${oficial.length} notícias; mais recente em ${topo(oficial)}: "${oficial[0]?.titulo}"`);
} catch(e){
  console.log(`Portal oficial indisponível daqui (${e.message}). Sem referência para comparar.`);
  process.exit(2);
}
for (const [nome, url] of [['Espelho (GitHub)', ESPELHO], ...(WORKER ? [['Worker publicado', WORKER]] : [])]){
  try {
    const d = await pegar(url), t = topo(d.itens || []);
    const atraso = horas(topo(oficial), t), atualizado = d.atualizadoEm ? ` · atualizadoEm ${d.atualizadoEm}` : '';
    const ruim = !t || atraso > LIMITE_H;
    problema ||= ruim;
    console.log(`${ruim ? 'ATRASADO' : 'ok      '} ${nome}: mais recente em ${t || '—'} (fonte ${d.fonte || '?'}${atualizado})${ruim ? ` — ${Math.round(atraso)} h atrás do portal` : ''}`);
  } catch(e){ problema = true; console.log(`FALHOU   ${nome}: ${e.message}`); }
}
process.exit(problema ? 1 : 0);
