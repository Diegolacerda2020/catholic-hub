// Atualiza o espelho das notícias da Arquidiocese de BH (usado pelo GitHub Actions, de hora em hora).
// Uso: NODE_EXTRA_CA_CERTS=scripts/certs/globalsign-rsa-ov-ssl-ca-2018.pem node scripts/atualizar-noticias.mjs <destino.json>
//
// Por que existe: o servidor de arquidiocesebh.org.br envia o certificado intermediário errado, e o
// runtime de Workers do Cloudflare recusa a conexão. Aqui o Node recebe o intermediário correto
// (GlobalSign RSA OV SSL CA 2018, público) e a verificação TLS continua ligada normalmente.
// Mesma extração do Worker (worker/noticias.js). Se a fonte falhar, o arquivo anterior é mantido.
import fs from 'node:fs';
import { buscarNoticias } from '../worker/noticias.js';

const destino = process.argv[2];
if (!destino){ console.error('Informe o arquivo de destino.'); process.exit(2); }

let anterior = null;
try { anterior = JSON.parse(fs.readFileSync(destino, 'utf8')); } catch(e){}

try {
  const novo = await buscarNoticias(fetch);
  if (anterior && JSON.stringify(anterior.itens) === JSON.stringify(novo.itens)){
    console.log(`Sem novidades (${novo.itens.length} notícias, fonte: ${novo.fonte}).`);
  } else {
    fs.writeFileSync(destino, JSON.stringify(novo, null, 1) + '\n');
    console.log(`Atualizado: ${novo.itens.length} notícias (fonte: ${novo.fonte}).`);
  }
} catch(e){
  // Mantém o último arquivo válido; o aviso aparece no resumo da execução no GitHub.
  console.log(`::warning::Fonte da Arquidiocese indisponível; mantendo as últimas notícias válidas. ${e.message}`);
}
