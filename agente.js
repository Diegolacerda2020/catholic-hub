/* =========================================================
   Central Paroquial — ASSISTENTE PAROQUIAL (módulo isolado do painel)

   "Fale normalmente. A Central organiza para você."

   Interface do painel para o núcleo do agente (agente-core.js). Só aparece para quem está logado na
   paróquia (ou no modo demonstração). Usa a sessão que o app já tem (NUVEM.sb, NUVEM.parishId, NUVEM.papel):
   a paróquia de trabalho é SEMPRE a da sessão, nunca a que aparece no texto.

   Carregado depois de agente-core.js e ANTES do script principal do index.html; usa as funções dele
   (S, NUVEM, esc, render, toast, irPara…) só na hora em que é chamado. Para desligar, basta remover os
   <script>/<link> do agente: o index.html testa window.AGENTE antes de cada gancho.
   A conversa fica só na memória desta aba (nada em localStorage, nada em parish_state).
   ========================================================= */
(function(){
'use strict';
if (!window.AgenteCore) return; // sem o núcleo, o módulo não liga (o resto do app segue igual)
const Core = window.AgenteCore;

/* ---------- sessão → contrato de entrada do agente ---------- */
const real = () => !!NUVEM.ativo;
function sessao(){
  if (real()){
    if (!logado() || !NUVEM.sessao?.user?.id) return null;
    return {userId:NUVEM.sessao.user.id, papel:NUVEM.papel, parishId:NUVEM.parishId};
  }
  const papel = papelAtual(); // modo demonstração: o seletor "Usando agora"
  return {userId:'demo-' + papel, papel, parishId:'demo'};
}
const entrada = (s, extra = {}) => ({channel:'painel', sender:{userId:s.userId, papel:s.papel},
  parish:{id:s.parishId, slug:NUVEM.slug, nome:S.cfg?.nome || ''}, message:'', timestamp:new Date().toISOString(), ...extra});

/* ---------- backend: Supabase (com login) ou dados deste aparelho (demonstração) ---------- */
function backendReal(){
  const b = Core.criarBackendSupabase(NUVEM.sb, {slug:NUVEM.slug});
  return {...b,
    horariosMissa: async () => S.cfg?.missas || '',
    async criarEvento(a){
      const r = await b.criarEvento(a);
      try { registrar('criou-evento', r?.title || a.evento.title); await relCarregar(); } catch(e){} // Uso + Agenda do painel
      return r;
    }
  };
}
const soDemo = () => Object.assign(new Error('demo'), {code:'DEMO'});
function backendDemo(){
  return {
    async listarEventos({inicio, fim}){ return rel('events').filter(e => e.starts_at >= inicio && e.starts_at < fim); },
    async listarComunidades(){ return rel('communities'); },
    async criarEvento({evento}){
      const {parish_id, source, ...o} = evento;
      const r = await relGravar('events', o); if (!r) throw new Error('falha ao gravar');
      registrar('criou-evento', r.title); return r;
    },
    async listarServicos(){ throw soDemo(); },
    async listarSolicitacoes(){ throw soDemo(); },
    async atualizarSolicitacao(){ throw soDemo(); },
    async auditar(){},
    async paroquiasConhecidas(){ return []; },
    horariosMissa: async () => S.cfg?.missas || ''
  };
}

/* ---------- estado da conversa (só memória, por usuário + paróquia) ---------- */
const E = {chave:null, agente:null, msgs:[], acoes:{}, rascunho:'', ocupado:false, editando:null, resolvidas:{}, rolar:false};
function agenteAtual(){
  const s = sessao(); if (!s) return null;
  const chave = s.userId + '|' + s.parishId + '|' + s.papel;
  if (E.chave !== chave){
    Object.assign(E, {chave, msgs:[], acoes:{}, rascunho:'', ocupado:false, editando:null, resolvidas:{}});
    E.agente = Core.criarAgente({backend: real() ? backendReal() : backendDemo()});
  }
  return {s, agente:E.agente};
}
const ERRO_DEMO = 'No modo demonstração, a Secretaria 24h fica só na tela Secretaria 24h.';

async function falar(texto){
  const a = agenteAtual(); if (!a || E.ocupado) return;
  texto = String(texto || '').trim().slice(0, 1000); if (!texto) return;
  E.msgs.push({de:'eu', texto}); E.rascunho = ''; E.ocupado = true; E.rolar = true; redesenhar();
  await responder(() => a.agente.receber(entrada(a.s, {message:texto})));
}
async function responder(fn){
  let r;
  try { r = await fn(); }
  catch(e){ r = {tipo:'erro', linhas:['Não consegui responder agora. Tente de novo em instantes.']}; console.warn('Assistente: falha', e); }
  if (r?.tipo === 'erro' && /consultar agora|concluir agora/.test((r.linhas || []).join(' ')) && !real()) r = {tipo:'resposta', linhas:[ERRO_DEMO]};
  if (r?.confirmacao?.faltando?.length) E.editando = r.confirmacao.id; // falta dado: já abre o "Corrigir"
  E.msgs.push({de:'agente', r}); E.ocupado = false; E.rolar = true; redesenhar();
}
function redesenhar(){ if (S.mode === 'painel' && S.tab === 'assistente') render(); }

/* ---------- desenho ---------- */
const P = ls => (ls || []).map(l => `<p>${esc(l)}</p>`).join('');
function acoesHTML(lista, pref){
  return (lista || []).map((a, i) => { const k = pref + '-' + i; E.acoes[k] = a; return `<button type="button" class="btn sm ${a.tipo === 'perguntar' || a.tipo === 'focar' ? 'ghost' : ''}" data-ag-acao="${k}">${esc(a.rotulo)}</button>`; }).join('');
}
function confHTML(c, idx){
  const fim = E.resolvidas[c.id];
  if (E.editando === c.id && !fim) return editarHTML(c);
  const avisos = (c.avisos || []).map(a => `<div class="signal wait">${esc(a)}</div>`).join('');
  return `<div class="ag-conf${fim ? ' ag-fim' : ''}" role="group" aria-label="${esc(c.titulo)}">
    <div class="ag-conf-t">${esc(c.titulo)}</div>
    <dl class="ag-dl">${c.campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${avisos}${c.nota ? `<p class="small muted">${esc(c.nota)}</p>` : ''}
    ${fim ? `<p class="small ag-fim-t">${esc(fim)}</p>` : `<div class="ag-botoes">
      <button type="button" class="btn" data-ag-conf="${esc(c.id)}" ${c.faltando?.length ? 'disabled aria-disabled="true"' : ''}>Confirmar</button>
      <button type="button" class="btn ghost" data-ag-corr="${esc(c.id)}">Corrigir</button>
      <button type="button" class="btn ghost" data-ag-canc="${esc(c.id)}">Cancelar</button></div>`}
  </div>`;
}
function editarHTML(c){
  const v = c.editar || {}, id = esc(c.id);
  const avisos = (c.avisos || []).map(a => `<div class="signal wait">${esc(a)}</div>`).join('');
  if (c.tipo === 'solicitacao') return `<form class="ag-conf ag-edit" data-ag-form="${id}">
    <div class="ag-conf-t">${esc(c.titulo)}</div>${avisos}
    <div class="field"><label for="ag-st">Nova situação</label><select id="ag-st" name="status">${v.opcoes.map(o => `<option value="${esc(o.valor)}" ${o.valor === v.status ? 'selected' : ''}>${esc(o.rotulo)}</option>`).join('')}</select></div>
    <div class="ag-botoes"><button class="btn">Revisar</button><button type="button" class="btn ghost" data-ag-canc="${id}">Cancelar</button></div></form>`;
  const falta = k => (c.faltando || []).includes(k) ? ' aria-invalid="true"' : '';
  return `<form class="ag-conf ag-edit" data-ag-form="${id}">
    <div class="ag-conf-t">${esc(c.titulo)}</div>${avisos}
    <div class="field"><label for="ag-tit">Evento *</label><input id="ag-tit" name="titulo" maxlength="160" value="${esc(v.titulo)}"${falta('titulo')} placeholder="Ex.: Missa, Terço dos homens"></div>
    <div class="field"><label for="ag-dia">Data *</label><input type="date" id="ag-dia" name="dia" value="${esc(v.dia)}"${falta('dia')}></div>
    <div class="two">
      <div class="field"><label for="ag-hi">Hora inicial *</label><input type="time" id="ag-hi" name="hora" value="${esc(v.hora)}"${falta('hora')}></div>
      <div class="field"><label for="ag-hf">Hora final</label><input type="time" id="ag-hf" name="horaFim" value="${esc(v.horaFim)}"${falta('horaFim')}></div>
    </div>
    <div class="field"><label for="ag-loc">Local</label><input id="ag-loc" name="local" maxlength="200" value="${esc(v.local)}"></div>
    <div class="field"><label for="ag-com">Comunidade</label><select id="ag-com" name="comunidadeId"${falta('comunidade')}>
      ${(c.faltando || []).includes('comunidade') ? '<option value="__" selected>— escolha —</option>' : ''}
      <option value="" ${!v.comunidadeId && !(c.faltando || []).includes('comunidade') ? 'selected' : ''}>Toda a paróquia</option>
      ${(v.comunidades || []).map(o => `<option value="${esc(o.valor)}" ${o.valor === v.comunidadeId ? 'selected' : ''}>${esc(o.rotulo)}</option>`).join('')}</select>
      ${(v.comunidades || []).length ? '' : '<div class="hint">Esta paróquia ainda não possui comunidades cadastradas.</div>'}</div>
    <div class="field"><label for="ag-desc">Descrição</label><textarea id="ag-desc" name="descricao" maxlength="4000" style="min-height:64px">${esc(v.descricao)}</textarea></div>
    <label class="check"><input type="checkbox" name="publico" ${v.publico ? 'checked' : ''}> Mostrar na agenda pública</label>
    <div class="ag-botoes"><button class="btn">Revisar</button><button type="button" class="btn ghost" data-ag-canc="${id}">Cancelar</button></div></form>`;
}
function msgHTML(m, i){
  if (m.de === 'eu') return `<div class="ag-msg ag-eu"><div class="ag-bolha">${esc(m.texto)}</div></div>`;
  const r = m.r || {}, cls = r.tipo === 'negado' ? ' ag-negado' : r.tipo === 'erro' ? ' ag-erro' : r.tipo === 'feito' ? ' ag-feito' : '';
  const itens = (r.itens || []).length ? `<ul class="ag-itens">${r.itens.map((x, j) => `<li><b>${esc(x.titulo)}</b>${x.detalhe ? `<span>${esc(x.detalhe)}</span>` : ''}${x.acoes ? `<div class="ag-item-acoes">${acoesHTML(x.acoes, i + '-i' + j)}</div>` : ''}</li>`).join('')}</ul>` : '';
  const sug = (r.sugestoes || []).length ? `<div class="ag-sug">${r.sugestoes.map(s => `<button type="button" class="ag-chip" data-ag-diga="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : '';
  return `<div class="ag-msg ag-ele"><div class="ag-bolha${cls}">${r.tipo === 'feito' ? '<span class="ag-ok" aria-hidden="true">✓</span>' : ''}${P(r.linhas)}${itens}${P(r.rodape).replace(/<p>/g, '<p class="small muted">')}
    ${r.confirmacao ? confHTML(r.confirmacao, i) : ''}${(r.acoes || []).length ? `<div class="ag-botoes">${acoesHTML(r.acoes, i + '-a')}</div>` : ''}${sug}</div></div>`;
}
function painelHTML(){
  const a = agenteAtual();
  if (!a) return '<h2>✨ Assistente Paroquial</h2><div class="signal wait">Entre com seu usuário da paróquia para usar o Assistente.</div>';
  E.acoes = {};
  const vazio = !E.msgs.length;
  const exemplos = ['O que temos amanhã?', ...(Core.podeArea(a.s.papel, 'secretaria24h') ? ['Quais solicitações estão pendentes?'] : []),
    ...(Core.podeArea(a.s.papel, 'agenda') ? ['Crie um evento sábado às 19h.'] : []), 'Quais serviços da secretaria estão disponíveis?',
    'Mostre os eventos desta semana.', 'Quais comunidades estão cadastradas?'];
  return `<div class="ag-cab"><h2>✨ Assistente Paroquial</h2><p class="ag-sub">Fale normalmente. A Central organiza para você.</p></div>
  ${vazio ? `<div class="ag-vazio"><p class="small muted">Experimente:</p><div class="ag-sug">${exemplos.map(s => `<button type="button" class="ag-chip" data-ag-diga="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>` : ''}
  <div class="ag-conversa" role="log" aria-live="polite" aria-label="Conversa com o Assistente">${E.msgs.map(msgHTML).join('')}
    ${E.ocupado ? '<div class="ag-msg ag-ele"><div class="ag-bolha ag-pensando" role="status"><span class="spinner"></span>Organizando…</div></div>' : ''}</div>
  <form class="ag-form" id="agF" autocomplete="off">
    <label class="sr" for="agTxt">Escreva para o Assistente</label>
    <textarea id="agTxt" rows="2" maxlength="1000" placeholder="Ex.: O que temos amanhã?">${esc(E.rascunho)}</textarea>
    <button class="btn" id="agEnviar" ${E.ocupado ? 'disabled' : ''}>Enviar</button>
  </form>
  <p class="small muted ag-rodape">O Assistente consulta e prepara. Nada é criado ou alterado sem o seu “Confirmar”.</p>`;
}
function bindPainel(root){
  const a = agenteAtual(); if (!a) return;
  const f = root.querySelector('#agF'), txt = root.querySelector('#agTxt');
  txt?.addEventListener('input', () => { E.rascunho = txt.value; });
  txt?.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit')); } });
  f?.addEventListener('submit', ev => { ev.preventDefault(); falar(txt.value); });
  root.querySelectorAll('[data-ag-diga]').forEach(b => b.onclick = () => falar(b.dataset.agDiga));
  root.querySelectorAll('[data-ag-acao]').forEach(b => b.onclick = () => executarAcao(E.acoes[b.dataset.agAcao]));
  root.querySelectorAll('[data-ag-conf]').forEach(b => b.onclick = () => {
    const id = b.dataset.agConf; if (E.resolvidas[id] || E.ocupado) return;
    b.disabled = true; E.resolvidas[id] = 'Confirmado.'; E.ocupado = true; redesenhar();
    responder(() => a.agente.confirmar(entrada(a.s, {confirmacaoId:id})));
  });
  root.querySelectorAll('[data-ag-corr]').forEach(b => b.onclick = () => { E.editando = b.dataset.agCorr; redesenhar(); root.querySelector('[data-ag-form] input, [data-ag-form] select')?.focus(); });
  root.querySelectorAll('[data-ag-canc]').forEach(b => b.onclick = () => {
    const id = b.dataset.agCanc; if (E.resolvidas[id]) return;
    E.resolvidas[id] = 'Cancelado. Nada foi alterado.'; E.editando = null; E.ocupado = true; redesenhar();
    responder(() => a.agente.cancelar(entrada(a.s, {confirmacaoId:id})));
  });
  root.querySelectorAll('[data-ag-form]').forEach(fm => fm.addEventListener('submit', ev => {
    ev.preventDefault();
    const id = fm.dataset.agForm, el = fm.elements, campos = {};
    if (el.status) campos.status = el.status.value;
    else Object.assign(campos, {titulo:el.titulo.value, dia:el.dia.value, hora:el.hora.value, horaFim:el.horaFim.value, local:el.local.value,
      descricao:el.descricao.value, publico:el.publico.checked, ...(el.comunidadeId.value === '__' ? {} : {comunidadeId:el.comunidadeId.value})});
    E.resolvidas[id] = 'Corrigido abaixo.'; E.editando = null; E.ocupado = true; redesenhar();
    responder(() => a.agente.corrigir(entrada(a.s, {confirmacaoId:id}), campos));
  }));
  if (E.rolar){ E.rolar = false; const l = root.querySelectorAll('.ag-msg'); l[l.length - 1]?.scrollIntoView({block:'nearest'}); if (!E.editando) txt?.focus({preventScroll:true}); }
}
function executarAcao(x){
  if (!x) return;
  const a = agenteAtual(); if (!a) return;
  if (x.tipo === 'perguntar') return falar(x.valor);
  if (x.tipo === 'ir') return irPara(x.valor);
  if (x.tipo === 'abrir_fila') return window.S24 ? S24.abrirFila(x.valor === 'todas' ? undefined : x.valor) : irPara('secretaria24h');
  if (x.tipo === 'abrir_solicitacao') return window.S24 ? S24.abrirSolicitacao(x.valor) : irPara('secretaria24h');
  if (x.tipo === 'focar'){ E.ocupado = true; redesenhar(); return responder(() => a.agente.focar(entrada(a.s), x.valor)); }
}

/* ---------- card no Início do painel ---------- */
function cardInicioHTML(){
  if (!sessao()) return '';
  return `<section class="ag-card" aria-labelledby="agCardT">
    <div class="ag-card-t" id="agCardT"><span aria-hidden="true">✨</span> Assistente Paroquial</div>
    <p class="small">Fale normalmente. A Central organiza para você.</p>
    <form id="agIniF" class="ag-ini-form" autocomplete="off"><label class="sr" for="agIniTxt">Pergunte ao Assistente</label>
      <input id="agIniTxt" maxlength="1000" placeholder="Ex.: O que temos amanhã?"><button class="btn sm">Perguntar</button></form>
  </section>`;
}
function bindCard(root){
  const f = root.querySelector('#agIniF'); if (!f) return;
  f.addEventListener('submit', ev => {
    ev.preventDefault();
    const t = f.querySelector('#agIniTxt').value.trim();
    S.tab = 'assistente'; save(); render(); scrollTo(0, 0);
    if (t) falar(t); else document.getElementById('agTxt')?.focus();
  });
}

// Falha isolada: nenhum erro deste módulo sobe para o render() do index.html.
const seguro = (fn, reserva) => (...a) => { try { return fn(...a); } catch(e){ console.warn('Assistente: falha em ' + fn.name, e); return reserva(); } };
window.AGENTE = {
  painelHTML: seguro(painelHTML, () => '<h2>✨ Assistente Paroquial</h2><div class="signal wait">O Assistente está temporariamente indisponível. O resto do painel continua funcionando.</div>'),
  bindPainel: seguro(bindPainel, () => {}),
  cardInicioHTML: seguro(cardInicioHTML, () => ''),
  bindCard: seguro(bindCard, () => {})
};
})();
