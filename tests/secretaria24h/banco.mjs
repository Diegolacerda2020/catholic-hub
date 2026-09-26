// Postgres local (PGlite) com o SQL de verdade da Secretaria 24h, imitando o Supabase
// (roles anon/authenticated, auth.uid()). Usado pelos testes de navegador: o Supabase falso
// (fakesb.mjs) continua cuidando do resto do app; só as chamadas da Secretaria 24h vêm para cá.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
export const ler = f => fs.readFileSync(`${REPO}/${f}`, 'utf8');
export const STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;
// usuários do fakesb.mjs -> uuid no Postgres
export const UID = {'u-sec':'00000000-0000-0000-0000-0000000000b1', 'u-padre':'00000000-0000-0000-0000-0000000000a1', 'u-pascom':'00000000-0000-0000-0000-0000000000c1', 'u-outra':'00000000-0000-0000-0000-0000000000d1'};
export const SLUG_B = 'paroquia-teste-multiparoquia';

export async function criarBanco({seed = true} = {}){
  const db = new PGlite({extensions:{pgcrypto}});
  await db.exec(STUB);
  await db.exec(ler('supabase/schema.sql'));
  await db.exec(ler('supabase/secretaria24h.sql'));
  await db.exec(`
    insert into parishes (slug, name) values ('${SLUG_B}', 'Paróquia Teste Multiparóquia') on conflict do nothing;
    insert into service_catalog (parish_id, code, title, description, form_fields, sort_order)
    select id, v.code, v.title, v.d, v.f::jsonb, v.o from parishes, (values
      ('certidao', 'Segunda via de certidão (B)', 'Serviço da paróquia B', '[{"name":"nome","label":"Nome no registro","type":"text","required":true}]', 1),
      ('visita_enfermos', 'Visita a enfermos (B)', 'Só existe na paróquia B', '[{"name":"endereco_ref","label":"Bairro","type":"text"}]', 2)
    ) v(code, title, d, f, o) where slug = '${SLUG_B}' on conflict do nothing;
    insert into auth.users values ('${UID['u-padre']}','padre@teste'),('${UID['u-sec']}','secretaria@teste'),('${UID['u-pascom']}','pascom@teste'),('${UID['u-outra']}','outra@teste');
    insert into parish_users select '${UID['u-padre']}', id, 'padre' from parishes where slug='santo-antonio-jaragua';
    insert into parish_users select '${UID['u-sec']}', id, 'secretaria' from parishes where slug='santo-antonio-jaragua';
    insert into parish_users select '${UID['u-pascom']}', id, 'pascom' from parishes where slug='santo-antonio-jaragua';
    insert into parish_users select '${UID['u-outra']}', id, 'secretaria' from parishes where slug='${SLUG_B}';
  `);
  if (seed) await db.exec(ler('supabase/demo_secretaria_seed.sql'));
  const pid = async slug => (await db.query('select id from parishes where slug=$1', [slug])).rows[0].id;
  return {db, PID_A: await pid('santo-antonio-jaragua'), PID_B: await pid(SLUG_B)};
}

// Uma consulta por vez, cada uma numa transação com o papel e o usuário certos.
let fila = Promise.resolve();
export function como(db, uid, fn){
  const run = () => db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    return fn(tx);
  });
  const p = fila.then(run, run);
  fila = p.catch(() => {});
  return p;
}
const erro = e => ({error:{code:e.code || 'XX000', message:e.message}});

// Envolve o op() do fakesb: chamadas da Secretaria 24h vão para o Postgres; o resto segue igual.
// falha: null | 'rede' (erro 500 em tudo da Secretaria) | 'ausente' (banco sem a migração)
export function ponte(op, {db, PID_A}, opcoes = {}){
  const RPC = ['public_service_catalog','public_create_service_request','public_get_service_request','staff_update_service_request'];
  const TAB = {service_catalog:'id, code, title, form_fields', service_requests:'id, service_id, protocol, requester_name, whatsapp, contact_preference, answers, status, is_demo, created_at, updated_at', service_request_history:'id, status, note, public_note, created_at'};
  const pidReal = v => v === 'p-1' ? PID_A : v;
  return async q => {
    const s24 = (q.kind === 'rpc' && RPC.includes(q.fn)) || (q.table in TAB);
    if (!s24) return op(q);
    opcoes.chamadas = (opcoes.chamadas || 0) + 1;
    if (opcoes.falha === 'rede') return {error:{code:'500', message:'Internal Server Error'}};
    if (opcoes.falha === 'ausente') return {error:{code: q.kind === 'rpc' ? 'PGRST202' : 'PGRST205', message:'Could not find the function in the schema cache'}};
    const uid = q.uid ? UID[q.uid] : null;
    try {
      if (q.kind === 'rpc'){
        const nomes = Object.keys(q.args);
        const sql = `select ${q.fn}(${nomes.map((n, i) => `${n} => $${i + 1}${n === 'p_answers' ? '::jsonb' : n === 'p_request' ? '::uuid' : n === 'p_public_note' ? '::boolean' : ''}`).join(', ')}) r`;
        const vals = nomes.map(n => n === 'p_answers' ? JSON.stringify(q.args[n]) : q.args[n]);
        return {data: (await como(db, uid, tx => tx.query(sql, vals))).rows[0].r};
      }
      if (q.kind !== 'select') return {error:{code:'42501', message:'permission denied'}};
      const f = (q.eq || []).map(([c, v]) => [c, c === 'parish_id' ? pidReal(v) : v]);
      const where = f.length ? 'where ' + f.map(([c], i) => `${c} = $${i + 1}`).join(' and ') : '';
      const ordem = q.table === 'service_request_history' ? 'order by created_at' : q.table === 'service_requests' ? 'order by created_at desc' : '';
      const r = await como(db, uid, tx => tx.query(`select ${TAB[q.table]} from ${q.table} ${where} ${ordem}`, f.map(x => x[1])));
      return {data: JSON.parse(JSON.stringify(r.rows))};
    } catch(e){ return erro(e); }
  };
}
