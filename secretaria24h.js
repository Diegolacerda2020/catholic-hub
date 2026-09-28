/* =========================================================
   Central Paroquial — SECRETARIA 24H (módulo isolado)

   "A Secretaria 24h recebe sua solicitação a qualquer momento.
    O atendimento pela equipe acontece no horário normal da secretaria."

   Página pública (sem login): catálogo, formulário, protocolo e acompanhamento,
   sempre pelas funções public_* do supabase/secretaria24h.sql.
   Painel (Mais > Secretaria 24h): lista, detalhe e mudança de status, com RLS
   (can_access 'secretaria24h') e staff_update_service_request.
   Modo demonstração (sem Supabase no config.js): tudo fica só neste aparelho.

   Carregado ANTES do script principal do index.html; usa as funções dele (S, NUVEM,
   esc, render, toast…) só na hora em que é chamado. Para desligar o módulo, basta
   remover o <script src="secretaria24h.js"> (e o CSS): o index.html testa window.S24
   antes de cada gancho. Não grava nada em parish_state.
   ========================================================= */
(function(){
'use strict';

const AVISO = 'A Secretaria 24h recebe sua solicitação a qualquer momento. O atendimento pela equipe acontece no horário normal da secretaria.';
const ST = {
  new:          {ic:'✅', pub:'Solicitação recebida', adm:'Recebida',       card:'Novas'},
  in_progress:  {ic:'🔄', pub:'Em atendimento',       adm:'Em atendimento', card:'Em atendimento'},
  waiting_user: {ic:'⏳', pub:'Aguardando seu retorno', adm:'Aguardando resposta do fiel', card:'Aguardando fiel'},
  completed:    {ic:'✔️', pub:'Concluída',            adm:'Concluída',      card:'Concluídas'},
  closed:       {ic:'📁', pub:'Encerrada',            adm:'Encerrada',      card:'Encerradas'}
};
const PREF = {whatsapp:'WhatsApp', ligacao:'Ligação', qualquer:'Tanto faz'};
const MAX = {text:200, date:10, select:200, textarea:2000};
const NOME_CAMPO = /^[a-z][a-z0-9_]{0,39}$/;
const PRIMEIRO_HIST = 'Solicitação recebida.';
const INDISPONIVEL = 'A Secretaria 24h está temporariamente indisponível. Os demais serviços da paróquia continuam funcionando.';
const indispHTML = (tentar = '') => `<div class="signal wait s24-indisp" role="status">${esc(INDISPONIVEL)}</div>${tentar ? `<button type="button" class="btn ghost block-w" id="${tentar}">Tentar de novo</button>` : ''}`;
const ERROS = {
  servico_indisponivel:'Este serviço não está disponível no momento. Fale com a secretaria.',
  nome_invalido:'Confira o seu nome.',
  whatsapp_invalido:'Confira o WhatsApp com DDD.',
  campo_obrigatorio:'Preencha os campos marcados com *.',
  dados_invalidos:'Confira os dados do formulário.',
  limite:'Recebemos muitas solicitações agora. Tente de novo mais tarde ou fale com a secretaria.',
  status_invalido:'Escolha um status da lista.',
  nota_longa:'A nota pode ter no máximo 1000 caracteres.',
  nada_alterado:'Escolha outro status ou escreva uma nota.'
};

/* ---------- utilitários ---------- */
// Mesma regra de s24_whatsapp() no banco: DDD + número (10 fixo, 11 celular), sem 55 e sem 0.
function s24Whats(v){
  let d = String(v ?? '').replace(/[\s().+-]/g, '');
  if (!/^[0-9]{10,14}$/.test(d)) return null;
  d = d.replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && /^[1-9][1-9]9[0-9]{8}$/.test(d)) return d;
  if (d.length === 10 && /^[1-9][1-9][2-5][0-9]{7}$/.test(d)) return d;
  return null;
}
const foneBR = d => d?.length === 11 ? `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}` : d?.length === 10 ? `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}` : (d || '');
const dataHora = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dataCurta = s => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : s;
const semAc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stInfo = s => ST[s] || {ic:'•', pub:s, adm:s, card:s};
const chipSt = (s, rot = 'adm') => `<span class="s24-st s24-st-${esc(s)}">${esc(stInfo(s)[rot])}</span>`;
// Só os campos que o renderer conhece; qualquer outra coisa vinda do banco é ignorada (nunca vira HTML).
const camposOk = svc => (Array.isArray(svc?.form_fields) ? svc.form_fields : [])
  .filter(f => f && NOME_CAMPO.test(f.name) && MAX[f.type] && typeof f.label === 'string' && (f.type !== 'select' || (Array.isArray(f.options) && f.options.length)));

function msgErro(e){
  const m = /s24:([a-z_]+)/.exec(e?.message || '');
  if (m && ERROS[m[1]]) return ERROS[m[1]];
  if (e?.code === '42501') return 'Seu usuário não tem permissão para esta ação.';
  if (typeof tabelaFaltando === 'function' && tabelaFaltando(e)) return 'A Secretaria 24h ainda não foi ativada no banco da paróquia.';
  return navigator.onLine === false ? 'Sem internet. Tente de novo quando a conexão voltar.' : INDISPONIVEL;
}

// Valida as respostas como o banco valida (o banco valida de novo; isto só evita ida e volta).
function validar(svc, respostas){
  const ans = {};
  for (const f of camposOk(svc)){
    const v = String(respostas[f.name] ?? '').trim();
    if (v.length > MAX[f.type]) return {erro:`“${f.label}” está muito longo.`};
    if (!v){ if (f.required === true) return {erro:`Preencha “${f.label}”.`, campo:f.name}; continue; }
    if (f.type === 'date'){
      const y = +v.slice(0,4);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v+'T12:00:00')) || y < 1900 || y > 2100) return {erro:`Confira a data em “${f.label}”.`, campo:f.name};
    }
    if (f.type === 'select' && !f.options.includes(v)) return {erro:`Escolha uma opção em “${f.label}”.`, campo:f.name};
    ans[f.name] = v;
  }
  return {ans};
}

/* ---------- acesso aos dados ---------- */
const demo = () => !NUVEM.ativo;
async function sb(){
  for (let i = 0; i < 50 && !NUVEM.sb; i++) await new Promise(r => setTimeout(r, 200)); // o cliente carrega em segundo plano
  if (!NUVEM.sb) throw new Error('sem conexão');
  return NUVEM.sb;
}
async function rpc(fn, args){
  const {data, error} = await (await sb()).rpc(fn, args);
  if (error) throw error;
  return data;
}

