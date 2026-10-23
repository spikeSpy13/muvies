import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { createDriveMiddleware } from '../server/drive.mjs';

const fileId = '1234567890abcdef';
const fakeToken = 'test-token-not-a-real-credential';

function downloadForm({ id = fileId, action = 'https://drive.usercontent.google.com/download', extra = '' } = {}) {
  return `<html><title>Google Drive - Virus scan warning</title><p>Google Drive can't scan this file for viruses because it is too large.</p>
    <form id="download-form" action="${action}" method="get"><input type="hidden" name="id" value="${id}">
    <input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t">
    <input type="hidden" name="uuid" value="public-download-uuid">${extra}</form></html>`;
}

function rawStatus(url, headers) {
  return new Promise((resolve, reject) => {
    get(url, { headers }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
}

async function setup(t, fetchImpl, now) {
  const middleware = createDriveMiddleware({ fetchImpl, now });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { base, media: `${base}/api/drive/media/${fileId}` };
}

async function authorize(base, expiresIn = 3600) {
  const response = await fetch(`${base}/api/drive/session`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: fakeToken, expiresIn }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /test-token/);
  assert.doesNotMatch(await response.text(), /test-token/);
  return cookie.split(';')[0];
}

test('original público: preserva Range, bytes e cabeçalhos 206 sem autorização', async t => {
  const { media } = await setup(t, async (url, options) => {
    assert.equal(url.hostname, 'drive.google.com');
    assert.equal(url.searchParams.get('id'), fileId);
    assert.equal(options.headers.get('range'), 'bytes=4-7');
    assert.equal(options.headers.get('authorization'), null);
    return new Response('4567', { status: 206, headers: {
      'Content-Type': 'video/mp4', 'Content-Range': 'bytes 4-7/10',
      'Content-Length': '4', 'Accept-Ranges': 'bytes', 'Content-Disposition': 'attachment',
    } });
  });
  const response = await fetch(media, { headers: { Range: 'bytes=4-7' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 4-7/10');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-disposition'), null);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(await response.text(), '4567');
});

test('original privado: sessão isolada, token na API, chave de recurso e encerramento', async t => {
  const { base, media } = await setup(t, async (url, options) => {
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(url.searchParams.get('alt'), 'media');
    assert.equal(options.headers.get('authorization'), `Bearer ${fakeToken}`);
    assert.equal(options.headers.get('x-goog-drive-resource-keys'), `${fileId}/key-for-shared-file`);
    assert.equal(url.searchParams.has('access_token'), false);
    return new Response('original', { headers: { 'Content-Type': 'video/mp4' } });
  });
  const cookie = await authorize(base);
  const session = await fetch(`${base}/api/drive/session`, { headers: { Cookie: cookie } });
  assert.equal((await session.json()).connected, true);
  const isolated = await fetch(`${base}/api/drive/session`);
  assert.equal((await isolated.json()).connected, false);
  const response = await fetch(`${media}?resourceKey=key-for-shared-file`, { headers: { Cookie: cookie } });
  assert.equal(await response.text(), 'original');
  const logout = await fetch(`${base}/api/drive/session`, { method: 'DELETE', headers: { Origin: base, Cookie: cookie } });
  assert.equal((await logout.json()).connected, false);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('página HTML de login não é entregue como se fosse vídeo', async t => {
  const { media } = await setup(t, async () => new Response('<form action="https://accounts.google.com/ServiceLogin"><input type="password"></form>', { headers: { 'Content-Type': 'text/html' } }));
  const response = await fetch(media);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'AUTH_REQUIRED');
});

test('limites, permissão e trechos inválidos mantêm erros do provedor', async t => {
  let status = 403;
  const { base, media } = await setup(t, async () => new Response('provider error', { status, headers: { 'Content-Range': 'bytes */10' } }));
  const cookie = await authorize(base);
  for (const [upstreamStatus, expectedCode] of [[403, 'DRIVE_FORBIDDEN'], [404, 'DRIVE_NOT_FOUND'], [416, 'INVALID_RANGE'], [429, 'DRIVE_LIMIT']]) {
    status = upstreamStatus;
    const response = await fetch(media, { headers: { Cookie: cookie } });
    assert.equal(response.status, upstreamStatus);
    assert.equal((await response.json()).code, expectedCode);
    if (status === 416) assert.equal(response.headers.get('content-range'), 'bytes */10');
  }
});

test('redirecionamento externo é recusado e o token não segue para o CDN público', async t => {
  let target = 'https://attacker.example/video';
  let calls = 0;
  const { base, media } = await setup(t, async (url, options) => {
    calls++;
    if (url.hostname === 'www.googleapis.com') return new Response(null, { status: 302, headers: { Location: target } });
    assert.equal(url.hostname, 'download.googleusercontent.com');
    assert.equal(options.headers.get('authorization'), null);
    return new Response('original', { headers: { 'Content-Type': 'video/mp4' } });
  });
  const cookie = await authorize(base);
  const rejected = await fetch(media, { headers: { Cookie: cookie } });
  assert.equal(rejected.status, 502);
  assert.equal(calls, 1);
  target = 'https://download.googleusercontent.com/original';
  const accepted = await fetch(media, { headers: { Cookie: cookie } });
  assert.equal(await accepted.text(), 'original');
  assert.equal(calls, 3);
});

test('HEAD cancela o corpo remoto e não baixa o filme', async t => {
  let cancelled = false;
  const { media } = await setup(t, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'video/mp4' } }));
  const response = await fetch(media, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal(cancelled, true);
});

test('fechar a reprodução cancela o download remoto sem buffer do filme inteiro', { timeout: 5000 }, async t => {
  let signal;
  let cancelled = false;
  const { media } = await setup(t, async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(65536)); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'video/mp4' } });
  });
  const response = await fetch(media);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  const aborted = signal.aborted ? Promise.resolve() : once(signal, 'abort');
  await reader.cancel();
  await aborted;
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test('sessões expiram; origem externa, host remoto e ranges múltiplos são recusados', async t => {
  let clock = 1000;
  let calls = 0;
  const { base, media } = await setup(t, async () => { calls++; throw new Error('Unexpected upstream call'); }, () => clock);
  const cookie = await authorize(base, 1);
  clock = 2001;
  const expired = await fetch(`${base}/api/drive/session`, { headers: { Cookie: cookie } });
  assert.equal((await expired.json()).connected, false);
  const crossOrigin = await fetch(`${base}/api/drive/session`, {
    method: 'POST', headers: { Origin: 'https://another-site.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: fakeToken }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(await rawStatus(media, { Host: 'external.example' }), 403);
  assert.equal(await rawStatus(media, { 'Sec-Fetch-Site': 'cross-site' }), 403);
  assert.equal((await fetch(media, { headers: { Range: 'bytes=0-1,4-5' } })).status, 416);
  assert.equal(calls, 0);
});

test('arquivo público grande: segue confirmação, cookies anônimos, resourcekey e Range sem login', async t => {
  let calls = 0;
  const { media } = await setup(t, async (url, options) => {
    calls++;
    assert.equal(options.headers.get('authorization'), null);
    assert.equal(options.headers.get('range'), 'bytes=4-7');
    if (calls === 1) {
      assert.equal(url.hostname, 'drive.google.com');
      assert.equal(options.headers.get('cookie'), null);
      return new Response(null, { status: 303, headers: {
        Location: `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
        'Set-Cookie': 'public_download=anonymous; Domain=google.com; Path=/; Secure',
      } });
    }
    assert.equal(url.hostname, 'drive.usercontent.google.com');
    assert.equal(options.headers.get('cookie'), 'public_download=anonymous');
    if (calls === 2) return new Response(downloadForm(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    assert.equal(url.searchParams.get('id'), fileId);
    assert.equal(url.searchParams.get('confirm'), 't');
    assert.equal(url.searchParams.get('uuid'), 'public-download-uuid');
    assert.equal(url.searchParams.get('resourcekey'), 'shared-file-key');
    return new Response('4567', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 4-7/10', 'Content-Length': '4' } });
  });
  const response = await fetch(`${media}?resourceKey=shared-file-key`, { headers: { Range: 'bytes=4-7', Cookie: 'unrelated_app_session=never-forward' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 4-7/10');
  assert.equal(await response.text(), '4567');
  assert.equal(calls, 3);
});

test('cookies de download não atravessam domínios Google diferentes', async t => {
  let calls = 0;
  const { media } = await setup(t, async (url, options) => {
    calls++;
    if (calls === 1) return new Response(null, { status: 302, headers: {
      Location: 'https://download.googleusercontent.com/original',
      'Set-Cookie': 'public_download=anonymous; Path=/; Secure',
    } });
    assert.equal(url.hostname, 'download.googleusercontent.com');
    assert.equal(options.headers.get('cookie'), null);
    return new Response('original', { headers: { 'Content-Type': 'application/octet-stream' } });
  });
  assert.equal(await (await fetch(media)).text(), 'original');
});

test('formulário externo ou de outro arquivo não é seguido', async t => {
  for (const options of [{ action: 'https://attacker.example/download' }, { id: 'another-file-id' }, { extra: '<input type="hidden" name="acknowledgeAbuse" value="true">' }]) {
    let calls = 0;
    const { media } = await setup(t, async () => { calls++; return new Response(downloadForm(options), { headers: { 'Content-Type': 'text/html' } }); });
    const response = await fetch(media);
    assert.equal(response.status, options.extra ? 403 : 502);
    assert.equal(calls, 1);
  }
});

test('HTML desconhecido, cota e bloqueio não são classificados como falta de OAuth', async t => {
  for (const [html, status, code] of [
    ['<html>Unexpected response</html>', 502, 'PUBLIC_DOWNLOAD_UNAVAILABLE'],
    ['<html>Too many users have viewed or downloaded this file recently.</html>', 429, 'DRIVE_LIMIT'],
    ['<html>This file is infected with a virus.</html>', 403, 'DRIVE_BLOCKED'],
  ]) {
    const { media } = await setup(t, async () => new Response(html, { headers: { 'Content-Type': 'text/html' } }));
    const response = await fetch(media);
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
});

test('confirmações repetidas e páginas HTML grandes têm limite', async t => {
  for (const html of [downloadForm(), `<html>${'x'.repeat(270000)}</html>`]) {
    let calls = 0;
    const { media } = await setup(t, async () => { calls++; return new Response(html, { headers: { 'Content-Type': 'text/html' } }); });
    const response = await fetch(media);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'PUBLIC_DOWNLOAD_UNAVAILABLE');
    assert.ok(calls <= 2);
  }
});

test('HEAD resolve a confirmação pública e cancela o corpo do vídeo', async t => {
  let cancelled = false;
  let calls = 0;
  const { media } = await setup(t, async () => {
    calls++;
    if (calls === 1) return new Response(downloadForm(), { headers: { 'Content-Type': 'text/html' } });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'video/mp4' } });
  });
  const response = await fetch(media, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
});

test('autorização expirada tenta o download público sem pedir nova conexão', async t => {
  let calls = 0;
  const { base, media } = await setup(t, async (url, options) => {
    calls++;
    if (calls === 1) { assert.equal(url.hostname, 'www.googleapis.com'); return new Response('expired', { status: 401 }); }
    assert.equal(options.headers.get('authorization'), null);
    return new Response('original public file', { headers: { 'Content-Type': 'video/mp4' } });
  });
  const cookie = await authorize(base);
  const response = await fetch(media, { headers: { Cookie: cookie } });
  assert.equal(await response.text(), 'original public file');
  assert.equal(calls, 2);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('nomes de arquivo não são confundidos com cota ou bloqueio do Google', async t => {
  for (const filename of ['Download Quota.mp4', 'infected with a virus.mp4']) {
    let calls = 0;
    const { media } = await setup(t, async () => {
      calls++;
      if (calls === 1) return new Response(`<div class="uc-name-size">${filename}</div>${downloadForm()}`, { headers: { 'Content-Type': 'text/html' } });
      return new Response('original', { headers: { 'Content-Type': 'video/mp4' } });
    });
    assert.equal(await (await fetch(media)).text(), 'original');
    assert.equal(calls, 2);
  }
});

test('conta sem acesso de conteúdo não impede baixar o mesmo arquivo público', async t => {
  let calls = 0;
  const { base, media } = await setup(t, async (url, options) => {
    calls++;
    if (calls === 1) { assert.equal(url.hostname, 'www.googleapis.com'); return new Response('insufficient scope', { status: 403 }); }
    assert.equal(options.headers.get('authorization'), null);
    return new Response('original public file', { headers: { 'Content-Type': 'video/mp4' } });
  });
  const cookie = await authorize(base);
  assert.equal(await (await fetch(media, { headers: { Cookie: cookie } })).text(), 'original public file');
  assert.equal(calls, 2);
});

test('rede local transmite arquivos públicos e não reutiliza autorização privada de loopback', async t => {
  let calls = 0;
  const { base, media } = await setup(t, async (url, options) => {
    calls++;
    assert.equal(url.hostname, 'drive.google.com');
    assert.equal(options.headers.get('authorization'), null);
    return new Response('public original', { headers: { 'Content-Type': 'video/mp4' } });
  });
  const cookie = await authorize(base);
  const headers = { Host: `192.168.1.20:${new URL(base).port}`, Cookie: cookie };
  const result = await new Promise((resolve, reject) => {
    get(media, { headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
  assert.deepEqual(result, { status: 200, body: 'public original' });
  assert.equal(calls, 1);
  assert.equal(await rawStatus(`${base}/api/drive/session`, headers), 403);
});
