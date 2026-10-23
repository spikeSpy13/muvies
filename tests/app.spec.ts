import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Video } from '../src/library';

type LibraryStore = { videos: Video[]; revision: string; writes: number; failWrite: boolean; conflictOnce: boolean };
const firstId = '1234567890abcdef';
function video(id: string, title: string, genre = 'Viagens'): Video {
  return { id: `drive-${id}`, driveId: id, title, genre, source: 'drive', url: `https://drive.google.com/file/d/${id}/preview` };
}
async function libraryRoutes(context: BrowserContext, library: LibraryStore) {
  await context.route('**/api/library', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { videos: library.videos, revision: library.revision } });
    if (library.failWrite) return route.fulfill({ status: 500, json: { message: 'Não foi possível salvar os links no computador. A biblioteca anterior foi preservada.' } });
    if (library.conflictOnce) {
      library.conflictOnce = false;
      library.videos.push(video('anotherDeviceId', 'Adicionado em outro aparelho', 'Família'));
      library.revision = 'remote-update';
    }
    if (route.request().headers()['if-match'] !== library.revision) return route.fulfill({ status: 409, json: { message: 'A lista mudou em outro aparelho.' } });
    library.videos = route.request().postDataJSON().videos;
    library.revision = `saved-${++library.writes}`;
    return route.fulfill({ json: { videos: library.videos, revision: library.revision } });
  });
}
const test = base.extend<{ library: LibraryStore }>({
  library: async ({ context }, use) => {
    const library: LibraryStore = { videos: [], revision: '0', writes: 0, failWrite: false, conflictOnce: false };
    await libraryRoutes(context, library);
    await use(library);
  },
  page: async ({ page, library }, use) => { void library; await use(page); },
});
async function addDriveVideo(page: Page, title = 'Nossa viagem', id = firstId, genre = 'Viagens') {
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${id}/view?usp=sharing`);
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page.getByLabel('Gênero', { exact: true }).fill(genre);
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('inicia sem demonstrações, com a lista acima do player vazio', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Seu próximo vídeo começa aqui' })).toBeVisible();
  await expect(page.locator('h1')).toContainText('Seus vídeos');
  await expect(page.locator('video,iframe,.video-card,.collection')).toHaveCount(0);
  await expect(page.getByText('Lista salva no aplicativo', { exact: true })).toBeVisible();
  const list = await page.getByRole('button', { name: 'Escolher vídeo' }).boundingBox();
  const player = await page.locator('.player').boundingBox();
  expect(list!.y + list!.height).toBeLessThan(player!.y);
  expect(requests.some(url => url.includes('/media/'))).toBe(false);
});

test('links são salvos no aplicativo e aparecem em outro navegador sem localStorage', async ({ page, browser, library }) => {
  await page.goto('/');
  await addDriveVideo(page);
  expect(library.videos[0].driveId).toBe(firstId);
  expect(library.writes).toBe(1);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nossa viagem', exact: true })).toBeVisible();
  const second = await browser.newContext();
  await libraryRoutes(second, library);
  const another = await second.newPage();
  await another.goto(page.url());
  await expect(another.getByRole('heading', { name: 'Nossa viagem', exact: true })).toBeVisible();
  expect(await another.evaluate(() => localStorage.getItem('muvies.library.v1'))).toContain(firstId);
  await second.close();
});

test('listas por gênero, busca e seleção acima do player', async ({ page }) => {
  await page.goto('/');
  await addDriveVideo(page);
  await addDriveVideo(page, 'Almoço de domingo', 'familyVideo12345', 'Família');
  await page.getByRole('button', { name: 'Viagens', exact: true }).click();
  await page.getByRole('button', { name: 'Escolher vídeo' }).click();
  await expect(page.locator('.select-video')).toHaveCount(1);
  await page.getByLabel('Buscar vídeo').fill('viagem');
  await page.locator('.select-video').click();
  await expect(page.getByRole('heading', { name: 'Nossa viagem', exact: true })).toBeVisible();
  await expect(page.locator('.dropdown')).not.toBeVisible();
});

test('edita e remove o último link sem reaparecer vídeo de demonstração', async ({ page, library }) => {
  await page.goto('/');
  await addDriveVideo(page);
  await page.getByRole('button', { name: 'Editar Nossa viagem', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Férias em família');
  await page.getByLabel('Gênero', { exact: true }).fill('Família');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('heading', { name: 'Férias em família', exact: true })).toBeVisible();
  expect(library.videos[0].genre).toBe('Família');
  await page.getByRole('button', { name: 'Editar Férias em família', exact: true }).click();
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu próximo vídeo começa aqui' })).toBeVisible();
  expect(library.videos).toEqual([]);
  await page.reload();
  await expect(page.locator('video,iframe')).toHaveCount(0);
});

test('rejeita links inválidos, evita duplicatas e preserva resourcekey', async ({ page, library }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill('https://example.com/file/d/1234567890abcdef/view');
  await page.getByLabel('Título', { exact: true }).fill('Inválido');
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('alert')).toContainText('Cole um link de vídeo do Google Drive');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await addDriveVideo(page);
  await addDriveVideo(page);
  expect(library.videos).toHaveLength(1);
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${firstId}/view?resourcekey=shared-file-key`);
  await page.getByLabel('Título', { exact: true }).fill('Outro nome');
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('video')).toHaveAttribute('src', `/api/drive/media/${firstId}?resourceKey=shared-file-key`);
  expect(library.videos[0].title).toBe('Nossa viagem');
});

