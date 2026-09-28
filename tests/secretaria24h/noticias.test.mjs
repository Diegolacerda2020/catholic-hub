// Notícias: ordem (mais recente primeiro), cache do Worker e queda para o espelho. Sem internet.
import { priorizar, deApi } from '../../worker/noticias.js';
import { responderNoticias } from '../../worker/api.js';

let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 300)); };
const item = (data, titulo, classes = []) => ({Link:`https://arquidiocesebh.org.br/noticias/${titulo.toLowerCase().replace(/\W+/g, '-')}/`, Resumo:titulo, DataRegistro:data + 'T10:00:00', class_list:classes, Imagem:''});

console.log('== ordem');
const l = priorizar(deApi([item('2026-09-01', 'Rensc antiga', ['regiao-rensc']), item('2026-09-28', 'Geral de hoje'), item('2026-09-25', 'Rensc recente', ['regiao-rensc']), item('2026-09-28', 'Rensc de hoje', ['regiao-rensc'])]));
t('mais recente primeiro (a RENSC não passa na frente de notícia nova)', l.map(i => i.titulo).join(' | ') === 'Rensc de hoje | Geral de hoje | Rensc recente | Rensc antiga', l.map(i => i.titulo).join(' | '));
t('no mesmo dia, a RENSC desempata', l[0].rotulo === 'RENSC');

console.log('== Worker: cache e espelho');
const env = {}, ctx = {waitUntil: p => p};
globalThis.caches = {default:{match: async () => null, put: async () => {}}};
const req = new Request('https://x/api/noticias');
let chamadas = 0;
const doEspelho = async () => { chamadas++; return {fonte:'espelho:api', atualizadoEm:new Date(Date.now() - 72 * 3600e3).toISOString(), itens:[{titulo:'x', data:'2026-09-25', url:'https://arquidiocesebh.org.br/noticias/x/'}]}; };
let r = await (await responderNoticias(req, env, ctx, doEspelho)).json();
t('resposta traz fonte, obtidoEm, atualizadoEm e idade', r.fonte === 'espelho:api' && r.obtidoEm && r.atualizadoEm && r.idadeMin >= 72 * 60 - 1, JSON.stringify(r).slice(0, 200));
await responderNoticias(req, env, ctx, doEspelho);
t('lista do espelho fica em cache só 10 min (segunda chamada logo em seguida usa o cache)', chamadas === 1, chamadas);
const oficial = async () => { chamadas++; return {fonte:'api', atualizadoEm:new Date().toISOString(), itens:[{titulo:'nova', data:'2026-09-28', url:'https://arquidiocesebh.org.br/noticias/nova/'}]}; };
// envelhece o cache do espelho além de 10 min: o Worker tenta a fonte de novo
const velho = await (await responderNoticias(req, env, ctx, doEspelho)).json();
globalThis.Date.now = (n => () => n + 11 * 60e3)(Date.now());
r = await (await responderNoticias(req, env, ctx, oficial)).json();
t('depois de 10 min, tenta a fonte oficial de novo e fica com a lista nova', r.fonte === 'api' && r.itens[0].titulo === 'nova' && chamadas === 2, JSON.stringify({fonte:r.fonte, chamadas, antes:velho.fonte}));
const falhou = async () => { throw new Error('fora do ar'); };
globalThis.Date.now = (n => () => n + 2 * 3600e3)(Date.now());
r = await (await responderNoticias(req, env, ctx, falhou)).json();
t('fonte e espelho fora do ar: devolve a última lista boa, marcada como desatualizada', r.desatualizado === true && r.itens[0].titulo === 'nova');

console.log(`\n${ok} ok, ${falha} falha(s)`);
process.exit(falha ? 1 : 0);
