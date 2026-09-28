// Importa o Diretório Arquidiocesano a partir do PDF do Catálogo 2026 da Arquidiocese de BH.
//
// Uso:  node scripts/importar-catalogo.mjs [caminho/do/catalogo.pdf]
//       (padrão: docs/catalogo-01.07.26.pdf). Precisa do "pdftotext" (vem com o Git for Windows / poppler).
//
// Gera (sem tocar em banco nenhum):
//   supabase/diretorio_seed.sql      insert/update de parish_directory (rode DEPOIS de supabase/diretorio.sql)
//   docs/diretorio-importacao.json   o mesmo conteúdo em JSON, para revisão e para os testes
//
// Regras:
//   - Só a seção "7.13 Paróquias da Arquidiocese" (territoriais, pessoais, militar, curatos e área pastoral).
//     Santuários, capelas e capelanias (7.14) ficam de fora desta importação.
//   - Só o que está escrito no catálogo. O que não aparece fica NULL. Nada é completado por fora.
//   - Curato e área pastoral NÃO viram paróquia: type = 'curato' / 'area_pastoral'.
//   - "display_name" é só o nome do catálogo com maiúsculas/minúsculas de leitura; "name" guarda o texto original.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PDF = process.argv[2] || path.join(REPO, 'docs', 'catalogo-01.07.26.pdf');
const SOURCE_YEAR = 2026;
const pdf = (de, ate) => execFileSync('pdftotext', ['-enc', 'UTF-8', '-f', String(de), '-l', String(ate), PDF, '-'], {encoding:'utf8', maxBuffer:64 << 20});

// ---------- páginas: acha as seções pelo título, não por número fixo ----------
const tudo = pdf(1, 999).split('\f');
const pagDe = re => tudo.findIndex((p, i) => i > 20 && re.test(p)) + 1; // pula o sumário
const P_PAROQUIAS = pagDe(/7\.13 Paróquias da Arquidiocese/), P_SANTUARIOS = pagDe(/7\.14 Santuários, Capelas/), P_FORANIAS = pagDe(/7\.15 Paróquias por Região Episcopal/);
if (!P_PAROQUIAS || !P_SANTUARIOS || !P_FORANIAS) throw new Error('Seções 7.13/7.14/7.15 não encontradas no PDF');

const RUIDO = /^(CATÁLOGO 2026|Arquidiocese de Belo Horizonte|PARÓQUIAS DA ARQUIDIOCESE|PARÓQUIAS DA|PARÓQUIAS POR REGIÃO EPISCOPAL|PARÓQUIAS|\d{1,3})$/;
const limpar = t => t.split('\n').map(l => l.trim()).filter(l => l && !RUIDO.test(l)).join(' ').replace(/\s+/g, ' ');

// ---------- regiões e foranias (7.15) ----------
const secFor = limpar(tudo.slice(P_FORANIAS - 1, P_FORANIAS + 5).join('\n'));
const REGIOES = {};
for (const m of secFor.matchAll(/\d\.\s+REGIÃO EPISCOPAL (NOSSA SENHORA(?: [A-ZÁ-Úa-zá-ú]+)+?)\s*-\s*(RENS[A-Z]{1,2})\b/g)) REGIOES[m[2]] = 'Região Episcopal ' + tit(m[1]);
// forania -> região (cada forania aparece embaixo do título da sua região)
const REG_DA_FORANIA = {};
const titulosReg = [...secFor.matchAll(/\d\.\s+REGIÃO EPISCOPAL .+?\s*-\s*(RENS[A-Z]{1,2})\b/g)];
titulosReg.forEach((m, i) => {
  const trecho = secFor.slice(m.index, titulosReg[i + 1]?.index ?? secFor.length);
  for (const f of trecho.matchAll(/\d{1,2}\.\s+Forania\s+(?:de\s+)?(.+?)\s+Vigário Forâneo/g)) REG_DA_FORANIA[f[1].trim()] = m[1];
});
// trechos da 7.15 por forania: acham a forania de quem, na 7.13, só diz "Forania São Sebastião" (há duas)
const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const secForN = norm(secFor);
const TRECHOS_FOR = [...secForN.matchAll(/\d{1,2}\.\s+forania\s+(?:de\s+)?(.+?)\s+vigario foraneo/g)].map((m, i, a) => ({f:m[1].trim(), ini:m.index, fim:a[i + 1]?.index ?? secForN.length}));
function foraniaPela715(display, bairro){
  if (!bairro) return null;
  const i = secForN.indexOf(norm(display + ' (' + bairro + ')'));
  const t = i < 0 ? null : TRECHOS_FOR.find(x => i >= x.ini && i < x.fim);
  return t ? FORANIAS.find(f => norm(f) === t.f) || null : null;
}
const FORANIAS = Object.keys(REG_DA_FORANIA).sort((a, b) => b.length - a.length); // o mais longo primeiro: "Santo Antônio (Pampulha)" antes de "Santo Antônio"

