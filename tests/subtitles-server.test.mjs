import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSubtitlesMiddleware } from '../server/subtitles.mjs';
import { MAX_SUBTITLE_BYTES, parseSrt, SrtError } from '../server/srt.mjs';

const driveId = '1234567890abcdef';
const caption = '1\n00:00:01,000 --> 00:00:03,200\nOlá, coração!\nSegunda linha.\n\n2\n00:00:05,000 --> 00:00:06,000\nAté já.\n';

async function fixture(t, directory) {
  const storage = directory || await mkdtemp(path.join(os.tmpdir(), 'muvies-subtitles-test-'));
  if (!directory) t.after(() => rm(storage, { recursive: true, force: true }));
  const middleware = createSubtitlesMiddleware({ directory: storage });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { directory: storage, origin, endpoint: `${origin}/api/subtitles/${driveId}` };
}

function upload(context, srt = caption, revision = '0', filename = 'Português.srt', extraHeaders = {}) {
  return fetch(context.endpoint, { method: 'PUT', headers: {
    Origin: context.origin, 'Content-Type': 'application/x-subrip', 'X-Subtitle-Filename': encodeURIComponent(filename), 'If-Match': revision, ...extraHeaders,
  }, body: srt });
}

function rawRequest(context, { method = 'GET', host, origin, body, revision = '0' }) {
  return new Promise((resolve, reject) => {
    const outgoing = request(context.endpoint, { method, headers: {
      Host: host,
      ...(origin ? { Origin: origin } : {}),
      'Content-Type': 'application/x-subrip', 'X-Subtitle-Filename': 'legenda.srt', 'If-Match': revision,
      ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

test('parser preserva acentos e múltiplas linhas e converte timestamps em WebVTT', () => {
  const parsed = parseSrt(Buffer.from(`\uFEFF${caption.replaceAll('\n', '\r\n')}`));
  assert.equal(parsed.srt, caption);
  assert.equal(parsed.cueCount, 2);
  assert.match(parsed.vtt, /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:03\.200/);
  assert.match(parsed.vtt, /Olá, coração!\nSegunda linha\./);
  const withoutIndices = parseSrt(Buffer.from('0:00:01.000 --> 00:00:02.100\nTexto\n\n \n00:00:03,000 --> 00:00:04,000\nOutro\n'));
  assert.equal(withoutIndices.cueCount, 2);
  assert.match(withoutIndices.srt, /^1\n00:00:01,000/);
});

test('parser lê Windows1252 e UTF16 LE/BE com BOM sem mascarar arquivos inválidos', () => {
  const latin = Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nAção, café e você.\n', 'latin1');
  assert.match(parseSrt(latin).vtt, /Ação, café e você\./);
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(caption, 'utf16le')]);
  assert.equal(parseSrt(utf16le).srt, caption);
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(caption, 'utf16le').swap16()]);
  assert.equal(parseSrt(utf16be).srt, caption);
  assert.throws(() => parseSrt(Buffer.from(caption, 'utf16le')), SrtError);
});

test('parser mantém markup e setas como texto literal, sem blocos WebVTT ativos', () => {
  const parsed = parseSrt(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n<script>alert(1)</script> & <v Pessoa>Olá</v>\n00:01:00.000 --> 00:02:00.000\n'));
  assert.match(parsed.vtt, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &lt;v Pessoa&gt;Olá&lt;\/v&gt;/);
  assert.match(parsed.vtt, /00:01:00\.000 --&gt; 00:02:00\.000/);
  assert.equal(parsed.vtt.includes('<script>'), false);
});

test('parser rejeita timestamps inválidos, cue sem texto, arquivo vazio e tamanho excessivo', () => {
  for (const text of ['', 'não é SRT', '1\n00:60:00,000 --> 01:01:00,000\nTexto', '1\n00:00:03,000 --> 00:00:02,000\nTexto', '1\n00:00:01,000 --> 00:00:01,000\nTexto', '1\n00:00:01,000 --> 00:00:02,000\n']) {
    assert.throws(() => parseSrt(Buffer.from(text)), SrtError);
  }
  assert.throws(() => parseSrt(Buffer.alloc(MAX_SUBTITLE_BYTES + 1, 65)), error => error instanceof SrtError && error.status === 413);
});

test('SRT persiste por vídeo, mantém revisão determinística e funciona após reiniciar', async t => {
  const context = await fixture(t);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), { subtitle: null });
  const first = await upload(context);
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.equal(saved.subtitle.filename, 'Português.srt');
  assert.match(saved.subtitle.revision, /^[a-f0-9]{64}$/);
  const stored = JSON.parse(await readFile(path.join(context.directory, 'subtitles', `${driveId}.json`), 'utf8'));
  assert.deepEqual(stored, { version: 1, filename: 'Português.srt', srt: caption });
  const restarted = await fixture(t, context.directory);
  assert.deepEqual(await (await fetch(restarted.endpoint)).json(), saved);
  const same = await upload(restarted, `\uFEFF${caption.replaceAll('\n', '\r\n')}`, saved.subtitle.revision);
  assert.deepEqual(await same.json(), saved);
  const secondVideo = await fetch(`${context.origin}/api/subtitles/anotherDriveVideo`);
  assert.deepEqual(await secondVideo.json(), { subtitle: null });
  assert.deepEqual(await readdir(path.join(context.directory, 'subtitles')), [`${driveId}.json`]);
});

test('VTT servido usa revisão atual, cabeçalhos corretos, GET/HEAD e texto escapado', async t => {
  const context = await fixture(t);
  const saved = await (await upload(context, '1\n00:00:00,000 --> 00:00:02,000\n<i>Olá</i> & você\n')).json();
  const track = `${context.endpoint}/track.vtt?revision=${saved.subtitle.revision}`;
  const response = await fetch(track);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/vtt; charset=utf-8$/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const body = await response.text();
  assert.match(body, /&lt;i&gt;Olá&lt;\/i&gt; &amp; você/);
  assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(body));
  const head = await fetch(track, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(body));
  const stale = await fetch(`${context.endpoint}/track.vtt?revision=outdated`);
  assert.equal(stale.status, 409);
  const mismatched = await fetch(track, { headers: { Origin: 'https://external.example' } });
  assert.equal(mismatched.status, 403);
});

