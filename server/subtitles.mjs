import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { appOrigin } from './local-network.mjs';
import { MAX_SUBTITLE_BYTES, parseSrt, SrtError } from './srt.mjs';

const FILE_ID = /^[\w-]{10,200}$/;

class SubtitleError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function validFilename(value) {
  return typeof value === 'string' && value.length <= 255 && value.trim().length > 4
    && /\.srt$/i.test(value.trim()) && !/[\u0000-\u001f\u007f/\\]/.test(value);
}

function hash(filename, srt) {
  return createHash('sha256').update(JSON.stringify({ filename, srt })).digest('hex');
}

function metadata(stored) {
  return { subtitle: stored ? { filename: stored.filename, revision: stored.revision } : null };
}

async function storedSubtitle(filename) {
  try {
    const details = await stat(filename);
    if (!details.isFile() || details.size > MAX_SUBTITLE_BYTES * 3) throw new Error('Invalid file');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filename)));
    if (!value || value.version !== 1 || !validFilename(value.filename) || typeof value.srt !== 'string') throw new Error('Invalid file');
    const parsed = parseSrt(Buffer.from(value.srt));
    return { filename: value.filename, ...parsed, revision: hash(value.filename, parsed.srt) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new SubtitleError(500, 'SUBTITLE_UNREADABLE', 'Não foi possível ler a legenda salva. O arquivo anterior foi preservado.');
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_SUBTITLE_BYTES) throw new SrtError('A legenda excede o limite de 2 MB.', 413, 'SUBTITLE_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function save(directory, filename, value) {
  const temporary = path.join(directory, `.subtitle-${randomUUID()}.tmp`);
  let handle;
  try {
    await mkdir(directory, { recursive: true });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ version: 1, filename: value.filename, srt: value.srt }, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filename);
  } catch {
    throw new SubtitleError(500, 'SUBTITLE_WRITE_FAILED', 'Não foi possível salvar a legenda no computador. A legenda anterior foi preservada.');
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Per-video SRT storage shared by all clients of this personal installation. */
export function createSubtitlesMiddleware({ directory = path.resolve('.muvies') } = {}) {
  const storageDirectory = path.join(path.resolve(directory), 'subtitles');
  let queue = Promise.resolve();
  const serialized = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };

  return async function subtitlesMiddleware(req, res, next) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return next(); }
    if (!url.pathname.startsWith('/api/subtitles/')) return next();
    try {
      const origin = appOrigin(req);
      if (!origin) throw new SubtitleError(403, 'LOCAL_ONLY', 'Abra a legenda pelo endereço local ou da rede privada do Muvies.');
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
        throw new SubtitleError(403, 'CROSS_ORIGIN', 'As legendas só aceitam solicitações do próprio Muvies.');
      }
      if (req.headers.origin && req.headers.origin !== origin.origin) throw new SubtitleError(403, 'CROSS_ORIGIN', 'Origem da legenda inválida.');
      const match = url.pathname.match(/^\/api\/subtitles\/([\w-]+)(\/track\.vtt)?$/);
      if (!match || !FILE_ID.test(match[1])) throw new SubtitleError(404, 'SUBTITLE_NOT_FOUND', 'Legenda não encontrada.');
      const filename = path.join(storageDirectory, `${match[1]}.json`);
      if (match[2]) {
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.setHeader('Allow', 'GET, HEAD');
          throw new SubtitleError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
        }
        const current = await serialized(() => storedSubtitle(filename));
        if (!current) throw new SubtitleError(404, 'SUBTITLE_NOT_FOUND', 'Nenhuma legenda foi salva para este vídeo.');
        const requestedRevision = url.searchParams.get('revision');
        if (requestedRevision && requestedRevision !== current.revision) throw new SubtitleError(409, 'SUBTITLE_CONFLICT', 'A legenda foi atualizada. Recarregue o player para usar a versão atual.');
        res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Content-Length': Buffer.byteLength(current.vtt), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(req.method === 'HEAD' ? undefined : current.vtt);
      }
      if (req.method === 'GET') return send(res, 200, metadata(await serialized(() => storedSubtitle(filename))));
      if (!['PUT', 'DELETE'].includes(req.method)) {
        res.setHeader('Allow', 'GET, PUT, DELETE');
        throw new SubtitleError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
      }
      if (req.headers.origin !== origin.origin) throw new SubtitleError(403, 'CROSS_ORIGIN', 'A legenda só pode ser alterada pelo próprio Muvies.');
      const expected = req.headers['if-match']?.replace(/^"|"$/g, '');
      if (!expected) throw new SubtitleError(428, 'SUBTITLE_REVISION_REQUIRED', 'Recarregue a legenda antes de salvar ou remover.');
      let uploaded;
      if (req.method === 'PUT') {
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/x-subrip') throw new SubtitleError(415, 'INVALID_SUBTITLE', 'Envie um arquivo SRT com o tipo application/x-subrip.');
        let originalName;
        try { originalName = decodeURIComponent(req.headers['x-subtitle-filename'] || ''); }
        catch { throw new SubtitleError(400, 'INVALID_SUBTITLE', 'O nome do arquivo SRT é inválido.'); }
        if (!validFilename(originalName)) throw new SubtitleError(400, 'INVALID_SUBTITLE', 'Escolha um arquivo com extensão .srt e um nome válido.');
        const parsed = parseSrt(await readBody(req));
        const name = originalName.trim();
        uploaded = { filename: name, ...parsed, revision: hash(name, parsed.srt) };
      }
      const result = await serialized(async () => {
        const current = await storedSubtitle(filename);
        if ((current?.revision || '0') !== expected) throw new SubtitleError(409, 'SUBTITLE_CONFLICT', 'A legenda foi atualizada em outro aparelho. Recarregue antes de salvar ou remover.');
        if (req.method === 'DELETE') {
          try { await unlink(filename); }
          catch (error) { if (error.code !== 'ENOENT') throw new SubtitleError(500, 'SUBTITLE_WRITE_FAILED', 'Não foi possível remover a legenda. O arquivo foi preservado.'); }
          return { subtitle: null };
        }
        await save(storageDirectory, filename, uploaded);
        return metadata(uploaded);
      });
      send(res, 200, result);
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      if (error instanceof SubtitleError || error instanceof SrtError) send(res, error.status, { code: error.code, message: error.message });
      else send(res, 500, { code: 'SUBTITLE_UNAVAILABLE', message: 'Não foi possível acessar a legenda. Os arquivos existentes foram preservados.' });
    }
  };
}
