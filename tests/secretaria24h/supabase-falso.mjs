// Supabase falso (só para teste): o navegador usa um cliente que imita o supabase-js e manda cada
// operação para este backend em Node, compartilhado entre várias abas ("aparelhos").
// Imita: login, parish_users, parish_state com trava por updated_at, tabelas novas com papéis
// (PASCOM sem dizimistas), RPCs públicas e o cenário "schema novo ainda não rodado".
import crypto from 'node:crypto';

export function criarBackend({migrado = true, semContrib = false} = {}){
  const PID = 'p-1';
  const usuarios = {'secretaria@teste':{id:'u-sec', senha:'123456', role:'secretaria'}, 'padre@teste':{id:'u-padre', senha:'123456', role:'padre'},
    'pascom@teste':{id:'u-pascom', senha:'123456', role:'pascom'}, 'semvinculo@teste':{id:'u-x', senha:'123456', role:null}};
  const B = {migrado, estado:{data:{}, updated_at:new Date().toISOString()}, t:{communities:[], events:[], tither_profiles:[], tither_leads:[], tither_contributions:[]}, log:[]};
  const papel = uid => Object.values(usuarios).find(u => u.id === uid)?.role;
  const areaDe = {communities:'comunidades', events:'agenda', tither_profiles:'dizimistas', tither_leads:'dizimistas', tither_contributions:'dizimistas'};
  const pode = (uid, area) => { const r = papel(uid); return r === 'padre' || r === 'secretaria' || (r === 'pascom' && ['agenda','comunidades','avisos'].includes(area)); };
  const tick = () => { const d = new Date(Date.now() + B.log.length); return d.toISOString(); };
  const erroFalta = {code:'PGRST205', message:"Could not find the table in the schema cache"};

  function publico(){
    const d = B.estado.data, r = {name:'Paróquia Santo Antônio – Jaraguá', slug:'santo-antonio-jaragua', cfg:d.cfg || {}, avisos:d.avisos || [],
      velasHoje:(d.velas || []).filter(v => v.ts > Date.now() - 864e5).length};
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
      if (q.fn === 'get_public_parish') return {data:publico()};
      if (q.fn === 'public_submit'){ const k = q.args.p_kind === 'vela' ? 'velas' : 'intencoes'; const it = {...q.args.p_item, id:Date.now()*1000, ts:Date.now()}; if (k === 'intencoes') it.status = 'nova';
        B.estado.data[k] = [...(B.estado.data[k] || []), it]; B.estado.updated_at = tick(); return {data:true}; }
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
    if (q.table === 'parish_users'){ const r = papel(uid); return {data: r ? [{parish_id:PID, role:r, parishes:{slug:'santo-antonio-jaragua'}}] : []}; }
    if (q.table === 'parish_state'){
      if (!papel(uid)) return q.single ? {error:{message:'no rows'}} : {data:[]};
      if (q.kind === 'select') return {data:{data:structuredClone(B.estado.data), updated_at:B.estado.updated_at}};
      if (q.kind === 'update'){ if (f.updated_at !== B.estado.updated_at) return {data:[]}; B.estado = {data:structuredClone(q.payload.data), updated_at:tick()}; return {data:[{updated_at:B.estado.updated_at}]}; }
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
