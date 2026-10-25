import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get, request } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLibraryMiddleware } from '../server/library.mjs';
import { appOrigin, isLoopbackRequest } from '../server/local-network.mjs';

const video = {
  id: 'drive-1234567890abcdef', title: 'Minha viagem', genre: 'Viagens', source: 'drive',
  driveId: '1234567890abcdef', resourceKey: 'shared-file-key',
  url: 'https://drive.google.com/file/d/1234567890abcdef/preview',
};

async function fixture(t, directory) {
  const storage = directory || await mkdtemp(path.join(os.tmpdir(), 'muvies-library-test-'));
  if (!directory) t.after(() => rm(storage, { recursive: true, force: true }));
  const middleware = createLibraryMiddleware({ directory: storage });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { directory: storage, origin, endpoint: `${origin}/api/library` };
}

function save(context, videos, revision = '0', headers = {}) {
  return fetch(context.endpoint, { method: 'PUT', headers: {
    Origin: context.origin, 'Content-Type': 'application/json', 'If-Match': revision, ...headers,
  }, body: JSON.stringify({ videos }) });
}

function rawRequest(context, { method = 'GET', host, origin, videos, revision = '0' }) {
  return new Promise((resolve, reject) => {
    const body = videos === undefined ? undefined : JSON.stringify({ videos });
    const outgoing = request(context.endpoint, { method, headers: {
      Host: host,
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'If-Match': revision } : {}),
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

test('links são salvos em disco e sobrevivem a uma nova instância do servidor', async t => {
  const context = await fixture(t);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), { videos: [], revision: '0' });
  const saved = await save(context, [video]);
  assert.equal(saved.status, 200);
  const data = await saved.json();
  assert.deepEqual(data.videos, [video]);
  assert.match(data.revision, /^[a-f0-9]{64}$/);
  const file = JSON.parse(await readFile(path.join(context.directory, 'library.json'), 'utf8'));
  assert.deepEqual(file, { version: 1, videos: [video] });
  const restarted = await fixture(t, context.directory);
  assert.deepEqual(await (await fetch(restarted.endpoint)).json(), data);
  assert.deepEqual(await readdir(context.directory), ['library.json']);
});

test('atualização, deduplicação e remoção mantêm a revisão e o vazio intencional', async t => {
  const context = await fixture(t);
  const first = await (await save(context, [video, video])).json();
  assert.equal(first.videos.length, 1);
  const updated = await (await save(context, [{ ...video, title: 'Férias', genre: 'Família', url: 'https://untrusted.example' }], first.revision)).json();
  assert.equal(updated.videos[0].title, 'Férias');
  assert.equal(updated.videos[0].url, video.url);
  assert.notEqual(updated.revision, first.revision);
  const empty = await (await save(context, [], `"${updated.revision}"`)).json();
  assert.deepEqual(empty.videos, []);
  assert.notEqual(empty.revision, '0');
  assert.deepEqual(await (await fetch(context.endpoint)).json(), empty);
});

test('detalhes editoriais e Minha lista persistem e mantêm compatibilidade com links antigos', async t => {
  const context = await fixture(t);
  const details = { ...video, director: 'Clara Monteiro', year: '1971', description: 'Uma história à beira-mar.\nCom duas linhas.', favorite: true };
  const saved = await (await save(context, [details])).json();
  assert.deepEqual(saved.videos, [details]);
  const restarted = await fixture(t, context.directory);
  assert.deepEqual((await (await fetch(restarted.endpoint)).json()).videos, [details]);
  for (const invalid of [{ year: 'ano' }, { director: '\ninválido' }, { description: '\u0000' }, { favorite: 'sim' }]) {
    assert.equal((await save(context, [{ ...details, ...invalid }], saved.revision)).status, 400);
  }
  assert.deepEqual((await (await fetch(context.endpoint)).json()).videos, [details]);
  const cleared = await (await save(context, [video], saved.revision)).json();
  assert.deepEqual(cleared.videos, [video]);
});

test('país é normalizado, persiste após reiniciar e rejeita valores inválidos sem perder dados', async t => {
  const context = await fixture(t);
  const response = await save(context, [{ ...video, country: '  Brasil  ' }]);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.deepEqual(saved.videos, [{ ...video, country: 'Brasil' }]);
  const restarted = await fixture(t, context.directory);
  assert.deepEqual(await (await fetch(restarted.endpoint)).json(), saved);
  for (const country of ['', '   ', '\nBrasil', 'x'.repeat(129), 123, null]) {
    const invalid = await save(restarted, [{ ...video, country }], saved.revision);
    assert.equal(invalid.status, 400);
    assert.deepEqual(await (await fetch(restarted.endpoint)).json(), saved);
  }
  const cleared = await save(restarted, [video], saved.revision);
  assert.equal(cleared.status, 200);
  assert.deepEqual((await cleared.json()).videos, [video]);
});

test('revisão antiga ou ausente não sobrescreve os links já salvos', async t => {
  const context = await fixture(t);
  const initial = await (await save(context, [video])).json();
  const stale = await save(context, [], '0');
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'LIBRARY_CONFLICT');
  const missing = await fetch(context.endpoint, { method: 'PUT', headers: { Origin: context.origin, 'Content-Type': 'application/json' }, body: '{"videos":[]}' });
  assert.equal(missing.status, 428);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), initial);
});

