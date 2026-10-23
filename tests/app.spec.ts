import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function addDriveVideo(page: Page, title = 'Nossa viagem') {
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill('https://drive.google.com/file/d/1234567890abcdef/view?usp=sharing');
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page.getByLabel('Gênero', { exact: true }).fill('Viagens');
  await page.getByRole('button', { name: 'Adicionar à biblioteca' }).click();
}

test('biblioteca: selecionar, filtrar e pesquisar vídeos', async ({ page }) => {
  const exceptions: string[] = [];
  page.on('pageerror', error => exceptions.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Seu cinema. Do seu jeito.' })).toBeVisible();
  await expect(page.locator('.video-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Natureza', exact: true }).click();
  await expect(page.locator('.video-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Escolher vídeo' }).click();
  await page.getByLabel('Buscar vídeo').fill('instante');
  await page.locator('.dropdown-options').getByRole('button', { name: /Um instante na natureza/ }).click();
  await expect(page.getByRole('heading', { name: 'Um instante na natureza', exact: true })).toBeVisible();
  await expect(page.locator('.now-playing strong')).toHaveText('Um instante na natureza');
  await expect(page.locator('.dropdown')).not.toBeVisible();
  await expect(page.locator('.active-card')).toHaveCount(1);
  expect(exceptions).toEqual([]);
});

test('links do Drive: adicionar, persistir, editar e remover sem apagar o arquivo', async ({ page }) => {
  await page.goto('/');
  await addDriveVideo(page);
  await expect(page.getByRole('heading', { name: 'Nossa viagem', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.video-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Player do Drive', exact: true }).click();
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', 'https://drive.google.com/file/d/1234567890abcdef/preview');
  await expect(page.locator('iframe')).toHaveAttribute('allowfullscreen', '');
  await page.getByRole('button', { name: 'Editar Nossa viagem' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Férias em família');
  await page.getByLabel('Gênero', { exact: true }).fill('Família');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await page.getByRole('button', { name: 'Família', exact: true }).click();
  await expect(page.locator('.video-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Editar Férias em família' }).click();
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(page.locator('.video-card')).toHaveCount(2);
  await expect(page.getByRole('status')).toContainText('O arquivo continua no seu Drive.');
  await page.reload();
  await expect(page.locator('.video-card')).toHaveCount(2);
});

test('rejeita links inválidos e não duplica um vídeo existente', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill('https://example.com/file/d/1234567890abcdef/view');
  await page.getByLabel('Título', { exact: true }).fill('Inválido');
  await page.getByRole('button', { name: 'Adicionar à biblioteca' }).click();
  await expect(page.getByRole('alert')).toContainText('Cole um link de vídeo do Google Drive');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await addDriveVideo(page);
  await addDriveVideo(page);
  await expect(page.locator('.video-card')).toHaveCount(3);
  await expect(page.getByRole('status')).toContainText('já está na sua biblioteca');
});

test('layout móvel e acesso por teclado aos diálogos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reproduzir Big Buck Bunny' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Como funciona' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Escolher vídeo' }).click();
  await expect(page.getByLabel('Buscar vídeo')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dropdown')).not.toBeVisible();
  await page.screenshot({ path: '/tmp/muvies-mobile.png', fullPage: true });
});

test('importação Google com paginação, preserva gêneros e não salva tokens (API simulada)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { google: unknown }).google = { accounts: { oauth2: { initTokenClient: (options: { scope: string; callback: (value: { access_token: string }) => void }) => {
      if (options.scope !== 'https://www.googleapis.com/auth/drive.readonly') throw new Error('Unexpected scope');
      return { requestAccessToken: () => options.callback({ access_token: 'test-token-not-a-real-credential' }) };
    } } } };
  });
  let requests = 0;
  await page.route('https://www.googleapis.com/drive/v3/files?*', async route => {
    requests++;
    expect(route.request().headers().authorization).toBe('Bearer test-token-not-a-real-credential');
    const secondPage = new URL(route.request().url()).searchParams.get('pageToken');
    await route.fulfill({ json: secondPage ? { files: [{ id: 'secondDriveVideo', name: 'Outro vídeo.mp4', mimeType: 'video/mp4' }] } : { files: [{ id: '1234567890abcdef', name: 'Original.mp4', mimeType: 'video/mp4' }], nextPageToken: 'next-page' } });
  });
  await page.goto('/');
  await addDriveVideo(page);
  await page.getByRole('button', { name: 'Conectar Drive', exact: true }).click();
  await page.getByLabel('Client ID do Google').fill('example.apps.googleusercontent.com');
  await page.getByRole('button', { name: 'Continuar com o Google' }).click();
  await expect(page.getByRole('status')).toContainText('2 vídeo(s) encontrado(s)');
  await expect(page.locator('.video-card')).toHaveCount(2);
  await expect(page.locator('.video-card').first()).toContainText('Nossa viagem');
  await expect(page.locator('.video-card').first()).toContainText('Viagens');
  expect(requests).toBe(2);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-token');
});

