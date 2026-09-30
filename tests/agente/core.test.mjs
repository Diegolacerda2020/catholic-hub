// Núcleo do Assistente (agente-core.js) com um backend em memória: interpretação, permissões por papel,
// confirmação humana, multi-paróquia, comunidades reais, linguagem humana e auditoria mínima.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../../agente-core.js');

let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500)); };
const texto = r => [...(r.linhas || []), ...(r.itens || []).flatMap(i => [i.titulo, i.detalhe]), ...(r.rodape || []),
  ...(r.confirmacao ? [r.confirmacao.titulo, ...r.confirmacao.campos.flat(), ...(r.confirmacao.avisos || []), r.confirmacao.nota || ''] : []),
  ...(r.acoes || []).map(a => a.rotulo), ...(r.sugestoes || [])].join('\n');
// O usuário nunca vê termos técnicos nem identificadores
const TECNICO = /\b(rpc|json|uuid|intent|tool|tenant|sql|parish_id|null|undefined|supabase|select|insert|service_requests|staff_update)\b|[0-9a-f]{8}-[0-9a-f]{4}-|\[object/i;

// ---------- banco em memória, com 2 paróquias ----------
const SC = 'p-sc', SA = 'p-sa';
function banco(){
  const B = {
    events:[{id:'e1', parish_id:SC, title:'Missa das Famílias', starts_at:'2026-10-01T22:00:00.000Z', ends_at:null, location:'Matriz', community_id:null, public:true, cancelled:false},
            {id:'e2', parish_id:SC, title:'Evento cancelado', starts_at:'2026-10-01T23:00:00.000Z', location:'', community_id:null, public:true, cancelled:true},
            {id:'e3', parish_id:SA, title:'Evento de Santo Antônio', starts_at:'2026-10-01T22:00:00.000Z', location:'', community_id:null, public:true, cancelled:false}],
    communities:{[SC]:[], [SA]:[{id:'c1', parish_id:SA, name:'Comunidade São José', active:true}, {id:'c2', parish_id:SA, name:'Comunidade São José Operário', active:true}, {id:'c3', parish_id:SA, name:'Capela Nossa Senhora Aparecida', active:true}]},
    requests:{[SC]:[
      {id:'r1', protocol:'SA-2026-0000000A', status:'new', service_title:'Batismo', created_at:'2026-09-29T12:00:00Z', is_demo:false},
      {id:'r2', protocol:'SA-2026-0000000B', status:'new', service_title:'Certidão', created_at:'2026-09-29T13:00:00Z', is_demo:false},
      {id:'r3', protocol:'SA-2026-0000000C', status:'in_progress', service_title:'Catequese', created_at:'2026-09-28T13:00:00Z', is_demo:false},
      {id:'r4', protocol:'SA-2026-0000000D', status:'waiting_user', service_title:'Matrimônio', created_at:'2026-09-27T13:00:00Z', is_demo:false},
      {id:'r5', protocol:'SA-2026-0000000E', status:'completed', service_title:'Outro assunto', created_at:'2026-09-20T13:00:00Z', is_demo:false}],
      [SA]:[{id:'rsa', protocol:'SA-2026-AAAAAAAA', status:'new', service_title:'Batismo', created_at:'2026-09-29T12:00:00Z'}]},
    gravacoes:[], auditoria:[]
  };
  const backend = {
    async listarEventos({parishId, inicio, fim}){ return B.events.filter(e => e.parish_id === parishId && e.starts_at >= inicio && e.starts_at < fim); },
    async listarComunidades({parishId}){ return B.communities[parishId] || []; },
    async listarServicos({slug}){ return slug === 'sc' ? [{code:'batismo', title:'Batismo', description:'Primeiras orientações.'}] : []; },
    async listarSolicitacoes({parishId}){ return structuredClone(B.requests[parishId] || []); },
    async criarEvento({parishId, evento}){ B.gravacoes.push({tipo:'evento', parishId, evento}); B.events.push({...evento, id:'novo' + B.gravacoes.length}); return {title:evento.title}; },
    async atualizarSolicitacao({parishId, requestId, status}){ B.gravacoes.push({tipo:'status', parishId, requestId, status}); for (const l of Object.values(B.requests)) for (const r of l) if (r.id === requestId) r.status = status; return {status}; },
    async auditar(a){ B.auditoria.push(a); },
    async paroquiasConhecidas(){ return [{nome:'Santo Antônio'}, {nome:'Santa Clara e São Francisco'}, {nome:'Nossa Senhora das Graças'}]; },
    async horariosMissa(){ return 'Quinta-feira: 19h\nSábado: 18h00\nDomingo: 07h30, 09h30 e 18h00'; }
  };
  return {B, backend};
}
let AGORA = new Date('2026-09-30T13:00:00-03:00'); // quarta-feira
const {B, backend} = banco();
const ag = Core.criarAgente({backend, agora:() => AGORA});
const ent = (papel, parish = SC, extra = {}) => ({channel:'painel', sender:{userId:'u-' + papel + '-' + parish, papel},
  parish:parish === SC ? {id:SC, slug:'sc', nome:'Paróquia Santa Clara e São Francisco – Mineirão'} : {id:SA, slug:'sa', nome:'Paróquia Santo Antônio – Jaraguá'}, timestamp:AGORA.toISOString(), ...extra});
const diga = (papel, message, parish, extra) => ag.receber({...ent(papel, parish, extra), message});

console.log('== consultas (VERDE)');
let r = await diga('secretaria', 'O que temos amanhã?');
t('agenda de amanhã: só eventos desta paróquia e não cancelados', r.itens?.length === 1 && r.itens[0].titulo === 'Missa das Famílias' && !texto(r).includes('Santo Antônio') && !texto(r).includes('cancelado'), texto(r));
t('agenda traz horário de missa do dia (Ajustes)', texto(r).includes('19h'), texto(r));
t('agenda em linguagem humana, sem termos técnicos', !TECNICO.test(texto(r)), texto(r));
r = await diga('secretaria', 'Mostre os eventos desta semana.');
t('eventos da semana', r.tipo === 'resposta' && /nesta semana/i.test(texto(r)), texto(r));
r = await diga('secretaria', 'Quais comunidades estão cadastradas?');
t('Santa Clara sem comunidades: não inventa', texto(r).includes('Esta paróquia ainda não possui comunidades cadastradas.') && !r.itens, texto(r));
t('nenhum nome fictício de comunidade', !/São José|São Francisco \(|Comunidade /.test(texto(r).replace('comunidades cadastradas', '')), texto(r));
r = await diga('padre', 'Quais comunidades estão cadastradas?', SA);
t('Santo Antônio lista só as comunidades reais dele', r.itens?.length === 3 && r.itens.every(i => /São José|Aparecida/.test(i.titulo)), texto(r));
r = await diga('secretaria', 'Agenda da comunidade São Pedro desta semana', SA);
t('comunidade inexistente: informa, não inventa', texto(r).includes('Não encontrei a comunidade “São Pedro”'), texto(r));
r = await diga('secretaria', 'Agenda da comunidade São José desta semana', SA);
t('nome exato vence o parecido (São José, não São José Operário)', /na Comunidade São José nesta semana/.test(texto(r)), texto(r));
r = await diga('secretaria', 'Agenda da comunidade José desta semana', SA);
t('comunidade ambígua: pergunta qual, sem escolher sozinho', /Encontrei 2 comunidades parecidas. Qual delas\?/.test(texto(r)) && r.acoes.length === 2, texto(r));
r = await diga('secretaria', 'Quais serviços da secretaria estão disponíveis?');
t('serviços do catálogo público da paróquia da sessão', r.itens?.[0]?.titulo === 'Batismo', texto(r));

console.log('== Secretaria 24h');
r = await diga('secretaria', 'Quais solicitações estão pendentes?');
t('pendentes: 4 (2 novas, 1 em atendimento, 1 aguardando o fiel)', texto(r).includes('Encontrei 4 solicitações pendentes') && texto(r).includes('• 2 novas') && texto(r).includes('• 1 em atendimento') && texto(r).includes('• 1 aguardando o fiel'), texto(r));
t('oferece abrir as novas', texto(r).includes('Quer que eu abra as novas?') && r.acoes.some(a => a.tipo === 'abrir_fila' && a.valor === 'new'), texto(r));
t('lista sem nome/telefone do fiel e sem ids visíveis', !TECNICO.test(texto(r)), texto(r));
r = await diga('secretaria', 'Mostre as solicitações aguardando o fiel.');
t('aguardando o fiel: 1 (estado real waiting_user)', r.itens?.length === 1 && r.itens[0].detalhe.includes('SA-2026-0000000D'), texto(r));
r = await diga('secretaria', 'Quais pedidos temos pendentes?', SA);
t('Santo Antônio vê só as dele', r.itens?.length === 1 && r.itens[0].detalhe.includes('SA-2026-AAAAAAAA'), texto(r));
r = await diga('secretaria', 'Mostre a solicitação SA-2026-AAAAAAAA');
t('protocolo de outra paróquia: "não encontrei nesta paróquia"', texto(r).includes('Não encontrei essa solicitação nesta paróquia'), texto(r));

console.log('== PASCOM não herda Secretaria 24h');
r = await diga('pascom', 'Quais solicitações estão pendentes?');
t('PASCOM: solicitações negadas', r.tipo === 'negado' && /não tem acesso/.test(texto(r)), texto(r));
r = await diga('pascom', 'Marque SA-2026-0000000A como em atendimento');
t('PASCOM: mudança de status negada', r.tipo === 'negado', texto(r));
t('PASCOM: nada gravado', B.gravacoes.length === 0);
r = await diga('pascom', 'Crie missa sábado às 19h');
t('PASCOM pode preparar evento (área agenda real)', r.tipo === 'confirmacao', texto(r));
await ag.cancelar({...ent('pascom'), confirmacaoId:r.confirmacao.id});

console.log('== evento: preparar → confirmar → executar (AMARELO)');
r = await diga('secretaria', 'Crie um evento sábado às 19h.');
t('evento sem título: prepara e pede o título', r.tipo === 'confirmacao' && r.confirmacao.faltando.includes('titulo'), texto(r));
t('não grava antes da confirmação', B.gravacoes.length === 0);
let c = await ag.confirmar({...ent('secretaria'), confirmacaoId:r.confirmacao.id});
t('confirmar com dado faltando não grava', B.gravacoes.length === 0 && /faltam/.test(texto(c)), texto(c));
r = await ag.corrigir({...ent('secretaria'), confirmacaoId:r.confirmacao.id}, {titulo:'Missa da Juventude', local:'Matriz'});
t('corrigir gera nova confirmação completa', r.tipo === 'confirmacao' && !r.confirmacao.faltando.length, texto(r));
const campos = Object.fromEntries(r.confirmacao.campos);
t('cartão mostra Evento, Data, Horário, Local, Comunidade, Visibilidade', ['Evento','Data','Horário','Local','Comunidade','Visibilidade'].every(k => k in campos) && campos.Horário === '19h' && /sábado, 3 de outubro/i.test(campos.Data), campos);
t('ainda não gravou', B.gravacoes.length === 0);
const idConf = r.confirmacao.id;
c = await ag.confirmar({...ent('padre'), confirmacaoId:idConf});
t('outro usuário não confirma a ação de outra pessoa', c.tipo === 'negado' && B.gravacoes.length === 0, texto(c));
c = await ag.confirmar({...ent('secretaria', SA, {sender:{userId:'u-secretaria-' + SC, papel:'secretaria'}}), confirmacaoId:idConf});
t('mesma pessoa em outra paróquia não confirma', c.tipo === 'negado' && B.gravacoes.length === 0, texto(c));
c = await ag.confirmar({...ent('secretaria', SC, {channel:'whatsapp'}), confirmacaoId:idConf});
t('outro canal não confirma', c.tipo === 'negado' && B.gravacoes.length === 0, texto(c));
c = await ag.confirmar({...ent('secretaria'), confirmacaoId:idConf});
t('grava após confirmação válida', c.tipo === 'feito' && B.gravacoes.length === 1, texto(c));
t('mensagem final humana', /Pronto! O evento “Missa da Juventude” foi criado para sábado, 3 de outubro, às 19h\./.test(texto(c)) && !TECNICO.test(texto(c)), texto(c));
const g = B.gravacoes[0];
t('evento na paróquia da sessão, com origem "agente"', g.parishId === SC && g.evento.parish_id === SC && g.evento.source === 'agente' && g.evento.title === 'Missa da Juventude' && g.evento.scope === 'parish' && g.evento.community_id === null, g);
t('horário em Brasília (19h = 22h UTC)', g.evento.starts_at === '2026-10-03T22:00:00.000Z', g.evento.starts_at);
t('modelo do evento pronto para Google Agenda (google_event_id)', 'google_event_id' in g.evento && 'description' in g.evento && 'ends_at' in g.evento && 'public' in g.evento);
c = await ag.confirmar({...ent('secretaria'), confirmacaoId:idConf});
t('confirmar 2x não cria 2 eventos', B.gravacoes.length === 1 && /não vale mais/.test(texto(c)), texto(c));

r = await diga('secretaria', 'Crie missa amanhã às 7h');
AGORA = new Date(AGORA.getTime() + 11 * 60e3);
c = await ag.confirmar({...ent('secretaria'), confirmacaoId:r.confirmacao.id});
t('confirmação expira (10 min)', /expirou/.test(texto(c)) && B.gravacoes.length === 1, texto(c));
AGORA = new Date('2026-09-30T13:00:00-03:00');
r = await diga('secretaria', 'Crie missa hoje às 8h');
t('data/hora passada não pode ser confirmada', r.confirmacao.faltando.includes('dia') && /já passaram/.test(texto(r)), texto(r));

r = await diga('secretaria', 'Crie missa sábado às 19h na comunidade São José');
t('comunidade inexistente em Santa Clara: não inventa, pede escolha', r.confirmacao.faltando.includes('comunidade') && /ainda não possui comunidades cadastradas/.test(texto(r)) && r.confirmacao.editar.comunidades.length === 0, texto(r));
r = await ag.corrigir({...ent('secretaria'), confirmacaoId:r.confirmacao.id}, {comunidadeId:'c1'});
t('não aceita comunidade de outra paróquia no "Corrigir"', r.confirmacao.faltando.includes('comunidade'), texto(r));
r = await diga('secretaria', 'Crie missa sábado às 19h na comunidade Aparecida', SA);
t('comunidade real resolvida pelo nome (Santo Antônio)', !r.confirmacao.faltando.length && Object.fromEntries(r.confirmacao.campos).Comunidade === 'Capela Nossa Senhora Aparecida', texto(r));
c = await ag.confirmar({...ent('secretaria', SA), confirmacaoId:r.confirmacao.id});
t('evento de comunidade gravado com community_id real', B.gravacoes[1]?.evento.community_id === 'c3' && B.gravacoes[1].evento.scope === 'community' && B.gravacoes[1].parishId === SA, B.gravacoes[1]);

console.log('== solicitação: preparar → confirmar → executar');
const antesSt = B.gravacoes.length;
r = await diga('secretaria', 'Marque esta solicitação como concluída.');
t('"esta" = a única solicitação mostrada antes (e o cartão mostra o protocolo)', r.tipo === 'confirmacao' && Object.fromEntries(r.confirmacao.campos).Protocolo === 'SA-2026-0000000D', texto(r));
await ag.cancelar({...ent('secretaria'), confirmacaoId:r.confirmacao.id});
r = await diga('padre', 'Marque esta solicitação como em atendimento.');
t('"esta" sem solicitação em foco: pergunta qual', r.tipo === 'resposta' && /Qual solicitação/.test(texto(r)) && B.gravacoes.length === antesSt, texto(r));
const r2 = r.itens.find(i => i.detalhe.includes('SA-2026-0000000B'));
r = await ag.focar(ent('padre'), r2.acoes.find(a => a.tipo === 'focar').valor);
t('"Usar esta" foca a solicitação', /SA-2026-0000000B/.test(texto(r)), texto(r));
r = await diga('padre', 'Marque esta solicitação como em atendimento.');
t('prepara a mudança com estados reais', r.tipo === 'confirmacao' && Object.fromEntries(r.confirmacao.campos)['Nova situação'] === 'Em atendimento' && Object.fromEntries(r.confirmacao.campos)['Situação atual'] === 'Recebida', texto(r));
t('mudança não ocorre antes da confirmação', B.gravacoes.length === antesSt && B.requests[SC][1].status === 'new');
r = await ag.corrigir({...ent('padre'), confirmacaoId:r.confirmacao.id}, {status:'inventado'});
t('não aceita estado inventado', /situação diferente/.test(texto(r)) && B.gravacoes.length === antesSt, texto(r));
r = await diga('padre', 'Marque esta solicitação como aguardando o fiel');
c = await ag.confirmar({...ent('padre'), confirmacaoId:r.confirmacao.id});
t('muda após confirmação', c.tipo === 'feito' && B.requests[SC][1].status === 'waiting_user' && B.gravacoes.at(-1).status === 'waiting_user', texto(c));
r = await diga('secretaria', 'Marque SA-2026-AAAAAAAA como concluída');
t('protocolo de outra paróquia: não prepara', r.tipo !== 'confirmacao' && /Não encontrei/.test(texto(r)), texto(r));

console.log('== multi-paróquia pelo texto');
for (const f of ['Mostre Santo Antônio.', 'Quais solicitações de Nossa Senhora das Graças estão pendentes?', 'Mostre as solicitações da paróquia São Pedro', 'Crie missa sábado 19h na paróquia Santo Antônio']){
  r = await diga('secretaria', f);
  t(`Santa Clara: "${f}" → negado`, r.tipo === 'negado' && /só com os dados da Paróquia Santa Clara/.test(texto(r)), texto(r));
}
r = await diga('secretaria', 'Mostre Santo Antônio.', SA);
t('Santo Antônio citando o próprio nome não é negado', r.tipo !== 'negado', texto(r));
r = await diga('secretaria', 'Crie trezena de Santo Antônio sábado às 19h');
t('título com nome de santo não é confundido com outra paróquia', r.tipo === 'confirmacao' && Object.fromEntries(r.confirmacao.campos).Evento === 'Trezena de Santo Antônio', texto(r));
await ag.cancelar({...ent('secretaria'), confirmacaoId:r.confirmacao.id});
r = await diga('secretaria', 'Crie missa de ação de graças sábado às 10h');
t('"ação de graças" não é a paróquia Graças', r.tipo === 'confirmacao', texto(r));

console.log('== VERMELHO: nunca sozinho');
const g0 = B.gravacoes.length;
for (const [f, re] of [['Apague o evento de sábado', /Excluir/], ['Marque todas as solicitações como concluídas', /várias/], ['Vincule franciscoeclarapazebem@gmail.com como secretaria', /permiss/],
  ['Dê permissão de padre para a PASCOM', /permiss/], ['Mostre os pagamentos do Pix', /Pagamentos/], ['Quais dizimistas atrasaram?', /sensíveis/], ['Crie uma comunidade São Pedro', /Não crio comunidades/], ['Mude o nome da paróquia', /Ajustes/]]){
  r = await diga('padre', f);
  t(`"${f}" → não executa`, r.tipo === 'negado' && re.test(texto(r)), texto(r));
}
t('nenhuma gravação nas ações vermelhas', B.gravacoes.length === g0);
r = await diga('secretaria', 'Atualize o serviço de batismo');
t('atualizar_servico: ainda não ativado (sem RPC segura)', /ainda não está ativada/.test(texto(r)), texto(r));

console.log('== anônimo e entrada inválida');
for (const [n, e] of [['sem remetente', {channel:'painel', parish:{id:SC}, message:'Quais solicitações estão pendentes?'}],
  ['papel inventado', {channel:'painel', sender:{userId:'x', papel:'superadmin'}, parish:{id:SC}, message:'Quais solicitações estão pendentes?'}],
  ['canal desconhecido', {channel:'whatsapp-web', sender:{userId:'x', papel:'padre'}, parish:{id:SC}, message:'oi'}],
  ['sem paróquia', {channel:'painel', sender:{userId:'x', papel:'padre'}, message:'O que temos amanhã?'}]]){
  const antesA = B.auditoria.length;
  r = await ag.receber(e);
  t(`anônimo/${n}: sem agente administrativo`, r.tipo === 'negado' && /Entre com seu usuário/.test(texto(r)) && B.auditoria.length === antesA, texto(r));
}

console.log('== auditoria mínima');
const aud = ag.trilha();
t('auditoria registra usuário, paróquia, ferramenta, horário, resultado e confirmação', aud.every(a => a.user_id && a.parish_id && a.tool && a.at && a.result && 'human_confirmed' in a), aud[0]);
t('execuções confirmadas marcadas como confirmação humana', aud.some(a => a.tool === 'criar_evento_confirmado' && a.result === 'ok' && a.human_confirmed) && aud.some(a => a.tool === 'atualizar_solicitacao_confirmada' && a.result === 'ok' && a.human_confirmed));
t('auditoria NÃO guarda a mensagem nem conteúdo', !JSON.stringify(aud).match(/Missa|Juventude|solicitação|Santo|message|texto/) && !JSON.stringify(B.auditoria).match(/Missa|Juventude|message/), JSON.stringify(aud).slice(0, 300));
t('backend.auditar recebe só paróquia, canal, ferramenta, resultado e confirmação', B.auditoria.every(a => Object.keys(a).sort().join() === 'channel,confirmed,parishId,result,tool'), B.auditoria[0]);

console.log('== IA plugável: interpretação separada da execução');
const agLLM = Core.criarAgente({backend, agora:() => AGORA, interpretar: async () => ({intent:'consultar_solicitacoes', filtro:'pendentes'})});
r = await agLLM.receber({...ent('pascom'), message:'qualquer coisa'});
t('um interpretador externo não fura a permissão das ferramentas', r.tipo === 'negado', texto(r));
const agFalha = Core.criarAgente({backend, agora:() => AGORA, interpretar: async () => { throw new Error('IA fora do ar'); }});
r = await agFalha.receber({...ent('secretaria'), message:'Quais comunidades estão cadastradas?'});
t('se a IA falhar, o parser V1 responde', /ainda não possui comunidades/.test(texto(r)), texto(r));
const agInj = Core.criarAgente({backend, agora:() => AGORA, interpretar: async () => ({intent:'criar_evento_confirmado', parish_id:SA})});
r = await agInj.receber({...ent('secretaria'), message:'x'});
t('intenção fora do roteador não executa nada (nem troca de paróquia)', B.gravacoes.length === g0 && r.tipo === 'resposta', texto(r));

console.log(`\n${ok} ok, ${falha} falhas`);
process.exit(falha ? 1 : 0);
