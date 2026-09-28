# Reconciliação do Diretório com o Catálogo 2026 (gerado)

Gerado por `scripts/importar-catalogo.mjs` a partir de `catalogo-01.07.26.pdf`. Não edite à mão.

| | |
|---|---:|
| Fichas na 7.13 (paróquias, curato, área pastoral) | 278 |
| — das quais paróquias (territoriais, pessoais, militar) | 276 |
| Santuários na 7.14 | 15 |
| Nomes na relação oficial por forania (7.15) casados com uma ficha | 283 |
| Nomes da 7.15 sem ficha | 3 |
| Casos ambíguos (não unidos) | 1 |
| Paróquias no diretório | 287 |
| Santuários que também são paróquia (um registro só) | 11 |
| Santuários independentes | 4 |
| Duplicatas (código, código de santuário ou slug) | 0 |
| **Total de registros no diretório** | **293** |

## Por que São Paulo da Cruz (e outras) não entraram antes
As paróquias que são santuários **não têm ficha na 7.13**: o catálogo põe a ficha delas só na 7.14
(Santuários). O importador anterior lia apenas a 7.13. Agora a 7.14 é lida e a 7.15 (relação oficial de
paróquias por forania) confere nome a nome.

## Santuários que também são paróquia
- Santuário Arquidiocesano Nossa Senhora da Piedade (Serra da Piedade) (Cód. 240), Forania Nossa Senhora do Bom Sucesso — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano Nossa Senhora da Saúde (Cód. 099), Forania Nossa Senhora da Saúde — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano da Santíssima Eucaristia - Nossa Senhora da Boa Viagem (Cód. 166), Forania São José — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano Nossa Senhora da Conceição dos Pobres (Lagoinha) (Cód. 032), Forania Nossa Senhora da Paz — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano Nossa Senhora de Fátima (Cód. 169), Forania São José — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano Nossa Senhora da Conceição Aparecida (Cód. 222), Forania Nossa Senhora da Glória — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano Santa Luzia (Cód. 046), Forania Santa Luzia — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano São José (Cód. 156), Forania São José — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano São Judas Tadeu (Bairro da Graça) (Cód. 042), Forania Nossa Senhora das Dores — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano Santo Antônio (Roça Grande) (Cód. 004), Forania São Sebastião (Sabará) — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só
- Santuário Arquidiocesano São Paulo da Cruz (Barreiro) (Cód. 159), Forania São Paulo da Cruz — na relação oficial de paróquias (7.15) e sem ficha na 7.13: paróquia e santuário, um registro só

## Santuários independentes
- Santuário Arquidiocesano Nossa Senhora do Rosário (Cód. 331) — não aparece como paróquia na 7.15 nem casa com ficha da 7.13
- Santuário Arquidiocesano da Saúde e da Paz (Cód. 057) — não aparece como paróquia na 7.15 nem casa com ficha da 7.13
- Santuário de Schoenstatt “Tabor da Liberdade” (Cód. —) — não aparece como paróquia na 7.15 nem casa com ficha da 7.13
- Santuário Arquidiocesano São Francisco de Assis (Cód. 283) — ambíguo (ver acima)

## Ambíguos (não unidos automaticamente)
- Santuário Arquidiocesano São Francisco de Assis × São Francisco de Assis (Cod. 094): mesmo nome e forania, endereço diferente (Av. Dr. Otacílio Negrão de Lima, 3000 × Rua Pe. Leopoldo Mertens, 1121): não unido