// ---------- paróquias (7.13) ----------
let sec = limpar(tudo.slice(P_PAROQUIAS - 1, P_SANTUARIOS - 1).join('\n'));
sec = sec.slice(sec.indexOf('7.13 Paróquias da Arquidiocese') + '7.13 Paróquias da Arquidiocese'.length);
const fimSec = sec.indexOf('7.14 Santuários'); if (fimSec > 0) sec = sec.slice(0, fimSec);
const BLOCOS = [['paroquia_territorial', null], ['paroquia_pessoal', 'B PARÓQUIAS PESSOAIS'], ['paroquia_militar', 'B PARÓQUIA MILITAR'], ['curato', 'B CURATOS'], ['area_pastoral', 'B ÁREA PASTORAL']];
const cortes = BLOCOS.map(([, t]) => t ? sec.indexOf(t) : 0);
if (cortes.some(c => c < 0)) throw new Error('Subtítulos de 7.13 não encontrados: ' + BLOCOS.filter((b, i) => cortes[i] < 0).map(b => b[1]));

const CAB = /(?:^|\s)(\d{1,3})\.\s*([A-ZÁ-ÚÇ].+?)\s*(?:\((RENS[A-Z]{1,2})\)\s*-?\s*)?\([Cc][OoÓó][Dd]\.?\s*(\d*)\s*\)/g;
const ROTULOS = 'Pároco e Reitor|Párocos Solidários|Pároco|Pàroco|Administrador Paroquial(?: "pro tempore")?|Adm\\. Paroquial(?: [“"]Pro Tempore[”"])?|Adm\\. Pastoral|Cura';
const entradas = [];
BLOCOS.forEach(([type, titulo], i) => {
  const trecho = sec.slice(cortes[i] + (titulo ? titulo.length : 0), cortes[i + 1] ?? sec.length);
  const cabs = [...trecho.matchAll(CAB)];
  cabs.forEach((m, j) => {
    const corpo = trecho.slice(m.index + m[0].length, cabs[j + 1]?.index ?? trecho.length).trim();
    entradas.push({seq:+m[1], type, nomeCat:m[2].trim(), regiao:m[3] || null, codigo:m[4] || null, corpo});
  });
  // a numeração do catálogo é contínua em cada bloco: se pular, algum cabeçalho não foi lido
  cabs.forEach((m, j) => { if (+m[1] !== j + 1) throw new Error(`${type}: esperava item ${j + 1}, li ${m[1]} (${m[2]})`); });
});

