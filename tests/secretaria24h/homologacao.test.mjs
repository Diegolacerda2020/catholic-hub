// Roteiro de homologação (docs/HOMOLOGACAO-DIRETORIO.md) rodado de verdade, na ordem, num banco
// equivalente à produção (PGlite): cada bloco ```sql do roteiro precisa rodar sem erro e dar o esperado.
// O teste de isolamento (I1) tem que terminar com o erro "RESULTADO…" e não deixar nada gravado.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { STUB, ler } from './banco.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const base = f => execSync(`git show bbb34e1:${f}`, {cwd:REPO}).toString();
let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 600)); };

const doc = fs.readFileSync(`${REPO}/docs/HOMOLOGACAO-DIRETORIO.md`, 'utf8');
const secaoMarcada = /^(\*\*)?([A-Z]\d)\.[^\n]*(?:\*\*)?/gm;
function blocosSql(documento = doc){
  return [...documento.matchAll(/```sql\n([\s\S]*?)```/g)].map(m => ({sql:m[1], index:m.index}));
}
function sqlDaSecao(rot, documento = doc){
  const secoes = [...documento.matchAll(secaoMarcada)].map(m => ({rot:m[2], index:m.index}));
  const secao = secoes.find(s => s.rot === rot);
  if (!secao) throw new Error(`Seção ${rot} não encontrada no roteiro de homologação.`);
  const proxima = secoes.find(s => s.index > secao.index)?.index ?? documento.length;
  const bloco = blocosSql(documento).find(b => b.index > secao.index && b.index < proxima);
  if (!bloco) throw new Error(`Seção ${rot} não tem bloco SQL.`);
  return bloco.sql;
}
function tentar(fn){ try { return {valor:fn()}; } catch(e){ return {erro:e.message}; } }
function testarParser(){
  const a = '**P1. Caso A**\n```sql\nselect 1;\n```';
  const b = '**P1. Caso B**\nTexto explicativo.\n```sql\nselect 1;\n```';
  const c = '**P1. Sem SQL**\nTexto explicativo.\n**P2. Outra seção**\n```sql\nselect 2;\n```';
  const d = '**P1. Uma seção**\nTexto explicativo.\n**P2. Outra seção**\n```sql\nselect 2;\n```';
  t('parser: título colado ao bloco SQL', sqlDaSecao('P1', a).trim() === 'select 1;');
  t('parser: aceita texto explicativo entre título e SQL', sqlDaSecao('P1', b).trim() === 'select 1;');
  t('parser: seção sem SQL falha com mensagem clara', tentar(() => sqlDaSecao('P1', c)).erro === 'Seção P1 não tem bloco SQL.');
  t('parser: P1 não captura SQL de P2', tentar(() => sqlDaSecao('P1', d)).erro === 'Seção P1 não tem bloco SQL.');
}
testarParser();
const blocos = blocosSql(doc);
const achar = rot => sqlDaSecao(rot);
t('roteiro tem P1–P7, D1–D3, D6, S1–S4, A1, A2, A4–A6 e o bloco de isolamento',
  ['P1','P2','P3','P4','P5','P6','P7','D1','D2','D3','D6','S1','S2','S3','S4','A1','A2','A4','A5','A6'].every(r => tentar(() => achar(r)).valor) && blocos.some(b => b.sql.startsWith('do $$')));