// Demonstração (sem banco): mesmo catálogo inicial do secretaria24h.sql, gravado só neste aparelho.
const CATALOGO_DEMO = [
  {code:'certidao', title:'Certidão / documento paroquial', sort_order:10,
   description:'Solicite informações ou segunda via de documentos emitidos pela paróquia.',
   instructions:'Informe os dados que souber para a secretaria localizar o registro nos livros da paróquia. Não é preciso enviar documentos agora: a equipe entra em contato para combinar a retirada.',
   form_fields:[{name:'tipo_documento',label:'Tipo de documento',type:'select',required:true,options:['Certidão de Batismo','Certidão de Crisma','Certidão de Matrimônio','Outro']},
     {name:'nome_pessoa',label:'Nome completo da pessoa',type:'text',required:true},
     {name:'data_sacramento',label:'Data aproximada do sacramento',type:'text',hint:'Pode ser só o ano ou o mês e o ano.'},
     {name:'nome_pais',label:'Nome dos pais',type:'text'},
     {name:'local',label:'Comunidade/igreja onde ocorreu',type:'text'},
     {name:'observacoes',label:'Observações',type:'textarea'}]},
  {code:'batismo', title:'Batismo', sort_order:20,
   description:'Receba as primeiras orientações para preparação e realização do Batismo.',
   instructions:'A secretaria entra em contato para explicar a preparação, os documentos necessários e as datas disponíveis.',
   form_fields:[{name:'nome_pessoa',label:'Nome da criança/pessoa',type:'text',required:true},{name:'data_nascimento',label:'Data de nascimento',type:'date'},
     {name:'nome_responsaveis',label:'Nome dos responsáveis',type:'text'},{name:'data_desejada',label:'Data desejada',type:'date'},
     {name:'comunidade',label:'Comunidade desejada',type:'text'},{name:'observacoes',label:'Observações',type:'textarea'}]},
  {code:'matrimonio', title:'Matrimônio', sort_order:30,
   description:'Receba as orientações iniciais para a preparação e o agendamento do casamento.',
   instructions:'A secretaria entra em contato para explicar a preparação, os documentos necessários e a disponibilidade de datas. A data só fica reservada depois da confirmação da paróquia.',
   form_fields:[{name:'nome_noivo',label:'Nome do noivo',type:'text',required:true},{name:'nome_noiva',label:'Nome da noiva',type:'text',required:true},
     {name:'data_desejada',label:'Data desejada',type:'date'},{name:'comunidade',label:'Comunidade/igreja',type:'text'},{name:'observacoes',label:'Observações',type:'textarea'}]},
  {code:'catequese', title:'Catequese', sort_order:40,
   description:'Informações e inscrição para a catequese.',
   instructions:'A secretaria entra em contato com as informações de turmas, horários e documentos.',
   form_fields:[{name:'nome_catequizando',label:'Nome do catequizando',type:'text',required:true},{name:'data_nascimento',label:'Data de nascimento',type:'date'},
     {name:'nome_responsavel',label:'Nome do responsável',type:'text'},{name:'comunidade',label:'Comunidade',type:'text'},{name:'observacoes',label:'Observações',type:'textarea'}]},
  {code:'atendimento_padre', title:'Atendimento com o padre', sort_order:50,
   description:'Solicite contato ou orientação para agendamento de atendimento pastoral.',
   instructions:'Conte em poucas palavras o assunto. A secretaria entra em contato para combinar o melhor horário. Não escreva aqui nada que seja assunto de confissão.',
   form_fields:[{name:'assunto',label:'Assunto',type:'text',required:true},{name:'melhor_periodo',label:'Melhor período para contato',type:'select',options:['Manhã','Tarde','Noite','Qualquer horário']},
     {name:'observacoes',label:'Observações',type:'textarea'}]},
  {code:'outro', title:'Outro assunto', sort_order:60,
   description:'Envie sua dúvida ou pedido para a secretaria.',
   instructions:'Escreva como podemos ajudar. A secretaria responde no horário de atendimento.',
   form_fields:[{name:'mensagem',label:'Como podemos ajudar?',type:'textarea',required:true}]}
];
const DEMO_KEY = 'central-paroquial-s24-demo';
function demoLer(){ try { const d = JSON.parse(localStorage.getItem(DEMO_KEY)); if (d && Array.isArray(d.requests) && Array.isArray(d.history)) return d; } catch(e){} return {requests:[], history:[]}; }
function demoGravar(d){ try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch(e){} }
const hex8 = () => { const b = new Uint8Array(4); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2,'0')).join('').toUpperCase(); };
const erroS24 = motivo => Object.assign(new Error('s24:'+motivo), {code:'22023'});

async function apiCatalogo(){
  if (demo()) return CATALOGO_DEMO;
  const d = await rpc('public_service_catalog', {p_slug:NUVEM.slug});
  return Array.isArray(d) ? d : [];
}
async function apiCriar(code, nome, whats, pref, respostas){
  if (!demo()) return rpc('public_create_service_request', {p_slug:NUVEM.slug, p_service_code:code, p_name:nome, p_whatsapp:whats, p_contact_preference:pref, p_answers:respostas});
  const svc = CATALOGO_DEMO.find(s => s.code === code), wa = s24Whats(whats), v = svc && validar(svc, respostas);
  if (!svc) throw erroS24('servico_indisponivel');
  if (!wa) throw erroS24('whatsapp_invalido');
  if (v.erro) throw erroS24('dados_invalidos');
  const db = demoLer(), agora = new Date();
  const prev = db.requests.find(r => r.service_id === code && r.whatsapp === wa && r.status === 'new' && agora - new Date(r.created_at) < 5*60e3);
  if (prev) return {protocol:prev.protocol, status:prev.status, created_at:prev.created_at};
  const r = {id:uuid(), service_id:code, protocol:`SA-${agora.getFullYear()}-${hex8()}`, requester_name:nome, whatsapp:wa, contact_preference:pref,
    answers:v.ans, status:'new', is_demo:true, created_at:agora.toISOString(), updated_at:agora.toISOString()};
  db.requests.push(r);
  db.history.push({id:uuid(), request_id:r.id, status:'new', note:PRIMEIRO_HIST, public_note:true, created_at:r.created_at});
  demoGravar(db);
  return {protocol:r.protocol, status:r.status, created_at:r.created_at};
}
async function apiConsultar(proto, whats){
  if (!demo()) return rpc('public_get_service_request', {p_slug:NUVEM.slug, p_protocol:proto, p_whatsapp:whats});
  const db = demoLer(), wa = s24Whats(whats), p = String(proto || '').replace(/\s/g, '').toUpperCase();
  const r = db.requests.find(x => x.protocol === p && x.whatsapp === wa);
  if (!r) return null;
  return {protocol:r.protocol, service_title:CATALOGO_DEMO.find(s => s.code === r.service_id)?.title || '', status:r.status, created_at:r.created_at, updated_at:r.updated_at,
    history:db.history.filter(h => h.request_id === r.id && h.public_note).sort((a,b) => a.created_at.localeCompare(b.created_at)).map(({status, note, created_at}) => ({status, note, created_at}))};
}
async function apiPainel(){
  if (demo()) return {catalogo:CATALOGO_DEMO.map(s => ({...s, id:s.code})), lista:demoLer().requests.slice().sort((a,b) => b.created_at.localeCompare(a.created_at))};
  const c = await sb();
  const [cat, req] = await Promise.all([
    c.from('service_catalog').select('id, code, title, form_fields').eq('parish_id', NUVEM.parishId),
    c.from('service_requests').select('id, service_id, protocol, requester_name, whatsapp, contact_preference, answers, status, is_demo, created_at, updated_at')
      .eq('parish_id', NUVEM.parishId).order('created_at', {ascending:false}).limit(1000)
  ]);
  if (cat.error) throw cat.error;
  if (req.error) throw req.error;
  return {catalogo:cat.data, lista:req.data};
}
async function apiHistorico(id){
  if (demo()) return demoLer().history.filter(h => h.request_id === id).sort((a,b) => a.created_at.localeCompare(b.created_at));
  const {data, error} = await (await sb()).from('service_request_history').select('id, status, note, public_note, created_at').eq('request_id', id).order('created_at');
  if (error) throw error;
  return data;
}
async function apiAtualizar(id, status, nota, publica){
  if (!demo()) return rpc('staff_update_service_request', {p_request:id, p_status:status, p_note:nota, p_public_note:publica});
  const db = demoLer(), r = db.requests.find(x => x.id === id), n = nota.trim() || null;
  if (!r) throw Object.assign(new Error('Sem permissão'), {code:'42501'});
  if (!ST[status]) throw erroS24('status_invalido');
  if (n && n.length > 1000) throw erroS24('nota_longa');
  const mudou = status !== r.status;
  if (!mudou && !n) throw erroS24('nada_alterado');
  const t = () => new Date().toISOString();
  if (mudou && n && !publica){
    db.history.push({id:uuid(), request_id:id, status, note:null, public_note:true, created_at:t()});
    db.history.push({id:uuid(), request_id:id, status, note:n, public_note:false, created_at:t()});
  } else db.history.push({id:uuid(), request_id:id, status, note:n, public_note:!n || publica, created_at:t()});
  if (mudou || publica){ r.status = status; r.updated_at = t(); }
  demoGravar(db);
  return {status};
}