function tit(s){
  const menores = new Set(['de','da','do','das','dos','e','d’','di']);
  return s.toLowerCase().replace(/(^|[\s(/-])([a-zà-ú])([a-zà-ú’']*)/g, (x, a, b, c, off) => {
    const pal = b + c;
    return a + (off > 0 && menores.has(pal) ? pal : b.toUpperCase() + c);
  }).replace(/\bD’([a-z])/g, (x, l) => 'D’' + l.toUpperCase()).replace(/\bIi\b/g, 'II').replace(/\bXxiii\b/g, 'XXIII').replace(/\bSto\b/g, 'Sto');
}
const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const slugify = s => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function campos(e){
  let c = e.corpo;
  const r = {};
  const MESES = {janeiro:1, fevereiro:2, 'março':3, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12};
  const cri = c.match(/Criação:?\s*(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{4})/);
  const criExt = c.match(/Criação:?\s*(\d{1,2}) de ([a-zç]+) de (\d{4})/i);
  const d2 = n => String(n).padStart(2, '0');
  r.founded_on = cri ? `${cri[3]}-${d2(cri[2])}-${d2(cri[1])}` : criExt && MESES[criExt[2].toLowerCase()] ? `${criExt[3]}-${d2(MESES[criExt[2].toLowerCase()])}-${d2(criExt[1])}` : null;
  // Forania: pode vir depois de observações ("É tradição...", "Basílica Menor") ou de um número de página solto.
  // Só vale se o nome bater (sem diferença de acento) com uma forania oficial da seção 7.15.
  let resto = c.replace(/^.*?Criação:?\s*(?:\d{1,2}\s*[/.]\s*\d{1,2}\s*[/.]\s*\d{4}|\d{1,2} de [a-zç]+ de \d{4})\s*/i, '');
  r.forania = null;
  const posF = resto.search(/Forania\s/);
  if (posF >= 0){
    const depois = resto.slice(posF).replace(/^Forania\s+(?:de\s+)?/, '');
    const f = FORANIAS.find(n => semAcento(depois).toLowerCase().startsWith(semAcento(n).toLowerCase()));
    if (f){ r.forania = f; resto = depois.slice(f.length).trim(); }
  } else if (/^\s*\(Santuário|^\s*\(Paróquia/.test(resto)) resto = resto.replace(/^\s*\([^)]*\)\s*/, '');
  // CEP + município (+ bairro entre parênteses, quando o catálogo informa)
  const cepRe = /(\d{2}\.?\d{3}-\d{3})\s*-?\s*([A-Za-zÁ-úÇç][A-Za-zÁ-úÇç .'’-]*?[A-Za-zÁ-úÇç])\s*(?:\(([^)]*)\)|(?=\s*-\s*MG))/;
  const cep = resto.match(cepRe);
  // endereço principal: do começo até o telefone ou o CEP (o que vier primeiro)
  const fimEnd = resto.search(/\s*-?\s*(Tel\.?|Telefax\.?|Tels?\.?|Fone|Telefone)\s*:?/i);
  const posCep = cep ? cep.index : -1;
  const corte = [fimEnd, posCep].filter(x => x >= 0).sort((a, b) => a - b)[0];
  const end = corte !== undefined ? resto.slice(0, corte).replace(/[\s,-]+$/, '').trim() : '';
  r.address = end && !/^(E-?mail|Pároco|Administrador)/i.test(end) ? end : null;
  const tel = resto.match(/(?:Tel\.?|Telefax\.?|Tels?\.?|Fone|Telefone)\s*:?\s*((?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4}(?:\s*(?:\/|e|–|-)\s*(?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4})*)/i);
  r.phone = tel ? tel[1].replace(/\s+/g, ' ').trim() : null;
  r.postal_code = cep ? cep[1].replace('.', '') : null;
  r.municipality = cep ? tit(cep[2].trim()) : null;
  r.neighborhood = cep && cep[3] ? cep[3].trim().replace(/\s+/g, ' ') : null;
  const em = resto.match(/E-?mail\s*:?\s*([\w.+-]+@\s?[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/i);
  r.email = em ? em[1].replace(/\s/g, '').toLowerCase() : null;
  // "Pároco: Pe. X" (às vezes sem os dois-pontos: "Pároco Pe. X")
  const pr = resto.match(new RegExp(`(${ROTULOS})\\s*(?::\\s*|(?=(?:Pe\\.|Frei|Côn\\.|Mons\\.|Dom)\\s))(.*?)(?=\\s+(?:Vigário|Pároco Emérito|Diácono|Pró-Reitor|Reitor)\\b|$)`));
  const nomePadre = pr ? pr[2].trim().replace(/[.;,]$/, '') : '';
  r.pastor_role = nomePadre ? (pr[1] === 'Pàroco' ? 'Pároco' : pr[1].replace(/\s*[“"]Pro Tempore[”"]/i, ' "pro tempore"')) : null;
  r.pastor_name = nomePadre || null;
  return r;
}

const usados = new Set(), dir = [];
for (const e of entradas){
  const c = campos(e), nome = e.nomeCat.replace(/\s+/g, ' ');
  // sem região no cabeçalho (ex.: item 138): usa a região da forania, também do catálogo (seção 7.15)
  const display = tit(nome);
  if (!c.forania) c.forania = foraniaPela715(display, c.neighborhood);
  if (!e.regiao && c.forania) e.regiao = REG_DA_FORANIA[c.forania] || null;
  // Belo Horizonte: nome + bairro (ex.: santo-antonio-jaragua). Outras cidades: nome + cidade (+ bairro, se não for "Centro").
  const bh = !c.municipality || c.municipality === 'Belo Horizonte', centro = /^centro$/i.test(c.neighborhood || '');
  let slug = slugify(display + (bh ? (c.neighborhood ? '-' + c.neighborhood : '') : '-' + c.municipality + (c.neighborhood && !centro ? '-' + c.neighborhood : '')));
  if (usados.has(slug)) slug = slugify(display + '-' + (c.municipality || '') + '-' + (c.neighborhood || '') ) ;
  if (usados.has(slug)) slug += '-' + (e.codigo || e.seq);
  usados.add(slug);
  dir.push({catalog_code:e.codigo, name:nome, display_name:display, slug, type:e.type, episcopal_region:e.regiao, episcopal_region_name:REGIOES[e.regiao] || null,
    forania:c.forania, municipality:c.municipality, neighborhood:c.neighborhood, address:c.address, postal_code:c.postal_code, phone:c.phone,
    email:c.email, pastor_role:c.pastor_role, pastor_name:c.pastor_name, founded_on:c.founded_on, source_year:SOURCE_YEAR});
}

// ---------- conferências ----------
const porTipo = dir.reduce((a, d) => (a[d.type] = (a[d.type] || 0) + 1, a), {});
const codigos = dir.map(d => d.catalog_code).filter(Boolean);
const dupCod = codigos.filter((c, i) => codigos.indexOf(c) !== i);
if (dupCod.length) throw new Error('Código repetido no catálogo: ' + dupCod);
const faltando = k => dir.filter(d => d[k] == null).length;
const resumo = {fonte:path.basename(PDF), paginas:{paroquias:P_PAROQUIAS, santuarios:P_SANTUARIOS, foranias:P_FORANIAS}, total:dir.length, porTipo,
  regioes:REGIOES, foranias:FORANIAS.length, semCampo:Object.fromEntries(['catalog_code','forania','address','postal_code','municipality','neighborhood','phone','email','pastor_name','founded_on'].map(k => [k, faltando(k)]))};

// ---------- saída ----------
const q = v => v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const COLS = ['catalog_code','name','display_name','slug','type','episcopal_region','episcopal_region_name','forania','municipality','neighborhood','address','postal_code','phone','email','pastor_role','pastor_name','founded_on','source_year'];
const ATUALIZA = COLS.filter(c => !['catalog_code','slug'].includes(c)).map(c => `${c} = excluded.${c}`).concat('updated_at = now()').join(', ');
const linhas = l => l.map(d => `  (${COLS.map(c => c === 'founded_on' ? (d[c] ? `'${d[c]}'::date` : 'null') : c === 'source_year' ? d[c] : q(d[c])).join(', ')})`).join(',\n');
const comCod = dir.filter(d => d.catalog_code), semCod = dir.filter(d => !d.catalog_code);
const sql = `-- Central Paroquial — Diretório Arquidiocesano: carga do Catálogo 2026 (GERADO, não edite à mão).
-- Gerado por scripts/importar-catalogo.mjs a partir de ${path.basename(PDF)} (seção 7.13).
-- ${dir.length} entradas: ${Object.entries(porTipo).map(([k, v]) => `${k} ${v}`).join(', ')}.
-- Rode DEPOIS de supabase/diretorio.sql. Pode rodar de novo: atualiza os dados do catálogo e NUNCA mexe em
-- status nem no vínculo com parishes (ativação é outro script: supabase/diretorio_ativacao.sql).
-- Campos que não aparecem no catálogo ficam NULL.

insert into parish_directory (${COLS.join(', ')}) values
${linhas(comCod)}
on conflict (catalog_code) do update set ${ATUALIZA};

-- Sem código no catálogo (casam pelo slug)
insert into parish_directory (${COLS.join(', ')}) values
${linhas(semCod)}
on conflict (slug) do update set ${ATUALIZA};

-- Conferência
select type, count(*) from parish_directory group by type order by type;
`;
fs.writeFileSync(path.join(REPO, 'supabase', 'diretorio_seed.sql'), sql);
fs.writeFileSync(path.join(REPO, 'docs', 'diretorio-importacao.json'), JSON.stringify({resumo, diretorio:dir}, null, 1) + '\n');
console.log(JSON.stringify(resumo, null, 1));