test('gravações concorrentes são serializadas e preservam o vencedor', async t => {
  const context = await fixture(t);
  const responses = await Promise.all([save(context, [video]), save(context, [{ ...video, title: 'Outra janela' }])]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const successful = await responses.find(response => response.status === 200).json();
  assert.deepEqual(await (await fetch(context.endpoint)).json(), successful);
});

test('arquivo inválido é preservado e bloqueia gravações em vez de apagar a biblioteca', async t => {
  const context = await fixture(t);
  const original = '{ "version": 1, "videos": [ conteúdo corrompido';
  await writeFile(path.join(context.directory, 'library.json'), original);
  const response = await fetch(context.endpoint);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'LIBRARY_UNREADABLE');
  assert.equal((await save(context, [])).status, 500);
  assert.equal(await readFile(path.join(context.directory, 'library.json'), 'utf8'), original);
});

test('corpo malformado, vídeo inválido e corpo grande não alteram o arquivo', async t => {
  const context = await fixture(t);
  const initial = await (await save(context, [video])).json();
  for (const badVideo of [{ ...video, driveId: '../invalid' }, { ...video, source: 'demo' }, { ...video, resourceKey: '\r\ninvalid' }]) {
    assert.equal((await save(context, [badVideo], initial.revision)).status, 400);
  }
  const malformed = await fetch(context.endpoint, { method: 'PUT', headers: { Origin: context.origin, 'Content-Type': 'application/json', 'If-Match': initial.revision }, body: '{invalid' });
  assert.equal(malformed.status, 400);
  // Content-Length is deliberately not used to claim a successful write.
  const large = await fetch(context.endpoint, { method: 'PUT', headers: { Origin: context.origin, 'Content-Type': 'application/json', 'If-Match': initial.revision }, body: JSON.stringify({ videos: [], padding: 'x'.repeat(2 * 1024 * 1024) }) });
  assert.equal(large.status, 413);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), initial);
});

