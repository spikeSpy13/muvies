import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const id = 'recordingVideo123';
async function openPlayer(page: Page, compatible = true) {
  const original = await readFile(new URL('./fixtures/native-video.mp4', import.meta.url));
  await page.route('**/api/library', route => route.fulfill({ json: { revision: 'saved-library', videos: [id, 'otherRecording123'].map((driveId, index) => ({ id: `drive-${driveId}`, driveId, title: index ? 'Outro filme' : 'Cena de teste', genre: 'Filmes', source: 'drive', url: `https://drive.google.com/file/d/${driveId}/preview` })) } }));
  await page.route('**/api/subtitles/**', route => route.fulfill({ json: { subtitle: null } }));
  await page.route('**/api/drive/media/*', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({ contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: original });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), original.length - 1) : original.length - 1;
    return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${original.length}` }, body: original.subarray(start, end + 1) });
  });
  await page.goto(`/?filme=drive-${id}`);
  const play = page.getByRole('button', { name: 'Reproduzir Cena de teste', exact: true });
  if (await play.isVisible()) await play.click();
  if (compatible) await expect(page.getByRole('button', { name: 'Gravar cena', exact: true })).toBeEnabled();
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).loop = true; });
}
async function savedClips(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/recording-store.ts');
    return store.listRecordings();
  });
}

test('grava imagem e áudio reais, persiste durante captura, pausa sem pausar o vídeo e baixa ao parar', async ({ page }) => {
  await openPlayer(page);
  await page.getByRole('button', { name: 'Gravar cena', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Gravando/ })).toBeVisible();
  await expect.poll(async () => (await savedClips(page))[0]?.bytes || 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pausar gravação', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continuar gravação', exact: true })).toBeVisible();
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
  const status = page.getByRole('status').filter({ hasText: /^Gravação pausada/ });
  const frozen = await status.textContent();
  const before = await page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime);
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).not.toBe(before);
  expect(await status.textContent()).toBe(frozen);
  await page.getByRole('button', { name: 'Continuar gravação', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Gravando/ })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Parar e salvar', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^Cena de teste - cena .*\.webm$/);
  expect(await download.failure()).toBeNull();
  const data = await readFile((await download.path())!);
  expect(data.length).toBeGreaterThan(1000);
  expect(data.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  await download.saveAs('/tmp/muvies-recording-test.webm');
  const media = await page.evaluate(async bytes => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video') as HTMLVideoElement & { captureStream(): MediaStream };
    video.muted = true; video.src = url;
    await video.play();
    const stream = video.captureStream();
    const result = { width: video.videoWidth, height: video.videoHeight, video: stream.getVideoTracks().length, audio: stream.getAudioTracks().length };
    video.pause(); stream.getTracks().forEach(track => track.stop()); URL.revokeObjectURL(url);
    return result;
  }, [...data]);
  expect(media.width).toBeGreaterThan(0);
  expect(media.height).toBeGreaterThan(0);
  expect(media.video).toBe(1);
  expect(media.audio).toBe(1);
  await expect(page.getByRole('button', { name: 'Baixar trecho de Cena de teste', exact: true })).toBeVisible();
  const clips = await savedClips(page);
  expect(clips[0].complete).toBe(true);
  expect(clips[0].bytes).toBe(data.length);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Baixar trecho de Cena de teste', exact: true })).toBeVisible();
  const retry = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar trecho de Cena de teste', exact: true }).click();
  expect(await (await retry).failure()).toBeNull();
  await page.getByRole('button', { name: 'Excluir cópia local de Cena de teste', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Baixar trecho de Cena de teste', exact: true })).toHaveCount(0);
  expect(await savedClips(page)).toEqual([]);
});

test('pausa junto ao vídeo e finaliza ao trocar de filme; modo Drive não oferece captura', async ({ page }) => {
  await openPlayer(page);
  await page.getByRole('button', { name: 'Gravar cena', exact: true }).click();
  await expect.poll(async () => (await savedClips(page))[0]?.bytes || 0).toBeGreaterThan(0);
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause());
  await expect(page.getByRole('status').filter({ hasText: /^Gravação pausada/ })).toBeVisible();
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).play());
  await expect(page.getByRole('status').filter({ hasText: /^Gravando/ })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Escolher vídeo', exact: true }).click();
  await page.locator('.select-video').filter({ hasText: 'Outro filme' }).click();
  expect(await (await downloadEvent).failure()).toBeNull();
  await expect(page.getByRole('button', { name: 'Baixar trecho de Cena de teste', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Player do Drive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gravar cena', exact: true })).toBeDisabled();
  await expect(page.getByText('Para gravar cenas, selecione Reprodução direta.', { exact: true })).toBeVisible();
});

test('informa incompatibilidade sem pedir câmera, microfone ou captura de tela', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'MediaRecorder', { value: undefined }); });
  await openPlayer(page, false);
  await expect(page.getByRole('button', { name: 'Gravar cena', exact: true })).toBeDisabled();
  await expect(page.getByText('Gravação indisponível neste navegador.', { exact: false })).toBeVisible();
});

test('terminar o vídeo salva automaticamente e voltar ao catálogo preserva a cópia local', async ({ page }) => {
  await openPlayer(page);
  await page.getByRole('button', { name: 'Gravar cena', exact: true }).click();
  await expect.poll(async () => (await savedClips(page))[0]?.bytes || 0).toBeGreaterThan(0);
  const download = page.waitForEvent('download');
  await page.locator('video').evaluate(video => { const player = video as HTMLVideoElement; player.loop = false; player.currentTime = player.duration - 0.5; });
  expect(await (await download).failure()).toBeNull();
  await page.getByRole('button', { name: 'Reproduzir Cena de teste', exact: true }).click();
  await page.getByRole('button', { name: 'Gravar cena', exact: true }).click();
  await expect.poll(async () => (await savedClips(page)).length).toBe(2);
  await expect.poll(async () => (await savedClips(page)).every(clip => clip.bytes > 0)).toBe(true);
  await page.getByRole('button', { name: 'Voltar ao catálogo', exact: true }).click();
  await expect.poll(async () => (await savedClips(page)).every(clip => clip.complete)).toBe(true);
  await page.locator('.catalog-card').first().getByRole('link', { name: 'Assistir Cena de teste', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Baixar trecho de Cena de teste', exact: true })).toHaveCount(2);
});

test('armazenamento indisponível impede gravar sem fingir que o trecho foi salvo', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
  await openPlayer(page);
  await page.getByRole('button', { name: 'Gravar cena', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Verifique o espaço disponível');
  await expect(page.getByRole('button', { name: 'Parar e salvar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gravar cena', exact: true })).toBeEnabled();
});

test('controles de gravação e trechos locais cabem na tela móvel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlayer(page);
  await page.getByRole('button', { name: 'Gravar cena', exact: true }).click();
  await expect.poll(async () => (await savedClips(page))[0]?.bytes || 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pausar gravação', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.scene-recorder').screenshot({ path: '/tmp/muvies-recording-mobile.png' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Parar e salvar', exact: true }).click();
  expect(await (await download).failure()).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