/* =========================================================
   PÁGINA PÚBLICA
   ========================================================= */
const CAT = {estado:'nada', lista:[]}; // nada | carregando | ok | ausente | erro

/* "Minhas solicitações": guardadas só neste aparelho, só o necessário para acompanhar
   (protocolo, serviço, data, WhatsApp normalizado e a última situação vista). Nunca as respostas do formulário. */
const MINHAS_KEY = 'central-paroquial-s24-minhas';
const PROTO_OK = /^SA-\d{4}-[0-9A-F]{8}$/;
function minhasTodas(){ try { const d = JSON.parse(localStorage.getItem(MINHAS_KEY)); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch(e){ return {}; } }
function minhasLer(){ const l = minhasTodas()[NUVEM.slug]; return Array.isArray(l) ? l.filter(x => x && PROTO_OK.test(x.protocol) && s24Whats(x.whats)) : []; }
function minhasGravar(l){ try { const d = minhasTodas(); d[NUVEM.slug] = l.slice(0, 10); localStorage.setItem(MINHAS_KEY, JSON.stringify(d)); } catch(e){} }
function minhasGuardar(x){ minhasGravar([x, ...minhasLer().filter(m => m.protocol !== x.protocol)]); }
function minhasStatus(proto, status){ const l = minhasLer(), m = l.find(x => x.protocol === proto); if (m && ST[status] && m.status !== status){ m.status = status; minhasGravar(l); } }
function minhasHTML(){
  const l = minhasLer();
  if (!l.length) return '';
  return `<h2>Minhas solicitações</h2>
  <div class="list s24-minhas">${l.map(m => `<div class="row"><div class="grow"><b>${esc(m.service_title || 'Solicitação')}</b>
      <span class="small muted" style="display:block">${esc(m.protocol)} · ${esc(dataHora(m.created_at))}</span>
      <div style="margin-top:4px">${chipSt(ST[m.status] ? m.status : 'new', 'pub')}</div></div>
    <div class="s24-minha-acoes"><button type="button" class="btn sm" data-s24-minha="${esc(m.protocol)}">Acompanhar</button>
      <button type="button" class="link-btn" data-s24-esquecer="${esc(m.protocol)}">Remover deste aparelho</button></div></div>`).join('')}</div>
  <p class="small muted" style="margin:0 4px 12px">Guardadas só neste aparelho, para você acompanhar sem digitar. As respostas do formulário não ficam guardadas.</p>`;
}
const P = {tela:'inicio', code:null, rascunho:{}, envio:null, consulta:{proto:'', whats:''}, resultado:null, naoAchou:false, ocupado:false};

function carregarCatalogo(forcar){
  if (CAT.estado === 'carregando' || (!forcar && CAT.estado !== 'nada')) return;
  CAT.estado = 'carregando';
  apiCatalogo().then(l => {
    CAT.lista = l.filter(s => s && typeof s.code === 'string' && typeof s.title === 'string');
    CAT.estado = 'ok';
  }).catch(e => {
    CAT.estado = (typeof tabelaFaltando === 'function' && tabelaFaltando(e)) ? 'ausente' : 'erro';
    if (CAT.estado === 'erro') console.warn('Secretaria 24h: falha ao ler o catálogo', e);
  }).finally(() => {
    // Só redesenha as telas que mostram algo da Secretaria 24h.
    if (S.mode === 'publico' && ['igreja','contato','secretaria'].includes(S.pubTab)) renderSeguro();
  });
}
const disponivel = () => { if (!vendoAtiva()) return false; carregarCatalogo(); return CAT.estado === 'ok' && CAT.lista.length > 0; };

function abrir(tela){
  P.tela = tela || 'inicio'; P.resultado = null; P.naoAchou = false;
  if (CAT.estado === 'erro' || CAT.estado === 'ausente') carregarCatalogo(true);
  S.pubTab = 'secretaria'; save(); render(); scrollTo(0,0);
}
// Botões "Acessar secretaria" (Home) e "Secretaria 24h" (Paróquia): um só ouvinte, sem gancho no bind das telas.
document.addEventListener('click', e => {
  try {
    const b = e.target.closest?.('[data-s24-abrir]');
    if (!b || S.mode !== 'publico') return;
    e.preventDefault(); abrir('inicio');
  } catch(x){ console.warn('Secretaria 24h: falha ao abrir', x); }
});

function cardHomeHTML(){
  if (!disponivel()) return '';
  return `<section class="s24-card" aria-labelledby="s24CardT">
    <div class="s24-kicker">Secretaria 24h</div>
    <h3 id="s24CardT">Secretaria paroquial, sempre aberta</h3>
    <p>Faça solicitações pelo celular a qualquer hora.<br>A equipe da paróquia responderá no horário de atendimento.</p>
    <button type="button" class="btn block-w" data-s24-abrir>Acessar secretaria</button>
  </section>`;
}
function botaoParoquiaHTML(){
  if (!disponivel()) return '';
  return `<button type="button" class="btn ghost block-w s24-bt-par" data-s24-abrir>🕐 Secretaria 24h</button>`;
}

function publicoHTML(){
  if (!vendoAtiva()) return `<button class="crumb" data-pub="igreja">‹ Igreja</button><h2>Secretaria 24h</h2><div class="empty">Esta paróquia ainda não usa a Secretaria 24h por aqui.</div>`;
  carregarCatalogo();
  const svc = CAT.lista.find(s => s.code === P.code);
  if (P.tela === 'form' && svc) return formHTML(svc);
  if (P.tela === 'ok' && P.envio) return okHTML();
  if (P.tela === 'consulta') return consultaHTML();
  P.tela = 'inicio';
  return inicioHTML();
}
function horarioHTML(){
  const h = String(S.cfg.secretaria || '').trim();
  return h ? `<p class="small s24-horario"><b>Atendimento da equipe</b><br>${esc(h)}</p>` : '';
}
function inicioHTML(){
  let servicos;
  if (CAT.estado === 'ok' && CAT.lista.length) servicos = `<div class="s24-servicos">${CAT.lista.map(s => `<button type="button" class="s24-serv" data-s24-servico="${esc(s.code)}"><b>${esc(s.title)}</b>${s.description ? `<span class="small">${esc(s.description)}</span>` : ''}</button>`).join('')}</div>`;
  else if (CAT.estado === 'nada' || CAT.estado === 'carregando') servicos = `<div class="status" role="status"><span class="spinner"></span>Carregando os serviços…</div>`;
  else if (CAT.estado === 'ok') servicos = `<div class="empty">Nenhum serviço disponível no momento.</div>${contatoBtn()}`;
  else servicos = indispHTML('s24Tentar') + contatoBtn(); // erro de rede, RPC ou banco sem a migração
  return `<button class="crumb" data-pub="igreja">‹ Igreja</button>
  <section class="s24-hero">
    <div class="s24-kicker">Secretaria 24h</div>
    <h2>Como podemos ajudar?</h2>
    <p>${esc(AVISO)}</p>
    ${horarioHTML()}
  </section>
  ${minhasHTML()}
  ${minhasLer().length ? '<h2>Nova solicitação</h2>' : ''}
  ${servicos}
  <h2>Atalhos</h2>
  <div class="list">
    <button type="button" class="pick-row" data-s24-intencao><span class="s24-ic" aria-hidden="true">🙏</span><span class="grow"><b>Enviar intenção de Missa</b><span class="small muted" style="display:block">Abre o pedido de intenção da paróquia</span></span><span class="muted" aria-hidden="true">›</span></button>
    <button type="button" class="pick-row" data-pub="dizimista"><span class="s24-ic" aria-hidden="true">❤️</span><span class="grow"><b>Quero ser dizimista</b><span class="small muted" style="display:block">Deixe seu contato para a equipe do dízimo</span></span><span class="muted" aria-hidden="true">›</span></button>
  </div>
  <h2>${minhasLer().length ? 'Fez a solicitação em outro aparelho?' : 'Já fez uma solicitação?'}</h2>
  <button type="button" class="btn ghost block-w" data-s24-ir="consulta">${minhasLer().length ? 'Consultar outra solicitação' : 'Acompanhar protocolo'}</button>`;
}

function campoHTML(f, v){
  const id = 's24-c-'+f.name, nm = 'c_'+f.name, req = f.required === true, rot = `<label for="${id}">${esc(f.label)}${req ? ' *' : ''}</label>`;
  const hint = typeof f.hint === 'string' && f.hint ? `<div class="hint">${esc(f.hint)}</div>` : '';
  let el;
  if (f.type === 'textarea') el = `<textarea id="${id}" name="${nm}" maxlength="${MAX.textarea}" ${req?'required':''}>${esc(v)}</textarea>`;
  else if (f.type === 'select') el = `<select id="${id}" name="${nm}" ${req?'required':''}><option value="">Selecione…</option>${f.options.filter(o => typeof o === 'string').map(o => `<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.type === 'date') el = `<input type="date" id="${id}" name="${nm}" value="${esc(v)}" min="1900-01-01" max="2100-12-31" ${req?'required':''}>`;
  else el = `<input type="text" id="${id}" name="${nm}" value="${esc(v)}" maxlength="${MAX.text}" ${req?'required':''}>`;
  return `<div class="field">${rot}${el}${hint}</div>`;
}
function formHTML(svc){
  const r = P.rascunho[svc.code] ||= {c:{}, nome:'', whats:'', pref:'whatsapp', ok:false};
  return `<button class="crumb" data-s24-ir="inicio">‹ Secretaria 24h</button>
  <h2>${esc(svc.title)}</h2>
  ${svc.description ? `<p class="lead">${esc(svc.description)}</p>` : ''}
  ${svc.instructions ? `<div class="s24-orient"><b>Orientações</b><p>${esc(svc.instructions)}</p></div>` : ''}
  <form class="block" id="s24F" novalidate>
    ${camposOk(svc).map(f => campoHTML(f, r.c[f.name] || '')).join('')}
    <div class="s24-sep">Seus dados para contato</div>
    <div class="field"><label for="s24-nome">Nome *</label><input type="text" id="s24-nome" name="nome" maxlength="120" autocomplete="name" value="${esc(r.nome)}" required></div>
    <div class="field"><label for="s24-wa">WhatsApp *</label><input type="tel" id="s24-wa" name="whats" autocomplete="tel" placeholder="(31) 99999-0000" value="${esc(r.whats)}" required><div class="hint">Com DDD. Ele também é usado para acompanhar o protocolo.</div></div>
    <fieldset class="field s24-fs"><legend>Preferência de contato</legend>
      <div class="radio-row">${Object.entries(PREF).map(([k,l]) => `<label><input type="radio" name="pref" value="${k}" ${r.pref===k?'checked':''}> ${l}</label>`).join('')}</div></fieldset>
    <div class="hp" aria-hidden="true"><label for="s24-site">Não preencha</label><input type="text" id="s24-site" name="site" tabindex="-1" autocomplete="off"></div>
    <label class="check"><input type="checkbox" name="ok" ${r.ok?'checked':''}> Autorizo a paróquia a usar estes dados exclusivamente para responder esta solicitação. *</label>
    <button class="btn block-w" id="s24Enviar">Enviar solicitação</button>
    <p class="small muted" style="margin:10px 0 0">${esc(AVISO)}</p>
  </form>`;
}
function okHTML(){
  const e = P.envio;
  return `<div class="s24-ok" role="status">
    <div class="s24-ok-t">✅ Solicitação recebida</div>
    ${e.title ? `<div class="small">${esc(e.title)}</div>` : ''}
    <div class="s24-proto-l">Protocolo</div>
    <div class="s24-proto">${esc(e.protocol)}</div>
    <p>Guarde este protocolo. Você pode acompanhar o andamento por esta página.</p>
    <p class="small" style="margin:0">${esc(AVISO)}</p>
  </div>
  <div class="s24-botoes">
    <button type="button" class="btn block-w" data-s24-copiar>Copiar protocolo</button>
    <button type="button" class="btn ghost block-w" data-s24-acompanhar>Acompanhar solicitação</button>
    <button type="button" class="btn ghost block-w" data-pub="igreja">Voltar à página da paróquia</button>
  </div>`;
}
function consultaHTML(){
  const c = P.consulta;
  return `<button class="crumb" data-s24-ir="inicio">‹ Secretaria 24h</button>
  <h2>Acompanhar solicitação</h2>
  <form class="block" id="s24C" novalidate>
    <div class="field"><label for="s24-p">Protocolo</label><input type="text" id="s24-p" name="proto" placeholder="SA-2026-XXXXXXXX" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="30" value="${esc(c.proto)}" required></div>
    <div class="field"><label for="s24-pw">WhatsApp informado</label><input type="tel" id="s24-pw" name="whats" autocomplete="tel" placeholder="(31) 99999-0000" value="${esc(c.whats)}" required><div class="hint">O mesmo número usado na solicitação.</div></div>
    <button class="btn block-w" id="s24Consultar">Consultar</button>
  </form>
  ${P.naoAchou ? `<div class="signal wait" role="status">Não encontramos uma solicitação com esses dados. Confira o protocolo e o WhatsApp informado na solicitação.</div>` : ''}
  ${P.resultado ? resultadoHTML(P.resultado) : ''}`;
}
function resultadoHTML(r){
  const hist = Array.isArray(r.history) ? r.history : [];
  return `<div class="block s24-res" role="status">
    <h3>${esc(r.service_title)}</h3>
    <div class="small muted">Protocolo ${esc(r.protocol)}</div>
    <div class="s24-atual">Situação atual: ${chipSt(r.status, 'pub')}</div>
    <ol class="s24-linha">${hist.map((h, i) => `<li class="s24-st-${esc(h.status)}">
      <b>${i && h.note && hist[i-1].status === h.status ? '💬 Nova mensagem da secretaria' : `${stInfo(h.status).ic} ${esc(stInfo(h.status).pub)}`}</b>
      <span class="small muted">${dataHora(h.created_at)}</span>
      ${h.note && !(h.status === 'new' && h.note === PRIMEIRO_HIST) ? `<div class="s24-msg"><span class="small muted">Mensagem da secretaria:</span><br>“${esc(h.note)}”</div>` : ''}
    </li>`).join('')}</ol>
    <p class="small muted" style="margin:10px 0 0">${esc(AVISO)}</p>
  </div>`;
}