test('migra os links antigos do navegador uma vez sem ressuscitar uma lista apagada', async ({ context, page, library }) => {
  await context.addInitScript(record => localStorage.setItem('muvies.library.v1', JSON.stringify([record])), video(firstId, 'Link antigo'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Link antigo', exact: true })).toBeVisible();
  expect(library.writes).toBe(1);
  await page.getByRole('button', { name: 'Editar Link antigo', exact: true }).click();
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu próximo vídeo começa aqui' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Seu próximo vídeo começa aqui' })).toBeVisible();
  expect(library.videos).toEqual([]);
});

test('falha ao gravar mantém o formulário e não afirma que o link foi salvo', async ({ page, library }) => {
  await page.goto('/');
  await expect(page.getByText('Lista salva no aplicativo', { exact: true })).toBeVisible();
  library.failWrite = true;
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${firstId}/view`);
  await page.getByLabel('Título', { exact: true }).fill('Sem perder o formulário');
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('alert')).toContainText('A biblioteca anterior foi preservada');
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Sem perder o formulário');
  expect(library.videos).toEqual([]);
  library.failWrite = false;
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(library.videos).toHaveLength(1);
});

test('conflitos não apagam links adicionados em outro aparelho', async ({ page, library }) => {
  await page.goto('/');
  await expect(page.getByText('Lista salva no aplicativo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${firstId}/view`);
  await page.getByLabel('Título', { exact: true }).fill('Meu link');
  library.conflictOnce = true;
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('alert')).toContainText('A lista mudou em outro aparelho');
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(library.videos.map(item => item.title)).toEqual(['Adicionado em outro aparelho', 'Meu link']);
});

test('listas abertas recebem alterações de outro aparelho e removem o vídeo excluído', async ({ page, library }) => {
  await page.goto('/');
  await addDriveVideo(page);
  library.videos.push(video('otherDeviceVideo', 'Recebido da rede'));
  library.revision = 'network-added';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('h1>span')).toHaveText('2');
  library.videos = [];
  library.revision = 'network-cleared';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Seu próximo vídeo começa aqui' })).toBeVisible();
});

test('layout móvel e acesso por teclado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Seu próximo vídeo começa aqui' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Como funciona' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Escolher vídeo' }).click();
  await expect(page.getByLabel('Buscar vídeo')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dropdown')).not.toBeVisible();
  await page.screenshot({ path: '/tmp/muvies-simple-mobile.png', fullPage: true });
});

