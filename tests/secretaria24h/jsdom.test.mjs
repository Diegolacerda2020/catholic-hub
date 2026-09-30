import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
let html = fs.readFileSync(`${REPO}/index.html`, 'utf8');
const mod = fs.readFileSync(`${REPO}/secretaria24h.js`, 'utf8');
const semModulo = process.argv[2] === 'sem-modulo';
html = html.replace('<script src="config.js"></script>', '<script>window.CENTRAL_CONFIG = {};</script>')
           .replace('<script src="secretaria24h.js"></script>', semModulo ? '' : `<script>${mod}</script>`)
           .replace('<link rel="stylesheet" href="secretaria24h.css">', '');

const erros = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Not implemented|setting 'onchange'/.test(e.message)) erros.push('jsdom: ' + e.message + ' @ ' + String(e.detail?.stack || '').split(String.fromCharCode(10)).slice(1,3).join(' <- ')); });
vc.on('error', (...a) => erros.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://central.test/', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window, d = w.document;
w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function(){};
w.confirm = () => true;
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
const view = () => $('#view').textContent.replace(/\s+/g, ' ');
const lastToast = () => $$('.toast').pop()?.textContent || '';
let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok  ', m); else { fails++; console.log('  FAIL', m); } };
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', {bubbles:true})); };
const submit = f => f.dispatchEvent(new w.Event('submit', {bubbles:true, cancelable:true}));
await tick();

if (semModulo){
  console.log('== sem secretaria24h.js');
  $('#mPublico').click(); await tick();
  ok(!$('[data-s24-abrir]') && /Liturgia de hoje/.test(view()) && $('[data-acao="intencao"]'), 'Home abre normal, sem a ação Secretaria 24h');
  $('#tabs [data-tab="contato"]').click(); await tick();
  ok(!/Secretaria 24h/.test(view()) && /Secretaria paroquial/.test(view()), 'Paróquia abre normal, sem botão');
  $('#mPainel').click(); await tick();
  w.eval("S.tab='mais'; render()"); await tick();
  ok(!$('[data-mais="secretaria24h"]') && $$('[data-mais]').map(b => b.dataset.mais).join() === 'equipe,dizimistas,mensagens,pessoas,comunidades,uso,ajustes', 'Mais com os itens de antes (+ Equipe e Dizimistas, que saíram da barra do celular)');
  ok(!erros.length, 'sem erros de JS ' + erros.join(' | '));
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
}

console.log('== página pública (modo demonstração)');
$('#mPublico').click(); await tick(60);
const tabs = $$('#tabs [data-tab]').map(b => b.dataset.tab).join();
ok(tabs === 'igreja,agenda,comunidades,avisos,contato', 'barra pública continua com 5 abas: ' + tabs);
// Home nova: a Secretaria 24h é uma das 5 ações, no mesmo nível de Liturgia, Rezar, Intenção e Vela
const acoes = $$('.acoes-grid .acao').map(b => b.querySelector('b').textContent).join(' | ');
ok(acoes === 'Liturgia de hoje | Rezar | Pedir intenção de Missa | Acender uma vela | Secretaria 24h', 'ações da Home: ' + acoes);
ok(!/Hoje na Igreja/.test(view()), 'Home sem o bloco repetido "Hoje na Igreja"');
$('[data-s24-abrir]').click(); await tick();
ok(/Como podemos ajudar\?/.test(view()) && /recebe sua solicitação a qualquer momento\. O atendimento pela equipe acontece no horário normal/.test(view()), 'tela Secretaria 24h com o aviso de horário');
ok($('#tabs [aria-current="page"]')?.dataset.tab === 'igreja', 'aba Igreja continua marcada (subtela)');
ok($$('.s24-serv').length === 6, '6 serviços');
ok($('[data-s24-intencao]') && $('[data-pub="dizimista"]') && /Acompanhar protocolo/.test(view()), 'atalhos e "Acompanhar protocolo"');

$('[data-s24-servico="certidao"]').click(); await tick();
ok(/Orientações/.test(view()) && $('#s24F select[name="c_tipo_documento"]') && $('#s24F textarea[name="c_observacoes"]'), 'formulário da certidão com orientações, select e textarea');
let f = $('#s24F');
submit(f); await tick();
ok(/Tipo de documento/.test(lastToast()), 'bloqueia sem campo obrigatório: ' + lastToast());
f.elements.c_tipo_documento.value = 'Certidão de Batismo'; f.elements.c_tipo_documento.dispatchEvent(new w.Event('change', {bubbles:true}));
setVal(f.elements.c_nome_pessoa, 'Maria das Dores');
setVal(f.elements.c_observacoes, '<img src=x onerror=alert(1)>');
setVal(f.elements.nome, 'Maria das Dores'); setVal(f.elements.whats, '(31) 99876-5432');
// redesenho no meio do preenchimento (sincronização) não perde o que foi digitado
w.eval('render()'); await tick(); f = $('#s24F');
ok(f.elements.c_nome_pessoa.value === 'Maria das Dores' && f.elements.c_tipo_documento.value === 'Certidão de Batismo' && f.elements.whats.value === '(31) 99876-5432', 'rascunho preservado após redesenho');
submit(f); await tick();
ok(/autorização/.test(lastToast()), 'exige o consentimento: ' + lastToast());
f.elements.ok.checked = true; f.elements.ok.dispatchEvent(new w.Event('change', {bubbles:true}));
submit(f); await tick(80);
const proto = $('.s24-proto')?.textContent;
ok(/^SA-\d{4}-[0-9A-F]{8}$/.test(proto || '') && /Solicitação recebida/.test(view()) && /Guarde este protocolo/.test(view()), 'confirmação com protocolo ' + proto);
ok($('[data-s24-copiar]') && $('[data-s24-acompanhar]') && /Voltar à página da paróquia/.test(view()), 'botões copiar/acompanhar/voltar');

$('[data-s24-acompanhar]').click(); await tick(80);
ok(/Acompanhar solicitação/.test(view()) && /Certidão \/ documento paroquial/.test(view()) && $$('.s24-linha li').length === 1, 'acompanhamento mostra serviço e histórico');

// envio repetido (duplo clique) devolve o mesmo protocolo
$('[data-s24-ir="inicio"]').click(); await tick();
$('[data-s24-servico="certidao"]').click(); await tick(); f = $('#s24F');
f.elements.c_tipo_documento.value = 'Certidão de Crisma'; setVal(f.elements.c_nome_pessoa, 'Outra');
setVal(f.elements.nome, 'Maria'); setVal(f.elements.whats, '31998765432'); f.elements.ok.checked = true;
submit(f); await tick(80);
ok($('.s24-proto')?.textContent === proto, 'reenvio em 5 min: mesmo protocolo');

// consulta com WhatsApp errado
w.eval("render()"); $('[data-pub="igreja"]')?.click(); await tick();
$('[data-s24-abrir]').click(); await tick(); $('[data-s24-ir="consulta"]').click(); await tick();
let c = $('#s24C'); setVal(c.elements.proto, proto.toLowerCase()); setVal(c.elements.whats, '31999990000'); submit(c); await tick(80);
ok(/Não encontramos uma solicitação/.test(view()) && !$('.s24-res'), 'WhatsApp errado: não encontrado');

// atalho da intenção de Missa
$('[data-s24-ir="inicio"]').click(); await tick();
$('[data-s24-intencao]').click(); await tick();
ok(w.eval('S.pubTab') === 'intencao' && $('#intF'), 'atalho abre o pedido de intenção existente');
$('#tabs [data-tab="igreja"]').click(); await tick();
$('[data-s24-abrir]').click(); await tick();
$('[data-pub="dizimista"]').click(); await tick();
ok(w.eval('S.pubTab') === 'dizimista' && $('#dzPubF'), 'atalho abre "Quero ser dizimista" existente');

$('#tabs [data-tab="contato"]').click(); await tick();
ok($('#view [data-s24-abrir]') && /Secretaria 24h/.test($('#view [data-s24-abrir]').textContent), 'botão "Secretaria 24h" na página Paróquia');
$('#view [data-s24-abrir]').click(); await tick();
ok(w.eval('S.pubTab') === 'secretaria', 'botão da Paróquia abre a Secretaria 24h');

console.log('== painel');
$('#mPainel').click(); await tick();
// Celular: barra de baixo com 4 tarefas + Mais. Tablet/computador: todas as áreas no menu lateral (o CSS escolhe).
const ptabs = $$('#tabs [data-tab]:not(.so-lateral)').map(b => b.dataset.tab).join();
ok(ptabs === 'inicio,comunicar,agenda,intencoes,mais', 'barra do celular: ' + ptabs);
const lat = $$('#tabs [data-tab]:not(.so-barra)').map(b => b.dataset.tab).join();
ok(lat === 'inicio,secretaria24h,comunicar,agenda,intencoes,equipe,dizimistas,mensagens,pessoas,comunidades,uso,ajustes', 'menu lateral com todas as áreas: ' + lat);
ok(w.eval('S.tab') === 'inicio' && /Secretaria 24h/.test(view()) && $('[data-ir="s24"]'), 'painel abre no Início, com a Secretaria 24h em destaque');
w.eval("S.tab='mais'; render()"); await tick();
ok($('[data-mais="secretaria24h"]') && /Solicitações recebidas pela secretaria digital/.test(view()), 'item "Secretaria 24h" em Mais');
$('[data-mais="secretaria24h"]').click(); await tick(80);
ok(/NOVAS|Novas/.test(view()) && $$('.s24-cards .stat').length === 4 && $$('.s24-row').length === 1, 'lista com 4 cards e 1 solicitação');
ok($$('#tabs [aria-current="page"]').map(x => x.dataset.tab).join() === 'secretaria24h,mais', 'marcado: Secretaria 24h (menu lateral) e Mais (celular)');
const b = $('#s24Busca'); setVal(b, 'zzz'); await tick();
ok($$('.s24-row').length === 0, 'busca sem resultado');
setVal($('#s24Busca'), '98765'); await tick();
ok($$('.s24-row').length === 1, 'busca por telefone');
setVal($('#s24Busca'), proto.slice(-4)); await tick();
ok($$('.s24-row').length === 1, 'busca por protocolo');
setVal($('#s24Busca'), 'maria'); await tick();
ok($$('.s24-row').length === 1, 'busca por nome (sem acento/maiúscula)');
$('[data-s24-f="completed"]').click(); await tick();
ok($$('.s24-row').length === 0, 'filtro Concluídas');
$('[data-s24-f="todas"]').click(); await tick();
$('.s24-row').click(); await tick(80);
ok(/Respostas do formulário/.test(view()) && /Certidão de Batismo/.test(view()) && /\(31\) 99876-5432/.test(view()), 'detalhe com respostas e WhatsApp');
ok(!$('#view img') && /<img src=x onerror=alert\(1\)>/.test(view()), 'resposta com HTML aparece como texto (escapada)');
const wa = $('#view a.btn.wa');
ok(wa && wa.href.startsWith('https://wa.me/5531998765432?text=') && wa.target === '_blank', 'Falar no WhatsApp abre wa.me (sem envio automático)');
let s = $('#s24St'); s.elements.status.value = 'in_progress'; s.elements.status.dispatchEvent(new w.Event('change', {bubbles:true}));
setVal(s.elements.nota, 'Nota só da equipe'); submit(s); await tick(120);
ok(/Em atendimento/.test(lastToast()) && /nota interna/.test(view()) && /Nota só da equipe/.test(view()), 'muda status com nota interna: ' + lastToast());
s = $('#s24St'); setVal(s.elements.nota, 'Localizamos o registro.'); s.elements.publica.checked = true; s.elements.publica.dispatchEvent(new w.Event('change', {bubbles:true}));
submit(s); await tick(120);
ok(/Nota registrada/.test(lastToast()) && /visível para o fiel/.test(view()), 'nota pública: ' + lastToast());

// o fiel vê o status e a nota pública, não a interna
$('#mPublico').click(); await tick();
$('[data-s24-abrir]').click(); await tick(); $('[data-s24-ir="consulta"]').click(); await tick();
c = $('#s24C'); setVal(c.elements.proto, proto); setVal(c.elements.whats, '31 99876-5432'); submit(c); await tick(80);
ok(/Em atendimento/.test(view()) && /Localizamos o registro/.test(view()) && !/Nota só da equipe/.test(view()), 'fiel vê status e nota pública, sem a interna');

console.log('== permissões no front-end (espelho de can_access)');
const itens = papel => w.eval(`(() => { const a = NUVEM.ativo, p = NUVEM.papel; NUVEM.ativo = true; NUVEM.papel = '${papel}'; const r = maisItens().map(([k]) => k); NUVEM.ativo = a; NUVEM.papel = p; return r.join(); })()`);
ok(itens('secretaria').includes('secretaria24h'), 'secretaria vê o item');
ok(itens('padre').includes('secretaria24h') && itens('admin').includes('secretaria24h'), 'padre e suporte veem o item');
ok(!itens('pascom').includes('secretaria24h'), 'PASCOM não vê o item: ' + itens('pascom'));
ok(itens('secretaria').includes('equipe') && itens('padre').includes('equipe') && itens('admin').includes('equipe'), 'padre, secretaria e suporte veem Equipe');
ok(!itens('pascom').includes('equipe'), 'PASCOM não vê Equipe: ' + itens('pascom'));

ok(!erros.length, 'sem erros de JS ' + erros.join(' | '));
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