async function consultar(proto, whats){
  P.consulta = {proto, whats}; P.naoAchou = false; P.resultado = null;
  const p = proto.replace(/\s/g, '').toUpperCase();
  if (!/^SA-\d{4}-[0-9A-F]{8}$/.test(p)){ toast('Confira o protocolo (ex.: SA-2026-A4F29C81).'); render(); document.getElementById('s24-p')?.focus(); return; }
  if (!s24Whats(whats)){ toast('Confira o WhatsApp com DDD.'); render(); document.getElementById('s24-pw')?.focus(); return; }
  P.ocupado = true;
  try {
    const r = await apiConsultar(p, whats);
    if (r && r.protocol){ P.resultado = r; minhasStatus(r.protocol, r.status); } else P.naoAchou = true;
  } catch(e){ toast(msgErro(e)); }
  finally { P.ocupado = false; }
  P.consulta.proto = p;
  if (S.pubTab === 'secretaria' && P.tela === 'consulta'){ render(); document.querySelector('.s24-res, .signal.wait')?.scrollIntoView({block:'nearest'}); }
}

function bindPublico(root){
  root.querySelectorAll('[data-s24-ir]').forEach(b => b.onclick = () => { P.tela = b.dataset.s24Ir; if (P.tela === 'inicio'){ P.resultado = null; P.naoAchou = false; } render(); scrollTo(0,0); });
  root.querySelectorAll('[data-s24-servico]').forEach(b => b.onclick = () => { P.tela = 'form'; P.code = b.dataset.s24Servico; render(); scrollTo(0,0); });
  root.querySelector('#s24Tentar')?.addEventListener('click', () => { carregarCatalogo(true); render(); });
  root.querySelector('[data-s24-intencao]')?.addEventListener('click', () => {
    S.pubTab = 'intencao'; save(); render(); scrollTo(0,0);
    const f = document.getElementById('intF');
    if (f){ f.scrollIntoView({block:'start'}); f.querySelector('select,input')?.focus({preventScroll:true}); } else scrollTo(0,0);
  });
  root.querySelector('[data-s24-copiar]')?.addEventListener('click', () => copiar(P.envio.protocol));
  root.querySelector('[data-s24-acompanhar]')?.addEventListener('click', () => { const e = P.envio; P.tela = 'consulta'; scrollTo(0,0); consultar(e.protocol, e.whats); render(); });
  // Minhas solicitações: preenche protocolo + WhatsApp sozinho e já consulta.
  root.querySelectorAll('[data-s24-minha]').forEach(b => b.onclick = () => {
    const m = minhasLer().find(x => x.protocol === b.dataset.s24Minha); if (!m) return;
    P.tela = 'consulta'; scrollTo(0,0); consultar(m.protocol, m.whats); render();
  });
  root.querySelectorAll('[data-s24-esquecer]').forEach(b => b.onclick = () => {
    minhasGravar(minhasLer().filter(x => x.protocol !== b.dataset.s24Esquecer)); render(); toast('Removida deste aparelho.');
  });

  const c = root.querySelector('#s24C');
  if (c){
    c.addEventListener('input', () => { P.consulta = {proto:c.elements.proto.value, whats:c.elements.whats.value}; });
    c.addEventListener('submit', e => { e.preventDefault(); if (!P.ocupado) consultar(c.elements.proto.value, c.elements.whats.value); });
  }

  const f = root.querySelector('#s24F'); if (!f) return;
  const svc = CAT.lista.find(s => s.code === P.code), campos = camposOk(svc), r = P.rascunho[svc.code];
  let enviado = false;
  const lerForm = () => {
    // Ao redesenhar, o Chrome dispara "change" no campo que acabou de sair da tela: não deixa um
    // formulário já enviado (ou já removido) regravar o rascunho com o texto antigo.
    if (enviado || !f.isConnected) return;
    campos.forEach(k => { r.c[k.name] = f.elements['c_'+k.name]?.value ?? ''; });
    r.nome = f.elements.nome.value; r.whats = f.elements.whats.value; r.pref = f.elements.pref.value || 'whatsapp'; r.ok = f.elements.ok.checked;
  };
  // O rascunho fica guardado (só na memória): se a página se redesenhar, nada do que foi digitado se perde.
  f.addEventListener('input', lerForm); f.addEventListener('change', lerForm);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (P.ocupado) return;
    lerForm();
    const v = validar(svc, r.c), nome = r.nome.trim().replace(/\s+/g, ' '), wa = s24Whats(r.whats);
    if (v.erro){ toast(v.erro); (v.campo && f.elements['c_'+v.campo] || f).focus?.(); return; }
    if (nome.length < 2){ toast('Escreva seu nome.'); f.elements.nome.focus(); return; }
    if (!wa){ toast('Confira o WhatsApp com DDD.'); f.elements.whats.focus(); return; }
    if (!r.ok){ toast('Marque a autorização para a paróquia usar estes dados.'); f.elements.ok.focus(); return; }
    if (f.elements.site.value) return; // robô preencheu o campo escondido
    const btn = f.querySelector('#s24Enviar'); btn.disabled = true; btn.textContent = 'Enviando…'; P.ocupado = true;
    try {
      const res = await apiCriar(svc.code, nome, wa, r.pref, v.ans);
      if (!res?.protocol) throw new Error('sem protocolo');
      P.envio = {protocol:res.protocol, created_at:res.created_at, whats:wa, title:svc.title};
      minhasGuardar({protocol:res.protocol, service_title:svc.title, created_at:res.created_at, whats:wa, status:res.status || 'new'});
      enviado = true; delete P.rascunho[svc.code];
      P.tela = 'ok';
      if (S.pubTab === 'secretaria'){ render(); scrollTo(0,0); }
    } catch(x){
      toast(msgErro(x));
      const b = document.getElementById('s24Enviar'); if (b){ b.disabled = false; b.textContent = 'Enviar solicitação'; }
    } finally { P.ocupado = false; }
  });
}

