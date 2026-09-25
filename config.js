/* Configuração do banco compartilhado (Supabase).
   Deixe em branco para usar o modo demonstração (dados só neste aparelho).

   Onde achar: painel do Supabase > Project Settings > API
   - url:     "Project URL"
   - anonKey: chave "anon public" (ou "Publishable key"). Ela é pública
              por natureza e pode ficar no site: quem protege os dados
              são as regras de acesso (RLS) do schema.sql.

   NUNCA coloque aqui a chave "service_role" / "secret". */
window.CENTRAL_CONFIG = {
  supabase: {
    url: '',
    anonKey: ''
  },
  parishSlug: 'santo-antonio-jaragua'
};
