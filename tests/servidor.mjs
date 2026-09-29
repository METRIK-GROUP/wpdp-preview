// tests/servidor.mjs
// Servidor estático mínimo para os testes (sem dependência). Serve a raiz do repo.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORTA = Number(process.env.PORTA ?? 4173);
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const caminho = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    let arquivo = normalize(join(RAIZ, caminho));
    if (!arquivo.startsWith(RAIZ)) {
      res.writeHead(403).end();
      return;
    }
    if (caminho.endsWith('/')) arquivo = join(arquivo, 'index.html');
    const corpo = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
    res.end(corpo);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
}).listen(PORTA, () => {
  console.info(`servidor de testes em http://localhost:${PORTA}`);
});