/* =========================================================
   PAINEL (Mais > Secretaria 24h)
   ========================================================= */
const A = {dados:null, estado:'nada', carregadoEm:0, filtro:'todas', busca:'', aberto:null, hist:{}, lendoHist:new Set(), nota:{}, salvando:false, timer:null, tick:0, conhecidos:null, abaAnterior:null};
const FILTROS = [['todas','Todas'],['new','Novas'],['in_progress','Em atendimento'],['waiting_user','Aguardando fiel'],['completed','Concluídas']];
const naTela = () => S.mode === 'painel' && S.tab === 'secretaria24h';
const naInicio = () => S.mode === 'painel' && S.tab === 'inicio';
// Equipe com acesso e painel aberto (login feito, ou modo demonstração).
const equipeAqui = () => S.mode === 'painel' && (!NUVEM.ativo || logado()) && pode('secretaria24h');
// Computador/tablet deitado: lista e detalhe lado a lado (mesma largura do CSS).
const largo = () => !!window.matchMedia?.('(min-width:1024px)').matches;

/* "Nova" = recebida e ainda não aberta NESTE aparelho (a marca some ao abrir a solicitação). */
const VISTAS_KEY = () => 'central-paroquial-s24-vistas-' + (NUVEM.parishId || 'demo');
function vistasLer(){ try { const l = JSON.parse(localStorage.getItem(VISTAS_KEY())); return new Set(Array.isArray(l) ? l : []); } catch(e){ return new Set(); } }
function marcarVisto(id){
  const v = vistasLer(); if (!id || v.has(id)) return;
  v.add(id); try { localStorage.setItem(VISTAS_KEY(), JSON.stringify([...v].slice(-500))); } catch(e){}
}