test('conflitos, conteúdo inválido e remoção preservam a versão anterior', async t => {
  const context = await fixture(t);
  const saved = await (await upload(context)).json();
  const original = await readFile(path.join(context.directory, 'subtitles', `${driveId}.json`), 'utf8');
  const stale = await upload(context, caption, '0');
  assert.equal(stale.status, 409);
  assert.equal((await upload(context, 'conteúdo inválido', saved.subtitle.revision)).status, 400);
  assert.equal((await upload(context, caption, saved.subtitle.revision, '../../outro.srt')).status, 400);
  assert.equal(await readFile(path.join(context.directory, 'subtitles', `${driveId}.json`), 'utf8'), original);
  const missing = await fetch(context.endpoint, { method: 'DELETE', headers: { Origin: context.origin } });
  assert.equal(missing.status, 428);
  const removed = await fetch(context.endpoint, { method: 'DELETE', headers: { Origin: context.origin, 'If-Match': saved.subtitle.revision } });
  assert.deepEqual(await removed.json(), { subtitle: null });
  assert.equal((await fetch(`${context.endpoint}/track.vtt`)).status, 404);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), { subtitle: null });
});

test('gravações concorrentes e arquivo corrompido não causam perda silenciosa', async t => {
  const context = await fixture(t);
  const responses = await Promise.all([upload(context), upload(context, caption, '0', 'Outra.srt')]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const directory = path.join(context.directory, 'subtitles');
  const filename = path.join(directory, `${driveId}.json`);
  const corrupt = '{ arquivo inválido';
  await writeFile(filename, corrupt);
  assert.equal((await fetch(context.endpoint)).status, 500);
  assert.equal((await upload(context)).status, 500);
  assert.equal(await readFile(filename, 'utf8'), corrupt);
});

test('clientes LAN compartilham as legendas; origem errada e hosts externos não alteram arquivos', async t => {
  const context = await fixture(t);
  const host = `192.168.1.20:${new URL(context.origin).port}`;
  const saved = await rawRequest(context, { method: 'PUT', host, origin: `http://${host}`, body: caption });
  assert.equal(saved.status, 200);
  assert.deepEqual((await rawRequest(context, { host })).body, saved.body);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), saved.body);
  const wrong = await rawRequest(context, { method: 'DELETE', host, origin: context.origin, revision: saved.body.subtitle.revision });
  assert.equal(wrong.status, 403);
  assert.equal((await rawRequest(context, { host: 'external.example' })).status, 403);
  assert.equal((await upload(context, caption, saved.body.subtitle.revision, 'Outra.srt', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), saved.body);
});
