import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { appOrigin } from './local-network.mjs';
import { IMAGE_URL } from './images.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const FILE_ID = /^[\w-]{10,200}$/;
const RESOURCE_KEY = /^[\w-]{1,256}$/;

class LibraryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid() {
  return new LibraryError(400, 'INVALID_LIBRARY', 'A lista de vídeos é inválida. Nenhum link foi alterado.');
}

function text(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value);
}

function normalizeVideos(value) {
  if (!Array.isArray(value) || value.length > 5000) throw invalid();
  const videos = [];
  const ids = new Map();
  const files = new Set();
  for (const video of value) {
    if (!video || typeof video !== 'object' || video.source !== 'drive'
      || !text(video.id, 256) || !text(video.title, 1000) || !text(video.genre, 128)
      || typeof video.driveId !== 'string' || !FILE_ID.test(video.driveId)) throw invalid();
    if (video.resourceKey !== undefined && (typeof video.resourceKey !== 'string' || !RESOURCE_KEY.test(video.resourceKey))) throw invalid();
    if (video.duration !== undefined && !text(video.duration, 64)) throw invalid();
    if (video.director !== undefined && !text(video.director, 200)) throw invalid();
    if (video.year !== undefined && (typeof video.year !== 'string' || !/^\d{4}$/.test(video.year))) throw invalid();
    if (video.country !== undefined && !text(video.country, 128)) throw invalid();
    if (video.description !== undefined && (typeof video.description !== 'string' || !video.description.trim() || video.description.length > 3000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(video.description))) throw invalid();
    if (video.favorite !== undefined && typeof video.favorite !== 'boolean') throw invalid();
    for (const field of ['poster', 'cover']) {
      if (video[field] !== undefined && (typeof video[field] !== 'string' || !IMAGE_URL.test(video[field]))) throw invalid();
    }
    if (ids.has(video.id) && ids.get(video.id) !== video.driveId) throw invalid();
    if (ids.has(video.id) || files.has(video.driveId)) continue;
    ids.set(video.id, video.driveId);
    files.add(video.driveId);
    videos.push({
      id: video.id,
      title: video.title.trim(),
      genre: video.genre.trim(),
      source: 'drive',
      driveId: video.driveId,
      ...(video.resourceKey ? { resourceKey: video.resourceKey } : {}),
      url: `https://drive.google.com/file/d/${video.driveId}/preview`,
      ...(video.duration ? { duration: video.duration } : {}),
      ...(video.director ? { director: video.director.trim() } : {}),
      ...(video.year ? { year: video.year } : {}),
      ...(video.country ? { country: video.country.trim() } : {}),
      ...(video.description ? { description: video.description.trim() } : {}),
      ...(video.favorite ? { favorite: true } : {}),
      ...(video.poster ? { poster: video.poster } : {}),
      ...(video.cover ? { cover: video.cover } : {}),
    });
  }
  return videos;
}

function revision(videos) {
  return createHash('sha256').update(JSON.stringify(videos)).digest('hex');
}

async function readLibrary(filename) {
  try {
    const metadata = await stat(filename);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) throw new Error('Invalid library file');
    const value = JSON.parse(await readFile(filename, 'utf8'));
    if (!value || value.version !== 1) throw new Error('Unknown library format');
    const videos = normalizeVideos(value.videos);
    return { videos, revision: revision(videos) };
  } catch (error) {
    if (error.code === 'ENOENT') return { videos: [], revision: '0' };
    throw new LibraryError(500, 'LIBRARY_UNREADABLE', 'Não foi possível ler a biblioteca salva. O arquivo original foi preservado.');
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new LibraryError(413, 'LIBRARY_TOO_LARGE', 'A biblioteca excede o limite de 2 MB. Nenhum link foi alterado.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw invalid(); }
}

async function writeLibrary(directory, filename, videos) {
  const content = `${JSON.stringify({ version: 1, videos }, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_BYTES) {
    throw new LibraryError(413, 'LIBRARY_TOO_LARGE', 'A biblioteca excede o limite de 2 MB. Nenhum link foi alterado.');
  }
  const temporary = path.join(directory, `.library-${randomUUID()}.tmp`);
  let handle;
  try {
    await mkdir(directory, { recursive: true });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filename);
  } catch {
    throw new LibraryError(500, 'LIBRARY_WRITE_FAILED', 'Não foi possível salvar os links no computador. A biblioteca anterior foi preservada.');
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

/** Durable personal-library storage for the local Vite server. */
export function createLibraryMiddleware({ directory = path.resolve('.muvies') } = {}) {
  const libraryDirectory = path.resolve(directory);
  const filename = path.join(libraryDirectory, 'library.json');
  let queue = Promise.resolve();
  const serialized = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };

  return async function libraryMiddleware(req, res, next) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch { return next(); }
    if (url.pathname !== '/api/library') return next();

    try {
      const origin = appOrigin(req);
      if (!origin) {
        throw new LibraryError(403, 'LOCAL_ONLY', 'Abra a biblioteca pelo endereço local ou da rede privada do Muvies.');
      }
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
        throw new LibraryError(403, 'CROSS_ORIGIN', 'A biblioteca só aceita solicitações do próprio Muvies.');
      }
      if (req.method === 'GET') return send(res, 200, await serialized(() => readLibrary(filename)));
      if (req.method !== 'PUT') {
        res.setHeader('Allow', 'GET, PUT');
        throw new LibraryError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
      }
      if (req.headers.origin !== origin.origin) throw new LibraryError(403, 'CROSS_ORIGIN', 'A biblioteca só pode ser alterada pelo próprio Muvies.');
      if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError(415, 'INVALID_LIBRARY', 'Envie a lista de vídeos como JSON.');
      const match = req.headers['if-match']?.replace(/^"|"$/g, '');
      if (!match) throw new LibraryError(428, 'LIBRARY_REVISION_REQUIRED', 'Recarregue a biblioteca antes de salvar.');
      const data = await readBody(req);
      const videos = normalizeVideos(data?.videos);
      const result = await serialized(async () => {
        const current = await readLibrary(filename);
        if (current.revision !== match) {
          throw new LibraryError(409, 'LIBRARY_CONFLICT', 'A biblioteca foi atualizada em outra janela. Recarregue antes de salvar para preservar todos os links.');
        }
        await writeLibrary(libraryDirectory, filename, videos);
        return { videos, revision: revision(videos) };
      });
      send(res, 200, result);
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      if (error instanceof LibraryError) send(res, error.status, { code: error.code, message: error.message });
      else send(res, 500, { code: 'LIBRARY_UNAVAILABLE', message: 'Não foi possível acessar a biblioteca. Os links existentes foram preservados.' });
    }
  };
}