/* ---------- notificações do navegador (opcional, só depois de a pessoa aceitar) ----------
   Não é Web Push: o aviso aparece enquanto o painel estiver aberto (mesmo em outra aba ou minimizado).
   O pedido de permissão do navegador só acontece depois do clique em "Ativar notificações". */
const NOTIF_KEY = 'central-paroquial-notif-depois';
const notifSuportado = () => 'Notification' in window && window.isSecureContext !== false;
const notifAtivas = () => notifSuportado() && Notification.permission === 'granted';
function notifCardHTML(){
  if (!notifSuportado() || Notification.permission !== 'default') return '';
  try { if (Date.now() - (+localStorage.getItem(NOTIF_KEY) || 0) < 14 * 864e5) return ''; } catch(e){}
  return `<section class="notif-card" aria-labelledby="notifT"><b id="notifT">🔔 Quer receber aviso quando uma nova solicitação chegar?</b>
    <p class="small">O computador avisa mesmo com o painel em outra aba ou minimizado (o painel precisa estar aberto). Dá para desligar quando quiser nas configurações do navegador.</p>
    <div class="acoes"><button type="button" class="btn sm" data-notif="ativar">Ativar notificações</button><button type="button" class="btn sm ghost" data-notif="depois">Agora não</button></div></section>`;
}
function bindNotif(root){
  root.querySelector('[data-notif="ativar"]')?.addEventListener('click', async () => {
    let p = 'denied';
    try { p = await Notification.requestPermission(); } catch(e){}
    if (p === 'granted') toast('✓ Notificações ativadas neste computador');
    else { try { localStorage.setItem(NOTIF_KEY, String(Date.now())); } catch(e){} toast('Tudo bem. Os avisos continuam aparecendo aqui no painel.'); }
    render();
  });
  root.querySelector('[data-notif="depois"]')?.addEventListener('click', () => { try { localStorage.setItem(NOTIF_KEY, String(Date.now())); } catch(e){} render(); });
}
function notificarNavegador(novas, titulo){
  if (!notifAtivas() || !document.hidden) return;
  try {
    const r = novas[0];
    // Sem o nome do fiel: a notificação pode aparecer na tela bloqueada do computador.
    const n = new Notification(novas.length > 1 ? `${novas.length} novas solicitações — Secretaria 24h` : 'Nova solicitação — Secretaria 24h',
      {body: novas.length > 1 ? 'Abra o painel para ver.' : titulo(r.service_id) + '. Clique para abrir no painel.', tag:'s24-nova', lang:'pt-BR'});
    n.onclick = () => { window.focus(); novas.length > 1 ? abrirFila('new') : abrirSolicitacao(r.id); n.close(); };
  } catch(e){ /* Android: notificação só com Service Worker (fica para o Web Push) */ }
}
// Chegou solicitação nova desde a última leitura: aviso discreto do próprio sistema (não interrompe).
function avisarChegadas(novas, d){
  if (!novas.length) return;
  const titulo = id => d.catalogo.find(s => s.id === id)?.title || 'Secretaria 24h';
  if (window.avisoToast){
    if (novas.length > 2) avisoToast({icone:'📥', titulo:`${novas.length} novas solicitações`, linhas:['Secretaria 24h'], acao:{rotulo:'Ver solicitações', fn:() => abrirFila('new')}});
    else novas.forEach(r => avisoToast({icone:'📥', titulo:'Nova solicitação', linhas:[titulo(r.service_id), r.requester_name], acao:{rotulo:'Ver solicitação', fn:() => abrirSolicitacao(r.id)}}));
  }
  notificarNavegador(novas, titulo);
}

function redesenhar(){
  if (naTela() || naInicio()) renderSeguro();
  if (typeof atualizarAtencao === 'function') atualizarAtencao(); // badge do menu e 🔔, sem mexer no que está sendo digitado
}
async function carregarPainel(){
  if (A.estado === 'carregando') return;
  const antes = A.estado;
  A.estado = 'carregando';
  try {
    const d = await apiPainel();
    const mudou = JSON.stringify(d) !== JSON.stringify(A.dados);
    if (A.conhecidos) avisarChegadas(d.lista.filter(r => r.status === 'new' && !A.conhecidos.has(r.id)), d);
    A.conhecidos = new Set(d.lista.map(r => r.id));
    A.dados = d; A.estado = 'ok'; A.carregadoEm = Date.now();
    if (A.aberto && !d.lista.some(r => r.id === A.aberto)) A.aberto = null;
    if (mudou || antes !== 'ok') redesenhar();
  } catch(e){
    A.estado = (typeof tabelaFaltando === 'function' && tabelaFaltando(e)) ? 'ausente' : 'erro';
    console.warn('Secretaria 24h: falha ao ler solicitações', e);
    redesenhar();
  }
}
async function carregarHist(id){
  if (A.lendoHist.has(id)) return;
  A.lendoHist.add(id);
  try { A.hist[id] = await apiHistorico(id); }
  catch(e){ A.hist[id] = A.hist[id] || null; console.warn('Secretaria 24h: falha ao ler histórico', e); }
  finally { A.lendoHist.delete(id); }
  if (naTela() && A.aberto === id) renderSeguro();
}
function iniciarAtualizacao(){
  if (A.timer) return;
  // Sem Realtime: relê a cada 30 s na tela da Secretaria 24h e a cada 60 s no resto do painel (badge, Início, 🔔).
  // Com a aba escondida, só continua se a pessoa ativou as notificações do navegador.
  A.timer = setInterval(() => {
    if (!equipeAqui() || A.salvando || (document.hidden && !notifAtivas())) return;
    A.tick++;
    if (naTela() || A.tick % 2 === 0){ carregarPainel(); if (naTela() && A.aberto && !document.hidden) carregarHist(A.aberto); }
  }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && equipeAqui() && Date.now() - A.carregadoEm > 15000) carregarPainel(); });
}
// Chamado a cada desenho do painel: ao ENTRAR na fila ou no Início, relê (os números nunca abrem velhos).
function iniciar(){
  iniciarAtualizacao();
  const entrou = S.tab !== A.abaAnterior && (naTela() || naInicio());
  A.abaAnterior = S.tab;
  if (A.estado === 'nada' || (entrou && A.estado !== 'carregando')) carregarPainel();
}

// Números para o Início, o menu e o 🔔.
function resumo(){
  if (A.estado === 'nada') carregarPainel();
  if (!A.dados) return {estado: A.estado === 'erro' || A.estado === 'ausente' ? A.estado : 'carregando'};
  const hoje = diaSP(new Date().toISOString()), vs = vistasLer();
  const cont = {new:0, in_progress:0, waiting_user:0, completed:0, closed:0, concluidasHoje:0};
  A.dados.lista.forEach(r => { cont[r.status] = (cont[r.status] || 0) + 1; if (r.status === 'completed' && r.updated_at && diaSP(r.updated_at) === hoje) cont.concluidasHoje++; });
  const novas = A.dados.lista.filter(r => r.status === 'new').sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(r => ({id:r.id, nome:r.requester_name, servico:servicoDe(r.service_id)?.title || 'Serviço', created_at:r.created_at, visto:vs.has(r.id), is_demo:!!r.is_demo}));
  return {estado:'ok', cont, novas};
}
function irTela(){ S.mode = 'painel'; S.tab = 'secretaria24h'; if (typeof fecharSino === 'function') fecharSino(); save(); render(); scrollTo(0,0); }
function abrirFila(filtro){ A.filtro = FILTROS.some(([k]) => k === filtro) ? filtro : 'todas'; A.aberto = null; A.busca = ''; irTela(); }
function abrirSolicitacao(id){ A.aberto = id; delete A.hist[id]; marcarVisto(id); irTela(); }

