// Worker do Central Paroquial: serve o site estático (ASSETS) e as APIs /api/noticias e /api/liturgia.
import { responderNoticias } from './api.js';
import { responderLiturgia } from './liturgia.js';

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    if (url.pathname === '/api/noticias') return responderNoticias(request, env, ctx);
    if (url.pathname === '/api/liturgia') return responderLiturgia(request, env, ctx);
    return env.ASSETS.fetch(request);
  }
};