## Nomes casados com grafia diferente entre as seções (conferidos, com evidência)
- Forania Cristo Sol Nascente: 7.15 "nossa senhora aparecida e sao miguel" = ficha Nossa Senhora Aparecida e São Miguel (Cod. 012) — nome igual, mas a ficha (7.13) aponta outra forania: Nossa Senhora do Sagrado Coração
- Forania Nossa Senhora da Glória: 7.15 "nossa senhora da conceicao (novo eldorado)" = ficha Santuário Arquidiocesano Nossa Senhora da Conceição Aparecida (Cód. 222) — variação de grafia (mesma forania, nome contido, mesmo bairro/cidade)
- Forania São Gonçalo: 7.15 "santa edwiges (bernardo monteiro)" = ficha São Norberto e Santa Edwiges (Cod. 262) — variação de grafia (mesma forania, nome contido, mesmo bairro/cidade)
- Forania Santo Antônio (Pampulha): 7.15 "santa catarina de laboure" = ficha Santa Catarina Labouré (Cod. 190) — variação de grafia (mesma forania, nome contido)
- Forania São Dimas: 7.15 "nossa senhora perpetuo socorro e sao damiao de molokai" = ficha Nossa Senhora do Perpétuo Socorro e São Damião de Molokai (Cod. 214) — variação de grafia (mesma forania, nome contido)
- Forania Santa Efigênia: 7.15 "santa efigenia (santa efigenia)" = ficha Santa Efigênia dos Militares (Cod. 096) — variação de grafia (mesma forania, nome contido, mesmo bairro/cidade)

## Nomes da relação oficial (7.15) sem ficha na 7.13/7.14 — PENDENTES de decisão manual (não importados)
- Forania São Gonçalo (RENSA): "sao norberto (bela vista)" — na relação oficial (7.15), sem ficha na 7.13/7.14 que case com segurança: não importado. Outras fichas sem par na mesma forania (listadas só para conferência; NÃO é correspondência): ficha Sagrado Coração de Jesus (Cod. 333, Icaivera), que também não está na 7.15; ficha São Luiz Gonzaga (Cod. 335, Industrial São Luiz), que também não está na 7.15.
- Forania São Francisco das Chagas (RENSE): "sagrados coracoes" — na relação oficial (7.15), sem ficha na 7.13/7.14 que case com segurança: não importado. Outras fichas sem par na mesma forania (listadas só para conferência; NÃO é correspondência): Santuário Arquidiocesano da Saúde e da Paz (Cód. 057), santuário da mesma forania.
- Forania São João Bosco (RENSE): "area pastoral nossa senhora aparecida" — na relação oficial (7.15), sem ficha na 7.13/7.14 que case com segurança: não importado.

Reexame com todas as ocorrências no Catálogo (páginas, endereços, códigos e evidências): `docs/diretorio-pendencias.md`.

## Fichas da 7.13 que não aparecem na 7.15 (importadas normalmente; a 7.15 parece não ter as criações recentes)
- Maria, Mãe da Esperança (Cod. —, paroquia_territorial, forania Nossa Senhora da Conceição, bairro Amazonas)
- Nossa Senhora Rainha dos Anjos (Cod. 301, paroquia_territorial, forania —, bairro Alphaville)
- Sagrado Coração de Jesus (Cod. 333, paroquia_territorial, forania São Gonçalo, bairro Icaivera)
- São Luiz Gonzaga (Cod. 335, paroquia_territorial, forania São Gonçalo, bairro Industrial São Luiz)

## Fora do escopo desta importação
- Forania São João Bosco: Capela Curial Santo Expedito
- Capelas curiais, capelas especiais, capela militar e capelanias (7.14 b–e).

## Códigos
- `catalog_code`: "Cod." da ficha de **paróquia** (7.13). Nulo para quem só tem ficha de santuário, para a paróquia militar e para a área pastoral (o catálogo não informa).
- `sanctuary_code`: "Cód." da ficha de **santuário** (7.14).
- O número de ordem de cada relação ("1.", "2."…) serve só para conferir que nenhum item foi pulado; não é guardado.

## Privacidade (minimização)
- **Nomes de responsáveis NÃO são importados**: pároco, vigário, reitor, pró-reitor, administrador, cura,
  assistente, capelão — nem no banco, nem no seed, nem neste relatório, nem no JSON. O diretório guarda só
  dados institucionais. 289 fichas trazem um responsável no Catálogo; nenhum nome foi guardado.
- **Contatos retidos para revisão manual** (não publicados, com evidência de serem pessoais; nunca pelo formato):
  - Sagrado Coração de Jesus (Siríacos Católicos) (Belo Horizonte), Cód. 197: e-mail — e-mail contém o nome do responsável listado
  O valor não aparece aqui de propósito: confira na ficha do Catálogo pelo código e, se for institucional,
  inclua à mão depois da revisão.
