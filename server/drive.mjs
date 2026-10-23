import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fetchPublicDriveOriginal, PublicDriveError, videoContentType } from './public-drive.mjs';
import { appOrigin, isLoopbackRequest } from './local-network.mjs';

const SESSION_COOKIE = 'muvies_drive_session';
const FILE_ID = /^[\w-]{10,200}$/;
const RESOURCE_KEY = /^[\w-]{1,256}$/;
const COOKIE_PATH = '/api/drive';

function sendError(res, status, code, message, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Muvies-Error': code,
    ...headers,
  });
  res.end(JSON.stringify({ code, message }));
}

function sendJson(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function cookieId(req) {
  return req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}

function trustedDownloadUrl(url) {
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
    && ['google.com', 'googleusercontent.com', 'googleapis.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Local middleware, shared by Vite development and preview servers. */
export function createDriveMiddleware({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  // Tokens stay in memory, never on disk, in media URLs, logs or browser storage.
  const sessions = new Map();
  const clearCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=0`;

  return async function driveMiddleware(req, res, next) {
    if (!req.url?.startsWith('/api/drive/')) return next();
    try {
      const origin = appOrigin(req);
      if (!origin) return sendError(res, 403, 'LOCAL_ONLY', 'Abra o Muvies pelo endereço local ou da sua rede privada.');
      const loopback = isLoopbackRequest(req);
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
        return sendError(res, 403, 'CROSS_ORIGIN', 'Abra o Muvies diretamente no servidor local.');
      }
      const url = new URL(req.url, origin);
      for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
      const id = cookieId(req);
      const session = loopback && id ? sessions.get(id) : undefined;

      if (url.pathname === '/api/drive/session') {
        if (!loopback) return sendError(res, 403, 'OAUTH_LOCAL_ONLY', 'A conexão Google deve ser feita no computador que executa o Muvies.');
        if (req.method === 'GET') return sendJson(res, { connected: !!session, expiresAt: session?.expiresAt || null });
        if (!['POST', 'DELETE'].includes(req.method)) return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', { Allow: 'GET, POST, DELETE' });
        if (req.headers.origin !== origin.origin) return sendError(res, 403, 'CROSS_ORIGIN', 'Origem da autorização inválida.');
        if (req.method === 'DELETE') {
          if (id) sessions.delete(id);
          res.setHeader('Set-Cookie', clearCookie);
          return sendJson(res, { connected: false });
        }
        if (!req.headers['content-type']?.startsWith('application/json')) return sendError(res, 415, 'INVALID_SESSION', 'Envie a autorização como JSON.');
        let data;
        try { data = await readJson(req); }
        catch { return sendError(res, 400, 'INVALID_SESSION', 'Autorização inválida.'); }
        if (typeof data.accessToken !== 'string' || !/^[\x21-\x7e]{20,8192}$/.test(data.accessToken)) return sendError(res, 400, 'INVALID_SESSION', 'Autorização inválida.');
        const seconds = Number(data.expiresIn ?? 3600);
        if (!Number.isFinite(seconds) || seconds < 1) return sendError(res, 400, 'INVALID_SESSION', 'A autorização expirou. Conecte novamente.');
        const ttl = Math.min(seconds, 3600);
        if (id) sessions.delete(id);
        if (sessions.size >= 100) return sendError(res, 429, 'TOO_MANY_SESSIONS', 'Muitas sessões locais abertas. Reinicie o servidor.');
        const newId = randomBytes(32).toString('base64url');
        const expiresAt = now() + ttl * 1000;
        sessions.set(newId, { accessToken: data.accessToken, expiresAt });
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${newId}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=${Math.floor(ttl)}`);
        return sendJson(res, { connected: true, expiresAt });
      }

      const match = url.pathname.match(/^\/api\/drive\/media\/([\w-]+)$/);
      if (!match || !FILE_ID.test(match[1])) return sendError(res, 404, 'NOT_FOUND', 'Vídeo não encontrado.');
      if (!['GET', 'HEAD'].includes(req.method)) return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', { Allow: 'GET, HEAD' });
      const fileId = match[1];
      const resourceKey = url.searchParams.get('resourceKey');
      if (resourceKey && !RESOURCE_KEY.test(resourceKey)) return sendError(res, 400, 'INVALID_RESOURCE_KEY', 'Chave de compartilhamento inválida.');
      const range = req.headers.range;
      if (range && !/^bytes=(?:\d{1,20}-\d{0,20}|-\d{1,20})$/.test(range)) return sendError(res, 416, 'INVALID_RANGE', 'Trecho de vídeo inválido.');

      // The API returns the original, without relying on Drive's preview transcode.
      // Public links can work anonymously if Google exposes a direct download.
      const source = session
        ? new URL(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`)
        : new URL(`https://drive.google.com/uc?export=download&id=${fileId}`);
      if (!session && resourceKey) source.searchParams.set('resourcekey', resourceKey);
      const controller = new AbortController();
      const abort = () => controller.abort();
      res.once('close', abort);
      const timeout = setTimeout(abort, 30000);
      let upstream;
      try {
        let destination = source;
        for (let redirects = 0; session && redirects <= 5; redirects++) {
          const headers = new Headers({ 'Accept-Encoding': 'identity' });
          if (range) headers.set('Range', range);
          if (session && destination.hostname === 'www.googleapis.com') {
            headers.set('Authorization', `Bearer ${session.accessToken}`);
            if (resourceKey) headers.set('X-Goog-Drive-Resource-Keys', `${fileId}/${resourceKey}`);
          }
          upstream = await fetchImpl(destination, { headers, redirect: 'manual', signal: controller.signal });
          if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
          const location = upstream.headers.get('location');
          await upstream.body?.cancel();
          if (!location || redirects === 5) throw new Error('Invalid redirect');
          destination = new URL(location, destination);
          if (!trustedDownloadUrl(destination)) throw new Error('Untrusted redirect');
        }
        const rejectedStatus = session ? upstream?.status : null;
        if (!session || [401, 403, 404].includes(rejectedStatus)) {
          if (session) {
            await upstream.body?.cancel();
            if (rejectedStatus === 401) {
              sessions.delete(id);
              res.setHeader('Set-Cookie', clearCookie);
            }
          }
          const publicSource = new URL(`https://drive.google.com/uc?export=download&id=${fileId}`);
          if (resourceKey) publicSource.searchParams.set('resourcekey', resourceKey);
          try {
            upstream = await fetchPublicDriveOriginal({ source: publicSource, fileId, resourceKey, range,
              signal: controller.signal, fetchImpl, userAgent: req.headers['user-agent'] });
          } catch (error) {
            if (error instanceof PublicDriveError && ['AUTH_REQUIRED', 'PUBLIC_DOWNLOAD_UNAVAILABLE'].includes(error.code)) {
              if (rejectedStatus === 403) throw new PublicDriveError(403, 'DRIVE_FORBIDDEN', 'Esta conta não tem permissão de leitura do arquivo original. Confira o acesso e a autorização do Drive.');
              if (rejectedStatus === 404) throw new PublicDriveError(404, 'DRIVE_NOT_FOUND', 'Arquivo não encontrado ou sem acesso nesta conta Google.');
            }
            throw error;
          }
        }
        clearTimeout(timeout);
        if (!upstream) throw new Error('No upstream response');
        if (!upstream.ok) {
          const status = upstream.status;
          const contentRange = upstream.headers.get('content-range');
          await upstream.body?.cancel();
          if (status === 401 || (!session && [403, 404].includes(status))) {
            if (id) sessions.delete(id);
            res.setHeader('Set-Cookie', clearCookie);
            return sendError(res, 401, 'AUTH_REQUIRED', 'Conecte o Google Drive para ler o arquivo original.');
          }
          if (status === 403) return sendError(res, 403, 'DRIVE_FORBIDDEN', 'Sua conta não pode baixar este arquivo ou o Drive limitou os downloads. Confira as permissões no Drive.');
          if (status === 404) return sendError(res, 404, 'DRIVE_NOT_FOUND', 'Arquivo não encontrado ou sem acesso nesta conta Google.');
          if (status === 416) return sendError(res, 416, 'INVALID_RANGE', 'Trecho fora do arquivo.', contentRange ? { 'Content-Range': contentRange } : {});
          if (status === 429) return sendError(res, 429, 'DRIVE_LIMIT', 'O Drive limitou os downloads. Aguarde e tente novamente.');
          return sendError(res, 502, 'DRIVE_UNAVAILABLE', 'Não foi possível receber o arquivo original do Google Drive.');
        }
        const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
        if (!videoContentType(contentType)) {
          await upstream.body?.cancel();
          return sendError(res, session ? 415 : 401, session ? 'NOT_VIDEO' : 'AUTH_REQUIRED', session
            ? 'O Drive não retornou um arquivo de vídeo reproduzível.'
            : 'Este link requer autorização ou confirmação de download. Conecte o Drive para ler o original pela API.');
        }
        if (!upstream.body) throw new Error('Empty response');
        const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          const value = upstream.headers.get(name);
          if (value) headers[name] = value;
        }
        res.writeHead(upstream.status, headers);
        if (req.method === 'HEAD') { await upstream.body.cancel(); return res.end(); }
        // Backpressure and cancellation keep movie-sized responses out of memory.
        await pipeline(Readable.fromWeb(upstream.body), res);
      } catch (error) {
        if (!res.headersSent && !res.destroyed && error instanceof PublicDriveError) sendError(res, error.status, error.code, error.message, error.headers);
        else if (!res.headersSent && !res.destroyed) sendError(res, 502, 'DRIVE_UNAVAILABLE', 'Não foi possível transmitir o original. Verifique sua conexão e tente novamente.');
        else if (!res.destroyed) res.destroy();
      } finally {
        clearTimeout(timeout);
        controller.abort();
        res.off('close', abort);
      }
    } catch {
      if (!res.headersSent && !res.destroyed) sendError(res, 400, 'INVALID_REQUEST', 'Solicitação inválida.');
    }
  };
}
