// Doações por paróquia (supabase/doacoes.sql) no SQL de verdade (PGlite), sobre o banco com as 3 paróquias ativas.
// Confere: roda 2x; começa DESLIGADO nas 3; só padre/suporte configuram (secretaria, PASCOM e visitante não);
// cada paróquia isolada; campos secretos recusados; URL de checkout só https e sem token; o público só vê o que está ligado.
// Valores de teste claramente fictícios (domínio .invalid) — só neste banco em memória.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { execSync } from 'node:child_process';
import { STUB, ler } from './banco.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const base = f => execSync(`git show bbb34e1:${f}`, {cwd:REPO}).toString();
let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 400)); };
const erro = async p => { try { await p; return null; } catch(e){ return e.message; } };
async function como(db, uid, fn){
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const q1 = async (db, sql, p = []) => (await db.query(sql, p)).rows;

console.log('== banco com as 3 paróquias + doacoes.sql 2x');
const db = new PGlite({extensions:{pgcrypto}});
await db.exec(STUB);
await db.exec(base('supabase/schema.sql'));
await db.exec(base('supabase/demo_seed.sql'));
await db.exec(ler('supabase/secretaria24h.sql'));
for (const f of ['supabase/diretorio.sql', 'supabase/diretorio_santuarios.sql', 'supabase/diretorio_privacidade.sql', 'supabase/diretorio_seed.sql', 'supabase/diretorio_ativacao.sql']) await db.exec(ler(f));
for (let i = 1; i <= 2; i++){ const e = await erro(db.exec(ler('supabase/doacoes.sql'))); t(`doacoes.sql (${i}ª vez) roda sem erro`, !e, e); }

const SL = {A:'santo-antonio-jaragua', B:'santa-clara-e-sao-francisco-mineirao', C:'nossa-senhora-das-gracas-ibirite'};
const PID = {}; for (const [k, s] of Object.entries(SL)) PID[k] = (await q1(db, `select id from parishes where slug=$1`, [s]))[0].id;
const U = {padreA:'00000000-0000-0000-0000-0000000a0001', adminA:'00000000-0000-0000-0000-0000000a0002', secA:'00000000-0000-0000-0000-0000000a0003', pascomA:'00000000-0000-0000-0000-0000000a0004', padreB:'00000000-0000-0000-0000-0000000b0001'};
await db.exec(`insert into auth.users values ${Object.entries(U).map(([k, id]) => `('${id}','${k}@x')`).join(',')};
  insert into parish_users values ('${U.padreA}','${PID.A}','padre'),('${U.adminA}','${PID.A}','admin'),('${U.secA}','${PID.A}','secretaria'),('${U.pascomA}','${PID.A}','pascom'),('${U.padreB}','${PID.B}','padre');`);

console.log('== estado inicial');
t('nenhuma paróquia com doação configurada', (await q1(db, `select count(*)::int n from parish_donation_settings`))[0].n === 0);
for (const k of 'ABC') t(`público ${k}: nada (botão escondido)`, (await como(db, null, () => q1(db, `select public_donation_settings($1) r`, [SL[k]])))[0].r === null);
const colunas = (await q1(db, `select column_name from information_schema.columns where table_name='parish_donation_settings'`)).map(r => r.column_name);
t('nenhuma coluna para cartão, CVV, validade, senha, token ou segredo', !colunas.some(c => /card_number|cvv|cvc|valid|expir|senha|password|token|secret|client_id/.test(c)), colunas.join());

console.log('== quem pode configurar');
const PIX = {pix_enabled:true, pix_key:'teste@exemplo.invalid', pix_key_type:'email', pix_beneficiary:'PAROQUIA TESTE', pix_city:'BELO HORIZONTE'};
const salvar = (uid, pid, d) => como(db, uid, () => q1(db, `select staff_save_donation_settings($1, $2::jsonb) r`, [pid, JSON.stringify(d)]));
t('visitante não salva', /permission denied|Sem permissão/.test(await erro(salvar(null, PID.A, PIX)) || ''));
t('secretaria NÃO salva', /Sem permissão/.test(await erro(salvar(U.secA, PID.A, PIX)) || ''));
t('PASCOM NÃO salva', /Sem permissão/.test(await erro(salvar(U.pascomA, PID.A, PIX)) || ''));
t('secretaria NÃO lê', /Sem permissão/.test(await erro(como(db, U.secA, () => q1(db, `select staff_get_donation_settings($1)`, [PID.A]))) || ''));
t('padre de B NÃO salva em A', /Sem permissão/.test(await erro(salvar(U.padreB, PID.A, PIX)) || ''));
t('padre de A salva o Pix de A', !(await erro(salvar(U.padreA, PID.A, PIX))));
t('suporte (admin) de A salva', !(await erro(salvar(U.adminA, PID.A, {...PIX, card_enabled:true, payment_provider:'Provedor de teste', checkout_url:'https://checkout.exemplo.invalid/doar'}))));
t('tabela direto pela API: sem insert/update para a equipe', /permission denied/.test(await erro(como(db, U.padreA, () => q1(db, `update parish_donation_settings set pix_key='x'`))) || ''));
t('tabela direto: secretaria não vê a linha', (await como(db, U.secA, () => q1(db, `select * from parish_donation_settings`))).length === 0);
t('tabela direto: padre de B não vê a linha de A', (await como(db, U.padreB, () => q1(db, `select * from parish_donation_settings`))).length === 0);

console.log('== campos recusados');
for (const campo of ['card_number', 'cvv', 'validade', 'senha', 'access_token', 'client_secret', 'token'])
  t(`campo "${campo}" recusado`, /Campo não permitido/.test(await erro(salvar(U.padreA, PID.A, {...PIX, [campo]:'x'})) || ''));
t('checkout sem https recusado', /violates check constraint/.test(await erro(salvar(U.padreA, PID.A, {card_enabled:true, checkout_url:'http://checkout.exemplo.invalid'})) || ''));
t('checkout com token na URL recusado', /violates check constraint/.test(await erro(salvar(U.padreA, PID.A, {card_enabled:true, checkout_url:'https://checkout.exemplo.invalid/?access_token=abc'})) || ''));
t('Pix ligado sem chave recusado', /violates check constraint/.test(await erro(salvar(U.padreA, PID.A, {pix_enabled:true})) || ''));
t('tipo de chave inválido recusado', /violates check constraint/.test(await erro(salvar(U.padreA, PID.A, {...PIX, pix_key_type:'banco'})) || ''));

console.log('== público');
let r = (await como(db, null, () => q1(db, `select public_donation_settings($1) r`, [SL.A])))[0].r;
t('A: Pix e cartão ligados aparecem', r?.pix?.key === PIX.pix_key && r?.card?.checkout_url === 'https://checkout.exemplo.invalid/doar', JSON.stringify(r));
t('A: não expõe updated_by nem parish_id', !JSON.stringify(r).includes('updated_by') && !JSON.stringify(r).includes(PID.A));
for (const k of 'BC') t(`isolamento: ${k} continua sem doação`, (await como(db, null, () => q1(db, `select public_donation_settings($1) r`, [SL[k]])))[0].r === null);
await salvar(U.padreA, PID.A, {...PIX, pix_enabled:false, card_enabled:true, checkout_url:'https://checkout.exemplo.invalid/doar'});
r = (await como(db, null, () => q1(db, `select public_donation_settings($1) r`, [SL.A])))[0].r;
t('Pix desligado: só o cartão', !r.pix && r.card, JSON.stringify(r));
await salvar(U.padreA, PID.A, {pix_enabled:false, card_enabled:false});
t('tudo desligado: público recebe nada', (await como(db, null, () => q1(db, `select public_donation_settings($1) r`, [SL.A])))[0].r === null);
await db.exec(`update parishes set active = false where id = '${PID.A}'`);
await salvar(U.padreA, PID.A, PIX);
t('paróquia inativa: público recebe nada', (await como(db, null, () => q1(db, `select public_donation_settings($1) r`, [SL.A])))[0].r === null);

console.log(`\n${ok} ok, ${falha} falha(s)`);
process.exit(falha ? 1 : 0);
