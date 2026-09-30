// Supabase falso (só para teste): o navegador usa um cliente que imita o supabase-js e manda cada
// operação para este backend em Node, compartilhado entre várias abas ("aparelhos").
// Imita: login, parish_users, parish_state com trava por updated_at, tabelas novas com papéis
// (PASCOM sem dizimistas), RPCs públicas e o cenário "schema novo ainda não rodado".
import crypto from 'node:crypto';

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// Diretório real (gerado do Catálogo 2026) para os testes de busca/ativação no front.
const DIR = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../docs/diretorio-importacao.json', import.meta.url)), 'utf8')).diretorio;
const SA = 'santo-antonio-jaragua', SC = 'santa-clara-e-sao-francisco-mineirao', NG = 'nossa-senhora-das-gracas-ibirite';
export const TENANTS = {[SA]:'p-1', [SC]:'p-2', [NG]:'p-3'};

export function criarBackend({migrado = true, semContrib = false, diretorio = true} = {}){
  const PID = 'p-1';
  const usuarios = {'secretaria@teste':{id:'u-sec', senha:'123456', role:'secretaria'}, 'padre@teste':{id:'u-padre', senha:'123456', role:'padre'},
    'pascom@teste':{id:'u-pascom', senha:'123456', role:'pascom'}, 'semvinculo@teste':{id:'u-x', senha:'123456', role:null},
    'sc@teste':{id:'u-sc', senha:'123456', role:'secretaria', pid:'p-2'}, 'padre.sc@teste':{id:'u-padre-sc', senha:'123456', role:'padre', pid:'p-2'},
    'pascom.sc@teste':{id:'u-pascom-sc', senha:'123456', role:'pascom', pid:'p-2'}, 'gracas@teste':{id:'u-ng-sec', senha:'123456', role:'secretaria', pid:'p-3'},
    'padre.gracas@teste':{id:'u-ng-padre', senha:'123456', role:'padre', pid:'p-3'}};
  const B = {migrado, estado:{data:{}, updated_at:new Date().toISOString()}, t:{communities:[], events:[], tither_profiles:[], tither_leads:[], tither_contributions:[]}, log:[], diretorio, doacoes:{}, doacoesMigrado:true};
  // Tenants novos: estado próprio, só com dados do catálogo (como o diretorio_ativacao.sql)
  const cfgDir = d => ({nome:'Paróquia ' + d.display_name + ' – ' + (d.neighborhood && !/^centro$/i.test(d.neighborhood) ? d.neighborhood : d.municipality),
    endereco:[d.address, d.neighborhood, d.municipality + ' – MG, CEP ' + d.postal_code].filter(Boolean).join(' – '), telefone:d.phone, email:d.email, forania:d.forania, regiao:d.episcopal_region_name, missas:'', secretaria:''});
  B.estados = {'p-1':B.estado};
  for (const [slug, pid] of [[SC, 'p-2'], [NG, 'p-3']]) B.estados[pid] = {data:{cfg:cfgDir(DIR.find(d => d.slug === slug))}, updated_at:new Date().toISOString()};
  const pidDe = uid => Object.values(usuarios).find(u => u.id === uid)?.pid || PID;
  const papel = uid => Object.values(usuarios).find(u => u.id === uid)?.role;
  const areaDe = {communities:'comunidades', events:'agenda', tither_profiles:'dizimistas', tither_leads:'dizimistas', tither_contributions:'dizimistas'};
  const pode = (uid, area) => { const r = papel(uid); return r === 'padre' || r === 'secretaria' || (r === 'pascom' && ['agenda','comunidades','avisos'].includes(area)); };
  const tick = () => { const d = new Date(Date.now() + B.log.length); return d.toISOString(); };
  const erroFalta = {code:'PGRST205', message:"Could not find the table in the schema cache"};

  function publico(slug = SA){
    const pid = TENANTS[slug];
    if (!pid) return null;
    B.estados[PID] = B.estado; // os testes antigos trocam B.estado inteiro
    const d = B.estados[pid].data;
    const r = {name:pid === PID ? 'Paróquia Santo Antônio – Jaraguá' : d.cfg.nome, slug, cfg:d.cfg || {}, avisos:d.avisos || [],
      velasHoje:(d.velas || []).filter(v => v.ts > Date.now() - 864e5).length};
    if (pid !== PID) return {...r, communities:[], events:[]};
    if (!B.migrado) return r; // função antiga: sem comunidades/eventos
    const ativas = B.t.communities.filter(c => c.active);
    r.communities = ativas.map(({id,name,slug,patron,address,phone,description,photo_url,mass_schedule}) => ({id,name,slug,patron,address,phone,description,photo_url,mass_schedule}));
    r.events = B.t.events.filter(e => e.public && !e.cancelled && (!e.community_id || ativas.some(c => c.id === e.community_id)) && Date.parse(e.ends_at || e.starts_at) > Date.now() - 6*3600e3)
      .map(({id,community_id,scope,title,description,starts_at,ends_at,location,highlight_home,image_url}) => ({id,community_id,scope,title,description,starts_at,ends_at,location,highlight_home,image_url}));
    return r;
  }

  async function op(q){
    B.log.push(q.kind + ':' + (q.table || q.fn || ''));
    const uid = q.uid;
    if (q.kind === 'login'){ const u = usuarios[q.email]; return u && u.senha === q.senha ? {data:{session:{user:{id:u.id, email:q.email}, access_token:'x'}}} : {error:{message:'Invalid login credentials'}}; }
    if (q.kind === 'rpc'){
      if (q.fn === 'get_public_parish') return {data:publico(q.args.p_slug)};
      if (q.fn === 'public_submit'){ const pid = TENANTS[q.args.p_slug]; if (!pid) return {data:false};
        B.estados[PID] = B.estado;
        const est = B.estados[pid], k = q.args.p_kind === 'vela' ? 'velas' : 'intencoes'; const it = {...q.args.p_item, id:Date.now()*1000, ts:Date.now()}; if (k === 'intencoes') it.status = 'nova';
        est.data[k] = [...(est.data[k] || []), it]; est.updated_at = tick(); return {data:true}; }
      if (q.fn === 'staff_list_parish_team'){
        if (!['padre', 'secretaria', 'admin'].includes(papel(uid)) || q.args.p_parish !== pidDe(uid)) return {error:{code:'42501', message:'Sem permissão'}};
        const ordem = {padre:1, secretaria:2, pascom:3, admin:4};
        return {data:Object.entries(usuarios).filter(([, u]) => u.role && (u.pid || PID) === q.args.p_parish)
          .sort((a, b) => (ordem[a[1].role] || 9) - (ordem[b[1].role] || 9) || a[0].localeCompare(b[0]))
          .map(([email, u]) => ({display_name:null, email, role:u.role, active:true}))};
      }
      if (q.fn === 'public_directory_search' || q.fn === 'public_directory_entry'){
        if (!B.diretorio) return {error:{code:'PGRST202', message:'Could not find the function in the schema cache'}};
        const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const ativo = d => TENANTS[d.slug] ? d.slug : null;
        const pub = d => ({slug:d.slug, name:d.display_name, type:d.type, municipality:d.municipality, neighborhood:d.neighborhood, forania:d.forania, episcopal_region:d.episcopal_region,
          is_sanctuary:!!d.is_sanctuary, sanctuary_name:d.sanctuary_name || null, sanctuary_kind:d.sanctuary_kind || null, active:!!ativo(d), tenant_slug:ativo(d)});
        if (q.fn === 'public_directory_entry'){ const d = DIR.find(x => x.slug === q.args.p_slug); return {data:d ? {...pub(d), address:d.address, postal_code:d.postal_code, phone:d.phone, email:d.email, catalog_code:d.catalog_code, episcopal_region_name:d.episcopal_region_name, sanctuary_code:d.sanctuary_code || null} : null}; }
        // mesma regra do supabase/diretorio_santuarios.sql: abreviações simples, filtro de tipo e relevância pelo nome
        const exp = t => (' ' + norm(t).replace(/[^a-z0-9]+/g, ' ') + ' ').replace(/ n s /g, ' nossa senhora ').replace(/ nsra /g, ' nossa senhora ').replace(/ sto /g, ' santo ').replace(/ sta /g, ' santa ').replace(/ sra /g, ' senhora ').replace(/\s+/g, ' ');
        const frase = exp(String(q.args.p_q || '').slice(0, 80)).trim(), w = frase.split(' ').filter(Boolean), tipo = q.args.p_tipo || null;
        const texto = d => exp([d.display_name, d.neighborhood, d.municipality, d.forania, d.sanctuary_name, d.sanctuary_kind].join(' ') + (d.type.startsWith('paroquia') ? ' paroquia' : '') + (d.is_sanctuary ? ' santuario' : ''));
        const rel = d => w.length && exp(d.display_name + ' ' + (d.sanctuary_name || '')).includes(frase) ? 0 : 1;
        const l = DIR.filter(d => !tipo || (tipo === 'paroquia' && d.type.startsWith('paroquia')) || (tipo === 'santuario' && d.is_sanctuary))
          .filter(d => w.length ? w.every(x => texto(d).includes(x)) : (ativo(d) || tipo === 'santuario'));
        return {data:l.sort((a, b) => rel(a) - rel(b) || !!ativo(b) - !!ativo(a) || (a.sanctuary_name || a.display_name).localeCompare(b.sanctuary_name || b.display_name)).slice(0, Math.min(q.args.p_limit || 30, 50)).map(pub)}; }
      // Doações (supabase/doacoes.sql): começa sem nada; só padre/suporte configuram; o público só vê o que está ligado
      if (['public_donation_settings', 'staff_get_donation_settings', 'staff_save_donation_settings'].includes(q.fn)){
        if (!B.doacoesMigrado) return {error:{code:'PGRST202', message:'Could not find the function in the schema cache'}};
        if (q.fn === 'public_donation_settings'){ const s = B.doacoes[TENANTS[q.args.p_slug]];
          if (!s || !(s.pix_enabled || s.card_enabled)) return {data:null};
          return {data:{...(s.pix_enabled ? {pix:{key:s.pix_key, key_type:s.pix_key_type, beneficiary:s.pix_beneficiary, city:s.pix_city}} : {}), ...(s.card_enabled ? {card:{provider:s.payment_provider || null, checkout_url:s.checkout_url}} : {})}}; }
        if (!['padre', 'admin'].includes(papel(uid)) || q.args.p_parish !== pidDe(uid)) return {error:{code:'42501', message:'Sem permissão'}};
        if (q.fn === 'staff_get_donation_settings') return {data:structuredClone(B.doacoes[q.args.p_parish] || {parish_id:q.args.p_parish, pix_enabled:false, card_enabled:false})};
        const PERMITIDOS = ['pix_enabled','pix_key','pix_key_type','pix_beneficiary','pix_city','card_enabled','payment_provider','checkout_url'], d = q.args.p_dados || {};
        const extra = Object.keys(d).find(k => !PERMITIDOS.includes(k)); if (extra) return {error:{code:'22023', message:'Campo não permitido: ' + extra}};
        if (d.checkout_url && !/^https:\/\/\S+$/.test(d.checkout_url)) return {error:{code:'23514', message:'violates check constraint "parish_donation_card_ck"'}};
        if ((d.pix_enabled && !(d.pix_key && d.pix_key_type && d.pix_beneficiary && d.pix_city)) || (d.card_enabled && !d.checkout_url)) return {error:{code:'23514', message:'violates check constraint'}};
        B.doacoes[q.args.p_parish] = {parish_id:q.args.p_parish, ...Object.fromEntries(PERMITIDOS.map(k => [k, d[k] ?? (k.endsWith('enabled') ? false : null)])), updated_at:new Date().toISOString()};
        return {data:structuredClone(B.doacoes[q.args.p_parish])}; }
      if (!B.migrado) return {error:{code:'PGRST202', message:'Could not find the function in the schema cache'}};
      if (q.fn === 'public_tither_interest'){ const it = q.args.p_item, wa = String(it.whatsapp).replace(/\D/g,'');
        if (!it.consent || wa.length < 10 || String(it.name||'').trim().length < 2) return {data:false};
        if (it.community_id && !B.t.communities.some(c => c.id === it.community_id && c.active)) return {data:false};
        if (!B.t.tither_leads.some(l => l.whatsapp === wa && ['new','contacted'].includes(l.status)))
          B.t.tither_leads.push({id:crypto.randomUUID(), parish_id:PID, community_id:it.community_id || null, name:it.name.trim(), whatsapp:wa, contact_preference:it.contact_preference, consent:true, status:'new', tither_id:null, created_at:new Date().toISOString(), updated_at:new Date().toISOString()});
        return {data:true}; }
      if (q.fn === 'convert_tither_lead'){ if (!pode(uid, 'dizimistas')) return {error:{code:'42501', message:'Sem permissão'}};
        const l = B.t.tither_leads.find(x => x.id === q.args.p_lead); let t = B.t.tither_profiles.find(x => x.whatsapp === l.whatsapp);
        if (!t){ t = {id:crypto.randomUUID(), parish_id:PID, community_id:l.community_id, name:l.name, whatsapp:l.whatsapp, birth_date:null, marriage_date:null, joined_on:new Date().toISOString().slice(0,10), status:'active', consent:true, notes:null, created_at:new Date().toISOString(), updated_at:new Date().toISOString()}; B.t.tither_profiles.push(t); }
        l.status = 'converted'; l.tither_id = t.id; return {data:t.id}; }
      return {error:{message:'rpc desconhecida'}};
    }
    const f = Object.fromEntries(q.eq || []);
    if (q.table === 'parish_users'){ const r = papel(uid), pid = pidDe(uid); return {data: r ? [{parish_id:pid, role:r, parishes:{slug:Object.keys(TENANTS).find(s => TENANTS[s] === pid)}}] : []}; }
    if (q.table === 'parish_state'){
      B.estados[PID] = B.estado;
      if (!papel(uid) || f.parish_id !== pidDe(uid)) return q.single ? {error:{message:'no rows'}} : {data:[]}; // RLS: só a própria paróquia
      const est = B.estados[f.parish_id];
      if (q.kind === 'select') return {data:{data:structuredClone(est.data), updated_at:est.updated_at}};
      if (q.kind === 'update'){ if (f.updated_at !== est.updated_at) return {data:[]}; const novo = {data:structuredClone(q.payload.data), updated_at:tick()}; B.estados[f.parish_id] = novo; if (f.parish_id === PID) B.estado = novo; return {data:[{updated_at:novo.updated_at}]}; }
    }
    if (!(q.table in B.t)) return {error:{message:'tabela desconhecida'}};
    if (!B.migrado || (semContrib && q.table === "tither_contributions")) return {error:erroFalta};
    const area = areaDe[q.table], lista = B.t[q.table];
    if (q.kind === 'select') return {data: pode(uid, area) || (q.table === 'communities' || q.table === 'events') && papel(uid) ? structuredClone(lista.filter(x => x.parish_id === f.parish_id)) : []};
    if (!pode(uid, area)) return {error:{code:'42501', message:'new row violates row-level security policy'}};
    const agora = new Date().toISOString();
    if (q.kind === 'insert'){
      if (q.table === 'communities' && lista.some(c => c.slug === q.payload.slug)) return {error:{code:'23505', message:'duplicate key'}};
      if (q.table === 'tither_contributions' && lista.some(c => c.tither_id === q.payload.tither_id && c.reference_month === q.payload.reference_month)) return {error:{code:'23505', message:'duplicate key value violates unique constraint "tither_contributions_one_per_month"'}};
      if (q.table === 'tither_contributions' && !B.t.tither_profiles.some(t => t.id === q.payload.tither_id)) return {error:{code:'23503', message:'fk'}};
      if (q.table === 'events' && (q.payload.scope === 'community') !== !!q.payload.community_id) return {error:{code:'23514', message:'events_scope_community'}};
      const r = {id:crypto.randomUUID(), created_at:agora, updated_at:agora, ...(q.table === 'events' ? {created_by:uid, google_event_id:null} : {}), ...q.payload};
      lista.push(r); return {data:structuredClone(r)};
    }
    const alvo = lista.find(x => x.id === f.id);
    if (!alvo) return q.single ? {error:{code:'PGRST116', message:'0 rows'}} : {data:[]};
    if (q.kind === 'update'){ Object.assign(alvo, q.payload, {updated_at:agora}); return {data:structuredClone(alvo)}; }
    if (q.kind === 'delete'){ if (q.table === 'communities') return {error:{code:'42501', message:'permission denied'}}; B.t[q.table] = lista.filter(x => x !== alvo); return {data:null}; }
  }
  return {B, op};
}