const servicoDe = id => A.dados?.catalogo.find(s => s.id === id);
function filtrada(){
  const l = A.dados.lista, q = semAc(A.busca.trim()), qd = A.busca.replace(/\D/g, ''), qp = A.busca.trim().toUpperCase();
  return l.filter(r => (A.filtro === 'todas' || r.status === A.filtro) && (!q ||
    semAc(r.requester_name).includes(q) || r.protocol.includes(qp) || (qd.length >= 3 && r.whatsapp.includes(qd))));
}

function painelHTML(){
  iniciarAtualizacao();
  if (A.estado === 'nada' || (A.estado === 'ok' && Date.now() - A.carregadoEm > 30000)) carregarPainel();
  if (A.estado === 'ausente') return `<h2>Secretaria 24h</h2>${indispHTML('s24Recarregar')}<p class="small muted" style="margin:10px 4px">Para o responsável pelo sistema: o banco ainda não tem a atualização <b>supabase/secretaria24h.sql</b>.</p>`;
  if (!A.dados){
    if (A.estado === 'erro') return `<h2>Secretaria 24h</h2>${indispHTML('s24Recarregar')}`;
    return `<h2>Secretaria 24h</h2><div class="status" role="status"><span class="spinner"></span>Carregando solicitações…</div>`;
  }
  const r = A.aberto && A.dados.lista.find(x => x.id === A.aberto);
  if (r) marcarVisto(r.id);
  // Dados já carregados continuam na tela; se a última releitura falhou, avisa sem esconder nada.
  // Celular: lista OU detalhe. Computador: resumo no topo e, embaixo, lista à esquerda e detalhe à direita.
  return (A.estado === 'erro' ? indispHTML() : '') + `<div class="s24-painel${r ? ' com-detalhe' : ''}">
    ${topoHTML()}
    <div class="s24-md"><div class="s24-md-lista">${listaHTML()}</div><div class="s24-md-det">${r ? detalheHTML(r) : semSelecaoHTML()}</div></div>
  </div>`;
}
function topoHTML(){
  const cont = {}; A.dados.lista.forEach(r => cont[r.status] = (cont[r.status] || 0) + 1);
  return `<div class="s24-topo"><h2>📥 Secretaria 24h</h2>
  <p class="lead small">Solicitações recebidas pela secretaria digital, a qualquer hora. Responda no horário de atendimento; nada é enviado automaticamente ao fiel.</p>
  <div class="stats quatro s24-cards">${['new','in_progress','waiting_user','completed'].map(k => `<button type="button" class="stat${k === 'new' && cont.new ? ' s24-quente' : ''}" data-s24-f="${k}" aria-pressed="${A.filtro===k}"><b>${cont[k] || 0}</b><span>${ST[k].card}</span></button>`).join('')}</div></div>`;
}
const VAZIO = {new:'Nenhuma solicitação nova 🎉<br>Tudo em dia por aqui.', in_progress:'Nenhuma solicitação em atendimento agora.', waiting_user:'Ninguém aguardando resposta do fiel.', completed:'Nenhuma solicitação concluída ainda.'};
function listaHTML(){
  const l = filtrada(), vs = vistasLer();
  return `<div class="filtros" role="group" aria-label="Filtrar solicitações">${FILTROS.map(([k,t]) => `<button type="button" data-s24-f="${k}" aria-pressed="${A.filtro===k}">${t}</button>`).join('')}</div>
  <input type="text" id="s24Busca" placeholder="🔎 Buscar por nome, telefone ou protocolo" aria-label="Buscar solicitação" value="${esc(A.busca)}" style="margin-bottom:10px">
  ${l.length ? `<div class="list s24-lista">${l.map(r => { const sel = r.id === A.aberto;
      return `<button type="button" class="pick-row s24-row${sel ? ' sel' : ''}" data-s24-req="${esc(r.id)}"${sel ? ' aria-current="true"' : ''}>
      <span class="grow"><span class="s24-row-l1"><b>${esc(r.requester_name)}</b>${r.status === 'new' && !vs.has(r.id) ? ' <span class="s24-nova">Nova</span>' : ''}${r.is_demo ? ' <span class="chip neutro">demonstração</span>' : ''}</span>
      <span class="small muted" style="display:block">${esc(servicoDe(r.service_id)?.title || 'Serviço')} · ${esc(r.protocol)}</span>
      <span class="small muted" style="display:block">${dataHora(r.created_at)} · ${esc(ago(Date.parse(r.created_at)))}</span></span>
      ${chipSt(r.status)}</button>`; }).join('')}</div>`
    : `<div class="empty">${A.busca.trim() ? 'Nenhuma solicitação encontrada com essa busca.' : !A.dados.lista.length ? 'Nenhuma solicitação recebida ainda.<br>Quando um fiel enviar pelo celular, ela aparece aqui.' : VAZIO[A.filtro] || 'Nenhuma solicitação com este filtro.'}</div>`}
  <button type="button" class="btn ghost block-w" id="s24Recarregar">Atualizar lista agora</button>
  <p class="small muted s24-auto">A lista também se atualiza sozinha a cada 30 segundos.</p>`;
}
function semSelecaoHTML(){
  const n = A.dados.lista.filter(r => r.status === 'new').length;
  return `<div class="s24-vazio"><div class="s24-vazio-ic" aria-hidden="true">📥</div>
    <b>Selecione uma solicitação na lista</b>
    <p class="small muted">Os detalhes aparecem aqui, ao lado da lista, sem precisar voltar.</p>
    ${n ? `<p>${n === 1 ? 'Há 1 solicitação nova' : `Há ${n} solicitações novas`} esperando atendimento.</p>` : '<p>Nenhuma solicitação nova 🎉<br>Tudo em dia por aqui.</p>'}</div>`;
}
function respostasHTML(r){
  const svc = servicoDe(r.service_id), ans = r.answers && typeof r.answers === 'object' ? r.answers : {};
  const campos = camposOk(svc), conhecidos = new Set(campos.map(f => f.name));
  const linhas = campos.filter(f => ans[f.name]).map(f => [f.label, f.type === 'date' ? dataCurta(String(ans[f.name])) : String(ans[f.name])])
    .concat(Object.keys(ans).filter(k => !conhecidos.has(k) && ans[k]).map(k => [k, String(ans[k])]));
  return linhas.length ? `<dl class="s24-dl">${linhas.map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '<p class="small muted" style="margin:0">Nenhum campo preenchido além do contato.</p>';
}
function detalheHTML(r){
  const svc = servicoDe(r.service_id), h = A.hist[r.id], n = A.nota[r.id] || {status:r.status, texto:'', publica:false};
  if (h === undefined) carregarHist(r.id);
  const msg = `Olá, ${primeiroNome(r.requester_name)}! Aqui é da secretaria da ${S.cfg.nome}, sobre a sua solicitação ${r.protocol} (${svc?.title || 'Secretaria 24h'}).`;
  return `<button class="crumb" data-s24-voltar>‹ Secretaria 24h</button>
  <h2 class="s24-det-t">${esc(svc?.title || 'Solicitação')}</h2>
  <div class="block">
    <dl class="s24-dl">
      <dt>Protocolo</dt><dd>${esc(r.protocol)}${r.is_demo ? ' <span class="chip neutro">demonstração</span>' : ''}</dd>
      <dt>Serviço</dt><dd>${esc(svc?.title || '—')}</dd>
      <dt>Nome</dt><dd>${esc(r.requester_name)}</dd>
      <dt>WhatsApp</dt><dd>${esc(foneBR(r.whatsapp))}</dd>
      <dt>Preferência</dt><dd>${esc(PREF[r.contact_preference] || r.contact_preference)}</dd>
      <dt>Recebida em</dt><dd>${dataHora(r.created_at)}</dd>
      <dt>Status</dt><dd>${chipSt(r.status)}</dd>
    </dl>
    <div class="acoes">
      <a class="btn wa" href="${esc(waLink(r.whatsapp, msg))}" target="_blank" rel="noopener">Responder fiel no WhatsApp</a>
      ${r.contact_preference !== 'whatsapp' ? `<a class="btn ghost" href="${esc(telLink(r.whatsapp))}">Ligar para o fiel</a>` : ''}
    </div>
  </div>
  <h2>Respostas do formulário</h2>
  <div class="block">${respostasHTML(r)}</div>
  <h2>Atualizar atendimento</h2>
  <form class="block" id="s24St" novalidate>
    <div class="field"><label for="s24-st">Status</label><select id="s24-st" name="status">${Object.keys(ST).map(k => `<option value="${k}" ${n.status===k?'selected':''}>${ST[k].adm}</option>`).join('')}</select></div>
    <div class="field"><label for="s24-nota">Nota</label><textarea id="s24-nota" name="nota" maxlength="1000" placeholder="Ex.: Localizamos o registro. A certidão está sendo preparada.">${esc(n.texto)}</textarea></div>
    <label class="check"><input type="checkbox" name="publica" ${n.publica?'checked':''}> Esta mensagem pode aparecer para o fiel no acompanhamento</label>
    <p class="small muted" style="margin:-4px 0 12px">Sem marcar, a nota fica só para a equipe. A mudança de status sempre aparece para o fiel, sem a nota interna.</p>
    <button class="btn block-w" id="s24Salvar" ${A.salvando?'disabled':''}>Salvar alteração</button>
  </form>
  <h2>Histórico</h2>
  ${h === undefined ? `<div class="status" role="status"><span class="spinner"></span>Carregando histórico…</div>`
    : h === null ? `<div class="block small">Não foi possível carregar o histórico. <button type="button" class="link-btn" style="color:var(--lit)" id="s24Hist">Tentar de novo</button></div>`
    : `<ol class="s24-linha s24-linha-adm">${h.slice().reverse().map(x => `<li class="s24-st-${esc(x.status)}">
        <b>${stInfo(x.status).ic} ${esc(stInfo(x.status).adm)}</b>
        <span class="small muted">${dataHora(x.created_at)} · ${x.public_note ? 'visível para o fiel' : '<b>nota interna</b>'}</span>
        ${x.note ? `<div class="s24-msg ${x.public_note ? '' : 's24-interna'}">${esc(x.note)}</div>` : ''}
      </li>`).join('')}</ol>`}`;
}

function bindPainel(root){
  root.querySelector('#s24Recarregar')?.addEventListener('click', () => { carregarPainel(); toast('Atualizando…'); });
  root.querySelectorAll('[data-s24-f]').forEach(b => b.onclick = () => { A.filtro = A.filtro === b.dataset.s24F && b.dataset.s24F !== 'todas' ? 'todas' : b.dataset.s24F; render(); });
  root.querySelectorAll('[data-s24-req]').forEach(b => b.onclick = () => {
    A.aberto = b.dataset.s24Req; delete A.hist[A.aberto]; marcarVisto(A.aberto); render();
    // Computador: a lista fica onde estava e o detalhe abre ao lado. Celular: o detalhe ocupa a tela.
    if (largo()) document.querySelector('.s24-md-det')?.scrollTo(0, 0); else scrollTo(0,0);
  });
  bindNotif(root);
  root.querySelector('[data-s24-voltar]')?.addEventListener('click', () => { A.aberto = null; render(); scrollTo(0,0); });
  root.querySelector('#s24Hist')?.addEventListener('click', () => { delete A.hist[A.aberto]; render(); });
  const b = root.querySelector('#s24Busca');
  b?.addEventListener('input', () => { A.busca = b.value; const pos = b.selectionStart; render(); const n = document.getElementById('s24Busca'); n.focus(); n.setSelectionRange(pos, pos); });

  const f = root.querySelector('#s24St'); if (!f) return;
  const id = A.aberto;
  let salvo = false; // mesma proteção do formulário público (change do campo removido)
  const lerForm = () => { if (salvo || !f.isConnected) return; A.nota[id] = {status:f.elements.status.value, texto:f.elements.nota.value, publica:f.elements.publica.checked}; };
  f.addEventListener('input', lerForm); f.addEventListener('change', lerForm);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (A.salvando) return;
    lerForm();
    const n = A.nota[id], r = A.dados.lista.find(x => x.id === id);
    if (n.status === r.status && !n.texto.trim()){ toast(ERROS.nada_alterado); return; }
    if (n.publica && n.texto.trim() && !confirm('Esta nota vai aparecer para o fiel no acompanhamento do protocolo. Confirmar?')) return;
    A.salvando = true; f.querySelector('#s24Salvar').disabled = true;
    try {
      await apiAtualizar(id, n.status, n.texto, n.publica);
      salvo = true; delete A.nota[id];
      toast(n.status !== r.status ? '✓ Status atualizado: ' + ST[n.status].adm : '✓ Nota registrada');
      r.status = n.status; // mostra já; a releitura abaixo confirma com o banco
      await Promise.all([carregarPainel(), carregarHist(id)]);
    } catch(x){
      // O que foi escrito continua no formulário (A.nota); "Tentar novamente" envia de novo.
      if (window.avisoToast) avisoToast({icone:'⚠️', tipo:'erro', titulo:'Não foi possível salvar agora', linhas:[msgErro(x)], tempo:15000,
        acao:{rotulo:'Tentar novamente', fn:() => document.getElementById('s24Salvar')?.click()}});
      else toast(msgErro(x));
    }
    finally { A.salvando = false; if (naTela()) render(); }
  });
}

// Falha isolada: nenhum erro deste módulo sobe para o render() do index.html.
// Card e botão somem; as telas do módulo mostram o aviso de indisponível; o resto do site segue.
const falhou = (onde, e) => console.warn('Secretaria 24h: falha em ' + onde, e);
const seguro = (fn, reserva) => (...a) => { try { return fn(...a); } catch(e){ falhou(fn.name, e); return reserva(); } };
const telaIndisp = volta => () => `<button class="crumb" data-pub="${volta}">‹ ${volta === 'igreja' ? 'Igreja' : 'Voltar'}</button><h2>Secretaria 24h</h2>${indispHTML()}`;

window.S24 = {
  cardHomeHTML: seguro(cardHomeHTML, () => ''),
  disponivel: seguro(disponivel, () => false), // ação "Secretaria 24h" na Home pública
  botaoParoquiaHTML: seguro(botaoParoquiaHTML, () => ''),
  publicoHTML: seguro(publicoHTML, () => { P.tela = 'inicio'; return telaIndisp('igreja')(); }),
  bindPublico: seguro(bindPublico, () => {}),
  painelHTML: seguro(painelHTML, () => { A.aberto = null; return '<h2>Secretaria 24h</h2>' + indispHTML(); }),
  bindPainel: seguro(bindPainel, () => {}),
  // Início, menu e 🔔 do painel
  iniciar: seguro(iniciar, () => {}),
  resumo: seguro(resumo, () => ({estado:'erro'})),
  abrirFila: seguro(abrirFila, () => {}),
  abrirSolicitacao: seguro(abrirSolicitacao, () => {}),
  notifCardHTML: seguro(notifCardHTML, () => ''),
  bindNotif: seguro(bindNotif, () => {}),
  s24Whats, validar
};
})();
