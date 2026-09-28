// Importa o Diretório Arquidiocesano a partir do PDF do Catálogo 2026 da Arquidiocese de BH.
//
// Uso:  node scripts/importar-catalogo.mjs [caminho/do/catalogo.pdf]
//       (padrão: docs/catalogo-01.07.26.pdf). Precisa do "pdftotext" (vem com o Git for Windows / poppler).
//
// Gera (sem tocar em banco nenhum):
//   supabase/diretorio_seed.sql          insert/update de parish_directory
//                                        (rode DEPOIS de diretorio.sql e diretorio_santuarios.sql)
//   docs/diretorio-importacao.json       o mesmo conteúdo em JSON + a reconciliação, para revisão e testes
//   docs/diretorio-reconciliacao.md      relatório legível da reconciliação
//
// Três seções do catálogo, cada uma com um papel:
//   7.13  Paróquias da Arquidiocese   — ficha completa (código "Cod.", endereço, pároco…). NÃO traz as paróquias
//                                        que são santuários (essas só aparecem na 7.14).
//   7.14a Santuários                   — ficha completa de cada santuário (código "Cód." próprio, reitor…).
//   7.15  Paróquias por forania        — relação oficial de nomes por forania. Não tem ficha: serve para CONFERIR,
//                                        nome a nome, que nenhuma paróquia ficou de fora e para saber quais
//                                        santuários também são paróquia.
// Capelas e capelanias (7.14 b–e) ficam de fora.
//
// Regras:
//   - Só o que está escrito no catálogo. O que não aparece fica NULL. Nada é completado por fora.
//   - Curato e área pastoral NÃO viram paróquia (type próprio). Santuário que não é paróquia: type 'santuario'.
//   - Santuário que também é paróquia = UM registro só (is_sanctuary = true), pela regra de união abaixo.
//     Caso duvidoso NÃO é unido: fica listado como ambíguo no relatório.
//   - Códigos: catalog_code = "Cod." da ficha de PARÓQUIA (7.13); sanctuary_code = "Cód." da ficha de SANTUÁRIO
//     (7.14). O número ordinal ("1.", "2."…) de cada relação não é guardado.
//   - "display_name" é só o nome do catálogo com maiúsculas/minúsculas de leitura; "name" guarda o texto original.
//   - O slug de quem já existia não muda (o banco usa o slug como chave de quem não tem código).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PDF = process.argv[2] || path.join(REPO, 'docs', 'catalogo-01.07.26.pdf');
const SOURCE_YEAR = 2026;
const pdf = (de, ate) => execFileSync('pdftotext', ['-enc', 'UTF-8', '-f', String(de), '-l', String(ate), PDF, '-'], {encoding:'utf8', maxBuffer:64 << 20});