test('origens externas, hosts remotos e métodos não suportados são recusados', async t => {
  const context = await fixture(t);
  assert.equal((await save(context, [video], '0', { Origin: 'https://external.example' })).status, 403);
  assert.equal((await fetch(context.endpoint, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const remote = await new Promise((resolve, reject) => {
    get(context.endpoint, { headers: { Host: 'external.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(remote, 403);
  assert.equal((await fetch(context.endpoint, { method: 'DELETE' })).status, 405);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), { videos: [], revision: '0' });
});

test('clientes da LAN compartilham a mesma biblioteca usando a origem privada exata', async t => {
  const context = await fixture(t);
  const port = new URL(context.origin).port;
  const host = `192.168.1.20:${port}`;
  const origin = `http://${host}`;
  assert.deepEqual(await rawRequest(context, { host }), { status: 200, body: { videos: [], revision: '0' } });
  const saved = await rawRequest(context, { host, origin, method: 'PUT', videos: [video] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.videos, [video]);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), saved.body);
  const anotherClient = await rawRequest(context, { host: `10.1.0.20:${port}` });
  assert.deepEqual(anotherClient.body, saved.body);
  const mismatch = await rawRequest(context, { host, origin: context.origin, method: 'PUT', videos: [], revision: saved.body.revision });
  assert.equal(mismatch.status, 403);
  assert.equal((await rawRequest(context, { host, origin: 'https://external.example', method: 'PUT', videos: [], revision: saved.body.revision })).status, 403);
  assert.deepEqual(await (await fetch(context.endpoint)).json(), saved.body);
});

test('política de rede aceita apenas hosts e pares loopback ou privados', () => {
  const stub = (host, remoteAddress) => ({ headers: { host }, socket: { remoteAddress } });
  for (const [host, peer] of [
    ['localhost:5173', '127.0.0.1'],
    ['127.0.0.2:5173', '::1'],
    ['[::1]:5173', '::ffff:127.0.0.1'],
    ['[::ffff:127.0.0.1]:5173', '::ffff:7f00:1'],
    ['192.168.1.20:5173', '192.168.1.42'],
    ['10.0.0.20:5173', '::ffff:192.168.1.42'],
    ['172.16.0.1:5173', '172.31.255.255'],
    ['[fc00::1]:5173', 'fdff::2'],
    ['[fe80::1]:5173', 'fe80::2%eth0'],
    ['[febf::1]:5173', 'fd00::2'],
    ['[::ffff:192.168.1.20]:5173', '::ffff:c0a8:12a'],
  ]) assert.ok(appOrigin(stub(host, peer)), `${host} / ${peer}`);
  for (const [host, peer] of [
    ['external.example:5173', '127.0.0.1'],
    ['192.168.1.20:5173', '8.8.8.8'],
    ['localhost:5173', '2001:4860:4860::8888'],
    ['8.8.8.8:5173', '127.0.0.1'],
    ['172.15.0.1:5173', '127.0.0.1'],
    ['172.32.0.1:5173', '127.0.0.1'],
    ['169.254.1.20:5173', '127.0.0.1'],
    ['[fec0::1]:5173', '::1'],
    ['[::]:5173', '::1'],
    ['[::ffff:8.8.8.8]:5173', '::1'],
    ['localhost@192.168.1.20:5173', '127.0.0.1'],
    ['localhost:5173/path', '127.0.0.1'],
    ['localhost:5173', undefined],
  ]) assert.equal(appOrigin(stub(host, peer)), null, `${host} / ${peer}`);
});

test('laço local para OAuth exige tanto Host quanto conexão loopback', () => {
  const stub = (host, remoteAddress) => ({ headers: { host }, socket: { remoteAddress } });
  assert.equal(isLoopbackRequest(stub('localhost:5173', '127.0.0.1')), true);
  assert.equal(isLoopbackRequest(stub('[::1]:5173', '::ffff:127.0.0.1')), true);
  assert.equal(isLoopbackRequest(stub('[::ffff:127.0.0.1]:5173', '::1')), true);
  assert.equal(isLoopbackRequest(stub('localhost:5173', '192.168.1.42')), false);
  assert.equal(isLoopbackRequest(stub('192.168.1.20:5173', '127.0.0.1')), false);
  assert.equal(isLoopbackRequest(stub('127.0.0.1:5173', '8.8.8.8')), false);
});
