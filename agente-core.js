/* =========================================================
   Central Paroquial — AGENTE PAROQUIAL (núcleo, independente de canal)

   "A paróquia informa uma vez. A Central organiza e distribui."

   Linguagem natural → interpretar → ferramenta segura → permissão → confirmação humana (quando altera)
   → RPC/API → banco. Nunca SQL livre: cada ferramenta chama só consultas e funções que já existem e que
   o próprio banco protege (RLS + can_access). Este arquivo NÃO usa DOM: roda no navegador (painel), no
   Node (testes) e, no futuro, num Worker (WhatsApp oficial). Quem chama informa o canal, o remetente e a
   paróquia da SESSÃO AUTENTICADA; a paróquia nunca vem do texto da mensagem.

   Separação:
   - interpretar(texto) → intenção + dados (parser determinístico V1; um LLM pode entrar no lugar
     devolvendo o mesmo formato, sem mudar as ferramentas);
   - executar → ferramentas (consultas = VERDE; alterações = AMARELO: preparar → confirmar → executar;
     VERMELHO: nunca sozinho).
   ========================================================= */
(function(raiz){
'use strict';

/* ---------- datas no fuso da paróquia (independe do fuso do aparelho/servidor) ---------- */
const TZ = 'America/Sao_Paulo';
const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const FMT = new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const partes = d => Object.fromEntries(FMT.formatToParts(new Date(d)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
const diaSP = d => { const p = partes(d); return `${p.year}-${p.month}-${p.day}`; };
const horaSP = d => { const p = partes(d); return `${p.hour}:${p.minute}`; };
const isoSP = (dia, hora) => new Date(`${dia}T${hora || '00:00'}:00-03:00`).toISOString(); // Brasília sem horário de verão desde 2019
const pad = n => String(n).padStart(2, '0');
const utcDe = dia => { const [y, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const somaDias = (dia, n) => { const d = utcDe(dia); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const semanaDe = dia => utcDe(dia).getUTCDay();
const diaValido = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d; };
const horaBR = hhmm => { const [h, m] = hhmm.split(':'); return +h + 'h' + (m === '00' ? '' : m); };
function diaExtenso(dia, hoje){
  if (dia === hoje) return 'hoje';
  if (dia === somaDias(hoje, 1)) return 'amanhã';
  const [y, m, d] = dia.split('-').map(Number);
  return `${DIAS[semanaDe(dia)]}, ${d} de ${MESES[m - 1]}${y !== +hoje.slice(0, 4) ? ' de ' + y : ''}`;
}

/* ---------- texto ---------- */
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const limpa = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const PROTOCOLO = /\bSA-\d{4}-[0-9A-F]{8}\b/i;

/* ---------- permissões: espelho de can_access() do supabase/schema.sql ----------
   O banco é quem decide (RLS e funções security definer). Isto só evita oferecer ao papel o que ele não pode. */
const ACESSO = {
  padre: null, admin: null, // null = todas as áreas da própria paróquia
  secretaria: ['avisos','agenda','comunidades','dizimistas','pessoas','intencoes','mensagens','ajustes','secretaria24h'],
  pascom: ['avisos','agenda','comunidades','noticias']
};
const PAPEIS = Object.keys(ACESSO);
function podeArea(papel, area){
  if (!PAPEIS.includes(papel)) return false;
  if (!area) return true; // leitura aberta a qualquer membro da paróquia (is_parish_member)
  return ACESSO[papel] === null || ACESSO[papel].includes(area);
}

/* ---------- ferramentas ----------
   nivel: verde (consulta, executa já) · amarelo (prepara; só executa depois da confirmação humana)
          vermelho (nunca sozinho). disponivel:false = preparada, mas ainda sem RPC segura no banco. */
const FERRAMENTAS = {
  consultar_agenda:                  {nivel:'verde',   area:null},
  consultar_eventos:                 {nivel:'verde',   area:null},
  consultar_comunidades:             {nivel:'verde',   area:null},
  consultar_servicos:                {nivel:'verde',   area:null},
  consultar_solicitacoes:            {nivel:'verde',   area:'secretaria24h'},
  preparar_evento:                   {nivel:'amarelo', area:'agenda'},
  criar_evento_confirmado:           {nivel:'amarelo', area:'agenda', confirmacao:true},
  preparar_atualizacao_solicitacao:  {nivel:'amarelo', area:'secretaria24h'},
  atualizar_solicitacao_confirmada:  {nivel:'amarelo', area:'secretaria24h', confirmacao:true},
  atualizar_servico:                 {nivel:'amarelo', area:'secretaria24h', confirmacao:true, disponivel:false}
};

// Estados reais de service_requests.status (supabase/secretaria24h.sql). Nenhum outro é aceito.
const STATUS = {
  new:          {um:'nova',                muitos:'novas',                situacao:'Recebida'},
  in_progress:  {um:'em atendimento',      muitos:'em atendimento',       situacao:'Em atendimento'},
  waiting_user: {um:'aguardando o fiel',   muitos:'aguardando o fiel',    situacao:'Aguardando o fiel'},
  completed:    {um:'concluída',           muitos:'concluídas',           situacao:'Concluída'},
  closed:       {um:'encerrada',           muitos:'encerradas',           situacao:'Encerrada'}
};
const PENDENTES = ['new','in_progress','waiting_user'];

/* ---------- canal ----------
   Contrato de entrada, igual para todos os canais:
   {channel, sender:{userId, papel}, parish:{id, slug, nome}, message, timestamp}
   channel/sender/parish vêm da sessão autenticada do canal (painel: login do Supabase; WhatsApp oficial,
   no futuro: número verificado → usuário vinculado). Nunca do texto. */
const CANAIS = ['painel','whatsapp','app'];
function validarEntrada(e){
  if (!e || typeof e !== 'object') return 'entrada';
  if (!CANAIS.includes(e.channel)) return 'canal';
  if (!e.sender || typeof e.sender.userId !== 'string' || !e.sender.userId || !PAPEIS.includes(e.sender.papel)) return 'anonimo';
  if (!e.parish || typeof e.parish.id !== 'string' || !e.parish.id) return 'anonimo';
  return null;
}

/* =========================================================
   INTERPRETAÇÃO (parser determinístico V1)
   Devolve {intent, ...dados}. Não consulta banco, não executa nada.
   ========================================================= */
const RE = {
  saudacao: /^(oi|ola|bom dia|boa tarde|boa noite|ajuda|help|menu|o que (voce|vc) (faz|sabe fazer)|como (funciona|usar)|comecar)\b/,
  criar: /\b(cri[ae]r?|crie|marqu?e|marcar|agende|agendar|cadastr[ae]r?|adicion[ae]r?|inclu[ai]r?|coloqu?e|colocar|program[ae]r?|registr[ae]r?|nov[oa] evento)\b/,
  mudar: /\b(marqu?e|marcar|marca|coloqu?e|colocar|mud[ae]r?|pass[ae]r?|alter[ae]r?|atualiz[ae]r?|defin[ae]r?|deix[ae]r?|pod[ea] marcar|troqu?e|trocar)\b/,
  excluir: /\b(exclu\w*|apag\w*|delet\w*|remov\w*|cancel\w*|desativ\w*|elimin\w*)\b/,
  massa: /\b(todas|todos|tudo)\b/,
  usuarios: /\b(usuario|usuarios|permiss\w*|senha|login|acesso|vincul\w*|perfil de|papel de|administrador|superadmin)\b|@[a-z0-9.-]+\.[a-z]{2,}/,
  pagamentos: /\b(pagamento\w*|pix|cobran\w*|boleto\w*|cartao|doac\w*|dinheiro|financeiro|valor(es)? d[oe]|contribuic\w*)\b/,
  sensivel: /\b(dizimist\w*|dizimo|confiss\w*|intenc\w* de missa|dados pessoais|cpf|telefone d[oa]s?|whatsapp d[oa]s?|endereco d[oa]s? fie\w*)\b/,
  tenant: /\b(tenant|slug|nome da paroquia|endereco da paroquia|dados da paroquia|configurac\w* da paroquia)\b/,
  solicitacao: /\b(solicitac\w*|solicitaco\w*|pedido\w*|protocolo\w*|secretaria 24)\b/,
  servico: /\b(servico\w*|catalogo)\b/,
  comunidade: /\b(comunidade\w*|capela\w*)\b/,
  agenda: /\b(agenda|evento\w*|temos|tem algo|tem alguma coisa|acontece\w*|programac\w*|atividade\w*|celebrac\w*|compromisso\w*|missas?)\b/,
  referencia: /\b(esta|essa|ela|isso|esse|este|dela|nessa|nesta)\b/
};
const STATUS_TEXTO = [
  [/\b(em atendimento|atendendo|atendimento)\b/, 'in_progress'],
  [/\baguardando( o| a| pelo| pela)? (fiel|retorno|resposta|paroquiano|documento\w*)\b|\baguardando\b/, 'waiting_user'],
  [/\b(conclu\w*|finaliz\w*|resolvid\w*|pront[oa])\b/, 'completed'],
  [/\b(encerr\w*|fech\w*|arquiv\w*)\b/, 'closed'],
  [/\b(nova|novas|recebida\w*)\b/, 'new']
];
const statusDoTexto = t => (STATUS_TEXTO.find(([re]) => re.test(t)) || [])[1] || null;

// Tipo de evento reconhecido na frase → título sugerido (o humano confirma ou corrige).
const TIPOS_EVENTO = [
  [/\bmissa\w*\b/, 'Missa'], [/\badorac\w*\b/, 'Adoração ao Santíssimo'], [/\bterco\b/, 'Terço'], [/\bnovena\b/, 'Novena'],
  [/\breuniao\b/, 'Reunião'], [/\bencontro\b/, 'Encontro'], [/\bensaio\b/, 'Ensaio'], [/\bfesta\b/, 'Festa'],
  [/\bcelebrac\w*\b/, 'Celebração'], [/\bprocissao\b/, 'Procissão'], [/\bretiro\b/, 'Retiro'], [/\bpalestra\b/, 'Palestra'],
  [/\bcatequese\b/, 'Catequese'], [/\bbatizado\b|\bbatismo\b/, 'Batizado'], [/\bvigilia\b/, 'Vigília'], [/\bconfissoes\b/, 'Confissões'],
  [/\bevento\b/, null]
];
const SEMANA = {domingo:0, segunda:1, terca:2, quarta:3, quinta:4, sexta:5, sabado:6};
const MES_N = Object.fromEntries(['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'].map((m, i) => [m, i + 1]));

// Datas: hoje, amanhã, depois de amanhã, dia da semana (próximo), dd/mm(/aaaa), "dia 12", "12 de outubro".
function lerData(t, hoje){
  if (/\bdepois de amanha\b/.test(t)) return {dia:somaDias(hoje, 2)};
  if (/\bamanha\b/.test(t)) return {dia:somaDias(hoje, 1)};
  if (/\b(hoje|hj|agora)\b/.test(t)) return {dia:hoje};
  let m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (m){
    const d = +m[1], mes = +m[2]; let y = m[3] ? +m[3] : +hoje.slice(0, 4); if (y < 100) y += 2000;
    if (!diaValido(y, mes, d)) return {invalida:true};
    let dia = `${y}-${pad(mes)}-${pad(d)}`; if (!m[3] && dia < hoje) dia = `${y + 1}-${pad(mes)}-${pad(d)}`;
    return {dia};
  }
  m = /\b(?:dia )?(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?: de (\d{4}))?\b/.exec(t);
  if (m){
    const d = +m[1], mes = MES_N[m[2]]; let y = m[3] ? +m[3] : +hoje.slice(0, 4);
    if (!diaValido(y, mes, d)) return {invalida:true};
    let dia = `${y}-${pad(mes)}-${pad(d)}`; if (!m[3] && dia < hoje) dia = `${y + 1}-${pad(mes)}-${pad(d)}`;
    return {dia};
  }
  m = /\bdia (\d{1,2})\b/.exec(t);
  if (m){
    const d = +m[1]; let [y, mes] = hoje.split('-').map(Number);
    if (d < +hoje.slice(8)){ mes++; if (mes > 12){ mes = 1; y++; } }
    if (!diaValido(y, mes, d)) return {invalida:true};
    return {dia:`${y}-${pad(mes)}-${pad(d)}`};
  }
  m = /\b(proxim[oa] |que vem )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira| feira)?( que vem)?\b/.exec(t);
  if (m){
    const alvo = SEMANA[m[2]], atual = semanaDe(hoje);
    let n = (alvo - atual + 7) % 7; if (n === 0 && (m[1] || m[3])) n = 7;
    return {dia:somaDias(hoje, n), semana:true};
  }
  return null;
}
// Horas: 19h, 19h30, 19:30, "às 7 da noite", meio-dia; "das 19h às 21h" / "até 21h" = término.
function lerHoras(t){
  const achados = [];
  const re = /\b(\d{1,2})(?:(?::|h)(\d{2}))?\s*(h|hs|horas?)?(?:\s*da (manha|tarde|noite))?\b/g;
  let m;
  while ((m = re.exec(t))){
    const temMarca = m[2] !== undefined || m[3] || m[4];
    if (!temMarca) continue;
    // "12/10", "dia 12", "12 de outubro" não são horas
    const antes = t.slice(Math.max(0, m.index - 4), m.index), depois = t.slice(re.lastIndex, re.lastIndex + 4);
    if (/\/$/.test(antes) || /^\//.test(depois) || /dia $/.test(antes)) continue;
    let h = +m[1]; const mi = m[2] !== undefined ? +m[2] : 0;
    if ((m[4] === 'tarde' || m[4] === 'noite') && h < 12) h += 12;
    if (h > 23 || mi > 59) return {invalida:true};
    achados.push({hora:`${pad(h)}:${pad(mi)}`, pos:m.index, ate:/\b(ate|as|a)\s*$/.test(t.slice(Math.max(0, m.index - 6), m.index)) && achados.length > 0});
  }
  if (/\bmeio[- ]dia\b/.test(t)) achados.push({hora:'12:00', pos:t.search(/\bmeio[- ]dia\b/), ate:false});
  if (!achados.length) return null;
  achados.sort((a, b) => a.pos - b.pos);
  const fim = achados.length > 1 && (achados[1].ate || /\b(das|de)\b/.test(t) || /\bate\b/.test(t)) ? achados[1].hora : null;
  return {hora:achados[0].hora, horaFim:fim};
}
// Período de consulta da agenda
function lerPeriodo(t, hoje){
  const semana = semanaDe(hoje), ateDomingo = (7 - semana) % 7;
  if (/\b(proxima semana|semana que vem)\b/.test(t)){ const seg = somaDias(hoje, ((8 - semana) % 7) || 7); return {inicio:seg, fim:somaDias(seg, 6), rotulo:'na próxima semana'}; }
  if (/\bfim de semana|final de semana\b/.test(t)){ const sab = somaDias(hoje, (6 - semana + 7) % 7); return {inicio:semana === 0 ? hoje : sab, fim:semana === 0 ? hoje : somaDias(sab, 1), rotulo:'neste fim de semana'}; }
  if (/\b(esta|essa|nesta|nessa|desta|dessa|da) semana\b|\bsemana\b/.test(t)) return {inicio:hoje, fim:somaDias(hoje, ateDomingo), rotulo:'nesta semana'};
  if (/\b(este|esse|neste|nesse|deste|desse|do) mes\b/.test(t)){ const [y, m] = hoje.split('-').map(Number); const ult = new Date(Date.UTC(y, m, 0)).getUTCDate(); return {inicio:hoje, fim:`${y}-${pad(m)}-${pad(ult)}`, rotulo:'neste mês'}; }
  const d = lerData(t, hoje);
  if (d && d.dia) return {inicio:d.dia, fim:d.dia, rotulo:null, dia:true};
  if (/\bproxim[oa]s?\b/.test(t)) return {inicio:hoje, fim:somaDias(hoje, 30), rotulo:'nos próximos 30 dias'};
  return {inicio:hoje, fim:somaDias(hoje, 6), rotulo:'nos próximos 7 dias'};
}
// "na comunidade X", "da comunidade X", "comunidade X" → nome informado (resolvido depois contra o banco).
function lerComunidade(original){
  const t = norm(original);
  const m = /\b(?:comunidade|capela)\s+(?:de |da |do |dos |das )?([a-z0-9][a-z0-9 ]{1,80}?)(?=\s+(?:no|na|em|as|a|ao|dia|amanha|hoje|domingo|segunda|terca|quarta|quinta|sexta|sabado|com|para|pra|das|de \d|\d|esta|essa|nesta|nessa|desta|dessa|este|esse|neste|nesse|deste|desse|semana|mes|proxim\w*|fim|que)\b|[,.;!?]|$)/.exec(t);
  return m ? limpaOriginal(original, m.index + m[0].length - m[1].length, m[1].length).trim() : null; // com a grafia original (acentos)
}
function lerLocal(original, comunidade){
  const t = norm(original);
  const m = /\b(?:local|lugar)[: ]+([a-z0-9][a-z0-9 ]{1,60}?)(?=[,.;!?]|$)/.exec(t)
    || /\b(?:no|na|em)\s+((?:salao|matriz|igreja|capela|quadra|auditorio|sala|praca|patio|centro|casa|secretaria|cripta)(?:\s+[a-z0-9]+){0,4}?)(?=\s+(?:as|a|ao|dia|amanha|hoje|domingo|segunda|terca|quarta|quinta|sexta|sabado|com|para|das|de \d|\d)\b|[,.;!?]|$)/.exec(t);
  if (!m) return null;
  if (comunidade && m[1].includes(comunidade)) return null;
  return cap(limpaOriginal(original, m.index + m[0].length - m[1].length, m[1].length)); // com a grafia original (acentos)
}
// Mantém acentos: tenta recuperar o trecho do texto original na mesma posição (norm preserva comprimento quando só tira acentos).
function limpaOriginal(original, i, n){
  const base = String(original).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const orig = String(original).replace(/\s+/g, ' ').trim();
  return base.length === orig.length ? orig.slice(i, i + n) : base.slice(i, i + n);
}
function lerTitulo(original){
  const aspas = /["“”'‘’«]([^"“”'‘’«»]{2,160})["“”'‘’»]/.exec(original);
  if (aspas) return limpa(aspas[1]);
  const t = norm(original);
  const chamado = /\b(?:chamad[oa]|com o (?:nome|titulo)|intitulad[oa]|titulo)[: ]+([a-z0-9][a-z0-9 ]{1,120}?)(?=\s+(?:no|na|em|as|a|ao|dia|amanha|hoje|domingo|segunda|terca|quarta|quinta|sexta|sabado|para|das|de \d|\d)\b|[,.;!?]|$)/.exec(t);
  if (chamado) return cap(limpaOriginal(original, t.indexOf(chamado[1]), chamado[1].length));
  for (const [re, titulo] of TIPOS_EVENTO){
    const m = re.exec(t); if (!m) continue;
    if (!titulo) break; // "evento" genérico: tenta o que vem depois do verbo (abaixo)
    // complemento: "reunião do conselho", "missa de sétimo dia", "terço dos homens"
    const resto = /^\s+((?:d[aoe]s?|pel[ao]s?|com|para)\s+[a-z0-9]+(?:\s+(?!no\b|na\b|em\b|as\b|a\b|ao\b|dia\b|amanha\b|hoje\b|domingo\b|segunda\b|terca\b|quarta\b|quinta\b|sexta\b|sabado\b|comunidade\b|capela\b|das\b|\d)[a-z0-9]+){0,4})/.exec(t.slice(m.index + m[0].length));
    if (resto && !/^(?:d[aoe]s?|na|no)\s+(comunidade|capela)\b/.test(resto[1])){
      const trecho = limpaOriginal(original, m.index + m[0].length + 1, resto[1].length);
      return titulo + ' ' + trecho;
    }
    return titulo;
  }
  // Genérico: o que vem depois do verbo, até a data/hora/local ("Crie trezena de Santo Antônio sábado 19h").
  const g = /\b(?:crie|criar|cria|marque|marcar|agende|agendar|cadastre|cadastrar|adicione|adicionar|inclua|incluir|coloque|colocar|programe|programar|registre|registrar)\s+(?:(?:um|uma|o|a)\s+)?(?:(?:novo|nova)\s+)?(?:evento\b\s*(?:de|da|do|para)?\s*)?/.exec(t);
  if (!g) return null;
  const resto = t.slice(g.index + g[0].length);
  const corte = /(^|\s+)(?:no|na|em|as|a|ao|dia|amanha|hoje|depois|domingo|segunda|terca|quarta|quinta|sexta|sabado|proxim\w*|das|comunidade|capela|para (?:a|o) comunidade)\b|\s+\d|^\d|[,.;!?]/.exec(resto);
  const trecho = (corte ? resto.slice(0, corte.index) : resto).trim();
  if (trecho.length < 2) return null; // "Crie um evento sábado às 19h": o humano dá o título
  return cap(limpaOriginal(original, g.index + g[0].length + resto.indexOf(trecho), trecho.length));
}

// Menção a OUTRA paróquia no texto → negar (a paróquia de trabalho é sempre a da sessão).
const PREFIXOS_SANTO = /^(santo|santa|sao|nossa|nosso|senhora|senhor|sagrad\w*|divino|divina|cristo|jesus|bom|boa|imaculad\w*|menino|espirito|todos|nsra|ns|maria|rainha|coracao|santissim\w*)\b/;
function aliasesParoquia(nome){
  const completo = norm(nome).replace(/^paroquia\s+/, '');
  const n = completo.split(/\s+[–—-]\s+/)[0]; // "Santo Antônio – Jaraguá" → "santo antonio"
  if (!n) return [];
  const a = new Set([completo, n]);
  const e = n.split(' e ')[0]; if (e.split(' ').length >= 2) a.add(e);
  const ns = /^nossa senhora (?:d[aoe]s? )?(.+)$/.exec(n); if (ns && ns[1].length >= 5) a.add(ns[1]);
  return [...a].filter(x => x.length >= 5 && x.includes(' ')); // só nomes compostos: "graças" sozinho também é "ação de graças"
}
const temTermo = (t, termo) => new RegExp(`(^|[^a-z0-9])${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t);
// criacao: título de evento pode ter nome de santo ("Trezena de Santo Antônio"); aí só vale "paróquia X" explícito.
function outraParoquia(texto, atual, conhecidas, comunidades, {criacao = false} = {}){
  const t = norm(texto);
  const minhas = new Set(aliasesParoquia(atual || ''));
  const daqui = termo => [...minhas].some(a => a.includes(termo) || termo.includes(a)) || (comunidades || []).some(c => norm(c.name).includes(termo));
  for (const p of criacao ? [] : conhecidas || []){
    for (const al of aliasesParoquia(p.nome || p.name || '')){
      if (temTermo(t, al) && !daqui(al)) return true;
    }
  }
  const m = /\bparoquias?\s+(?:de |da |do |dos |das )?([a-z]+(?: [a-z]+){0,5})/.exec(t);
  if (m && PREFIXOS_SANTO.test(m[1])){
    const nome = m[1].replace(/\s+(?:no|na|em|com|para|e as|e os)\b.*$/, '');
    if (![...minhas].some(a => a.startsWith(nome.split(' ').slice(0, 2).join(' ')) || nome.startsWith(a))) return true;
  }
  return false;
}

function interpretarDeterministico(texto, {agora = new Date()} = {}){
  const original = limpa(texto).slice(0, 1000);
  const t = norm(original);
  const hoje = diaSP(agora);
  const semSaudacao = t.replace(/^(oi|ola|bom dia|boa tarde|boa noite)[,!. ]*/, '').replace(/^(por favor|pf|padre|secretaria)[,!. ]+/, '').trim();
  if (!semSaudacao || RE.saudacao.test(semSaudacao) && semSaudacao.split(' ').length <= 5) return {intent:'ajuda'};

  const protocolo = (PROTOCOLO.exec(original) || [])[0]?.toUpperCase() || null;
  const falaDeSolicitacao = RE.solicitacao.test(t) || !!protocolo;

  // VERMELHO: nunca autônomo (checado antes de qualquer ferramenta)
  if (RE.massa.test(t) && (RE.mudar.test(t) || RE.excluir.test(t) || /\bconclu|\bencerr/.test(t)) && (falaDeSolicitacao || /\bevento/.test(t))) return {intent:'vermelho', motivo:'massa'};
  if (RE.excluir.test(t)) return {intent:'vermelho', motivo:'exclusao'};
  if (RE.usuarios.test(t)) return {intent:'vermelho', motivo:'usuarios'};
  if (RE.pagamentos.test(t)) return {intent:'vermelho', motivo:'pagamentos'};
  if (RE.sensivel.test(t)) return {intent:'vermelho', motivo:'sensivel'};
  if (RE.tenant.test(t)) return {intent:'vermelho', motivo:'paroquia'};
  if (RE.comunidade.test(t) && RE.criar.test(t) && !TIPOS_EVENTO.some(([re]) => re.test(t)) && !lerHoras(t)) return {intent:'vermelho', motivo:'criar_comunidade'};

  // AMARELO: mudar situação de solicitação
  const status = statusDoTexto(t);
  if (status && RE.mudar.test(t) && (falaDeSolicitacao || RE.referencia.test(t) || /\bcomo\b/.test(t)))
    return {intent:'preparar_atualizacao_solicitacao', status, protocolo, referencia:!protocolo};

  // VERDE: solicitações
  if (falaDeSolicitacao && !(RE.criar.test(t) && RE.agenda.test(t))){
    let filtro = 'pendentes';
    if (/\bpendente/.test(t)) filtro = 'pendentes';
    else if (/\btodas\b|\btodos\b/.test(t)) filtro = 'todas';
    else if (status) filtro = status;
    return {intent:'consultar_solicitacoes', filtro, protocolo};
  }

  // VERDE: serviços
  if (RE.servico.test(t) && !RE.criar.test(t)){
    if (RE.mudar.test(t) || /\b(edit\w*|corrig\w*)\b/.test(t)) return {intent:'atualizar_servico'};
    return {intent:'consultar_servicos'};
  }
  if (RE.servico.test(t) && /\b(edit\w*|corrig\w*|mud\w*|alter\w*|atualiz\w*)\b/.test(t)) return {intent:'atualizar_servico'};

  // AMARELO: criar evento
  const tipoEvento = TIPOS_EVENTO.some(([re]) => re.test(t));
  const horas = lerHoras(t), data = lerData(t, hoje);
  if (RE.criar.test(t) && (tipoEvento || horas || data)){
    const comunidade = lerComunidade(original);
    return {intent:'preparar_evento', titulo:lerTitulo(original), dia:data?.dia || null, dataInvalida:!!data?.invalida,
      hora:horas?.hora || null, horaFim:horas?.horaFim || null, horaInvalida:!!horas?.invalida,
      local:lerLocal(original, comunidade && norm(comunidade)), comunidade, semanaSemData:!!data?.semana};
  }

  // VERDE: comunidades (lista) ou agenda de uma comunidade
  const comunidade = lerComunidade(original);
  if (RE.comunidade.test(t) && !(RE.agenda.test(t) || data || /\bsemana|\bmes\b|\bproxim/.test(t)))
    return {intent:'consultar_comunidades', comunidade};

  // VERDE: agenda / eventos
  if (RE.agenda.test(t) || data || /\bsemana|\bfim de semana|\bmes\b/.test(t)){
    const p = lerPeriodo(t, hoje);
    return {intent: p.dia ? 'consultar_agenda' : 'consultar_eventos', ...p, comunidade};
  }
  return {intent:'desconhecido'};
}

/* =========================================================
   RESPOSTAS em linguagem humana (sem ids, JSON, nomes técnicos)
   ========================================================= */
const R = {
  texto: (linhas, extra = {}) => ({tipo:'resposta', linhas:[].concat(linhas).filter(Boolean), ...extra}),
  negado: (linhas, extra = {}) => ({tipo:'negado', linhas:[].concat(linhas).filter(Boolean), ...extra}),
  erro: linhas => ({tipo:'erro', linhas:[].concat(linhas)})
};
const EXEMPLOS = {
  base: ['O que temos amanhã?', 'Mostre os eventos desta semana.', 'Quais comunidades estão cadastradas?', 'Quais serviços da secretaria estão disponíveis?'],
  agenda: ['Crie um evento sábado às 19h.'],
  secretaria24h: ['Quais solicitações estão pendentes?', 'Mostre as solicitações aguardando o fiel.']
};
function exemplosPara(papel){
  return [...EXEMPLOS.base.slice(0, 1), ...(podeArea(papel, 'secretaria24h') ? EXEMPLOS.secretaria24h.slice(0, 1) : []),
    ...(podeArea(papel, 'agenda') ? EXEMPLOS.agenda : []), ...EXEMPLOS.base.slice(1)];
}
const VERMELHO = {
  massa: 'Alterações em várias solicitações ou eventos de uma vez eu não faço. Faça uma por uma, com a sua confirmação.',
  exclusao: 'Excluir ou cancelar eu não faço sozinho. Use a tela correspondente (por exemplo, Agenda › evento › Cancelar), onde a equipe confere antes.',
  usuarios: 'Usuários, acessos e permissões não são alterados pelo Assistente. Esse pedido vai para o suporte da Central Paroquial.',
  pagamentos: 'Pagamentos, doações e valores não passam pelo Assistente.',
  sensivel: 'Dados pastorais sensíveis (dizimistas, intenções, contatos de fiéis) não são consultados pelo Assistente. Use a tela própria no painel.',
  paroquia: 'Os dados da paróquia são alterados só em Ajustes, por quem tem permissão.',
  criar_comunidade: 'Não crio comunidades a partir de uma frase. Para cadastrar, use Mais › Comunidades.'
};
const ERRO_MSG = {
  permissao: 'Seu usuário não tem permissão para isso nesta paróquia.',
  ausente: 'Esta parte ainda não está ativada no banco da paróquia.',
  geral: 'Não consegui consultar agora. Tente de novo em instantes.',
  gravar: 'Não consegui concluir agora. Nada foi alterado. Tente de novo em instantes.'
};
function tipoErro(e){
  const c = e?.code || '', m = String(e?.message || '');
  if (c === '42501' || /permission|permiss|row-level security|sem permiss/i.test(m)) return 'permissao';
  if (['42P01','42883','PGRST202','PGRST205','PGRST204'].includes(c) || /does not exist|schema cache/i.test(m)) return 'ausente';
  return 'geral';
}

/* =========================================================
   AGENTE
   backend: funções assíncronas que falam com o banco da SESSÃO (ver criarBackendSupabase).
   interpretar: (texto, {agora}) → intenção. Padrão: interpretarDeterministico.
   ========================================================= */
function criarAgente({backend, interpretar = interpretarDeterministico, agora = () => new Date(), validadeMs = 10 * 60e3, gerarId} = {}){
  if (!backend) throw new Error('backend obrigatório');
  const pendentes = new Map();   // confirmações abertas (só em memória)
  const conversas = new Map();   // contexto curto por usuário+paróquia (solicitação em foco)
  const trilha = [];             // últimas auditorias (memória; o banco guarda via backend.auditar)
  const novoId = gerarId || (() => { const b = new Uint8Array(12); (raiz.crypto || globalThis.crypto).getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); });
  const chave = e => e.sender.userId + '|' + e.parish.id;
  const conversa = e => { const k = chave(e); if (!conversas.has(k)) conversas.set(k, {foco:null}); return conversas.get(k); };
  const hoje = () => diaSP(agora());

  async function auditar(e, tool, result, confirmed = false){
    const rec = {user_id:e.sender.userId, parish_id:e.parish.id, channel:e.channel, tool, result, human_confirmed:!!confirmed, at:agora().toISOString()};
    trilha.push(rec); if (trilha.length > 100) trilha.shift();
    try { await backend.auditar?.({parishId:e.parish.id, channel:e.channel, tool, result, confirmed:!!confirmed}); } catch(x){ /* auditoria nunca derruba o atendimento */ }
  }
  // Toda chamada de ferramenta passa por aqui: confere a permissão do papel antes de tocar no banco.
  async function usar(e, tool, fn){
    const f = FERRAMENTAS[tool];
    if (!f || f.disponivel === false){ await auditar(e, tool, 'negado'); return {negado:'indisponivel'}; }
    if (!podeArea(e.sender.papel, f.area)){ await auditar(e, tool, 'negado'); return {negado:'permissao'}; }
    try { const r = await fn(); return {ok:r}; }
    catch(x){ const k = tipoErro(x); await auditar(e, tool, k === 'permissao' ? 'negado' : 'erro'); return {erro:k}; }
  }
  const semPermissao = area => R.negado(area === 'secretaria24h'
    ? 'As solicitações da Secretaria 24h são vistas por padre e secretaria. Seu perfil não tem acesso a elas.'
    : area === 'agenda' ? 'Seu perfil não pode criar eventos nesta paróquia.' : ERRO_MSG.permissao);

  async function comunidadesDe(e){ return (await backend.listarComunidades({parishId:e.parish.id})).filter(c => c.active !== false); }
  function resolverComunidade(nome, lista){
    const n = norm(nome).replace(/^(comunidade|capela)\s+/, '');
    const nomeDe = c => norm(c.name).replace(/^(comunidade|capela)\s+(?:de |da |do |dos |das )?/, '');
    const exatas = lista.filter(c => nomeDe(c) === n || norm(c.name) === n);
    if (exatas.length) return exatas;
    return lista.filter(c => nomeDe(c).includes(n) || n.includes(nomeDe(c)));
  }

  /* ---------- VERDE ---------- */
  async function agenda(e, it){
    const tool = it.intent;
    let com = null;
    if (it.comunidade){
      const r = await usar(e, 'consultar_comunidades', () => comunidadesDe(e));
      if (!r.ok) return r.negado ? semPermissao(null) : R.erro(ERRO_MSG[r.erro]);
      if (!r.ok.length) return R.texto('Esta paróquia ainda não possui comunidades cadastradas.');
      const achou = resolverComunidade(it.comunidade, r.ok);
      if (!achou.length) return R.texto(`Não encontrei a comunidade “${it.comunidade}” nesta paróquia.`, {acoes:[{rotulo:'Ver comunidades cadastradas', tipo:'perguntar', valor:'Quais comunidades estão cadastradas?'}]});
      if (achou.length > 1) return R.texto(`Encontrei ${achou.length} comunidades parecidas. Qual delas?`, {acoes:achou.slice(0, 6).map(c => ({rotulo:c.name, tipo:'perguntar', valor:`Agenda da comunidade ${c.name} ${it.rotulo || ''}`.trim()}))});
      com = achou[0];
    }
    const r = await usar(e, tool, () => backend.listarEventos({parishId:e.parish.id, inicio:isoSP(it.inicio, '00:00'), fim:isoSP(somaDias(it.fim, 1), '00:00')}));
    if (!r.ok) return r.negado ? semPermissao(null) : R.erro(ERRO_MSG[r.erro]);
    const h = hoje();
    let evs = r.ok.filter(x => !x.cancelled).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    if (com) evs = evs.filter(x => x.community_id === com.id);
    const quando = it.dia ? diaExtenso(it.inicio, h) : it.rotulo;
    const onde = com ? ` na ${/^(comunidade|capela)\b/i.test(com.name) ? '' : 'comunidade '}${com.name}` : '';
    await auditar(e, tool, evs.length ? 'ok' : 'vazio');
    let missas = [];
    if (it.dia && !com && backend.horariosMissa){
      try { missas = linhasMissa(await backend.horariosMissa({parishId:e.parish.id}), it.inicio); } catch(x){}
    }
    const itens = evs.slice(0, 12).map(x => ({titulo:x.title, detalhe:[it.dia ? horaBR(horaSP(x.starts_at)) : cap(diaExtenso(diaSP(x.starts_at), h)) + ' · ' + horaBR(horaSP(x.starts_at)), x.location, x.public === false ? 'só a equipe vê' : ''].filter(Boolean).join(' · ')}));
    const mais = evs.length > 12 ? [`E mais ${evs.length - 12}. Veja todos na Agenda.`] : [];
    const acoes = [{rotulo:'Abrir a Agenda', tipo:'ir', valor:'agenda'}];
    if (!evs.length){
      const l = [`Não há eventos cadastrados${onde} ${quando}.`];
      if (missas.length) l.push(`Horários de missa ${quando}: ${missas.join(' · ')}.`);
      return R.texto(l, {acoes});
    }
    return R.texto([`${cap(quando)}${onde}, ${evs.length === 1 ? 'temos 1 evento' : `temos ${evs.length} eventos`}:`, ...(missas.length ? [`Horários de missa: ${missas.join(' · ')}.`] : [])], {itens, rodape:mais, acoes});
  }
  async function comunidades(e, it){
    const r = await usar(e, 'consultar_comunidades', () => comunidadesDe(e));
    if (!r.ok) return r.negado ? semPermissao(null) : R.erro(ERRO_MSG[r.erro]);
    const l = r.ok.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    await auditar(e, 'consultar_comunidades', l.length ? 'ok' : 'vazio');
    if (!l.length) return R.texto('Esta paróquia ainda não possui comunidades cadastradas.', {acoes:podeArea(e.sender.papel, 'comunidades') ? [{rotulo:'Cadastrar em Comunidades', tipo:'ir', valor:'comunidades'}] : []});
    if (it.comunidade){
      const achou = resolverComunidade(it.comunidade, l);
      if (!achou.length) return R.texto(`Não encontrei a comunidade “${it.comunidade}” nesta paróquia. As cadastradas são: ${l.map(c => c.name).join(', ')}.`);
      if (achou.length > 1) return R.texto(`Encontrei ${achou.length} comunidades parecidas: ${achou.map(c => c.name).join(', ')}. Qual delas?`);
    }
    return R.texto(l.length === 1 ? 'Esta paróquia tem 1 comunidade cadastrada:' : `Esta paróquia tem ${l.length} comunidades cadastradas:`,
      {itens:l.map(c => ({titulo:c.name, detalhe:[c.patron ? 'Padroeiro(a): ' + c.patron : '', c.mass_schedule ? 'Missas: ' + c.mass_schedule : ''].filter(Boolean).join(' · ')})), acoes:[{rotulo:'Abrir Comunidades', tipo:'ir', valor:'comunidades'}]});
  }
  async function servicos(e){
    const r = await usar(e, 'consultar_servicos', () => backend.listarServicos({parishId:e.parish.id, slug:e.parish.slug}));
    if (!r.ok) return r.negado ? semPermissao(null) : R.erro(ERRO_MSG[r.erro]);
    const l = r.ok || [];
    await auditar(e, 'consultar_servicos', l.length ? 'ok' : 'vazio');
    if (!l.length) return R.texto('A Secretaria 24h desta paróquia ainda não tem serviços disponíveis.');
    return R.texto(l.length === 1 ? 'Há 1 serviço disponível na Secretaria 24h:' : `Há ${l.length} serviços disponíveis na Secretaria 24h:`,
      {itens:l.map(s => ({titulo:s.title, detalhe:s.description || ''})),
       rodape:['Para mudar textos do catálogo, fale com o suporte da Central Paroquial (a edição pelo Assistente ainda não está ativada).']});
  }
  async function listaSolicitacoes(e){ return backend.listarSolicitacoes({parishId:e.parish.id}); }
  const itemSolicitacao = (s, h) => ({titulo:`${s.service_title || 'Solicitação'}${s.is_demo ? ' (demonstração)' : ''}`,
    detalhe:`${s.protocol} · ${STATUS[s.status]?.situacao || ''} · ${cap(diaExtenso(diaSP(s.created_at), h))}`,
    acoes:[{rotulo:'Abrir', tipo:'abrir_solicitacao', valor:s.id}, {rotulo:'Usar esta', tipo:'focar', valor:s.id}]});
  async function solicitacoes(e, it){
    const r = await usar(e, 'consultar_solicitacoes', () => listaSolicitacoes(e));
    if (r.negado) return semPermissao('secretaria24h');
    if (!r.ok) return R.erro(ERRO_MSG[r.erro]);
    const h = hoje(), todas = r.ok, c = conversa(e);
    if (it.protocolo){
      const s = todas.find(x => x.protocol === it.protocolo);
      await auditar(e, 'consultar_solicitacoes', s ? 'ok' : 'vazio');
      if (!s) return R.texto('Não encontrei essa solicitação nesta paróquia. Confira o protocolo.');
      c.foco = s.id;
      return R.texto(`A solicitação ${s.protocol} (${s.service_title || 'Secretaria 24h'}) está ${STATUS[s.status].um}.`,
        {itens:[itemSolicitacao(s, h)], acoes:[{rotulo:'Marcar como em atendimento', tipo:'perguntar', valor:'Marque esta solicitação como em atendimento'}]});
    }
    const alvo = it.filtro === 'pendentes' ? PENDENTES : it.filtro === 'todas' ? Object.keys(STATUS) : [it.filtro];
    const l = todas.filter(s => alvo.includes(s.status));
    await auditar(e, 'consultar_solicitacoes', l.length ? 'ok' : 'vazio');
    const nome = it.filtro === 'pendentes' ? 'pendentes' : it.filtro === 'todas' ? '' : STATUS[it.filtro].muitos;
    if (!l.length) return R.texto(it.filtro === 'pendentes' ? 'Não há solicitações pendentes. Tudo em dia! 🙏' : nome ? `Não há solicitações ${nome}.` : 'Ainda não há solicitações nesta paróquia.');
    if (l.length === 1) c.foco = l[0].id;
    const cont = Object.fromEntries(Object.keys(STATUS).map(k => [k, l.filter(s => s.status === k).length]));
    const linhas = [`Encontrei ${plural(l.length, 'solicitação', 'solicitações')}${nome ? ' ' + nome : ''}:`];
    const partesSt = Object.keys(STATUS).filter(k => cont[k]).map(k => `${cont[k]} ${cont[k] === 1 ? STATUS[k].um : STATUS[k].muitos}`);
    if (partesSt.length > 1 || ['pendentes','todas'].includes(it.filtro)) linhas.push(...partesSt.map(p => '• ' + p));
    const acoes = [];
    if (cont.new && it.filtro !== 'new'){ linhas.push('Quer que eu abra as novas?'); acoes.push({rotulo:'Abrir as novas', tipo:'abrir_fila', valor:'new'}); }
    else acoes.push({rotulo:'Abrir na Secretaria 24h', tipo:'abrir_fila', valor:alvo.length === 1 ? alvo[0] : 'todas'});
    return R.texto(linhas, {itens:l.slice(0, 5).map(s => itemSolicitacao(s, h)), rodape:l.length > 5 ? [`E mais ${l.length - 5} na Secretaria 24h.`] : [], acoes});
  }

  /* ---------- AMARELO: preparar → confirmar → executar ---------- */
  function abrirPendencia(e, tool, dados){
    for (const [id, p] of pendentes) if (p.k === chave(e) && p.tool === tool) pendentes.delete(id); // uma pendência por tipo
    const id = novoId();
    pendentes.set(id, {id, k:chave(e), userId:e.sender.userId, parishId:e.parish.id, channel:e.channel, tool, dados, expira:agora().getTime() + validadeMs});
    return id;
  }
  function validarEvento(d, h, agoraMs){
    const faltando = [], avisos = [];
    if (!d.titulo || d.titulo.length < 2) faltando.push('titulo');
    if (!d.dia) faltando.push('dia');
    if (!d.hora) faltando.push('hora');
    if (d.titulo && d.titulo.length > 160) avisos.push('O título pode ter no máximo 160 caracteres.'), faltando.push('titulo');
    if (d.local && d.local.length > 200) avisos.push('O local pode ter no máximo 200 caracteres.'), faltando.push('local');
    if (d.descricao && d.descricao.length > 4000) faltando.push('descricao');
    if (d.dia && d.hora && Date.parse(isoSP(d.dia, d.hora)) < agoraMs){ avisos.push('Essa data e hora já passaram.'); faltando.push('dia'); }
    if (d.horaFim && d.hora && d.horaFim < d.hora){ avisos.push('A hora final precisa ser depois da hora inicial.'); faltando.push('horaFim'); }
    if (d.comunidadePendente) faltando.push('comunidade');
    return {faltando:[...new Set(faltando)], avisos};
  }
  function cartaoEvento(id, d, coms, extraAvisos = []){
    const h = hoje(), {faltando, avisos} = validarEvento(d, h, agora().getTime());
    const com = d.comunidadeId ? coms.find(c => c.id === d.comunidadeId) : null;
    return {tipo:'confirmacao', linhas:[faltando.length ? 'Entendi. Falta completar alguns dados antes de confirmar:' : 'Entendi. Confira antes de criar:'],
      confirmacao:{id, tipo:'evento', titulo:'Novo evento', faltando,
        avisos:[...extraAvisos, ...avisos],
        campos:[
          ['Evento', d.titulo || '— escreva o título —'],
          ['Data', d.dia ? cap(diaExtenso(d.dia, h)) + (d.dia !== h && d.dia !== somaDias(h, 1) ? '' : ` (${d.dia.split('-').reverse().join('/')})`) : '— escolha a data —'],
          ['Horário', d.hora ? horaBR(d.hora) + (d.horaFim ? ' às ' + horaBR(d.horaFim) : '') : '— informe o horário —'],
          ['Local', d.local || (com ? com.name : 'Não informado')],
          ['Comunidade', com ? com.name : d.comunidadePendente ? '— escolha —' : 'Toda a paróquia'],
          ['Visibilidade', d.publico ? 'Aparece na agenda pública' : 'Só a equipe vê']
        ],
        // valores para o formulário "Corrigir" (a UI só oferece comunidades reais desta paróquia)
        editar:{titulo:d.titulo || '', dia:d.dia || '', hora:d.hora || '', horaFim:d.horaFim || '', local:d.local || '', descricao:d.descricao || '',
          comunidadeId:d.comunidadeId || '', publico:!!d.publico, comunidades:coms.map(c => ({valor:c.id, rotulo:c.name}))}}};
  }
  async function prepararEvento(e, it){
    if (!podeArea(e.sender.papel, 'agenda')){ await auditar(e, 'preparar_evento', 'negado'); return semPermissao('agenda'); }
    const d = {titulo:it.titulo ? limpa(it.titulo).slice(0, 160) : '', dia:it.dia, hora:it.hora, horaFim:it.horaFim, local:it.local ? limpa(it.local) : '',
      descricao:'', comunidadeId:null, comunidadePendente:false, publico:true, source:'agente'};
    const avisos = [];
    if (it.dataInvalida) avisos.push('Não entendi a data. Escolha no formulário.');
    if (it.horaInvalida) avisos.push('Não entendi o horário.');
    // se o dia da semana já passou hoje (ex.: "sábado às 19h" num sábado às 21h), vai para o próximo
    if (d.dia && d.hora && it.semanaSemData && Date.parse(isoSP(d.dia, d.hora)) < agora().getTime()) d.dia = somaDias(d.dia, 7);
    let coms = [];
    const r = await usar(e, 'consultar_comunidades', () => comunidadesDe(e));
    if (r.ok) coms = r.ok; else if (r.erro && it.comunidade) return R.erro(ERRO_MSG[r.erro]);
    if (it.comunidade){
      const achou = resolverComunidade(it.comunidade, coms);
      if (!coms.length){ d.comunidadePendente = true; avisos.push(`Esta paróquia ainda não possui comunidades cadastradas. Não encontrei “${it.comunidade}”. Escolha “Toda a paróquia” ou cadastre a comunidade antes.`); }
      else if (!achou.length){ d.comunidadePendente = true; avisos.push(`Não encontrei a comunidade “${it.comunidade}” nesta paróquia. Escolha uma das cadastradas ou “Toda a paróquia”.`); }
      else if (achou.length > 1){ d.comunidadePendente = true; avisos.push(`Encontrei mais de uma comunidade parecida com “${it.comunidade}”: ${achou.map(c => c.name).join(', ')}. Escolha qual.`); }
      else d.comunidadeId = achou[0].id;
    }
    const id = abrirPendencia(e, 'criar_evento_confirmado', d);
    await auditar(e, 'preparar_evento', 'preparado');
    return cartaoEvento(id, d, coms, avisos);
  }
  async function prepararStatus(e, it){
    if (!podeArea(e.sender.papel, 'secretaria24h')){ await auditar(e, 'preparar_atualizacao_solicitacao', 'negado'); return semPermissao('secretaria24h'); }
    if (!STATUS[it.status]) return R.texto('Não entendi a nova situação. Use: em atendimento, aguardando o fiel, concluída ou encerrada.');
    const r = await usar(e, 'preparar_atualizacao_solicitacao', () => listaSolicitacoes(e));
    if (!r.ok) return r.negado ? semPermissao('secretaria24h') : R.erro(ERRO_MSG[r.erro]);
    const c = conversa(e);
    let s = null;
    if (it.protocolo) s = r.ok.find(x => x.protocol === it.protocolo);
    else if (c.foco) s = r.ok.find(x => x.id === c.foco);
    if (!s){
      await auditar(e, 'preparar_atualizacao_solicitacao', 'vazio');
      if (it.protocolo) return R.texto('Não encontrei essa solicitação nesta paróquia. Confira o protocolo.');
      const pend = r.ok.filter(x => PENDENTES.includes(x.status)).slice(0, 5), h = hoje();
      return R.texto(pend.length ? 'Qual solicitação? Escolha uma abaixo (“Usar esta”) ou informe o protocolo.' : 'Qual solicitação? Informe o protocolo (por exemplo, SA-2026-1A2B3C4D).', {itens:pend.map(x => itemSolicitacao(x, h))});
    }
    if (s.status === it.status){ await auditar(e, 'preparar_atualizacao_solicitacao', 'vazio'); return R.texto(`A solicitação ${s.protocol} já está como ${STATUS[s.status].um}.`); }
    c.foco = s.id;
    const id = abrirPendencia(e, 'atualizar_solicitacao_confirmada', {requestId:s.id, protocol:s.protocol, servico:s.service_title || '', de:s.status, para:it.status});
    await auditar(e, 'preparar_atualizacao_solicitacao', 'preparado');
    return cartaoStatus(id, s, it.status);
  }
  const cartaoStatus = (id, s, para) => ({tipo:'confirmacao', linhas:['Entendi. Confira antes de alterar:'],
    confirmacao:{id, tipo:'solicitacao', titulo:'Alterar situação da solicitação', faltando:[], avisos:[],
      campos:[['Serviço', s.service_title || s.servico || 'Secretaria 24h'], ['Protocolo', s.protocol], ['Situação atual', STATUS[s.status || s.de].situacao], ['Nova situação', STATUS[para].situacao]],
      nota:'O fiel verá a nova situação ao acompanhar o protocolo. Nenhuma mensagem é enviada.',
      editar:{status:para, opcoes:Object.keys(STATUS).filter(k => k !== (s.status || s.de)).map(k => ({valor:k, rotulo:STATUS[k].situacao}))}}});

  // Confere se a confirmação é deste usuário, desta paróquia, deste canal, e ainda vale.
  function pegarPendencia(e, id){
    const p = pendentes.get(String(id || ''));
    if (!p) return {erro:'Esta confirmação não vale mais. Peça de novo, por favor.'};
    if (p.userId !== e.sender.userId || p.parishId !== e.parish.id || p.channel !== e.channel) return {erro:'Esta confirmação não pertence a você nesta paróquia.', negado:true};
    if (agora().getTime() > p.expira){ pendentes.delete(p.id); return {erro:'A confirmação expirou. Peça de novo, por favor.'}; }
    return {p};
  }

  async function corrigir(entrada, campos = {}){
    const inv = validarEntrada(entrada); if (inv) return R.negado('Entre com seu usuário da paróquia para usar o Assistente.');
    const {p, erro, negado} = pegarPendencia(entrada, entrada.confirmacaoId);
    if (!p) return negado ? R.negado(erro) : R.texto(erro);
    if (p.tool === 'criar_evento_confirmado'){
      const d = {...p.dados}, avisos = [];
      const txt = (k, max) => { if (k in campos) d[k] = limpa(campos[k]).slice(0, max); };
      txt('titulo', 161); txt('local', 201); if ('descricao' in campos) d.descricao = String(campos.descricao ?? '').replace(/\r/g, '').trim().slice(0, 4001);
      if ('dia' in campos){ const v = String(campos.dia || ''); d.dia = /^\d{4}-\d{2}-\d{2}$/.test(v) && diaValido(...v.split('-').map(Number)) ? v : null; }
      if ('hora' in campos){ const v = String(campos.hora || ''); d.hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null; }
      if ('horaFim' in campos){ const v = String(campos.horaFim || ''); d.horaFim = /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null; }
      if ('publico' in campos) d.publico = campos.publico === true || campos.publico === 'true';
      let coms = [];
      try { coms = await comunidadesDe(entrada); } catch(x){}
      if ('comunidadeId' in campos){
        const v = String(campos.comunidadeId || '');
        if (!v){ d.comunidadeId = null; d.comunidadePendente = false; }
        else if (coms.some(c => c.id === v)){ d.comunidadeId = v; d.comunidadePendente = false; }
        else { d.comunidadeId = null; d.comunidadePendente = true; avisos.push('Escolha uma comunidade cadastrada ou “Toda a paróquia”.'); }
      }
      pendentes.delete(p.id);
      const id = abrirPendencia(entrada, p.tool, d);
      return cartaoEvento(id, d, coms, avisos);
    }
    if (p.tool === 'atualizar_solicitacao_confirmada'){
      const st = String(campos.status || '');
      if (!STATUS[st] || st === p.dados.de) return R.texto('Escolha uma situação diferente da atual.');
      pendentes.delete(p.id);
      const id = abrirPendencia(entrada, p.tool, {...p.dados, para:st});
      return cartaoStatus(id, {service_title:p.dados.servico, protocol:p.dados.protocol, status:p.dados.de}, st);
    }
    return R.texto('Não há o que corrigir aqui.');
  }

  async function confirmar(entrada){
    const inv = validarEntrada(entrada); if (inv) return R.negado('Entre com seu usuário da paróquia para usar o Assistente.');
    const {p, erro, negado} = pegarPendencia(entrada, entrada.confirmacaoId);
    if (!p){ if (negado) await auditar(entrada, 'confirmacao', 'negado'); return negado ? R.negado(erro) : R.texto(erro); }
    const f = FERRAMENTAS[p.tool];
    if (!podeArea(entrada.sender.papel, f.area)){ pendentes.delete(p.id); await auditar(entrada, p.tool, 'negado', true); return semPermissao(f.area); }
    if (p.tool === 'criar_evento_confirmado'){
      const d = p.dados, {faltando} = validarEvento(d, hoje(), agora().getTime());
      if (faltando.length) return R.texto('Ainda faltam dados. Use “Corrigir” para completar.');
      pendentes.delete(p.id); // antes de executar: dois cliques não criam dois eventos
      const evento = {parish_id:p.parishId, community_id:d.comunidadeId || null, scope:d.comunidadeId ? 'community' : 'parish',
        title:d.titulo, description:d.descricao || '', starts_at:isoSP(d.dia, d.hora), ends_at:d.horaFim ? isoSP(d.dia, d.horaFim) : null,
        location:d.local || '', public:!!d.publico, highlight_home:false, cancelled:false, source:'agente', google_event_id:null};
      try {
        const r = await backend.criarEvento({parishId:p.parishId, evento});
        await auditar(entrada, p.tool, 'ok', true);
        const h = hoje();
        return {tipo:'feito', linhas:[`Pronto! O evento “${r?.title || d.titulo}” foi criado para ${diaExtenso(d.dia, h)}, às ${horaBR(d.hora)}.`, d.publico ? 'Ele já aparece na agenda pública da paróquia.' : 'Só a equipe vê este evento.'],
          acoes:[{rotulo:'Abrir a Agenda', tipo:'ir', valor:'agenda'}]};
      } catch(x){ const k = tipoErro(x); await auditar(entrada, p.tool, k === 'permissao' ? 'negado' : 'erro', true); return R.erro(k === 'geral' ? ERRO_MSG.gravar : ERRO_MSG[k]); }
    }
    if (p.tool === 'atualizar_solicitacao_confirmada'){
      pendentes.delete(p.id);
      try {
        // A solicitação precisa continuar existindo NESTA paróquia (a lista vem filtrada pela paróquia da sessão).
        const atual = (await listaSolicitacoes(entrada)).find(s => s.id === p.dados.requestId);
        if (!atual){ await auditar(entrada, p.tool, 'negado', true); return R.negado('Não encontrei essa solicitação nesta paróquia.'); }
        if (atual.status === p.dados.para){ await auditar(entrada, p.tool, 'vazio', true); return R.texto(`A solicitação ${atual.protocol} já está como ${STATUS[atual.status].um}.`); }
        await backend.atualizarSolicitacao({parishId:p.parishId, requestId:atual.id, status:p.dados.para});
        await auditar(entrada, p.tool, 'ok', true);
        return {tipo:'feito', linhas:[`Pronto! A solicitação ${atual.protocol} agora está ${STATUS[p.dados.para].um}.`], acoes:[{rotulo:'Abrir a solicitação', tipo:'abrir_solicitacao', valor:atual.id}]};
      } catch(x){ const k = tipoErro(x); await auditar(entrada, p.tool, k === 'permissao' ? 'negado' : 'erro', true); return R.erro(k === 'geral' ? ERRO_MSG.gravar : ERRO_MSG[k]); }
    }
    return R.texto('Nada a confirmar.');
  }
  async function cancelar(entrada){
    const inv = validarEntrada(entrada); if (inv) return R.negado('Entre com seu usuário da paróquia para usar o Assistente.');
    const {p} = pegarPendencia(entrada, entrada.confirmacaoId);
    if (p){ pendentes.delete(p.id); await auditar(entrada, p.tool, 'cancelado'); }
    return R.texto('Tudo bem, não fiz nenhuma alteração.');
  }
  // "Usar esta": a UI escolhe uma solicitação da lista (só vale se for desta paróquia).
  async function focar(entrada, requestId){
    const inv = validarEntrada(entrada); if (inv) return R.negado('Entre com seu usuário da paróquia para usar o Assistente.');
    const r = await usar(entrada, 'consultar_solicitacoes', () => listaSolicitacoes(entrada));
    if (r.negado) return semPermissao('secretaria24h');
    if (!r.ok) return R.erro(ERRO_MSG[r.erro]);
    const s = r.ok.find(x => x.id === requestId);
    if (!s) return R.negado('Não encontrei essa solicitação nesta paróquia.');
    conversa(entrada).foco = s.id;
    return R.texto(`Certo, vamos falar da solicitação ${s.protocol} (${s.service_title || 'Secretaria 24h'}), que está ${STATUS[s.status].um}. O que devo fazer?`,
      {acoes:['in_progress','waiting_user','completed'].filter(k => k !== s.status).map(k => ({rotulo:'Marcar como ' + STATUS[k].um, tipo:'perguntar', valor:'Marque esta solicitação como ' + STATUS[k].um}))});
  }

  async function receber(entrada){
    const inv = validarEntrada(entrada);
    if (inv) return R.negado('Entre com seu usuário da paróquia para usar o Assistente.');
    const texto = limpa(entrada.message).slice(0, 1000);
    let it;
    try { it = await interpretar(texto, {agora:agora()}); } catch(x){ it = null; }
    if (!it || !it.intent) it = interpretarDeterministico(texto, {agora:agora()}); // sem IA (ou se ela falhar): parser V1
    // Outra paróquia citada no texto: nega (a paróquia é sempre a da sessão; o texto nunca troca de paróquia).
    let conhecidas = [], coms = [];
    try { conhecidas = (await backend.paroquiasConhecidas?.()) || []; } catch(x){}
    try { if (/comunidade|capela|santo|santa|sao|são|senhora/i.test(texto)) coms = await comunidadesDe(entrada); } catch(x){}
    if (outraParoquia(texto, entrada.parish.nome, conhecidas, coms, {criacao:it.intent === 'preparar_evento'})){
      await auditar(entrada, 'outra_paroquia', 'negado');
      return R.negado([`Eu trabalho só com os dados da ${entrada.parish.nome || 'sua paróquia'}.`, 'Informações de outras paróquias não são acessadas pelo Assistente.']);
    }
    switch (it.intent){
      case 'ajuda': return R.texto(['Olá! Sou o Assistente Paroquial. Fale normalmente, por exemplo:'], {sugestoes:exemplosPara(entrada.sender.papel)});
      case 'vermelho': await auditar(entrada, 'bloqueado_' + (it.motivo || 'acao'), 'negado'); return R.negado(VERMELHO[it.motivo] || 'Isso eu não faço sozinho.');
      case 'consultar_agenda': case 'consultar_eventos': return agenda(entrada, it);
      case 'consultar_comunidades': return comunidades(entrada, it);
      case 'consultar_servicos': return servicos(entrada);
      case 'consultar_solicitacoes': return solicitacoes(entrada, it);
      case 'preparar_evento': return prepararEvento(entrada, it);
      case 'preparar_atualizacao_solicitacao': return prepararStatus(entrada, it);
      case 'atualizar_servico': await auditar(entrada, 'atualizar_servico', 'negado'); return R.texto(['A edição do catálogo de serviços pelo Assistente ainda não está ativada.', 'Por enquanto, o suporte da Central Paroquial faz essas mudanças.']);
      default: return R.texto(['Desculpe, não entendi. Você pode perguntar, por exemplo:'], {sugestoes:exemplosPara(entrada.sender.papel)});
    }
  }

  return {receber, confirmar, corrigir, cancelar, focar, trilha:() => trilha.slice(), pendentes:() => pendentes.size};
}
// "Sábado: 18h00" → horários de missa do dia (texto que a paróquia já informou em Ajustes).
function linhasMissa(texto, dia){
  const nome = norm(DIAS[semanaDe(dia)]).replace('-feira', '');
  return String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(l => norm(l).startsWith(nome))
    .map(l => l.replace(/^[^:]+:\s*/, '')).filter(Boolean).slice(0, 3);
}

/* =========================================================
   BACKEND Supabase (painel hoje; Worker/WhatsApp no futuro com o JWT do usuário)
   Só tabelas/funções que já existem e que o banco protege:
   events/communities (RLS: membro lê; can_access 'agenda' grava), public_service_catalog,
   service_requests/service_catalog (RLS: can_access 'secretaria24h'), staff_update_service_request.
   agent_log_action só existe depois de supabase/agente.sql (sem ela, a auditoria fica só na memória).
   ========================================================= */
function criarBackendSupabase(sb, {slug} = {}){
  const falhou = error => { if (error) throw error; };
  let conhecidasCache = null;
  let semOrigem = false; // events.source ainda não existe no banco (supabase/agente.sql não rodou)
  return {
    async listarEventos({parishId, inicio, fim}){
      const {data, error} = await sb.from('events').select('id, title, starts_at, ends_at, location, community_id, public, cancelled')
        .eq('parish_id', parishId).gte('starts_at', inicio).lt('starts_at', fim).order('starts_at');
      falhou(error); return data || [];
    },
    async listarComunidades({parishId}){
      const {data, error} = await sb.from('communities').select('id, name, patron, mass_schedule, active').eq('parish_id', parishId);
      falhou(error); return data || [];
    },
    async listarServicos({slug: s}){
      const {data, error} = await sb.rpc('public_service_catalog', {p_slug:s || slug});
      falhou(error); return Array.isArray(data) ? data : [];
    },
    async listarSolicitacoes({parishId}){
      // Só o necessário para organizar a fila: sem nome, telefone nem respostas do fiel.
      const [cat, req] = await Promise.all([
        sb.from('service_catalog').select('id, title').eq('parish_id', parishId),
        sb.from('service_requests').select('id, service_id, protocol, status, is_demo, created_at, updated_at').eq('parish_id', parishId).order('created_at', {ascending:false}).limit(500)
      ]);
      falhou(cat.error); falhou(req.error);
      const tit = new Map((cat.data || []).map(c => [c.id, c.title]));
      return (req.data || []).map(r => ({...r, service_title:tit.get(r.service_id) || ''}));
    },
    async criarEvento({parishId, evento}){
      const linha = {...evento, parish_id:parishId};
      if (semOrigem) delete linha.source;
      let {data, error} = await sb.from('events').insert(linha).select('id, title, starts_at').single();
      if (error && !semOrigem && /source/.test(error.message || '') && ['PGRST204','42703'].includes(error.code)){
        semOrigem = true; delete linha.source;
        ({data, error} = await sb.from('events').insert(linha).select('id, title, starts_at').single());
      }
      falhou(error); return data;
    },
    async atualizarSolicitacao({requestId, status}){
      // Função segura que já existe: confere can_access(parish,'secretaria24h') e grava o histórico.
      const {data, error} = await sb.rpc('staff_update_service_request', {p_request:requestId, p_status:status, p_note:null, p_public_note:false});
      falhou(error); return data;
    },
    async auditar({parishId, channel, tool, result, confirmed}){
      const {error} = await sb.rpc('agent_log_action', {p_parish:parishId, p_channel:channel, p_tool:tool, p_result:result, p_confirmed:confirmed});
      if (error && tipoErro(error) !== 'ausente') throw error;
    },
    async paroquiasConhecidas(){
      if (conhecidasCache) return conhecidasCache;
      try {
        const {data, error} = await sb.rpc('public_directory_search', {p_q:'', p_limit:50});
        conhecidasCache = !error && Array.isArray(data) ? data.filter(d => d.active).map(d => ({nome:d.name})) : [];
      } catch(x){ conhecidasCache = []; }
      return conhecidasCache;
    }
  };
}

const api = {criarAgente, criarBackendSupabase, interpretarDeterministico, podeArea, FERRAMENTAS, STATUS, CANAIS,
  util:{diaSP, horaSP, isoSP, somaDias, norm, outraParoquia, aliasesParoquia, lerData, lerHoras}};
if (typeof module === 'object' && module.exports) module.exports = api;
else raiz.AgenteCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