test('reprodução real da demonstração e imagens carregadas', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Reproduzir Big Buck Bunny' }).click();
  await expect.poll(async () => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(page.locator('.player-error')).toHaveCount(0);
  await expect.poll(async () => page.locator('.video-card img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause());
});

test('Drive em processamento: oferece diagnóstico e recarrega apenas o player', async ({ page }) => {
  let requests = 0;
  await page.route('https://drive.google.com/file/d/1234567890abcdef/preview', async route => {
    requests++;
    await route.fulfill({ contentType: 'text/html', body: '<p>Este arquivo de vídeo ainda está sendo processado para reprodução. Tente de novo mais tarde.</p>' });
  });
  await page.goto('/');
  await addDriveVideo(page);
  const help = page.getByRole('complementary', { name: 'Ajuda com a reprodução do Drive' });
  await expect(help.getByRole('link', { name: 'Abrir no Drive' })).toHaveAttribute('href', 'https://drive.google.com/file/d/1234567890abcdef/view');
  await expect(help.getByRole('button', { name: 'Recarregar player' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Player do Drive', exact: true }).click();
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect.poll(() => requests).toBe(1);
  await help.getByText('O Drive diz que o vídeo ainda está sendo processado?').click();
  await expect(help).toContainText('Esse modo não usa a prévia processada pelo Google.');
  await help.getByRole('button', { name: 'Recarregar player' }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('.video-card')).toHaveCount(3);
  await expect(page.locator('.now-playing')).toContainText('Vídeo selecionado');
  await expect(page.locator('.now-playing')).not.toContainText('Você está assistindo');
});

test('reprodução direta usa o original em um vídeo HTML5, sem iframe', async ({ page }) => {
  const original = await readFile(new URL('../public/media/flower.mp4', import.meta.url));
  await page.route('**/api/drive/media/1234567890abcdef', route => route.fulfill({ contentType: 'video/mp4', body: original }));
  await page.goto('/');
  await addDriveVideo(page);
  await expect(page.getByRole('button', { name: 'Reprodução direta', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect(page.locator('video')).toHaveAttribute('src', '/api/drive/media/1234567890abcdef');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 3; });
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.player-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Player do Drive', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', 'https://drive.google.com/file/d/1234567890abcdef/preview');
});

test('reprodução privada pede conexão de leitura quando o original exige autorização', async ({ page }) => {
  await page.route('**/api/drive/media/1234567890abcdef', route => route.fulfill({ status: 401, headers: { 'X-Muvies-Error': 'AUTH_REQUIRED' }, json: { code: 'AUTH_REQUIRED' } }));
  await page.goto('/');
  await addDriveVideo(page);
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect(page.locator('.player-error')).toContainText('O Google está exigindo login');
  await page.locator('.player-error').getByRole('button', { name: 'Conectar Drive', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('drive.readonly');
});

test('link com resourcekey atualiza o vídeo existente e preserva a chave após recarregar', async ({ page }) => {
  await page.goto('/');
  await addDriveVideo(page);
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill('https://drive.google.com/file/d/1234567890abcdef/view?resourcekey=shared-file-key');
  await page.getByLabel('Título', { exact: true }).fill('Outro nome');
  await page.getByRole('button', { name: 'Adicionar à biblioteca' }).click();
  await expect(page.locator('.video-card')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Nossa viagem', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('video')).toHaveAttribute('src', '/api/drive/media/1234567890abcdef?resourceKey=shared-file-key');
  await expect(page.getByRole('link', { name: 'Abrir no Drive', exact: true })).toHaveAttribute('href', 'https://drive.google.com/file/d/1234567890abcdef/view?resourcekey=shared-file-key');
});

test('falha no download público não pede Client ID sem evidência de login', async ({ page }) => {
  await page.route('**/api/drive/media/1234567890abcdef', route => route.fulfill({ status: 502,
    headers: { 'X-Muvies-Error': 'PUBLIC_DOWNLOAD_UNAVAILABLE' }, json: { code: 'PUBLIC_DOWNLOAD_UNAVAILABLE' } }));
  await page.goto('/');
  await addDriveVideo(page);
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem' }).click();
  await expect(page.locator('.player-error')).toContainText('Não é necessário configurar Client ID');
  await expect(page.locator('.player-error').getByRole('button', { name: 'Conectar Drive', exact: true })).toHaveCount(0);
});
