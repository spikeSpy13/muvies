import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { appOrigin } from './local-network.mjs';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_URL = /^\/api\/images\/[a-f0-9]{64}\.webp$/;
const IMAGE_FILE = /^\/api\/images\/([a-f0-9]{64}\.webp)$/;

class ImageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readImage(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_IMAGE_BYTES) throw new ImageError(413, 'Escolha uma imagem de até 10 MB.');
    chunks.push(chunk);
  }
  if (!length) throw new ImageError(400, 'O arquivo de imagem está vazio.');
  try {
    const image = sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported format');
    // Decode and re-encode actual pixels: discard metadata and keep only a still image.
    return await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw new ImageError(400, 'Escolha uma imagem JPG, PNG ou WebP válida, com até 40 megapixels.');
  }
}

async function store(directory, filename, bytes) {
  const temporary = path.join(directory, `.image-${randomUUID()}.tmp`);
  let handle;
  try {
    await mkdir(directory, { recursive: true });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path.join(directory, filename));
  } catch {
    throw new ImageError(500, 'Não foi possível salvar a imagem no computador. Tente novamente.');
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export function createImagesMiddleware({ directory = path.resolve('.muvies') } = {}) {
  const storage = path.join(path.resolve(directory), 'images');
  return async function imagesMiddleware(req, res, next) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return next(); }
    if (url.pathname !== '/api/images' && !url.pathname.startsWith('/api/images/')) return next();
    try {
      const origin = appOrigin(req);
      if (!origin) throw new ImageError(403, 'Abra as imagens pelo endereço local ou da rede privada do Muvies.');
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])
        || req.headers.origin && req.headers.origin !== origin.origin) throw new ImageError(403, 'Origem da imagem inválida.');
      if (url.pathname === '/api/images') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new ImageError(405, 'Método não permitido.'); }
        if (req.headers.origin !== origin.origin) throw new ImageError(403, 'Envie a imagem pelo próprio Muvies.');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.headers['content-type']?.split(';')[0].trim().toLowerCase())) {
          throw new ImageError(415, 'Escolha uma imagem JPG, PNG ou WebP.');
        }
        const bytes = await readImage(req);
        const filename = `${createHash('sha256').update(bytes).digest('hex')}.webp`;
        await store(storage, filename, bytes);
        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ url: `/api/images/${filename}` }));
      }
      const match = url.pathname.match(IMAGE_FILE);
      if (!match) throw new ImageError(404, 'Imagem não encontrada.');
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); throw new ImageError(405, 'Método não permitido.'); }
      const filename = path.join(storage, match[1]);
      let info;
      try { info = await stat(filename); }
      catch (error) { if (error.code === 'ENOENT') throw new ImageError(404, 'Imagem não encontrada.'); throw error; }
      if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new ImageError(500, 'Não foi possível ler a imagem salva.');
      const bytes = req.method === 'HEAD' ? undefined : await readFile(filename);
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': info.size, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes);
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(error instanceof ImageError ? error.status : 500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ message: error instanceof ImageError ? error.message : 'Não foi possível acessar a imagem. Tente novamente.' }));
    }
  };
}
