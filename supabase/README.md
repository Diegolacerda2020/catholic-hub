# Banco do piloto (Supabase)

## Como aplicar
1. Crie um projeto no Supabase (ou use um existente) para o piloto.
2. Cole o conteúdo de `schema.sql` no SQL Editor do projeto e rode.
3. Crie os dois primeiros usuários em Authentication → Users (padre e secretaria), com e-mail e senha.
4. Vincule cada usuário à paróquia rodando o `insert into parish_users` comentado no final do `schema.sql`, com o UUID de cada usuário.

## O que fica sincronizado
Só o que é dado da paróquia: avisos, pessoas, modelos de mensagem, intenções, velas, log de uso. Estado de tela (aba aberta, rascunho em digitação, filtro de busca) continua só no aparelho — não sincroniza.

## O que ainda falta (não bloqueia a demonstração do piloto)
O pedido de intenção de missa e o acender de vela na página pública são hoje enviados por qualquer visitante, sem login. Isso ainda não tem um caminho seguro de escrita no Supabase (a página pública só tem permissão de leitura, via `get_public_parish`). Enquanto isso não é feito, esses dois formulários continuam funcionando localmente no protótipo, mas o pedido não chega à secretaria de outro aparelho — ela precisa ver no mesmo aparelho onde a pessoa preencheu. Pode virar uma etapa curta separada quando o piloto básico (avisos + mensagens) estiver validado.
