import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
import { execSync } from 'child_process';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const read = p => fs.readFileSync(`${REPO}/${p}`, 'utf8');
const oldSchema = execSync('git show bbb34e1:supabase/schema.sql', { cwd: REPO }).toString();
let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok  ', m); else { fails++; console.log('  FAIL', m); } };

const STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase dá privilégios padrão a anon/authenticated em tudo que é criado em public
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;

async function como(db, papel, uid, fn){
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${papel};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
async function erro(p){ try { await p; return null; } catch(e){ return e.message; } }

async function cenario(nome, passos){
  console.log('\n== ' + nome);
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const [rot, sql] of passos){
    try { await db.exec(sql); ok(true, 'rodou ' + rot); }
    catch(e){ ok(false, 'rodou ' + rot + ': ' + e.message); }
  }
  return db;
}

// 1) Banco do piloto já existente (schema antigo) + secretaria24h.sql duas vezes + schema novo duas vezes
const db = await cenario('produção: schema antigo + migração 2x + schema novo 2x', [
  ['schema.sql (HEAD)', oldSchema],
  ['secretaria24h.sql (1ª)', read('supabase/secretaria24h.sql')],
  ['secretaria24h.sql (2ª)', read('supabase/secretaria24h.sql')],
  ['schema.sql novo (1ª)', read('supabase/schema.sql')],
  ['schema.sql novo (2ª)', read('supabase/schema.sql')],
]);
{
  const n = (await db.query(`select count(*)::int n from service_catalog`)).rows[0].n;
  ok(n === 6, `catálogo com 6 serviços (tem ${n})`);

  // usuários e paróquias
  await db.exec(`
    insert into parishes (slug, name) values ('outra', 'Outra paróquia');
    insert into auth.users values ('00000000-0000-0000-0000-00000000000a','padre@x'),('00000000-0000-0000-0000-00000000000b','sec@x'),
      ('00000000-0000-0000-0000-00000000000c','pascom@x'),('00000000-0000-0000-0000-00000000000d','outra@x'),('00000000-0000-0000-0000-00000000000e','admin@x');
    insert into parish_users select '00000000-0000-0000-0000-00000000000a', id, 'padre' from parishes where slug='santo-antonio-jaragua';
    insert into parish_users select '00000000-0000-0000-0000-00000000000b', id, 'secretaria' from parishes where slug='santo-antonio-jaragua';
    insert into parish_users select '00000000-0000-0000-0000-00000000000c', id, 'pascom' from parishes where slug='santo-antonio-jaragua';
    insert into parish_users select '00000000-0000-0000-0000-00000000000d', id, 'secretaria' from parishes where slug='outra';
    insert into parish_users select '00000000-0000-0000-0000-00000000000e', id, 'admin' from parishes where slug='santo-antonio-jaragua';
  `);
  const PADRE='00000000-0000-0000-0000-00000000000a', SEC='00000000-0000-0000-0000-00000000000b', PASCOM='00000000-0000-0000-0000-00000000000c', OUTRA='00000000-0000-0000-0000-00000000000d', ADMIN='00000000-0000-0000-0000-00000000000e';
  const SLUG = 'santo-antonio-jaragua';
  const criar = (code, name, wa, pref, ans) => db.query(`select public_create_service_request($1,$2,$3,$4,$5,$6::jsonb) r`, [SLUG, code, name, wa, pref, JSON.stringify(ans)]).then(x => x.rows[0].r);

  let r1, r1b, cat;
  await como(db, 'anon', null, async () => {
    for (const t of ['service_catalog','service_requests','service_request_history'])
      ok(!!await erro(db.query(`select * from ${t}`)), `anon sem SELECT direto em ${t}`);
    ok(!!await erro(db.query(`insert into service_requests (parish_id, service_id, protocol, requester_name, whatsapp) values (gen_random_uuid(), gen_random_uuid(), 'SA-2026-AAAAAAAA', 'xx', '31999999999')`)), 'anon sem INSERT direto');
    cat = (await db.query(`select public_service_catalog($1) c`, [SLUG])).rows[0].c;
    ok(cat.length === 6 && !('id' in cat[0]) && !('parish_id' in cat[0]), 'catálogo público: 6 serviços, sem ids');
    ok(cat.map(c => c.code).join() === 'certidao,batismo,matrimonio,catequese,atendimento_padre,outro', 'catálogo na ordem');
    ok((await db.query(`select public_service_catalog('nao-existe') c`)).rows[0].c.length === 0, 'slug inexistente: lista vazia');

    r1 = await criar('certidao', '  Maria   da Silva ', '(31) 99876-5432', 'whatsapp', {tipo_documento:'Certidão de Batismo', nome_pessoa:'Maria da Silva', desconhecido:'x', observacoes:'linha1\nlinha2'});
    ok(/^SA-\d{4}-[0-9A-F]{8}$/.test(r1.protocol) && r1.status === 'new' && Object.keys(r1).sort().join() === 'created_at,protocol,status', 'cria solicitação e devolve só protocol/status/created_at: ' + r1.protocol);
    r1b = await criar('certidao', 'Maria da Silva', '5531998765432', 'ligacao', {tipo_documento:'Certidão de Crisma', nome_pessoa:'Maria'});
    ok(r1b.protocol === r1.protocol, 'envio repetido em 5 min devolve o mesmo protocolo');
    const outro = await criar('batismo', 'Maria da Silva', '31998765432', 'whatsapp', {nome_pessoa:'Joãozinho'});
    ok(outro.protocol !== r1.protocol, 'outro serviço do mesmo WhatsApp gera outro protocolo');

    const inval = [
      ['serviço inexistente', () => criar('nao', 'Maria', '31998765432', 'whatsapp', {}), 'servico_indisponivel'],
      ['nome curto', () => criar('outro', 'M', '31998765432', 'whatsapp', {mensagem:'oi'}), 'nome_invalido'],
      ['nome longo', () => criar('outro', 'M'.repeat(121), '31998765432', 'whatsapp', {mensagem:'oi'}), 'nome_invalido'],
      ['WhatsApp com letras', () => criar('outro', 'Maria', '3199876abcd', 'whatsapp', {mensagem:'oi'}), 'whatsapp_invalido'],
      ['WhatsApp curto', () => criar('outro', 'Maria', '998765432', 'whatsapp', {mensagem:'oi'}), 'whatsapp_invalido'],
      ['celular sem 9', () => criar('outro', 'Maria', '31898765432', 'whatsapp', {mensagem:'oi'}), 'whatsapp_invalido'],
      ['DDD 00', () => criar('outro', 'Maria', '00998765432', 'whatsapp', {mensagem:'oi'}), 'whatsapp_invalido'],
      ['preferência inválida', () => criar('outro', 'Maria', '31998765432', 'email', {mensagem:'oi'}), 'dados_invalidos'],
      ['answers não objeto', () => db.query(`select public_create_service_request($1,'outro','Maria','31998765432','whatsapp','[1]'::jsonb)`, [SLUG]), 'dados_invalidos'],
      ['answers nulo', () => db.query(`select public_create_service_request($1,'outro','Maria','31998765432','whatsapp',null)`, [SLUG]), 'dados_invalidos'],
      ['campo obrigatório vazio', () => criar('outro', 'Maria', '31998765432', 'whatsapp', {mensagem:'  '}), 'campo_obrigatorio'],
      ['texto longo', () => criar('certidao', 'Maria', '31998765432', 'whatsapp', {tipo_documento:'Outro', nome_pessoa:'x'.repeat(201)}), 'dados_invalidos'],
      ['textarea gigante', () => criar('outro', 'Maria', '31998765432', 'whatsapp', {mensagem:'x'.repeat(2001)}), 'dados_invalidos'],
      ['payload gigante', () => criar('outro', 'Maria', '31998765432', 'whatsapp', {mensagem:'oi', lixo:'x'.repeat(20000)}), 'dados_invalidos'],
      ['opção fora da lista', () => criar('certidao', 'Maria', '31998765432', 'whatsapp', {tipo_documento:'<script>', nome_pessoa:'x'}), 'dados_invalidos'],
      ['data inválida', () => criar('batismo', 'Maria', '31998765432', 'whatsapp', {nome_pessoa:'x', data_nascimento:'2026-02-31'}), 'dados_invalidos'],
      ['data fora do formato', () => criar('batismo', 'Maria', '31998765432', 'whatsapp', {nome_pessoa:'x', data_nascimento:'12/06/2026'}), 'dados_invalidos'],
      ['valor não texto', () => criar('outro', 'Maria', '31998765432', 'whatsapp', {mensagem:{a:1}}), 'dados_invalidos'],
      ['caractere de controle', () => criar('outro', 'Maria\u0007', '31998765432', 'whatsapp', {mensagem:'oi'}), 'nome_invalido'],
    ];
    for (const [rot, f, cod] of inval){ const m = await erro(f()); ok(m && m.includes('s24:' + cod), `rejeita ${rot} (${m})`); }

    const res = (await db.query(`select public_get_service_request($1,$2,$3) r`, [SLUG, r1.protocol.toLowerCase(), '31 99876-5432'])).rows[0].r;
    ok(res && res.service_title === 'Certidão / documento paroquial' && res.history.length === 1 && res.history[0].note === 'Solicitação recebida.', 'consulta com protocolo + WhatsApp');
    ok(res && !JSON.stringify(res).match(/requester_name|answers|whatsapp|"id"|created_by|parish/), 'consulta não expõe ids, nome, respostas ou quem alterou');
    ok((await db.query(`select public_get_service_request($1,$2,$3) r`, [SLUG, r1.protocol, '31999990000'])).rows[0].r === null, 'WhatsApp errado: NULL (não revela o protocolo)');
    ok((await db.query(`select public_get_service_request($1,$2,$3) r`, [SLUG, 'SA-2026-00000000', '31998765432'])).rows[0].r === null, 'protocolo inexistente: NULL');
    ok((await db.query(`select public_get_service_request('outra',$1,$2) r`, [r1.protocol, '31998765432'])).rows[0].r === null, 'outra paróquia: NULL');
    ok(!!await erro(db.query(`select staff_update_service_request(gen_random_uuid(),'closed',null,false)`)), 'anon não executa staff_update_service_request');
  });

  const stored = (await db.query(`select * from service_requests where protocol=$1`, [r1.protocol])).rows[0];
  ok(stored.whatsapp === '31998765432' && stored.requester_name === 'Maria da Silva', 'nome e WhatsApp normalizados no banco');
  ok(!('desconhecido' in stored.answers) && stored.answers.observacoes === 'linha1\nlinha2', 'chave desconhecida descartada; textarea com quebra de linha aceita');
  const reqId = stored.id;

  // equipe
  await como(db, 'authenticated', SEC, async () => {
    ok((await db.query(`select count(*)::int n from service_requests`)).rows[0].n === 2, 'secretaria lê as solicitações da própria paróquia');
    ok((await db.query(`select count(*)::int n from service_catalog`)).rows[0].n === 6, 'secretaria lê o catálogo');
    ok(!!await erro(db.query(`update service_requests set status='closed'`)), 'secretaria não altera a tabela direto');
    ok(!!await erro(db.query(`insert into service_request_history (request_id, parish_id, status) values ($1, gen_random_uuid(), 'new')`, [reqId])), 'secretaria não insere histórico direto');
    await db.query(`select staff_update_service_request($1,'in_progress','Ligar para o cartório antes.',false)`, [reqId]);
    await db.query(`select staff_update_service_request($1,'in_progress','Localizamos o registro. A certidão está sendo preparada.',true)`, [reqId]);
    ok((await erro(db.query(`select staff_update_service_request($1,'aprovado',null,false)`, [reqId])))?.includes('status_invalido'), 'rejeita status arbitrário');
    ok((await erro(db.query(`select staff_update_service_request($1,'in_progress','',false)`, [reqId])))?.includes('nada_alterado'), 'rejeita alteração vazia');
    ok((await erro(db.query(`select staff_update_service_request($1,'closed',$2,false)`, [reqId, 'x'.repeat(1001)])))?.includes('nota_longa'), 'rejeita nota longa');
    const h = (await db.query(`select status, note, public_note, created_by from service_request_history where request_id=$1 order by created_at`, [reqId])).rows;
    ok(h.length === 4 && h[1].public_note && h[1].note === null && !h[2].public_note && h[3].public_note && h[3].created_by === SEC, 'histórico: status público + nota interna + nota pública, com autor');
  });
  await como(db, 'anon', null, async () => {
    const res = (await db.query(`select public_get_service_request($1,$2,$3) r`, [SLUG, r1.protocol, '31998765432'])).rows[0].r;
    ok(res.status === 'in_progress' && res.history.length === 3 && !JSON.stringify(res).includes('cartório'), 'fiel vê o novo status e a nota pública, não a interna');
  });
  await como(db, 'authenticated', PADRE, async () => {
    ok((await db.query(`select count(*)::int n from service_requests`)).rows[0].n === 2, 'padre lê as solicitações');
    await db.query(`select staff_update_service_request($1,'completed',null,false)`, [reqId]);
    ok(true, 'padre altera status');
  });
  await como(db, 'authenticated', ADMIN, async () => {
    ok((await db.query(`select count(*)::int n from service_request_history`)).rows[0].n >= 5, 'suporte (admin) lê o histórico');
  });
  await como(db, 'authenticated', PASCOM, async () => {
    for (const t of ['service_catalog','service_requests','service_request_history'])
      ok((await db.query(`select count(*)::int n from ${t}`)).rows[0].n === 0, `PASCOM não vê nada em ${t}`);
    ok((await erro(db.query(`select staff_update_service_request($1,'closed',null,false)`, [reqId])))?.includes('Sem permissão'), 'PASCOM não altera status');
  });
  await como(db, 'authenticated', OUTRA, async () => {
    ok((await db.query(`select count(*)::int n from service_requests`)).rows[0].n === 0, 'secretaria de outra paróquia não vê nada');
    ok((await erro(db.query(`select staff_update_service_request($1,'closed',null,false)`, [reqId])))?.includes('Sem permissão'), 'secretaria de outra paróquia não altera');
  });

  // permissões antigas continuam iguais
  await como(db, 'authenticated', SEC, async () => {
    const r = (await db.query(`select ${['avisos','agenda','comunidades','dizimistas','pessoas','intencoes','mensagens','ajustes','secretaria24h','noticias'].map(a => `can_access(p.id,'${a}') as "${a}"`).join(',')} from parishes p where slug=$1`, [SLUG])).rows[0];
    ok(Object.entries(r).every(([k,v]) => v === (k !== 'noticias')), 'matriz da secretaria: antigas mantidas + secretaria24h (noticias continua não)');
  });
  await como(db, 'authenticated', PASCOM, async () => {
    const r = (await db.query(`select can_access(p.id,'secretaria24h') s, can_access(p.id,'avisos') a, can_access(p.id,'noticias') n from parishes p where slug=$1`, [SLUG])).rows[0];
    ok(!r.s && r.a && r.n, 'PASCOM: sem secretaria24h, mantém avisos/noticias');
  });

  // limite por WhatsApp (5/h): já há 2 deste número; a 3ª..5ª passam, a 6ª não
  await como(db, 'anon', null, async () => {
    for (const c of ['matrimonio','catequese','atendimento_padre']) await criar(c, 'Maria', '31998765432', 'whatsapp', c === 'matrimonio' ? {nome_noivo:'a', nome_noiva:'b'} : c === 'catequese' ? {nome_catequizando:'a'} : {assunto:'a'});
    ok((await erro(criar('outro', 'Maria', '31998765432', 'whatsapp', {mensagem:'oi'})))?.includes('s24:limite'), '6ª solicitação do mesmo WhatsApp na hora: limite');
  });

  // catálogo: form_fields inválido é barrado pelo banco
  ok(!!await erro(db.query(`insert into service_catalog (parish_id, code, title, form_fields) select id, 'x', 'Teste', '[{"name":"a","label":"A","type":"html"}]' from parishes where slug=$1`, [SLUG])), 'form_fields com tipo não permitido é recusado');
  ok(!!await erro(db.query(`insert into service_catalog (parish_id, code, title, form_fields) select id, 'y', 'Teste', '[{"name":"a","label":"A","type":"select"}]' from parishes where slug=$1`, [SLUG])), 'select sem options é recusado');

  // demonstração
  await db.exec(read('supabase/demo_secretaria_seed.sql'));
  await db.exec(read('supabase/demo_secretaria_seed.sql'));
  const d = (await db.query(`select status, (select count(*)::int from service_request_history h where h.request_id=r.id) h from service_requests r where is_demo order by created_at`)).rows;
  ok(d.length === 5 && d.map(x => x.status).sort().join() === 'completed,in_progress,new,new,waiting_user', 'seed de demonstração 2x: 5 solicitações, status certos');
  ok(d.reduce((a, x) => a + x.h, 0) === 12, 'seed de demonstração: 12 linhas de histórico, sem duplicar');
  const reais = (await db.query(`select count(*)::int n from service_requests where not is_demo`)).rows[0].n;
  await db.exec(read('supabase/demo_secretaria_cleanup.sql'));
  ok((await db.query(`select count(*)::int n from service_requests where is_demo`)).rows[0].n === 0, 'cleanup remove as demonstrações');
  ok((await db.query(`select count(*)::int n from service_requests where not is_demo`)).rows[0].n === reais && reais > 0, 'cleanup não toca solicitações reais');
  ok((await db.query(`select count(*)::int n from service_request_history h where not exists (select 1 from service_requests r where r.id=h.request_id)`)).rows[0].n === 0, 'sem histórico órfão');

  // rodar a migração de novo com dados: nada some nem duplica
  const antes = (await db.query(`select (select count(*) from service_requests) a, (select count(*) from service_request_history) b, (select count(*) from service_catalog) c`)).rows[0];
  await db.exec(read('supabase/secretaria24h.sql'));
  const depois = (await db.query(`select (select count(*) from service_requests) a, (select count(*) from service_request_history) b, (select count(*) from service_catalog) c`)).rows[0];
  ok(JSON.stringify(antes) === JSON.stringify(depois), 'rodar secretaria24h.sql de novo com dados: nada muda ' + JSON.stringify(depois));
  // get_public_parish intacta
  const gp = (await db.query(`select get_public_parish($1) g`, [SLUG])).rows[0].g;
  ok(gp && !JSON.stringify(gp).includes('service'), 'get_public_parish não mudou (sem dados da Secretaria 24h)');
}

// 2) Banco novo só com o schema.sql novo
const db2 = await cenario('banco novo: schema.sql novo 2x + secretaria24h.sql', [
  ['schema.sql novo (1ª)', read('supabase/schema.sql')],
  ['schema.sql novo (2ª)', read('supabase/schema.sql')],
  ['secretaria24h.sql', read('supabase/secretaria24h.sql')],
]);
ok((await db2.query(`select count(*)::int n from service_catalog`)).rows[0].n === 6, 'catálogo com 6 serviços');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
