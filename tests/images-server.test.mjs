import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createImagesMiddleware, MAX_IMAGE_BYTES } from '../server/images.mjs';
import { createLibraryMiddleware } from '../server/library.mjs';

async function fixture(t, directory) {
  const storage = directory || await mkdtemp(path.join(os.tmpdir(), 'muvies-images-test-'));
  if (!directory) t.after(() => rm(storage, { recursive: true, force: true }));
  const images = createImagesMiddleware({ directory: storage });
  const library = createLibraryMiddleware({ directory: storage });
  const server = createServer((req, res) => images(req, res, () => library(req, res, () => { res.writeHead(404); res.end(); })));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { directory: storage, origin: `http://127.0.0.1:${server.address().port}` };
}
async function image(format = 'png', width = 120, height = 180) {
  return sharp({ create: { width, height, channels: 3, background: '#c8372d' } }).toFormat(format).toBuffer();
}
function upload(context, body, contentType = 'image/png', headers = {}) {
  return fetch(`${context.origin}/api/images`, { method: 'POST', headers: { Origin: context.origin, 'Content-Type': contentType, ...headers }, body });
}
const video = { id: 'drive-posterMovie123', driveId: 'posterMovie123', title: 'Filme com imagens', genre: 'Drama', source: 'drive', url: 'https://drive.google.com/file/d/posterMovie123/preview' };
function save(context, videos, revision = '0') {
  return fetch(`${context.origin}/api/library`, { method: 'PUT', headers: { Origin: context.origin, 'Content-Type': 'application/json', 'If-Match': revision }, body: JSON.stringify({ videos }) });
}

test('imagem real é validada, salva em disco, deduplicada e servida após reiniciar', async t => {
  const context = await fixture(t);
  const png = await image();
  const response = await upload(context, png);
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.match(saved.url, /^\/api\/images\/[a-f0-9]{64}\.webp$/);
  assert.deepEqual(await (await upload(context, png)).json(), saved);
  const filename = path.basename(saved.url);
  assert.deepEqual(await readdir(path.join(context.directory, 'images')), [filename]);
  const stored = await readFile(path.join(context.directory, 'images', filename));
  const info = await sharp(stored).metadata();
  assert.equal(info.format, 'webp'); assert.equal(info.width, 120); assert.equal(info.height, 180);
  assert.equal(info.exif, undefined);
  const restarted = await fixture(t, context.directory);
  const served = await fetch(restarted.origin + saved.url);
  assert.equal(served.headers.get('content-type'), 'image/webp');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('cache-control'), /private.*immutable/);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), stored);
  const head = await fetch(restarted.origin + saved.url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal(Number(head.headers.get('content-length')), stored.length);
});

test('JPEG, PNG e WebP são aceitos; imagens grandes mantêm proporção e orientação', async t => {
  const context = await fixture(t);
  for (const [format, mime] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const response = await upload(context, await image(format), mime);
    assert.equal(response.status, 201);
  }
  const rotated = await sharp(await image('jpeg', 100, 150)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rotatedUrl = (await (await upload(context, rotated, 'image/jpeg')).json()).url;
  const metadata = await sharp(Buffer.from(await (await fetch(context.origin + rotatedUrl)).arrayBuffer())).metadata();
  assert.equal(metadata.width, 150); assert.equal(metadata.height, 100); assert.equal(metadata.orientation, undefined);
  const large = await upload(context, await image('png', 4000, 2000));
  const largeUrl = (await large.json()).url;
  const resized = await sharp(Buffer.from(await (await fetch(context.origin + largeUrl)).arrayBuffer())).metadata();
  assert.equal(resized.width, 2400); assert.equal(resized.height, 1200);
});

test('pôster e destaque persistem independentemente na biblioteca e podem ser removidos', async t => {
  const context = await fixture(t);
  const poster = (await (await upload(context, await image())).json()).url;
  const cover = (await (await upload(context, await image('png', 320, 180))).json()).url;
  assert.notEqual(poster, cover);
  const initial = await (await save(context, [{ ...video, poster, cover }])).json();
  assert.deepEqual(initial.videos, [{ ...video, poster, cover }]);
  const restarted = await fixture(t, context.directory);
  assert.deepEqual(await (await fetch(restarted.origin + '/api/library')).json(), initial);
  const edited = await (await save(context, [{ ...video, title: 'Novo título', favorite: true, poster, cover }], initial.revision)).json();
  assert.equal(edited.videos[0].poster, poster); assert.equal(edited.videos[0].cover, cover);
  for (const invalid of [{ poster: 'https://example.com/image.jpg' }, { cover: '/api/images/../../secrets' }, { poster: 'data:image/svg+xml,bad' }]) {
    assert.equal((await save(context, [{ ...video, poster, cover, ...invalid }], edited.revision)).status, 400);
  }
  const stale = await save(context, [{ ...video, cover }], initial.revision);
  assert.equal(stale.status, 409);
  assert.deepEqual(await (await fetch(context.origin + '/api/library')).json(), edited);
  const removed = await (await save(context, [video], edited.revision)).json();
  assert.deepEqual(removed.videos, [video]);
  assert.equal((await fetch(context.origin + poster)).status, 200);
});

test('arquivos inválidos, SVG e corpos excessivos não gravam imagens nem alteram o catálogo', async t => {
  const context = await fixture(t);
  const saved = await (await save(context, [video])).json();
  for (const body of [Buffer.alloc(0), Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>')]) {
    assert.equal((await upload(context, body)).status, 400);
  }
  assert.equal((await upload(context, await image(), 'image/svg+xml')).status, 415);
  assert.equal((await upload(context, Buffer.alloc(MAX_IMAGE_BYTES + 1))).status, 413);
  assert.deepEqual(await readdir(context.directory), ['library.json']);
  assert.deepEqual(await (await fetch(context.origin + '/api/library')).json(), saved);
  assert.equal((await fetch(context.origin + '/api/images/' + '0'.repeat(64) + '.webp')).status, 404);
});

test('gravação indisponível preserva a biblioteca e retorna erro em vez de confirmar upload', async t => {
  const context = await fixture(t);
  const saved = await (await save(context, [video])).json();
  await writeFile(path.join(context.directory, 'images'), 'directory unavailable');
  assert.equal((await upload(context, await image())).status, 500);
  assert.deepEqual(await (await fetch(context.origin + '/api/library')).json(), saved);
});

test('origem externa é recusada; clientes LAN recebem as mesmas imagens salvas', async t => {
  const context = await fixture(t);
  const png = await image();
  assert.equal((await upload(context, png, 'image/png', { Origin: 'https://external.example' })).status, 403);
  assert.equal((await upload(context, png, 'image/png', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const missingOrigin = await fetch(context.origin + '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
  assert.equal(missingOrigin.status, 403);
  const saved = await (await upload(context, png)).json();
  const lan = await new Promise((resolve, reject) => {
    const outgoing = request(context.origin + saved.url, { headers: { Host: `192.168.1.20:${new URL(context.origin).port}` } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
    }); outgoing.on('error', reject); outgoing.end();
  });
  assert.equal(lan.status, 200); assert.equal((await sharp(lan.bytes).metadata()).format, 'webp');
  const external = await new Promise((resolve, reject) => {
    const outgoing = request(context.origin + saved.url, { headers: { Host: 'external.example' } }, response => { response.resume(); resolve(response.statusCode); });
    outgoing.on('error', reject); outgoing.end();
  });
  assert.equal(external, 403);
});
