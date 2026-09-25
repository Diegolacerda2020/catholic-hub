// Worker do Central Paroquial: serve o site estático (ASSETS) e o proxy /api/noticias.
import { responderNoticias } from './api.js';

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    if (url.pathname === '/api/noticias') return responderNoticias(request, env, ctx);
    return env.ASSETS.fetch(request);
  }
};