test('importa o Drive com paginação preservando títulos e gêneros na lista compartilhada (Google simulado)', async ({ page, library }) => {
  let releaseImport: (() => void) | undefined;
  await page.addInitScript(() => {
    (window as unknown as { google: unknown }).google = { accounts: { oauth2: { initTokenClient: (options: { scope: string; callback: (value: { access_token: string }) => void }) => {
      if (options.scope !== 'https://www.googleapis.com/auth/drive.readonly') throw new Error('Unexpected scope');
      return { requestAccessToken: () => options.callback({ access_token: 'test-token-not-a-real-credential' }) };
    } } } };
  });
  await page.route('https://www.googleapis.com/drive/v3/files?*', async route => {
    const second = new URL(route.request().url()).searchParams.get('pageToken');
    if (!second) await new Promise<void>(resolve => { releaseImport = resolve; });
    await route.fulfill({ json: second ? { files: [{ id: 'secondDriveVideo', name: 'Outro vídeo.mp4', mimeType: 'video/mp4' }] } : { files: [{ id: firstId, name: 'Original.mp4', mimeType: 'video/mp4' }], nextPageToken: 'next-page' } });
  });
  await page.goto('/');
  await addDriveVideo(page);
  await page.getByRole('button', { name: 'Conectar Drive', exact: true }).click();
  await page.getByLabel('Client ID do Google').fill('example.apps.googleusercontent.com');
  await page.getByRole('button', { name: 'Continuar com o Google' }).click();
  await expect.poll(() => !!releaseImport).toBe(true);
  library.videos.push(video('concurrentLanVideo', 'Adicionado durante a importação'));
  library.revision = 'changed-during-oauth';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('h1>span')).toHaveText('2');
  releaseImport!();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(library.videos).toHaveLength(3);
  expect(library.videos.some(item => item.title === 'Adicionado durante a importação')).toBe(true);
  expect(library.videos[0]).toMatchObject({ title: 'Nossa viagem', genre: 'Viagens' });
  expect(JSON.stringify(library)).not.toContain('test-token');
});

test('migração concorrente carrega a biblioteca já salva sem bloquear a tela', async ({ context, page, library }) => {
  library.conflictOnce = true;
  await context.addInitScript(record => localStorage.setItem('muvies.library.v1', JSON.stringify([record])), video(firstId, 'Link antigo'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Adicionado em outro aparelho', exact: true })).toBeVisible();
  await expect(page.getByText('Lista salva no aplicativo', { exact: true })).toBeVisible();
  await expect(page.locator('.storage-problem')).toHaveCount(0);
});

test('vídeo inicial é interrompido quando a rede remove a seleção durante a reprodução', async ({ page, library }) => {
  const original = await readFile(new URL('./fixtures/native-video.mp4', import.meta.url));
  library.videos = [video(firstId, 'Vídeo inicial')];
  library.revision = 'existing-library';
  await page.route(`**/api/drive/media/${firstId}`, route => route.fulfill({ contentType: 'video/mp4', body: original }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Reproduzir Vídeo inicial' }).click();
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  library.videos = [video('newNetworkVideo', 'Nova seleção')];
  library.revision = 'selection-removed';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Reproduzir Nova seleção' })).toBeVisible();
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
});

test('player HTML5 reproduz e avança um original sem iframe, mantendo alternativa do Drive', async ({ page }) => {
  const original = await readFile(new URL('./fixtures/native-video.mp4', import.meta.url));
  await page.route(`**/api/drive/media/${firstId}`, route => route.fulfill({ contentType: 'video/mp4', body: original }));
  await page.route(`https://drive.google.com/file/d/${firstId}/preview`, route => route.fulfill({ contentType: 'text/html', body: '<p>Player do Drive</p>' }));
  await page.goto('/');
  await addDriveVideo(page);
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 3; });
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(3);
  await page.getByRole('button', { name: 'Player do Drive', exact: true }).click();
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', `https://drive.google.com/file/d/${firstId}/preview`);
});

test('login real e falha pública têm orientações diferentes', async ({ page }) => {
  let code = 'AUTH_REQUIRED';
  await page.route(`**/api/drive/media/${firstId}`, route => route.fulfill({ status: code === 'AUTH_REQUIRED' ? 401 : 502, headers: { 'X-Muvies-Error': code }, json: { code } }));
  await page.goto('/');
  await addDriveVideo(page);
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect(page.locator('.player-error')).toContainText('O Google está exigindo login');
  await expect(page.locator('.player-error').getByRole('button', { name: 'Conectar Drive', exact: true })).toBeVisible();
  code = 'PUBLIC_DOWNLOAD_UNAVAILABLE';
  await page.getByRole('button', { name: 'Recarregar player', exact: true }).click();
  await expect(page.locator('.player-error')).toContainText('Não é necessário configurar Client ID');
  await expect(page.locator('.player-error').getByRole('button', { name: 'Conectar Drive', exact: true })).toHaveCount(0);
});
