# Governanca Fase 1 - suporte e equipe paroquial

## Suporte atual

- O banco aceita `role = 'admin'` em `parish_users`, descrito como suporte.
- Nao ha `superadmin`, `support` global ou tabela separada de suporte central no schema atual.
- O `admin` atual so existe como conceito vinculado a uma `parish_id`. Sem vinculo em `parish_users`, ele nao entra no tenant.
- O frontend chama esse papel de `Suporte` e libera as mesmas telas amplas de padre.

## Acesso cross-tenant atual

- As regras de RLS e `can_access(p_parish, p_area)` sempre validam `auth.uid()` junto da `parish_id`.
- Um `admin` vinculado a uma paroquia acessa os dados daquela paroquia.
- Nao foi encontrado caminho global para um suporte ler todas as paroquias automaticamente.
- Se um mesmo usuario for vinculado manualmente a varias paroquias, ele podera alternar entre esses tenants como membro de cada um.

## Equipe da paroquia

- A funcao `staff_list_parish_team(p_parish uuid)` lista a equipe da propria paroquia.
- Quem pode chamar nesta fase: padre, secretaria e admin vinculado ao mesmo `p_parish`.
- PASCOM e anonimo nao recebem a lista.
- Retorno minimo: `display_name`, `email`, `role`, `active`.
- Nao retorna `user_id`, `parish_id`, datas internas, metadados de Auth, tokens, IP ou senha.

## Modelo recomendado

- Suporte Central deve ser separado de usuario paroquial.
- Padre, secretaria e PASCOM continuam como papeis pastorais/operacionais da propria paroquia.
- Para autonomia futura, preferir um marcador de capacidade administrativa paroquial, por exemplo `is_parish_admin = true`, em vez de transformar todo padre/secretaria em administrador automaticamente.
- O Administrador Paroquial nunca deve poder criar Suporte Central nem escolher outro tenant.

## Proximo passo

Implementar convites por e-mail, ainda dentro do proprio tenant:

- botao `Convidar pessoa`;
- escolha de perfil: Padre, Secretaria ou PASCOM;
- convite por e-mail;
- senha definida pelo proprio usuario;
- desativacao de acesso;
- historico minimo: quem convidou, quem desativou, quando e qual perfil;
- validacao no backend para impedir outro tenant e impedir criacao de Suporte Central.

## Futuro painel do suporte central

O painel central deve mostrar saude operacional, nao conteudo pastoral privado por padrao:

- tenant, status, quantidade de usuarios;
- ultimo uso, erros, servicos habilitados e integracoes;
- estado de Secretaria 24h e configuracoes tecnicas;
- sem acesso automatico a notas pastorais, intencoes privadas ou dados sensiveis desnecessarios.