// ---------- utilidades ----------
function tit(s){
  const menores = new Set(['de','da','do','das','dos','e','d’','di']);
  return s.toLowerCase().replace(/(^|[\s(/“"-])([a-zà-ú])([a-zà-ú’']*)/g, (x, a, b, c, off) => {
    const pal = b + c;
    return a + (off > 0 && menores.has(pal) ? pal : b.toUpperCase() + c);
  }).replace(/\bD’([a-z])/g, (x, l) => 'D’' + l.toUpperCase()).replace(/\bIi\b/g, 'II').replace(/\bXxiii\b/g, 'XXIII');
}
const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const slugify = s => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// Nome normalizado para comparar (sem acento, minúsculas, abreviações comuns por extenso, sem pontuação)
const nn = s => ' ' + semAcento(String(s || '')).toLowerCase().replace(/(\S)\(/g, '$1 (').replace(/[.,;:’'"“”()\/–-]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
const ABREV = [[/ sto /g, ' santo '], [/ sta /g, ' santa '], [/ sra /g, ' senhora '], [/ nossa sra /g, ' nossa senhora '], [/ n senhora /g, ' nossa senhora '], [/ pq /g, ' parque '], [/ jd /g, ' jardim '], [/ terezinha /g, ' teresinha '], [/ nazareth /g, ' nazare ']]; // só para comparar nomes entre as seções
const nome = s => ABREV.reduce((t, [a, b]) => t.replace(a, b).replace(a, b), nn(s)).trim();
const endNorm = s => nome(s).replace(/\b(rua|r|av|avenida|praca|pca|pc)\b/g, '').replace(/\bs n[ºo°]?\b|\bs\/n\b/g, 'sn').replace(/\s+/g, ' ').trim();

// ---------- páginas: acha as seções pelo título, não por número fixo ----------
const tudo = pdf(1, 999).split('\f');
const pagDe = re => tudo.findIndex((p, i) => i > 20 && re.test(p)) + 1; // pula o sumário
const P_PAROQUIAS = pagDe(/7\.13 Paróquias da Arquidiocese/), P_SANTUARIOS = pagDe(/7\.14 Santuários, Capelas/), P_FORANIAS = pagDe(/7\.15 Paróquias por Região Episcopal/);
if (!P_PAROQUIAS || !P_SANTUARIOS || !P_FORANIAS) throw new Error('Seções 7.13/7.14/7.15 não encontradas no PDF');

const RUIDO = /^(CATÁLOGO 2026|Arquidiocese de Belo Horizonte|PARÓQUIAS DA ARQUIDIOCESE|PARÓQUIAS DA|PARÓQUIAS POR REGIÃO EPISCOPAL|PARÓQUIAS|POR REGIÃO|EPISCOPAL|\d{1,3})$/;
const limpar = t => t.split('\n').map(l => l.trim()).filter(l => l && !RUIDO.test(l)).join(' ').replace(/\s+/g, ' ');

// ---------- 7.15: regiões, foranias e a relação oficial de paróquias por forania ----------
let secFor = limpar(tudo.slice(P_FORANIAS - 1, P_FORANIAS + 5).join('\n'));
const fimFor = secFor.indexOf('a) Paróquias por Munic'); if (fimFor > 0) secFor = secFor.slice(0, fimFor);
const REGIOES = {};
for (const m of secFor.matchAll(/\d\.\s+REGIÃO EPISCOPAL (NOSSA SENHORA(?: [A-ZÁ-Úa-zá-ú]+)+?)\s*-\s*(RENS[A-Z]{1,2})\b/g)) REGIOES[m[2]] = 'Região Episcopal ' + tit(m[1]);
const titulosReg = [...secFor.matchAll(/\d\.\s+REGIÃO EPISCOPAL .+?\s*-\s*(RENS[A-Z]{1,2})\b/g)];
const regiaoNaPos = i => [...titulosReg].reverse().find(m => m.index <= i)?.[1] || null;
// cada forania: nome, região e o texto da lista "Paróquias …"
const FOR715 = [...secFor.matchAll(/(\d{1,2})\.\s+Forania\s+(?:de\s+)?(.+?)\s+Vigário Forâneo:?(.*?)Paróquias\s+(.*?)(?=\s\d{1,2}\.\s+(?:Forania|REGIÃO)|$)/g)]
  .map(m => ({forania:m[2].trim(), regiao:regiaoNaPos(m.index), lista:m[4].replace(/^\d{2,3}\s+/, '').trim()}));
// o mesmo nome de forania existe em duas regiões (ex.: Nossa Senhora do Carmo, RENSA e RENSB)
const REGS_DA_FORANIA = {};
FOR715.forEach(f => (REGS_DA_FORANIA[f.forania] ||= new Set()).add(f.regiao));
const FORANIAS = Object.keys(REGS_DA_FORANIA).sort((a, b) => b.length - a.length); // o mais longo primeiro

// ---------- ficha (7.13 e 7.14): endereço, telefone, pároco… ----------
const ROTULOS = 'Pároco e Reitor(?: do Santuário [^:]+)?|Párocos Solidários|Pároco|Pàroco|Administrador Paroquial(?: "pro tempore")?|Adm\\. Paroquial(?: [“"]Pro Tempore[”"])?|Adm\\. Pastoral|Cura';
function campos(corpo){
  const r = {};
  const MESES = {janeiro:1, fevereiro:2, 'março':3, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12};
  const d2 = n => String(n).padStart(2, '0');
  const data = (d, m, a) => `${a}-${d2(m)}-${d2(d)}`;
  // criação da PARÓQUIA: "Criação: dd/mm/aaaa" (na 7.14, a marcada com "(Paróquia)" quando há duas)
  const paroq = corpo.match(/Criação:?\s*(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{4})\s*\(Paróquia\)/);
  const cri = paroq || corpo.match(/Criação:?\s*(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{4})/);
  const criExt = corpo.match(/Criação:?\s*(\d{1,2}) de ([a-zç]+) de (\d{4})/i);
  r.founded_on = cri ? data(cri[1], cri[2], cri[3]) : criExt && MESES[criExt[2].toLowerCase()] ? data(criExt[1], MESES[criExt[2].toLowerCase()], criExt[3]) : null;
  const elev = corpo.match(/(?:Elevação a Santuário|Criação do Santuário):?\s*(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{4})/);
  r.sanctuary_since = elev ? data(elev[1], elev[2], elev[3]) : null;
  // Forania: pode vir depois de observações; só vale se bater com uma forania oficial da 7.15
  let resto = corpo.replace(/^.*?Criação(?: do Santuário)?:?\s*(?:\d{1,2}\s*[/.]\s*\d{1,2}\s*[/.]\s*\d{4}|\d{1,2} de [a-zç]+ de \d{4}|anterior a \d{4})\s*/i, '');
  r.forania = null;
  const posF = resto.search(/Forania\s/);
  if (posF >= 0){
    const depois = resto.slice(posF).replace(/^Forania\s+(?:de\s+)?/, '');
    const f = FORANIAS.find(n => semAcento(depois).toLowerCase().startsWith(semAcento(n).toLowerCase()));
    if (f){ r.forania = f; resto = depois.slice(f.length).trim(); }
    else {
      // "Forania São Sebastião" sem o complemento: há mais de uma (Sabará, Boa Vista). Tira o nome do endereço
      // e deixa a forania para a 7.15 decidir (pelo nome e bairro da paróquia na relação oficial).
      const base = [...new Set(FORANIAS.map(n => n.replace(/\s*\(.*\)$/, '')))].sort((a, b) => b.length - a.length)
        .find(n => semAcento(depois).toLowerCase().startsWith(semAcento(n).toLowerCase()) && FORANIAS.filter(x => x.startsWith(n + ' (')).length > 1);
      if (base){ r.foraniaIncompleta = base; resto = depois.slice(base.length).trim(); }
    }
  } else if (/^\s*\(Santuário|^\s*\(Paróquia/.test(resto)) resto = resto.replace(/^\s*\([^)]*\)\s*/, '');
  resto = resto.replace(/^Criação:?\s*/, '').replace(/^Endereço para correspondência:\s*/i, '').replace(/^\([^)]*\)\s*/, ''); // "(Betim) Rua …": o complemento é da forania
  // "Criação Área Pastoral: 25/12/2014 Elevação a Paróquia: 22/08/2024 Av. …" (paróquia nova): a criação da paróquia é a elevação
  const elevParoq = corpo.match(/Elevação a Paróquia:?\s*(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{4})/);
  if (elevParoq){ r.founded_on = data(elevParoq[1], elevParoq[2], elevParoq[3]); resto = resto.replace(/^.*?Elevação a Paróquia:?\s*\d{1,2}\s*[/.]\s*\d{1,2}\s*[/.]\s*\d{4}\s*/, ''); }
  const cepRe = /(\d{2}\.?\d{3}-\d{3})\s*-?\s*([A-Za-zÁ-úÇç][A-Za-zÁ-úÇç .'’-]*?[A-Za-zÁ-úÇç])\s*(?:\(([^)]*)\)|(?=\s*-\s*MG))/;
  const cep = resto.match(cepRe);
  const fimEnd = resto.search(/\s*-?\s*(Tel\.?|Telefax\.?|Tels?\.?|Telefones|Fone|Telefone)\s*:?/i);
  const posCep = cep ? cep.index : -1;
  const corte = [fimEnd, posCep].filter(x => x >= 0).sort((a, b) => a - b)[0];
  const end = corte !== undefined ? resto.slice(0, corte).replace(/[\s,-]+$/, '').trim() : '';
  r.address = end && !/^(E-?mail|Pároco|Administrador|Reitor)/i.test(end) ? end : null;
  const tel = resto.match(/(?:Tel\.?|Telefax\.?|Tels?\.?|Fone|Telefone)\s*:?\s*((?:\(?\d{2}\)?\s*)?\d{4,5}\s?-?\d{4}(?:\s*(?:\/|e|–|-)\s*(?:\(?\d{2}\)?\s*)?\d{4,5}\s?-?\d{4})*)/i);
  r.phone = tel ? tel[1].replace(/\s+/g, ' ').trim() : null;
  r.postal_code = cep ? cep[1].replace('.', '') : null;
  r.municipality = cep ? tit(cep[2].trim()) : null;
  r.neighborhood = cep && cep[3] ? cep[3].trim().replace(/\s+/g, ' ') : null;
  const em = resto.match(/E-?mail\s*:?\s*([\w.+-]+@\s?[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/i);
  r.email = em ? em[1].replace(/\s/g, '').toLowerCase() : null;
  const pr = resto.match(new RegExp(`(${ROTULOS})\\s*(?::\\s*|(?=(?:Pe\\.|Frei|Côn\\.|Mons\\.|Dom)\\s))(.*?)(?=\\s+(?:Vigário|Pároco Emérito|Diácono|Pró-Reitor|Reitor)\\b|$)`));
  const nomePadre = pr ? pr[2].trim().replace(/[.;,]$/, '') : '';
  r.pastor_role = nomePadre ? (pr[1] === 'Pàroco' ? 'Pároco' : /^Pároco e Reitor/.test(pr[1]) ? 'Pároco e Reitor' : pr[1].replace(/\s*[“"]Pro Tempore[”"]/i, ' "pro tempore"')) : null;
  r.pastor_name = nomePadre || null;
  const rei = resto.match(/(?<!Pró-)(?<!e )Reitor:\s*(.*?)(?=\s+(?:Pró-Reitor|Pároco|Vigário|Diácono)\b|$)/);
  r.rector_name = /^Pároco e Reitor/.test(pr?.[1] || '') ? nomePadre : rei ? rei[1].trim().replace(/[.;,]$/, '') : null;
  return r;
}

// ---------- 7.13: paróquias ----------
let sec = limpar(tudo.slice(P_PAROQUIAS - 1, P_SANTUARIOS - 1).join('\n'));
sec = sec.slice(sec.indexOf('7.13 Paróquias da Arquidiocese') + '7.13 Paróquias da Arquidiocese'.length);
const fimSec = sec.indexOf('7.14 Santuários'); if (fimSec > 0) sec = sec.slice(0, fimSec);
const BLOCOS = [['paroquia_territorial', null], ['paroquia_pessoal', 'B PARÓQUIAS PESSOAIS'], ['paroquia_militar', 'B PARÓQUIA MILITAR'], ['curato', 'B CURATOS'], ['area_pastoral', 'B ÁREA PASTORAL']];
const cortes = BLOCOS.map(([, t]) => t ? sec.indexOf(t) : 0);
if (cortes.some(c => c < 0)) throw new Error('Subtítulos de 7.13 não encontrados: ' + BLOCOS.filter((b, i) => cortes[i] < 0).map(b => b[1]));
const CAB = /(?:^|\s)(\d{1,3})\.\s*([A-ZÁ-ÚÇ].+?)\s*(?:\((RENS[A-Z]{1,2})\)\s*-?\s*)?\([Cc][OoÓó][Dd]\.?\s*(\d*)\s*\)/g;
const e713 = [];
BLOCOS.forEach(([type, titulo], i) => {
  const trecho = sec.slice(cortes[i] + (titulo ? titulo.length : 0), cortes[i + 1] ?? sec.length);
  const cabs = [...trecho.matchAll(CAB)];
  cabs.forEach((m, j) => {
    if (+m[1] !== j + 1) throw new Error(`7.13 ${type}: esperava item ${j + 1}, li ${m[1]} (${m[2]})`); // numeração contínua: nada pulado
    e713.push({secao:'7.13', seq:+m[1], type, nomeCat:m[2].trim().replace(/\s+/g, ' '), regiao:m[3] || null, codigo:m[4] || null,
      ...campos(trecho.slice(m.index + m[0].length, cabs[j + 1]?.index ?? trecho.length).trim())});
  });
});

// ---------- 7.14 a): santuários ----------
let secSan = limpar(tudo.slice(P_SANTUARIOS - 1, P_SANTUARIOS + 1).join('\n'));
secSan = secSan.slice(secSan.indexOf('a) Santuários') + 'a) Santuários'.length);
secSan = secSan.slice(0, secSan.indexOf('b) Capelas Curiais'));
const cabsSan = [...secSan.matchAll(/(?:^|\s)(\d{1,2})\.\s+(SANTUÁRIO\b)/g)];
const e714 = cabsSan.map((m, j) => {
  if (+m[1] !== j + 1) throw new Error(`7.14 santuários: esperava item ${j + 1}, li ${m[1]}`);
  const bloco = secSan.slice(m.index + m[0].length - m[2].length, cabsSan[j + 1]?.index ?? secSan.length).trim();
  // cabeçalho: até o "(Cód. N)"; sem código, até a sigla da região
  const fimCab = bloco.match(/\([Cc][OoÓó][Dd]\.?\s*\d*\s*\)/) || bloco.match(/\bRENS[A-Z]{1,2}\b\)?/);
  const cab = bloco.slice(0, fimCab.index + fimCab[0].length);
  const corpo = bloco.slice(cab.length).trim();
  const codigo = (cab.match(/\([Cc][OoÓó][Dd]\.?\s*(\d+)\s*\)/) || [])[1] || null;
  const regiao = (cab.match(/\b(RENS[A-Z]{1,2})\b/) || [])[1] || null;
  const nomeCat = cab.replace(/\([Cc][OoÓó][Dd]\.?\s*\d*\s*\)/, '').replace(/\(?\bRENS[A-Z]{1,2}\b\)?/, '').replace(/[\s-]+$/, '').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
  const kind = /Santuário Estadual/i.test(corpo) ? 'Santuário Estadual' : /^SANTUÁRIO ARQUIDIOCESANO/.test(nomeCat) ? 'Santuário Arquidiocesano' : 'Santuário';
  // nome do padroeiro/título sem "Santuário Arquidiocesano" (e sem o apelido entre parênteses) para comparar com paróquias
  const nucleo = nomeCat.replace(/^SANTUÁRIO\s+(?:ARQUIDIOCESANO\s+|DE\s+)?/, '').replace(/^DA\s+/, '');
  return {secao:'7.14', seq:+m[1], nomeCat, nucleo, codigo, regiao, kind, ...campos(corpo)};
});

// ---------- 7.15: nomes da relação oficial, casados contra os nomes conhecidos ----------
// Candidatos: fichas da 7.13 e da 7.14. Chaves de nome: display da 7.13 (sem "Curato" e sem o que está entre
// parênteses); para a 7.14, o nome com e sem "Santuário Arquidiocesano" / "Da".
const semParenteses = t => t.replace(/\s*\([^)]*\)\s*/g, ' ');
const conhecidos = [];
e713.forEach((e, i) => conhecidos.push({k:nome(semParenteses(tit(e.nomeCat)).replace(/^Curato\s+/, '')), ref:{fonte:'7.13', i}}));
e714.forEach((e, i) => [e.nucleo, e.nucleo.replace(/^DA\s+/, ''), e.nomeCat, e.nomeCat.replace(/^SANTUÁRIO\s+ARQUIDIOCESANO\s+/, '')]
  .forEach(v => conhecidos.push({k:nome(semParenteses(tit(v))), ref:{fonte:'7.14', i}})));
const nomesUnicos = [...new Set(conhecidos.map(c => c.k))].sort((a, b) => b.length - a.length);
const QUALIF = ['curato', 'area pastoral', 'capela curial', 'santuario arquidiocesano'];
// Cada "( … )" da 7.15 é o complemento (bairro/cidade) do nome anterior: não é um nome e serve para desempatar homônimos.
function itens715(lista){
  const toks = [];
  for (const m of lista.replace(/(\S)\(/g, '$1 (').matchAll(/\(([^)]*)\)|[^()]+/g)){
    if (m[1] !== undefined) toks.push({comp:nome(m[1])});
    else nome(m[0]).split(' ').filter(Boolean).forEach(w => toks.push({w}));
  }
  const itens = [], casa = (palavras, k) => palavras.every((w, j) => toks[k + j]?.w === w);
  let i = 0, desconhecido = null;
  const fecha = () => { if (desconhecido){ itens.push(desconhecido); desconhecido = null; } };
  while (i < toks.length){
    if (toks[i].comp !== undefined){ const alvo = desconhecido || itens.at(-1); if (alvo) alvo.comp = toks[i].comp; i++; continue; }
    let qual = null;
    for (const q of QUALIF){ const qt = q.split(' '); if (casa(qt, i)){ qual = q; i += qt.length; break; } }
    const achou = nomesUnicos.find(n => casa(n.split(' '), i));
    if (!achou){ desconhecido ||= {nome:'', desconhecido:true}; desconhecido.nome = [desconhecido.nome, qual, toks[i]?.w].filter(Boolean).join(' '); if (qual && !desconhecido.qual) desconhecido.qual = qual; i++; continue; }
    fecha();
    i += achou.split(' ').length;
    itens.push({nome:achou, qual});
  }
  fecha();
  return itens;
}

// ---------- reconciliação ----------
const R = {itens715:[], variacoes:[], semFicha:[], naoCasados713:[], ambiguos:[], unioes:[], santuariosIndependentes:[], santuariosSoNa715:[], foraDoEscopo:[]};
const usado713 = new Set(), usado714 = new Set(), papel714 = {};
const ficha = r => r.fonte === '7.13' ? e713[r.i] : e714[r.i];
const usado = r => (r.fonte === '7.13' ? usado713 : usado714).has(r.i);
const vizinhanca = r => [ficha(r).neighborhood, ficha(r).municipality].filter(Boolean).map(nome);
const bateComp = (r, c) => !c || vizinhanca(r).some(v => v.includes(c) || c.includes(v) || c.split(' ').some(w => w.length > 3 && v.split(' ').includes(w)));
const PARADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'd']);
const essencia = t => nome(t).split(' ').filter(w => w && !PARADAS.has(w));
const contido = (a, b) => { const A = essencia(a), B = essencia(b); const [menor, maior] = A.length <= B.length ? [A, B] : [B, A]; return menor.length >= 2 && menor.every(w => maior.includes(w)); };
function marca(r, f, it, regra){
  (r.fonte === '7.13' ? usado713 : usado714).add(r.i);
  if (r.fonte === '7.13' && !e713[r.i].forania) e713[r.i].forania = f.forania; // forania que a ficha deixou incompleta
  if (r.fonte === '7.14') papel714[r.i] = {paroquia:true, qual:it.qual, forania:f.forania};
  R.itens715.push({forania:f.forania, nome:it.nome, comp:it.comp || null, qual:it.qual, fonte:r.fonte, regra});
}
const pendentes = [];
// 1ª passada: nome idêntico (na forania da ficha; ficha sem forania só se o complemento bater)
for (const f of FOR715) for (const it of itens715(f.lista)){
  if (it.qual === 'capela curial'){ R.foraDoEscopo.push({forania:f.forania, nome:'Capela Curial ' + tit(it.nome.replace(/^capela curial /, ''))}); continue; }
  if (it.desconhecido && /^capela curial/.test(it.nome)){ R.foraDoEscopo.push({forania:f.forania, nome:tit(it.nome)}); continue; }
  if (it.desconhecido){ pendentes.push({f, it}); continue; }
  const refs = [...new Map(conhecidos.filter(c => c.k === it.nome).map(c => [c.ref.fonte + c.ref.i, c.ref])).values()].filter(r => !usado(r));
  let esc = refs.filter(r => ficha(r).forania === f.forania);
  if (!esc.length) esc = refs.filter(r => !ficha(r).forania && (ficha(r).foraniaIncompleta ? f.forania.startsWith(ficha(r).foraniaIncompleta) : true) && bateComp(r, it.comp));
  if (esc.length > 1){ const porComp = esc.filter(r => bateComp(r, it.comp)); if (porComp.length) esc = porComp; }
  if (esc.length === 1) marca(esc[0], f, it, 'nome igual');
  else pendentes.push({f, it, candidatos:esc.length});
}
// 2ª passada: grafia diferente entre as seções (ex.: "Catarina de Labouré" × "Catarina Labouré", "Nazaré" × "Nazareth").
// Só casa se: mesma forania (ou ficha sem forania) + um nome contido no outro (sem de/da/do/e) + complemento batendo com o bairro/cidade.
// Nome idêntico em forania diferente também casa, mas só se for a única ficha livre com esse nome (anotado como divergência).
for (const p of pendentes.splice(0)){
  const {f, it} = p;
  const livres = [...e713.map((e, i) => ({fonte:'7.13', i})), ...e714.map((e, i) => ({fonte:'7.14', i}))].filter(r => !usado(r));
  let esc = livres.filter(r => (ficha(r).forania === f.forania || !ficha(r).forania) && contido(it.nome, r.fonte === '7.13' ? semParenteses(ficha(r).nomeCat).replace(/^CURATO\s+/, '') : semParenteses(ficha(r).nucleo)) && (it.comp ? bateComp(r, it.comp) : true));
  let regra = 'variação de grafia (mesma forania, nome contido' + (it.comp ? ', mesmo bairro/cidade' : '') + ')';
  if (!esc.length && !it.desconhecido){
    esc = livres.filter(r => conhecidos.some(c => c.k === it.nome && c.ref.fonte === r.fonte && c.ref.i === r.i));
    regra = 'nome igual, mas a ficha (7.13) aponta outra forania: ' + (esc[0] ? ficha(esc[0]).forania : '');
  }
  if (esc.length === 1){ marca(esc[0], f, it, regra); R.variacoes.push({forania:f.forania, nome715:it.nome + (it.comp ? ` (${it.comp})` : ''), ficha:ficha(esc[0]).nomeCat, codigo:ficha(esc[0]).codigo, fonte:esc[0].fonte, regra}); continue; }
  const rotulo = (it.qual ? it.qual + ' ' : '') + it.nome + (it.comp ? ` (${it.comp})` : '');
  if (esc.length > 1) R.ambiguos.push({forania:f.forania, nome:rotulo, candidatos:esc.length});
  else R.semFicha.push({forania:f.forania, regiao:f.regiao, nome:rotulo, motivo:'na relação oficial (7.15), sem ficha na 7.13/7.14 que case com segurança: não importado'});
}
e713.forEach((e, i) => { if (!usado713.has(i) && e.type !== 'paroquia_pessoal') R.naoCasados713.push({codigo:e.codigo, nome:e.nomeCat, type:e.type, forania:e.forania, bairro:e.neighborhood}); });

// União santuário ↔ paróquia da 7.13 (as que têm ficha nas duas seções):
//   1) mesmo código; ou 2) mesmo CEP + mesmo endereço (normalizado) + mesmo município.
// Mesmo nome e forania mas endereço diferente = AMBÍGUO: não une.
const uniao714 = {};
e714.forEach((s, i) => {
  const porCod = s.codigo ? e713.findIndex(e => e.codigo === s.codigo) : -1;
  const porEnd = e713.findIndex(e => s.postal_code && e.postal_code === s.postal_code && s.address && e.address && endNorm(e.address) === endNorm(s.address) && e.municipality === s.municipality);
  const alvo = porCod >= 0 ? porCod : porEnd;
  if (alvo >= 0){ uniao714[i] = alvo; R.unioes.push({santuario:s.nomeCat, sanctuary_code:s.codigo, paroquia:e713[alvo].nomeCat, catalog_code:e713[alvo].codigo, regra:porCod >= 0 ? 'mesmo código' : 'mesmo CEP + endereço + município'}); return; }
  const homonimo = e713.find(e => nome(tit(e.nomeCat)) === nome(tit(s.nucleo).replace(/\s*\([^)]*\)\s*/g, ' ')) && e.forania === s.forania);
  if (homonimo) R.ambiguos.push({santuario:s.nomeCat, paroquia:homonimo.nomeCat, catalog_code:homonimo.codigo, motivo:`mesmo nome e forania, endereço diferente (${s.address} × ${homonimo.address}): não unido`});
  if (papel714[i]) R.santuariosSoNa715.push({santuario:s.nomeCat, sanctuary_code:s.codigo, forania:papel714[i].forania, regra:'na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só'});
  else R.santuariosIndependentes.push({santuario:s.nomeCat, sanctuary_code:s.codigo, forania:s.forania, motivo:homonimo ? 'ambíguo (ver acima)' : 'não aparece como paróquia na 7.15 nem casa com ficha da 7.13'});
});

// ---------- registros do diretório ----------
const usados = new Set(), dir = [];
const regiaoDe = (regiao, forania) => regiao || (forania && REGS_DA_FORANIA[forania]?.size === 1 ? [...REGS_DA_FORANIA[forania]][0] : null);
function novoSlug(display, c){
  const bh = !c.municipality || c.municipality === 'Belo Horizonte', centro = /^centro$/i.test(c.neighborhood || '');
  let slug = slugify(display + (bh ? (c.neighborhood ? '-' + c.neighborhood : '') : '-' + c.municipality + (c.neighborhood && !centro ? '-' + c.neighborhood : '')));
  if (usados.has(slug)) slug = slugify(display + '-' + (c.municipality || '') + '-' + (c.neighborhood || ''));
  if (usados.has(slug)) slug += '-' + (c.codigo || c.seq);
  usados.add(slug);
  return slug;
}
const vazioSantuario = {is_sanctuary:false, sanctuary_code:null, sanctuary_name:null, sanctuary_kind:null, rector_name:null, sanctuary_since:null};
// nome de exibição sem o apelido do lugar entre parênteses (o bairro aparece à parte); o original fica em name
const dadosSantuario = s => ({is_sanctuary:true, sanctuary_code:s.codigo, sanctuary_name:semParenteses(tit(s.nomeCat)).replace(/\s+/g, ' ').trim(), sanctuary_kind:s.kind, rector_name:s.rector_name, sanctuary_since:s.sanctuary_since});
e713.forEach((e, i) => {
  const s = Object.entries(uniao714).find(([, a]) => a === i)?.[0];
  const display = tit(e.nomeCat), regiao = regiaoDe(e.regiao, e.forania);
  dir.push({catalog_code:e.codigo, name:e.nomeCat, display_name:display, slug:novoSlug(display, e), type:e.type, episcopal_region:regiao, episcopal_region_name:REGIOES[regiao] || null,
    forania:e.forania, municipality:e.municipality, neighborhood:e.neighborhood, address:e.address, postal_code:e.postal_code, phone:e.phone, email:e.email,
    pastor_role:e.pastor_role, pastor_name:e.pastor_name, founded_on:e.founded_on, source_year:SOURCE_YEAR,
    ...(s !== undefined ? dadosSantuario(e714[s]) : vazioSantuario), source_section:s !== undefined ? '7.13+7.14' : '7.13'});
});
e714.forEach((s, i) => {
  if (uniao714[i] !== undefined) return;
  const paroquia = !!papel714[i];
  const display = semParenteses(tit(s.nucleo)).replace(/^Da\s+/, '').replace(/\s+/g, ' ').trim(), regiao = regiaoDe(s.regiao, s.forania);
  dir.push({catalog_code:null, name:s.nomeCat, display_name:display, slug:novoSlug(paroquia ? display : 'Santuário ' + display, s), type:paroquia ? 'paroquia_territorial' : 'santuario',
    episcopal_region:regiao, episcopal_region_name:REGIOES[regiao] || null, forania:s.forania, municipality:s.municipality, neighborhood:s.neighborhood, address:s.address,
    postal_code:s.postal_code, phone:s.phone, email:s.email, pastor_role:paroquia || s.pastor_name ? s.pastor_role : null, pastor_name:s.pastor_name,
    founded_on:paroquia ? s.founded_on : null, source_year:SOURCE_YEAR, ...dadosSantuario(s), source_section:paroquia ? '7.14+7.15' : '7.14'});
});

// ---------- conferências (falha em vez de seguir com algo estranho) ----------
const codigos = dir.map(d => d.catalog_code).filter(Boolean), codSan = dir.map(d => d.sanctuary_code).filter(Boolean);
const dup = l => l.filter((c, i) => l.indexOf(c) !== i);
if (dup(codigos).length) throw new Error('Código de paróquia repetido: ' + dup(codigos));
if (dup(codSan).length) throw new Error('Código de santuário repetido: ' + dup(codSan));
if (dup(dir.map(d => d.slug)).length) throw new Error('Slug repetido: ' + dup(dir.map(d => d.slug)));
const porTipo = dir.reduce((a, d) => (a[d.type] = (a[d.type] || 0) + 1, a), {});
const paroquias = dir.filter(d => d.type.startsWith('paroquia'));
const faltando = k => dir.filter(d => d[k] == null).length;
const resumo = {fonte:path.basename(PDF), paginas:{paroquias:P_PAROQUIAS, santuarios:P_SANTUARIOS, foranias:P_FORANIAS}, total:dir.length, porTipo,
  numeros:{
    fichas_713:e713.length, paroquias_713:e713.filter(e => e.type.startsWith('paroquia')).length, santuarios_714:e714.length,
    itens_715:R.itens715.length + R.semFicha.length + R.ambiguos.filter(a => a.forania).length, itens_715_casados:R.itens715.length,
    paroquias_no_diretorio:paroquias.length, santuarios_tambem_paroquia:dir.filter(d => d.is_sanctuary && d.type.startsWith('paroquia')).length,
    santuarios_independentes:dir.filter(d => d.type === 'santuario').length, sem_ficha_715:R.semFicha.length, ambiguos:R.ambiguos.length,
    duplicatas:0, fichas_713_fora_da_715:R.naoCasados713.length},
  regioes:REGIOES, foranias:FOR715.length,
  semCampo:Object.fromEntries(['catalog_code','forania','address','postal_code','municipality','neighborhood','phone','email','pastor_name','founded_on'].map(k => [k, faltando(k)]))};

// ---------- saída ----------
const q = v => v == null ? 'null' : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const COLS = ['catalog_code','name','display_name','slug','type','episcopal_region','episcopal_region_name','forania','municipality','neighborhood','address','postal_code','phone','email','pastor_role','pastor_name','founded_on','source_year',
  'is_sanctuary','sanctuary_code','sanctuary_name','sanctuary_kind','rector_name','sanctuary_since','source_section'];
const ATUALIZA = COLS.filter(c => !['catalog_code','slug'].includes(c)).map(c => `${c} = excluded.${c}`).concat('updated_at = now()').join(', ');
const val = (d, c) => ['founded_on','sanctuary_since'].includes(c) ? (d[c] ? `'${d[c]}'::date` : 'null') : c === 'source_year' ? d[c] : q(d[c]);
const linhas = l => l.map(d => `  (${COLS.map(c => val(d, c)).join(', ')})`).join(',\n');
const comCod = dir.filter(d => d.catalog_code), semCod = dir.filter(d => !d.catalog_code);
const sql = `-- Central Paroquial — Diretório Arquidiocesano: carga do Catálogo 2026 (GERADO, não edite à mão).
-- Gerado por scripts/importar-catalogo.mjs a partir de ${path.basename(PDF)} (seções 7.13, 7.14a e 7.15).
-- ${dir.length} registros: ${Object.entries(porTipo).map(([k, v]) => `${k} ${v}`).join(', ')}.
-- Santuários: ${e714.length} (${resumo.numeros.santuarios_tambem_paroquia} também paróquia, ${resumo.numeros.santuarios_independentes} independentes).
-- Rode DEPOIS de supabase/diretorio.sql e supabase/diretorio_santuarios.sql. Pode rodar de novo: atualiza os dados
-- do catálogo e NUNCA mexe em status nem no vínculo com parishes (ativação é outro script).
-- Campos que não aparecem no catálogo ficam NULL.

insert into parish_directory (${COLS.join(', ')}) values
${linhas(comCod)}
on conflict (catalog_code) do update set ${ATUALIZA};

-- Sem código de paróquia (casam pelo slug): militar, área pastoral, paróquias que só têm ficha de santuário e santuários
insert into parish_directory (${COLS.join(', ')}) values
${linhas(semCod)}
on conflict (slug) do update set ${ATUALIZA};

-- Conferência
select type, is_sanctuary, count(*) from parish_directory group by type, is_sanctuary order by type, is_sanctuary;
`;
fs.writeFileSync(path.join(REPO, 'supabase', 'diretorio_seed.sql'), sql);
fs.writeFileSync(path.join(REPO, 'docs', 'diretorio-importacao.json'), JSON.stringify({resumo, reconciliacao:R, diretorio:dir}, null, 1) + '\n');

const md = `# Reconciliação do Diretório com o Catálogo 2026 (gerado)

Gerado por \`scripts/importar-catalogo.mjs\` a partir de \`${path.basename(PDF)}\`. Não edite à mão.

| | |
|---|---:|
| Fichas na 7.13 (paróquias, curato, área pastoral) | ${e713.length} |
| — das quais paróquias (territoriais, pessoais, militar) | ${resumo.numeros.paroquias_713} |
| Santuários na 7.14 | ${e714.length} |
| Nomes na relação oficial por forania (7.15) casados com uma ficha | ${R.itens715.length} |
| Nomes da 7.15 sem ficha | ${R.semFicha.length} |
| Casos ambíguos (não unidos) | ${R.ambiguos.length} |
| Paróquias no diretório | ${paroquias.length} |
| Santuários que também são paróquia (um registro só) | ${resumo.numeros.santuarios_tambem_paroquia} |
| Santuários independentes | ${resumo.numeros.santuarios_independentes} |
| Duplicatas (código, código de santuário ou slug) | 0 |
| **Total de registros no diretório** | **${dir.length}** |

## Por que São Paulo da Cruz (e outras) não entraram antes
As paróquias que são santuários **não têm ficha na 7.13**: o catálogo põe a ficha delas só na 7.14
(Santuários). O importador anterior lia apenas a 7.13. Agora a 7.14 é lida e a 7.15 (relação oficial de
paróquias por forania) confere nome a nome.

## Santuários que também são paróquia
${[...R.unioes.map(u => `- ${tit(u.santuario)} (Cód. ${u.sanctuary_code ?? '—'}) = paróquia ${tit(u.paroquia)} (Cod. ${u.catalog_code}) — ${u.regra}`),
   ...R.santuariosSoNa715.map(u => `- ${tit(u.santuario)} (Cód. ${u.sanctuary_code ?? '—'}), Forania ${u.forania} — ${u.regra}`)].join('\n') || '- nenhum'}

## Santuários independentes
${R.santuariosIndependentes.map(u => `- ${tit(u.santuario)} (Cód. ${u.sanctuary_code ?? '—'}) — ${u.motivo}`).join('\n') || '- nenhum'}

## Ambíguos (não unidos automaticamente)
${R.ambiguos.map(a => `- ${a.santuario ? `${tit(a.santuario)} × ${tit(a.paroquia)} (Cod. ${a.catalog_code}): ${a.motivo}` : `Forania ${a.forania}: "${a.nome}" com ${a.candidatos} fichas possíveis`}`).join('\n') || '- nenhum'}

## Nomes casados com grafia diferente entre as seções (conferidos, com evidência)
${R.variacoes.map(v => `- Forania ${v.forania}: 7.15 "${v.nome715}" = ficha ${tit(v.ficha)} (${v.fonte === '7.14' ? 'Cód.' : 'Cod.'} ${v.codigo ?? '—'}) — ${v.regra}`).join('\n') || '- nenhum'}

## Nomes da relação oficial (7.15) sem ficha na 7.13/7.14 — PENDENTES de decisão manual (não importados)
${R.semFicha.map(s => {
  const possiveis = [...R.naoCasados713.filter(x => x.forania === s.forania).map(x => `ficha ${tit(x.nome)} (Cod. ${x.codigo ?? '—'}, ${x.bairro ?? '—'}), que também não está na 7.15`),
    ...R.santuariosIndependentes.filter(x => x.forania === s.forania).map(x => `${tit(x.santuario)} (Cód. ${x.sanctuary_code ?? '—'}), santuário da mesma forania`)];
  return `- Forania ${s.forania} (${s.regiao}): "${s.nome}" — ${s.motivo}.${possiveis.length ? ' Possível correspondência, NÃO unida: ' + possiveis.join('; ') + '.' : ''}`; }).join('\n') || '- nenhum'}

## Fichas da 7.13 que não aparecem na 7.15 (importadas normalmente; a 7.15 parece não ter as criações recentes)
${R.naoCasados713.map(s => `- ${tit(s.nome)} (Cod. ${s.codigo ?? '—'}, ${s.type}, forania ${s.forania ?? '—'}, bairro ${s.bairro ?? '—'})`).join('\n') || '- nenhuma'}

## Fora do escopo desta importação
${R.foraDoEscopo.map(s => `- Forania ${s.forania}: ${s.nome}`).join('\n') || '- nada'}
- Capelas curiais, capelas especiais, capela militar e capelanias (7.14 b–e).

## Códigos
- \`catalog_code\`: "Cod." da ficha de **paróquia** (7.13). Nulo para quem só tem ficha de santuário, para a paróquia militar e para a área pastoral (o catálogo não informa).
- \`sanctuary_code\`: "Cód." da ficha de **santuário** (7.14).
- O número de ordem de cada relação ("1.", "2."…) serve só para conferir que nenhum item foi pulado; não é guardado.
`;
fs.writeFileSync(path.join(REPO, 'docs', 'diretorio-reconciliacao.md'), md);
console.log(JSON.stringify(resumo.numeros, null, 1));
console.log(md.split('## Por que')[1].split('## Códigos')[0]);
