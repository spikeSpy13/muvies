import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseSrt } from '../server/srt.mjs';

const firstId = 'subtitleVideo123';
const secondId = 'otherSubVideo123';
type SavedSubtitle = { filename: string; revision: string; vtt: string };
type Store = { subtitles: Map<string, SavedSubtitle>; brokenTrack: boolean; failWrite: boolean };
const captions = '\uFEFF1\r\n00:00:00,000 --> 00:00:02,000\r\nOlá, coração!\r\nSegunda linha.\r\n\r\n2\r\n00:00:02,000 --> 00:00:05,000\r\nAção e diversão.\r\n';
function savedSubtitle(filename: string, srt: string): SavedSubtitle {
  const { vtt } = parseSrt(Buffer.from(srt));
  return { filename, vtt, revision: createHash('sha256').update(filename + srt).digest('hex') };
}
async function routes(context: BrowserContext, store: Store) {
  const original = await readFile(new URL('./fixtures/native-video.mp4', import.meta.url));
  await context.route('**/api/library', route => route.fulfill({ json: { revision: 'saved-library', videos: [
    { id: `drive-${firstId}`, driveId: firstId, title: 'Vídeo com legenda', genre: 'Filmes', source: 'drive', url: `https://drive.google.com/file/d/${firstId}/preview` },
    { id: `drive-${secondId}`, driveId: secondId, title: 'Outro vídeo', genre: 'Filmes', source: 'drive', url: `https://drive.google.com/file/d/${secondId}/preview` },
  ] } }));
  await context.route('**/api/drive/media/*', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({ contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: original });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), original.length - 1) : original.length - 1;
    return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${original.length}` }, body: original.subarray(start, end + 1) });
  });
  await context.route('**/api/subtitles/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.pathname.split('/')[3];
    const saved = store.subtitles.get(id);
    const metadata = () => ({ subtitle: saved ? { filename: saved.filename, revision: saved.revision } : null });
    if (url.pathname.endsWith('/track.vtt')) {
      if (store.brokenTrack || !saved) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: 'text/vtt; charset=utf-8', body: saved.vtt });
    }
    if (request.method() === 'GET') return route.fulfill({ json: metadata() });
    if (store.failWrite) return route.fulfill({ status: 500, json: { message: 'Não foi possível salvar a legenda no computador. A legenda anterior foi preservada.' } });
    if (request.headers()['if-match'] !== (saved?.revision || '0')) return route.fulfill({ status: 409, json: { message: 'A legenda mudou.' } });
    if (request.method() === 'DELETE') {
      store.subtitles.delete(id);
      return route.fulfill({ json: { subtitle: null } });
    }
    try {
      expect(request.headers()['content-type']).toBe('application/x-subrip');
      const file = decodeURIComponent(request.headers()['x-subtitle-filename']);
      const result = savedSubtitle(file, request.postDataBuffer()!.toString('utf8'));
      store.subtitles.set(id, result);
      return route.fulfill({ json: { subtitle: { filename: result.filename, revision: result.revision } } });
    } catch (error) {
      return route.fulfill({ status: 400, json: { message: (error as Error).message } });
    }
  });
}
const test = base.extend<{ store: Store }>({
  store: async ({ context }, use) => {
    const store: Store = { subtitles: new Map(), brokenTrack: false, failWrite: false };
    await routes(context, store);
    await use(store);
  },
  page: async ({ page, store }, use) => { void store; await use(page); },
});
async function upload(page: Page, name = 'Português.srt', text = captions) {
  await expect(page.getByRole('button', { name: /Carregar legenda|Trocar legenda/ })).toBeEnabled();
  await page.getByLabel('Arquivo de legenda SRT').setInputFiles({ name, mimeType: 'application/x-subrip', buffer: Buffer.from(text) });
}
async function start(page: Page) {
  const cover = page.getByRole('button', { name: 'Reproduzir Vídeo com legenda', exact: true });
  if (await cover.isVisible()) await cover.click();
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).playbackRate = 0.1; });
}
async function cue(page: Page) {
  return page.locator('video').evaluate(video => (video as HTMLVideoElement).textTracks[0]?.activeCues?.[0] && ((video as HTMLVideoElement).textTracks[0].activeCues![0] as VTTCue).text);
}

test('SRT exibe acentos e multilinha, permite ocultar e trocar sem reiniciar o vídeo', async ({ page, store }) => {
  await page.goto('/');
  await page.locator('.catalog-card').first().getByRole('link', { name: 'Assistir Vídeo com legenda', exact: true }).click();
  await start(page);
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 1; });
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(1);
  await upload(page);
  await expect(page.locator('.subtitle-filename')).toHaveText('Português.srt');
  await expect.poll(() => page.locator('track').evaluate(track => (track as HTMLTrackElement).readyState)).toBe(2);
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => cue(page)).toBe('Olá, coração!\nSegunda linha.');
  await page.getByRole('button', { name: 'Ocultar legendas', exact: true }).click();
  await expect.poll(() => page.locator('track').evaluate(track => (track as HTMLTrackElement).track.mode)).toBe('disabled');
  await page.getByRole('button', { name: 'Mostrar legendas', exact: true }).click();
  await page.locator('video').evaluate(video => { const player = video as HTMLVideoElement; player.pause(); player.currentTime = 3; });
  await expect.poll(() => cue(page)).toBe('Ação e diversão.');
  // The native CC menu must also update the application's visibility button.
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).textTracks[0].mode = 'disabled'; });
  await expect(page.getByRole('button', { name: 'Mostrar legendas', exact: true })).toBeVisible();
  await upload(page, 'Nova legenda.srt', '1\n00:00:00,000 --> 00:00:05,000\nUma legenda nova.\n');
  await expect.poll(() => cue(page)).toBe('Uma legenda nova.');
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBe(3);
  expect(store.subtitles.get(firstId)?.filename).toBe('Nova legenda.srt');
});

test('legenda é compartilhada, persiste ao reabrir e não passa para outro vídeo', async ({ page, browser, store }) => {
  await page.goto('/');
  await page.locator('.catalog-card').first().getByRole('link', { name: 'Assistir Vídeo com legenda', exact: true }).click();
  await upload(page);
  await expect(page.locator('.subtitle-filename')).toHaveText('Português.srt');
  await page.reload();
  await expect(page.locator('.subtitle-filename')).toHaveText('Português.srt');
  const otherContext = await browser.newContext();
  await routes(otherContext, store);
  const other = await otherContext.newPage();
  await other.goto(page.url());
  await expect(other.locator('.subtitle-filename')).toHaveText('Português.srt');
  await other.getByRole('button', { name: 'Remover legenda', exact: true }).click();
  await expect(other.locator('track')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('track')).toHaveCount(0);
  await upload(page);
  await expect(page.locator('track')).toHaveCount(1);
  await page.getByRole('button', { name: 'Escolher vídeo', exact: true }).click();
  await page.locator('.select-video').filter({ hasText: 'Outro vídeo' }).click();
  await expect(page.getByRole('button', { name: 'Reproduzir Outro vídeo', exact: true })).toBeVisible();
  await expect(page.locator('track,.subtitle-filename')).toHaveCount(0);
  await otherContext.close();
});

test('troca remota de legenda preserva o tempo e o vídeo em reprodução', async ({ page, store }) => {
  store.subtitles.set(firstId, savedSubtitle('Inicial.srt', captions));
  await page.goto('/');
  await page.locator('.catalog-card').first().getByRole('link', { name: 'Assistir Vídeo com legenda', exact: true }).click();
  await start(page);
  await expect.poll(() => cue(page)).toBe('Olá, coração!\nSegunda linha.');
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 3; });
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(3);
  store.subtitles.set(firstId, savedSubtitle('Da rede.srt', '1\n00:00:00,000 --> 00:00:05,000\nRecebida da rede.\n'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.subtitle-filename')).toHaveText('Da rede.srt');
  await expect.poll(() => cue(page)).toBe('Recebida da rede.');
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(3);
});

test('arquivo inválido e falha ao salvar preservam a legenda anterior; conflito atualiza sem sobrescrever', async ({ page, store }) => {
  store.subtitles.set(firstId, savedSubtitle('Original.srt', captions));
  await page.goto('/');
  await page.locator('.catalog-card').first().getByRole('link', { name: 'Assistir Vídeo com legenda', exact: true }).click();
  await upload(page, 'Inválida.srt', '1\nHorários inválidos\nTexto\n');
  await expect(page.getByRole('alert')).toContainText('horários SRT válidos');
  await expect(page.locator('.subtitle-filename')).toHaveText('Original.srt');
  store.failWrite = true;
  await upload(page, 'Tentativa.srt');
  await expect(page.getByRole('alert')).toContainText('A legenda anterior foi preservada');
  await expect(page.locator('.subtitle-filename')).toHaveText('Original.srt');
  store.failWrite = false;
  store.subtitles.set(firstId, savedSubtitle('Atualizada na rede.srt', captions));
  await upload(page, 'Não sobrescrever.srt');
  await expect(page.getByRole('alert')).toContainText('A legenda mudou em outro aparelho');
  await expect(page.locator('.subtitle-filename')).toHaveText('Atualizada na rede.srt');
  expect(store.subtitles.get(firstId)?.filename).toBe('Atualizada na rede.srt');
});

test('carregar SRT no modo Drive muda para reprodução direta e cabe na tela móvel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.catalog-card').first().getByRole('link', { name: 'Assistir Vídeo com legenda', exact: true }).click();
  await page.getByRole('button', { name: 'Player do Drive', exact: true }).click();
  await expect(page.getByText('SRT usa a reprodução direta.', { exact: true })).toBeVisible();
  await upload(page, 'Legenda com um nome muito longo para testar a tela móvel.srt');
  await expect(page.getByRole('button', { name: 'Reprodução direta', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('video track')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/muvies-srt-mobile.png', fullPage: true });
});

test('falha da faixa de legenda não mostra erro de vídeo nem pede autenticação', async ({ page, store }) => {
  store.subtitles.set(firstId, savedSubtitle('Indisponível.srt', captions));
  store.brokenTrack = true;
  await page.goto('/');
  await page.locator('.catalog-card').first().getByRole('link', { name: 'Assistir Vídeo com legenda', exact: true }).click();
  await start(page);
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a legenda');
  await expect(page.locator('.player-error')).toHaveCount(0);
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
  store.brokenTrack = false;
  store.subtitles.set(firstId, savedSubtitle('Corrigida.srt', '1\n00:00:00,000 --> 00:00:05,000\nLegenda recuperada.\n'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => cue(page)).toBe('Legenda recuperada.');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
