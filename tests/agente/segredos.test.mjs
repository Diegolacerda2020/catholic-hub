// Nenhuma chave/API secreta no navegador: confere tudo o que o .assetsignore publica e todo o repositório.
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
// só código: comentários explicando o que NÃO fazer ("NUNCA coloque a service_role") não contam
const semComentarios = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
const REPO = fileURLToPath(new URL('../..', import.meta.url));
let ok = 0, falha = 0; const t = (n, c, x = '') => { c ? ok++ : falha++; console.log(c ? '  ok  ' : '  FALHOU', n, c ? '' : String(x).slice(0, 300)); };
const SEGREDO = /sk-ant-[a-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|service_role|sb_secret_|ANTHROPIC_API_KEY\s*[:=]\s*['"][^'"]+|OPENAI_API_KEY\s*[:=]\s*['"][^'"]+|client_secret\s*[:=]\s*['"][^'"]+|EAA[A-Za-z0-9]{40,}|-----BEGIN (RSA |EC )?PRIVATE KEY/;

// o que vai para o site: a regra "*" com exceções "!arquivo" do .assetsignore
const permitidos = fs.readFileSync(path.join(REPO, '.assetsignore'), 'utf8').split(/\r?\n/).filter(l => l.startsWith('!') && !l.endsWith('/')).map(l => l.slice(1));
t('arquivos do Assistente são publicados', ['agente-core.js', 'agente.js', 'agente.css'].every(f => permitidos.includes(f)), permitidos);
for (const f of permitidos){
  const s = semComentarios(fs.readFileSync(path.join(REPO, f), 'utf8'));
  t(`publicado sem segredo: ${f}`, !SEGREDO.test(s), (s.match(SEGREDO) || [])[0]);
}
const ctx = {window:{}}; vm.runInNewContext(fs.readFileSync(path.join(REPO, 'config.js'), 'utf8'), ctx);
const C = ctx.window.CENTRAL_CONFIG, chaves = JSON.stringify(C).match(/"[a-zA-Z]*[Kk]ey"/g) || [];
t('config.js: só a chave pública do Supabase', /^sb_publishable_/.test(C.supabase.anonKey) && chaves.join() === '"anonKey"', chaves);
for (const f of ['agente-core.js', 'agente.js']){
  const s = semComentarios(fs.readFileSync(path.join(REPO, f), 'utf8'));
  t(`${f}: não chama provedor de IA nem WhatsApp não oficial pelo navegador`, !/anthropic\.com|openai\.com|generativelanguage|web\.whatsapp\.com|wa\.me|api\.z-api|evolution/i.test(s));
  t(`${f}: sem fetch/XMLHttpRequest próprio (só o cliente Supabase da sessão)`, !/\bfetch\(|XMLHttpRequest/.test(s));
  t(`${f}: não depende de Google Calendar nem de sincronização externa`, !/google|external_|sync_status|calendar_id|oauth|refresh_token/i.test(s), (s.match(/google|external_|sync_status|calendar_id|oauth|refresh_token/i) || [])[0]);
  t(`${f}: sem console.log/debug de dados`, !/console\.(log|debug|info|table|dir)\(/.test(s));
  t(`${f}: nada em localStorage (conversa só em memória)`, !/localStorage|sessionStorage|indexedDB/.test(s));
}
const w = fs.readFileSync(path.join(REPO, 'wrangler.jsonc'), 'utf8');
t('wrangler.jsonc sem vars/segredos', !/"vars"|api_key|secret/i.test(w));
// este próprio teste contém os padrões que procura
const rastreados = execSync('git ls-files', {cwd:REPO}).toString().split('\n').filter(f => f && !/\.(png|jpg|pdf|pem)$/.test(f) && f !== 'tests/agente/segredos.test.mjs');
const com = rastreados.filter(f => { try { return SEGREDO.test(fs.readFileSync(path.join(REPO, f), 'utf8').replace(/NUNCA coloque aqui a chave "service_role"[^\n]*|service_role[^\n]*(repositório|no navegador|nunca)/gi, '')); } catch(e){ return false; } });
t('nenhum segredo em arquivos do repositório', !com.length, com.join(', '));
console.log(`\n${ok} ok, ${falha} falhas`);
process.exit(falha ? 1 : 0);