// banco equivalente à produção: schema de bbb34e1 + dados DEMO + Secretaria 24h aplicada + equipe real
const db = new PGlite({extensions:{pgcrypto}});
await db.exec(STUB.replace('create table auth.users (id uuid primary key, email text);', 'create table auth.users (id uuid primary key, email text, aud text, role text);'));
await db.exec(base('supabase/schema.sql'));
await db.exec(base('supabase/demo_seed.sql'));
await db.exec(ler('supabase/secretaria24h.sql'));
await db.exec(ler('supabase/demo_secretaria_seed.sql'));
await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','padre@paroquia'),('00000000-0000-0000-0000-0000000000b1','secretaria@paroquia');
  insert into parish_users select '00000000-0000-0000-0000-0000000000a1', id, 'padre' from parishes; insert into parish_users select '00000000-0000-0000-0000-0000000000b1', id, 'secretaria' from parishes;
  update parish_state set data = data || '{"cfg":{"nome":"Paróquia Santo Antônio – Jaraguá","missas":"Domingo: 07h30"},"avisos":[{"id":1,"ts":1,"titulo":"Quermesse"}]}'::jsonb;`);
const q = async rot => (await db.query(achar(rot))).rows;
const last = async sql => { const r = await db.exec(sql); return r.at(-1)?.rows || []; };

console.log('== pré-check');
let r = (await q('P1'))[0];
t('P1: diretório ainda não existe', r.ja_existe_parish_directory === false && r.ja_existe_directory_id === false && +r.funcoes_do_diretorio === 0, JSON.stringify(r));
r = (await q('P2'))[0];
t('P2: pré-requisitos', r.tem_touch_updated_at && r.tem_gen_random_uuid, JSON.stringify(r));
const idSA = (await q('P3'))[0].id;
t('P3: 1 tenant', (await q('P3')).length === 1);
t('P4: equipe listada', (await q('P4')).length === 2);
const p5 = JSON.stringify(await q('P5')), p6 = JSON.stringify(await q('P6')), p7 = JSON.stringify(await q('P7'));
t('P5: 12 tabelas com contagem e checksum', JSON.parse(p5).length === 12);

console.log('== diretorio.sql');
await db.exec(ler('supabase/diretorio.sql'));
r = (await q('D1'))[0];
t('D1: estrutura, coluna opcional, nada ligado, FK segura', r.tem_parish_directory && r.tem_directory_id && r.directory_id_opcional === 'YES' && +r.paroquias_ja_ligadas === 0 && r.fk_segura === true, JSON.stringify(r));
r = (await q('D2'))[0];
t('D2: RLS ligado, 0 policies, ninguém lê/altera direto', r.rls_ligado && +r.policies === 0 && !r.anon_le && !r.equipe_le && !r.equipe_altera && !r.anon_cria_paroquia, JSON.stringify(r));
r = await q('D3');
t('D3: só as duas funções públicas abertas ao visitante', JSON.stringify(r.map(x => [x.proname, x.anon_executa])) === JSON.stringify([['dir_norm', false], ['dir_tenant_slug', false], ['public_directory_entry', true], ['public_directory_search', true]]), JSON.stringify(r));
t('D4: P5 idêntica', JSON.stringify(await q('P5')) === p5);
t('D5: P6 idêntica', JSON.stringify(await q('P6')) === p6);
t('D6: busca vazia', JSON.stringify((await q('D6'))[0].public_directory_search) === '[]');

console.log('== diretorio_santuarios.sql + diretorio_seed.sql');
await db.exec(ler('supabase/diretorio_santuarios.sql'));
t('santuários: P5 idêntica (só estrutura)', JSON.stringify(await q('P5')) === p5);
await db.exec(ler('supabase/diretorio_privacidade.sql'));
t('privacidade (banco novo): P5 idêntica, nada a limpar', JSON.stringify(await q('P5')) === p5);
await db.exec(ler('supabase/diretorio_seed.sql'));
r = Object.fromEntries((await q('S1')).map(x => [x.type, +x.count]));
t('S1: 293 por tipo', r.TOTAL === 293 && r.paroquia_territorial === 284 && r.paroquia_pessoal === 2 && r.paroquia_militar === 1 && r.curato === 1 && r.area_pastoral === 1 && r.santuario === 4, JSON.stringify(r));
r = (await q('S2'))[0];
t('S2: 2026, listed, sem duplicados, 18 sem código de paróquia', JSON.stringify(r.anos) === '[2026]' && JSON.stringify(r.status) === '["listed"]' && +r.codigos_duplicados === 0 && +r.sem_codigo_no_catalogo === 18 && +r.slugs_duplicados === 0, JSON.stringify(r));
t('S3: 013, 207, 009 presentes', (await q('S3')).map(x => x.catalog_code).join() === '009,013,207');
r = await q('S4');
t('S4: ainda 1 tenant, sem directory_id', r.length === 1 && r[0].slug === 'santo-antonio-jaragua' && r[0].directory_id === null);
t('S5: P5 idêntica', JSON.stringify(await q('P5')) === p5);
await db.exec(ler('supabase/diretorio_seed.sql'));
t('S5: seed 2x continua 293', (await q('S1')).find(x => x.type === 'TOTAL').count == 293);

console.log('== diretorio_ativacao.sql');
const conf = await last(ler('supabase/diretorio_ativacao.sql'));
t('ativação: conferência final lista as 3, equipe 0 nas novas', conf.length === 3 && conf.filter(x => +x.equipe === 0).length === 2, JSON.stringify(conf));
r = await q('A1');
t('A1: 3 tenants, Santo Antônio com o mesmo id', r.length === 3 && r.find(x => x.slug === 'santo-antonio-jaragua').id === idSA && r.every(x => x.directory_id && x.status === 'active'), JSON.stringify(r));
t('A2: active 3, listed 290', JSON.stringify((await q('A2')).map(x => [x.status, +x.count])) === '[["active",3],["listed",290]]');
const p5b = JSON.parse(JSON.stringify(await q('P5'))), p5a = JSON.parse(p5);
const muda = p5b.filter((x, i) => x.h !== p5a[i].h).map(x => x.t);
t('A3: só parishes e parish_state mudam (novas linhas)', JSON.stringify(muda) === '["parishes","parish_state"]' && p5b.find(x => x.t === 'parishes').n == 3 && p5b.find(x => x.t === 'parish_state').n == +p5a.find(x => x.t === 'parish_state').n + 2, JSON.stringify(muda));
t('A3: P7 idêntica (linha de Santo Antônio não mudou)', JSON.stringify(await q('P7')) === p7);
r = await q('A4');
t('A4: tenants novos vazios', r.length === 2 && r.every(x => ['comunidades','eventos','dizimistas','contribuicoes','interessados','servicos_s24','solicitacoes','equipe'].every(k => +x[k] === 0) && +x.parish_state === 1), JSON.stringify(r));
r = await q('A5');
t('A5: só cfg do catálogo, nada de Santo Antônio', r.length === 2 && r.every(x => x.chaves === 'cfg' && x.tem_algo_de_santo_antonio === false && x.cfg.missas === ''), JSON.stringify(r).slice(0, 300));
const a6 = blocos.filter(b => /public_directory_search\('', 30\);\s+-- esperado/.test(b.sql))[0]?.sql;
t('A6: páginas públicas das 3', (await q('A6')).length === 3);
const busca = (await db.query(`select public_directory_search('', 30) r`)).rows[0].r;
t('A6: busca sem texto devolve as 3 ativas', busca.length === 3 && busca.every(x => x.active && x.tenant_slug) && !!a6);

console.log('== isolamento (I1)');
const iso = blocos.find(b => b.sql.startsWith('do $$')).sql;
let msg = '';
try { await db.exec(iso); } catch(e){ msg = e.message; }
console.log(msg.split('\n').map(l => '      ' + l).join('\n'));
t('I1 termina com o erro-resultado (e por isso desfaz tudo)', msg.startsWith('RESULTADO DO TESTE DE ISOLAMENTO'));
const linhas = msg.split('\n').filter(l => /^[ABC] \(/.test(l));
t('I1: A, B e C veem 0 de outras paróquias em todas as tabelas', linhas.length === 3 && linhas.every(l => (l.match(/OUTRAS paróquias: ([^|]+)\|/)[1].match(/=(\d+)/g) || []).every(x => x === '=0')), linhas.join(' // '));
t('I1: B e C veem os próprios dados de teste', linhas.slice(1).every(l => /PRÓPRIA: events=1 service_requests=1/.test(l)));
t('I1: visitante sem acesso direto', msg.includes('visitante | sem acesso direto (ok)'));
t('I1: página pública de B só com o evento de B', msg.includes('eventos: [ISO] Evento B | avisos: 0'));
const depois = blocos.find(b => b.sql.includes('eventos_iso')).sql;
r = (await db.query(depois)).rows[0];
t('I1: nada ficou gravado', +r.eventos_iso === 0 && +r.usuarios_iso === 0 && +r.servicos_iso === 0, JSON.stringify(r));
t('I1: P5 igual à do pós-ativação', JSON.stringify(await q('P5')) === JSON.stringify(p5b));

// ---------- Seção 10: o banco real JÁ tem o diretório antigo (278, sem santuários) ----------
console.log('== seção 10: atualização de santuários sobre o diretório antigo');
{ const antigo = f => execSync(`git show e0f0096:${f}`, {cwd:REPO}).toString();
  const u = new PGlite({extensions:{pgcrypto}});
  await u.exec(STUB.replace('create table auth.users (id uuid primary key, email text);', 'create table auth.users (id uuid primary key, email text, aud text, role text);'));
  await u.exec(base('supabase/schema.sql')); await u.exec(base('supabase/demo_seed.sql')); await u.exec(ler('supabase/secretaria24h.sql'));
  for (const f of ['supabase/diretorio.sql', 'supabase/diretorio_seed.sql', 'supabase/diretorio_ativacao.sql']) await u.exec(antigo(f));
  const uq = async rot => (await u.query(achar(rot))).rows;
  const spc0 = (await u.query(`select count(*)::int n from parish_directory where slug like 'sao-paulo-da-cruz%'`)).rows[0].n;
  t('U0: como no banco real — active 3, listed 275, São Paulo da Cruz ausente', spc0 === 0 && JSON.stringify((await uq('A2')).map(x => [x.status, +x.count])) === '[["active",3],["listed",275]]');
  const chaves = async () => (await u.query(`select catalog_code, slug, status from parish_directory where catalog_code is not null order by 1`)).rows;
  const slugs0 = await chaves(), p5u = JSON.stringify(await uq('P5'));
  const tenants = async () => JSON.stringify((await u.query(`select id, slug, directory_id from parishes order by slug`)).rows), tenants0 = await tenants();
  // como no banco real: os 2 tenants novos receberam cfg.paroco do catálogo; Santo Antônio tem o dela (cadastrado pela paróquia)
  const cfgParoco = async () => Object.fromEntries((await u.query(`select p.slug, ps.data->'cfg'->>'paroco' paroco from parishes p join parish_state ps on ps.parish_id = p.id`)).rows.map(x => [x.slug, x.paroco]));
  await u.exec(`update parish_state set data = data || jsonb_build_object('cfg', coalesce(data->'cfg', '{}'::jsonb) || '{"paroco":"Nome cadastrado pela própria paróquia"}'::jsonb) where parish_id = (select id from parishes where slug='santo-antonio-jaragua')`);
  const par0 = await cfgParoco();
  t('U0: Santo Antônio com o nome cadastrado pela própria paróquia', par0['santo-antonio-jaragua'] === 'Nome cadastrado pela própria paróquia');
  t('U0: tenants novos com cfg.paroco copiado do catálogo (situação a limpar)', !!par0['santa-clara-e-sao-francisco-mineirao'] && !!par0['nossa-senhora-das-gracas-ibirite'], JSON.stringify(Object.keys(par0)));
  const p5u0 = JSON.stringify(await uq('P5'));
  for (let i = 1; i <= 2; i++) for (const f of ['supabase/diretorio_santuarios.sql', 'supabase/diretorio_privacidade.sql', 'supabase/diretorio_seed.sql']){
    let e = null; try { await u.exec(ler(f)); } catch(x){ e = x.message; } t(`U: ${f} (${i}ª vez) sem erro`, !e, e);
  }
  const par1 = await cfgParoco();
  t('privacidade: cfg.paroco do catálogo removido dos 2 tenants novos', !par1['santa-clara-e-sao-francisco-mineirao'] && !par1['nossa-senhora-das-gracas-ibirite']);
  t('privacidade: Santo Antônio mantém o que a própria paróquia cadastrou', par1['santo-antonio-jaragua'] === 'Nome cadastrado pela própria paróquia');
  const cols = (await u.query(`select column_name from information_schema.columns where table_name='parish_directory' and column_name in ('pastor_role','pastor_name','rector_name')`)).rows;
  t('privacidade: colunas de responsável removidas do diretório', cols.length === 0, JSON.stringify(cols));
  const conf = (await u.exec(ler('supabase/diretorio_privacidade.sql'))).at(-1).rows[0];
  t('privacidade: conferência do arquivo = 0 / 0', +conf.colunas_de_responsavel === 0 && +conf.tenants_novos_com_paroco === 0, JSON.stringify(conf));
  const p5u1 = JSON.parse(JSON.stringify(await uq('P5'))), p5a0 = JSON.parse(p5u0);
  t('privacidade: só parish_state muda (parish_users, auth.users e demais idênticas)', JSON.stringify(p5u1.filter((x, i) => x.h !== p5a0[i].h).map(x => x.t)) === '["parish_state"]');
  const u3 = (await uq('U3'))[0];
  t('U3: 293, active 3, listed 290, 15 santuários (11 também paróquia)', +u3.total === 293 && +u3.active === 3 && +u3.listed === 290 && +u3.santuarios === 15 && +u3.santuario_e_paroquia === 11, JSON.stringify(u3));
  const u4 = (await u.exec(achar('U4'))).map(x => x.rows);
  t('U4: São Paulo da Cruz, paróquia e Santuário Arquidiocesano, Barreiro de Baixo; a busca acha', u4[0].length === 1 && u4[0][0].type === 'paroquia_territorial' && u4[0][0].is_sanctuary && u4[0][0].sanctuary_kind === 'Santuário Arquidiocesano' && u4[0][0].neighborhood === 'Barreiro de Baixo' && +u4[1][0].resultados >= 1, JSON.stringify(u4));
  const slugs1 = await chaves();
  const mudou = slugs0.filter(a => { const b = slugs1.find(x => x.catalog_code === a.catalog_code); return !b || b.slug !== a.slug || b.status !== a.status; });
  t('U: nenhum slug nem status existente mudou (as 3 ativas continuam ativas)', mudou.length === 0, JSON.stringify(mudou));
  t('U5: P5 idêntica à de depois da limpeza de privacidade (parishes, parish_users, auth.users…)', JSON.stringify(await uq('P5')) === JSON.stringify(p5u1) && p5u !== null);
  t('U: tenants idênticos (mesmos ids e directory_id)', await tenants() === tenants0);
}

console.log('== seção 11: doacoes.sql (2x) sobre o banco homologado');
for (let i = 1; i <= 2; i++){ let e = null; try { await db.exec(ler('supabase/doacoes.sql')); } catch(x){ e = x.message; } t(`doacoes.sql (${i}ª vez) sem erro`, !e, e); }
t('doações: 0 configuradas (desligadas nas 3)', (await db.query(`select count(*)::int n from parish_donation_settings`)).rows[0].n === 0);
t('doações: P5 igual à do pós-ativação', JSON.stringify(await q('P5')) === JSON.stringify(p5b));

console.log(`\n${ok} ok, ${falha} falha(s)`);
process.exit(falha ? 1 : 0);