// Cliente injetado no navegador antes do app carregar (o app usa window.supabase se já existir).
export const CLIENTE = `
window.supabase = { createClient(){
  const KEY = 'fake-sb-sessao';
  let sessao = JSON.parse(localStorage.getItem(KEY) || 'null');
  const chamar = q => window.__sb({...q, uid: sessao?.user?.id || null});
  const builder = table => {
    const q = {table, kind:'select', eq:[], single:false};
    const b = {
      select(){ if (q.kind === 'select') q.kind = 'select'; q.returning = true; return b; },
      insert(p){ q.kind = 'insert'; q.payload = p; return b; },
      update(p){ q.kind = 'update'; q.payload = p; return b; },
      delete(){ q.kind = 'delete'; return b; },
      eq(c, v){ q.eq.push([c, v]); return b; },
      gte(){ return b; },
      single(){ q.single = true; return b; },
      then(ok, err){ return chamar(q).then(ok, err); }
    };
    return b;
  };
  return {
    auth:{
      async getSession(){ return {data:{session:sessao}}; },
      async signInWithPassword({email, password}){ const r = await chamar({kind:'login', email, senha:password}); if (r.data) { sessao = r.data.session; localStorage.setItem(KEY, JSON.stringify(sessao)); } return r.error ? {data:{}, error:r.error} : r; },
      async signOut(){ sessao = null; localStorage.removeItem(KEY); return {}; }
    },
    from: builder,
    rpc(fn, args){ return chamar({kind:'rpc', fn, args}); }
  };
}};`;
