import { parse } from 'node-html-parser';
import { CookieJar } from 'tough-cookie';

const MAX_HTML_BYTES = 256 * 1024;
const MAX_REQUESTS = 8;
const SAFE_VALUE = /^[\w-]{1,256}$/;

export class PublicDriveError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function videoContentType(value = '') {
  const type = value.toLowerCase().split(';')[0].trim();
  return type.startsWith('video/') || ['application/octet-stream', 'application/binary'].includes(type);
}

export function trustedGoogleUrl(url) {
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
    && ['google.com', 'googleusercontent.com', 'googleapis.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}

function unavailable() {
  return new PublicDriveError(502, 'PUBLIC_DOWNLOAD_UNAVAILABLE', 'O Google não liberou o download público deste link. Confira se o download funciona no Drive sem login.');
}

async function readHtml(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) throw unavailable();
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel(); }
}

// Only the ordinary public-file confirmation is supported. Never submit a login
// form, change the requested file, or acknowledge a malware/abuse restriction.
function confirmationUrl(candidate, fileId, resourceKey) {
  if (!trustedGoogleUrl(candidate)) return null;
  if (!((candidate.hostname === 'drive.google.com' && candidate.pathname === '/uc')
    || (candidate.hostname === 'drive.usercontent.google.com' && candidate.pathname === '/download'))) return null;
  if (candidate.searchParams.getAll('id').length !== 1 || candidate.searchParams.get('id') !== fileId
    || candidate.searchParams.get('export') !== 'download' || !SAFE_VALUE.test(candidate.searchParams.get('confirm') || '')) return null;
  if ([...candidate.searchParams.keys()].some(key => /abuse/i.test(key))) return null;
  const next = new URL(candidate.origin + candidate.pathname);
  for (const name of ['id', 'export', 'confirm', 'uuid', 'resourcekey', 'authuser']) {
    const value = candidate.searchParams.get(name);
    if (value !== null) {
      if (!SAFE_VALUE.test(value)) return null;
      next.searchParams.set(name, value);
    }
  }
  if (resourceKey) next.searchParams.set('resourcekey', resourceKey);
  return next;
}

function inspectPage(html, destination, fileId, resourceKey) {
  const document = parse(html);
  const messages = parse(html);
  // Google echoes the user-controlled filename in its warning page. A movie
  // called "Download Quota.mp4" must not be mistaken for a provider error.
  for (const node of messages.querySelectorAll('title,script,style,.uc-name-size,.uc-name,.uc-filename,.uc-file-name')) node.remove();
  const text = messages.textContent.toLowerCase();
  if (/too many users have viewed or downloaded|download quota|downloadquotaexceeded|muitos usuários.*(?:baixaram|download)|cota de download/.test(text)) {
    throw new PublicDriveError(429, 'DRIVE_LIMIT', 'O Google limitou os downloads deste arquivo. Aguarde e tente novamente.');
  }
  if (/infected with a virus|virus (?:has been|was) detected|identified as malware|infectado por um vírus|vírus foi detectado|violates.*terms of service/.test(text)
    || document.querySelectorAll('input').some(input => /abuse/i.test(input.getAttribute('name') || ''))) {
    throw new PublicDriveError(403, 'DRIVE_BLOCKED', 'O Google bloqueou o download deste arquivo. Abra o Drive para consultar o motivo.');
  }
  if (/access denied|access to this file has been denied|owner has disabled.*download|download.*disabled by.*owner|acesso negado|não tem permissão para baixar/.test(text)) {
    throw new PublicDriveError(403, 'DRIVE_FORBIDDEN', 'O Drive não permite baixar este arquivo. Confira as permissões de download do link.');
  }
  const form = document.querySelector('form#download-form');
  if (form && (form.getAttribute('method') || 'get').toLowerCase() === 'get') {
    try {
      const candidate = new URL(form.getAttribute('action') || '', destination);
      for (const input of form.querySelectorAll('input')) {
        if ((input.getAttribute('type') || '').toLowerCase() === 'hidden' && input.getAttribute('name')) {
          candidate.searchParams.append(input.getAttribute('name'), input.getAttribute('value') || '');
        }
      }
      const next = confirmationUrl(candidate, fileId, resourceKey);
      if (next) return next;
    } catch (error) { if (error instanceof PublicDriveError) throw error; }
  }
  for (const link of document.querySelectorAll('a[href]')) {
    try {
      const next = confirmationUrl(new URL(link.getAttribute('href'), destination), fileId, resourceKey);
      if (next) return next;
    } catch { /* Not a supported public download link. */ }
  }
  const encoded = html.match(/"downloadUrl"\s*:\s*("(?:\\.|[^"\\])*")/);
  if (encoded) {
    try {
      const next = confirmationUrl(new URL(JSON.parse(encoded[1]), destination), fileId, resourceKey);
      if (next) return next;
    } catch { /* Not a supported public download URL. */ }
  }
  if (document.querySelector('input[type=password]') || document.querySelector('form[action*="accounts.google.com"]')
    || /faça login para acessar|sign in to (?:access|continue)|you need access|request access|solicitar acesso/.test(text)) {
    throw new PublicDriveError(401, 'AUTH_REQUIRED', 'O Google exige login para este arquivo. Confira o compartilhamento ou conecte uma conta com acesso.');
  }
  throw unavailable();
}

/** Follow the normal anonymous download flow, including large-file confirmation. */
export async function fetchPublicDriveOriginal({ source, fileId, resourceKey, range, signal, fetchImpl = globalThis.fetch, userAgent }) {
  const cookies = new CookieJar();
  let destination = source;
  const visited = new Set();
  for (let request = 0; request < MAX_REQUESTS; request++) {
    if (!trustedGoogleUrl(destination) || visited.has(destination.href)) throw unavailable();
    if (destination.hostname === 'accounts.google.com') throw new PublicDriveError(401, 'AUTH_REQUIRED', 'O Google exige login para este arquivo.');
    visited.add(destination.href);
    const headers = new Headers({ 'Accept-Encoding': 'identity' });
    if (range) headers.set('Range', range);
    if (userAgent) headers.set('User-Agent', userAgent.slice(0, 512));
    const cookie = await cookies.getCookieString(destination.href);
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetchImpl(destination, { headers, redirect: 'manual', signal });
    for (const cookie of response.headers.getSetCookie()) await cookies.setCookie(cookie, destination.href, { ignoreError: true });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw unavailable();
      destination = new URL(location, destination);
      continue;
    }
    if (response.ok && videoContentType(response.headers.get('content-type') || '')) return response;
    if ((response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
      destination = inspectPage(await readHtml(response), destination, fileId, resourceKey);
      continue;
    }
    const contentRange = response.headers.get('content-range');
    await response.body?.cancel();
    if (response.status === 401) throw new PublicDriveError(401, 'AUTH_REQUIRED', 'O Google exige login para este arquivo.');
    if (response.status === 403) throw new PublicDriveError(403, 'DRIVE_FORBIDDEN', 'O Google não permitiu o download público deste arquivo.');
    if (response.status === 404) throw new PublicDriveError(404, 'DRIVE_NOT_FOUND', 'Arquivo não encontrado ou link indisponível.');
    if (response.status === 416) throw new PublicDriveError(416, 'INVALID_RANGE', 'Trecho fora do arquivo.', contentRange ? { 'Content-Range': contentRange } : {});
    if (response.status === 429) throw new PublicDriveError(429, 'DRIVE_LIMIT', 'O Google limitou os downloads deste arquivo.');
    throw unavailable();
  }
  throw unavailable();
}
