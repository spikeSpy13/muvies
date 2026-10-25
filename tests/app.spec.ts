import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
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
  const original = await readFile(new URL('./fixtures/native-video.mp4', import.meta.url));
  await context.route('**/api/drive/media/*', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({ contentType: 'video/mp4', body: original, headers: { 'Accept-Ranges': 'bytes' } });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), original.length - 1) : original.length - 1;
    return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${original.length}` }, body: original.subarray(start, end + 1) });
  });
  await context.route('**/api/subtitles/**', route => route.fulfill({ json: { subtitle: null } }));
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
function card(page: Page, title = 'Nossa viagem') {
  return page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
async function watch(page: Page, title = 'Nossa viagem') {
  await card(page, title).getByRole('link', { name: `Assistir ${title}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sala de projeção', exact: true })).toBeVisible();
}

type ImageStore = { files: Map<string, Buffer>; uploads: number; fail: boolean };
async function imageRoutes(context: BrowserContext, store: ImageStore = { files: new Map(), uploads: 0, fail: false }) {
  await context.route('**/api/images', async route => {
    store.uploads++;
    if (store.fail) return route.fulfill({ status: 500, json: { message: 'Não foi possível salvar a imagem no computador.' } });
    const bytes = await sharp(route.request().postDataBuffer()!).webp().toBuffer();
    const url = `/api/images/${createHash('sha256').update(bytes).digest('hex')}.webp`;
    store.files.set(url, bytes);
    return route.fulfill({ status: 201, json: { url } });
  });
  await context.route('**/api/images/*', route => {
    const bytes = store.files.get(new URL(route.request().url()).pathname);
    return bytes ? route.fulfill({ contentType: 'image/webp', body: bytes }) : route.fulfill({ status: 404 });
  });
  return store;
}
async function artworkFile(poster = true) {
  return { name: poster ? 'Pôster.png' : 'Destaque.png', mimeType: 'image/png', buffer: await sharp({ create: { width: poster ? 120 : 320, height: 180, channels: 3, background: poster ? '#c8372d' : '#335b68' } }).png().toBuffer() };
}

test('catálogo editorial começa vazio, sem player, demonstrações ou conexão Google', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'THE METROPOLIS', exact: true })).toHaveCount(0);
  await expect(page.locator('.catalog-feature,.masthead')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'O seu cinema começa aqui.' })).toBeVisible();
  await expect(page.locator('video,iframe,.catalog-card')).toHaveCount(0);
  await expect(page.getByText('Lista salva no aplicativo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Conectar Drive|Sincronizar Drive/ })).toHaveCount(0);
  expect(requests.some(url => /accounts\.google|googleapis\.com|\/api\/drive\/session|\/api\/drive\/media/.test(url))).toBe(false);
  await expect(page.getByRole('navigation', { name: 'Filtrar por gênero' })).toBeVisible();
});

test('links aparecem no catálogo de outro navegador e persistem sem localStorage', async ({ page, browser, library }) => {
  await page.goto('/');
  await addDriveVideo(page);
  expect(library.videos[0].driveId).toBe(firstId);
  expect(library.writes).toBe(1);
  await expect(card(page)).toHaveCount(1);
  await expect(page.locator('video')).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(card(page)).toHaveCount(1);
  const second = await browser.newContext();
  await libraryRoutes(second, library);
  const another = await second.newPage();
  await another.goto(page.url());
  await expect(card(another)).toHaveCount(1);
  await second.close();
});

test('busca por título, direção e ano, gêneros e detalhes editoriais são funcionais', async ({ page, library }) => {
  library.videos = [{ ...video(firstId, 'Nossa viagem'), director: 'Clara Monteiro', year: '1971', description: 'Uma história junto ao mar.' }, video('familyVideo12345', 'Almoço de domingo', 'Família')];
  library.revision = 'existing';
  await page.goto('/');
  await expect(page.locator('.catalog-card')).toHaveCount(2);
  for (const query of ['viagem', 'Clara', '1971']) {
    await page.getByRole('searchbox', { name: 'Buscar no catálogo' }).fill(query);
    await expect(card(page)).toHaveCount(1);
    await expect(page.locator('.catalog-card')).toHaveCount(1);
  }
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Família', exact: true }).click();
  await expect(card(page, 'Almoço de domingo')).toHaveCount(1);
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('searchbox').fill('não existe');
  await expect(page.getByRole('heading', { name: 'Nenhum filme encontrado', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver catálogo completo' }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(2);
});

test('edita detalhes e remove o último filme sem ressuscitar conteúdo', async ({ page, library }) => {
  await page.goto('/');
  await addDriveVideo(page);
  await card(page).getByRole('button', { name: 'Editar Nossa viagem', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Férias em família');
  await page.getByLabel('Gênero', { exact: true }).fill('Família');
  await page.getByText('Detalhes do filme (opcional)', { exact: true }).click();
  await page.getByLabel('Direção', { exact: true }).fill('Clara Monteiro');
  await page.getByLabel('Ano', { exact: true }).fill('2026');
  await page.getByLabel('Sinopse', { exact: true }).fill('Acentos, ação e coração.\nUma nova linha.');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(card(page, 'Férias em família')).toBeVisible();
  expect(library.videos[0]).toMatchObject({ genre: 'Família', director: 'Clara Monteiro', year: '2026', description: 'Acentos, ação e coração.\nUma nova linha.' });
  await page.reload();
  await card(page, 'Férias em família').getByRole('button', { name: 'Editar Férias em família', exact: true }).click();
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'O seu cinema começa aqui.' })).toBeVisible();
  expect(library.videos).toEqual([]);
  await page.reload();
  await expect(page.locator('.catalog-card,video,iframe')).toHaveCount(0);
});

test('combina gênero, ano, país e busca sem destaque, preservando filtros ao voltar do player', async ({ page, library }) => {
  library.videos = [
    { ...video(firstId, 'Nossa viagem', 'Drama'), year: '2024', country: 'Brasil' },
    { ...video('otherBrazilDrama', 'Outra história', 'Drama'), year: '2023', country: 'Brasil' },
    { ...video('frenchDrama2024', 'Encontro em Paris', 'Drama'), year: '2024', country: 'França' },
    { ...video('comedyBrazil2024', 'Domingo de sol', 'Comédia'), year: '2024', country: 'Brasil' },
    video('legacyVideo12345', 'Filme sem detalhes', 'Arquivo'),
  ];
  library.revision = 'existing';
  await page.goto('/');
  await expect(page.locator('.catalog-card')).toHaveCount(5);
  await expect(page.locator('.catalog-feature,.masthead')).toHaveCount(0);
  await expect(page.getByText('THE METROPOLIS', { exact: true })).toHaveCount(0);
  const year = page.getByRole('combobox', { name: 'Filtrar por ano', exact: true });
  const country = page.getByRole('combobox', { name: 'Filtrar por país', exact: true });
  await expect(year).toHaveValue('');
  await expect(country).toHaveValue('');
  await expect(year.locator('option')).toHaveText(['Todos os anos', '2024', '2023']);
  await expect(country.locator('option')).toHaveText(['Todos os países', 'Brasil', 'França']);
  await page.getByRole('button', { name: 'Drama', exact: true }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(3);
  await year.selectOption('2024');
  await expect(page.locator('.catalog-card')).toHaveCount(2);
  await country.selectOption('Brasil');
  await expect(page.locator('.catalog-card')).toHaveCount(1);
  await expect(card(page)).toBeVisible();
  await watch(page);
  await page.getByRole('button', { name: 'Voltar ao catálogo', exact: true }).click();
  await expect(year).toHaveValue('2024');
  await expect(country).toHaveValue('Brasil');
  await expect(page.getByRole('button', { name: 'Drama', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.catalog-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Buscar no catálogo' }).fill('Paris');
  await expect(page.getByRole('heading', { name: 'Nenhum filme encontrado', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(5);
  await expect(year).toHaveValue('');
  await expect(country).toHaveValue('');
  await expect(page.getByRole('searchbox', { name: 'Buscar no catálogo' })).toHaveValue('');
  library.videos.push({ ...video('networkDocumentary', 'Ilha distante', 'Documentário'), year: '2025', country: 'Portugal' });
  library.revision = 'network-added';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Documentário', exact: true })).toBeVisible();
  await expect(year.locator('option')).toHaveText(['Todos os anos', '2025', '2024', '2023']);
  await country.selectOption('Portugal');
  await expect(card(page, 'Ilha distante')).toBeVisible();
  await expect(page.locator('.catalog-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(6);
});

test('cadastro e edição salvam país e ano e atualizam os filtros após recarregar', async ({ page, library }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${firstId}/view`);
  await page.getByLabel('Título', { exact: true }).fill('Nossa viagem');
  await page.getByLabel('Gênero', { exact: true }).fill('Viagens');
  await page.getByLabel('Ano', { exact: true }).fill('2024');
  await page.getByLabel('País', { exact: true }).fill('Brasil');
  await page.getByRole('button', { name: 'Adicionar à lista', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(library.videos[0]).toMatchObject({ year: '2024', country: 'Brasil' });
  await page.reload();
  await card(page).getByRole('button', { name: 'Editar Nossa viagem', exact: true }).click();
  await expect(page.getByLabel('Ano', { exact: true })).toHaveValue('2024');
  await expect(page.getByLabel('País', { exact: true })).toHaveValue('Brasil');
  await page.getByLabel('Ano', { exact: true }).fill('2025');
  await page.getByLabel('País', { exact: true }).fill('Portugal');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(library.videos[0]).toMatchObject({ year: '2025', country: 'Portugal' });
  await page.reload();
  await page.getByRole('combobox', { name: 'Filtrar por ano', exact: true }).selectOption('2025');
  await page.getByRole('combobox', { name: 'Filtrar por país', exact: true }).selectOption('Portugal');
  await expect(card(page)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filtrar por país', exact: true }).locator('option')).toHaveText(['Todos os países', 'Portugal']);
});

test('rejeita links inválidos, evita duplicatas e preserva resourcekey ao abrir o player', async ({ page, library }) => {
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
  await watch(page);
  await expect(page.locator('video')).toHaveAttribute('src', `/api/drive/media/${firstId}?resourceKey=shared-file-key`);
  expect(library.videos[0].title).toBe('Nossa viagem');
});

test('migra links antigos uma vez e preserva o catálogo intencionalmente vazio', async ({ context, page, library }) => {
  await context.addInitScript(record => localStorage.setItem('muvies.library.v1', JSON.stringify([record])), video(firstId, 'Link antigo'));
  await page.goto('/');
  await expect(card(page, 'Link antigo')).toBeVisible();
  expect(library.writes).toBe(1);
  await card(page, 'Link antigo').getByRole('button', { name: 'Editar Link antigo', exact: true }).click();
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'O seu cinema começa aqui.' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.catalog-card')).toHaveCount(0);
  expect(library.videos).toEqual([]);
});

test('falha ao gravar mantém formulário e permite tentar novamente', async ({ page, library }) => {
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

test('conflitos não apagam filmes adicionados em outro aparelho', async ({ page, library }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${firstId}/view`);
  await page.getByLabel('Título', { exact: true }).fill('Meu filme');
  library.conflictOnce = true;
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('alert')).toContainText('A lista mudou em outro aparelho');
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(library.videos.map(item => item.title)).toEqual(['Adicionado em outro aparelho', 'Meu filme']);
});

test('catálogo recebe adições e remoções da rede', async ({ page, library }) => {
  await page.goto('/');
  await addDriveVideo(page);
  library.videos.push(video('otherDeviceVideo', 'Recebido da rede'));
  library.revision = 'network-added';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.catalog-card')).toHaveCount(2);
  library.videos = [];
  library.revision = 'network-cleared';
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'O seu cinema começa aqui.' })).toBeVisible({ timeout: 10000 });
});

test('Minha lista persiste no aplicativo, sincroniza e não abre o player ao marcar', async ({ page, browser, library }) => {
  library.videos = [video(firstId, 'Nossa viagem'), video('familyVideo12345', 'Almoço de domingo', 'Família')];
  library.revision = 'existing';
  await page.goto('/');
  await card(page).getByRole('button', { name: 'Adicionar à Minha lista: Nossa viagem', exact: true }).click();
  await expect(card(page).getByRole('button', { name: 'Remover da Minha lista: Nossa viagem', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(library.videos[0].favorite).toBe(true);
  await expect(page.locator('video')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Minha lista', exact: false }).filter({ has: page.locator('span') }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(1);
  const second = await browser.newContext();
  await libraryRoutes(second, library);
  const another = await second.newPage();
  await another.goto(page.url());
  await card(another).getByRole('button', { name: 'Remover da Minha lista: Nossa viagem', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.catalog-card')).toHaveCount(0);
  await expect(page.getByText('Use o marcador de um filme para guardá-lo na Minha lista.')).toBeVisible();
  await second.close();
});

test('clique no filme abre o player, reproduz imediatamente e suporta voltar e avançar', async ({ page, library }) => {
  library.videos = [video(firstId, 'Nossa viagem'), video('secondWatchVideo', 'Segundo filme')];
  library.revision = 'existing';
  await page.goto('/');
  await watch(page, 'Segundo filme');
  await expect(page).toHaveURL(/\?filme=drive-secondWatchVideo$/);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 3; });
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(3);
  await page.getByRole('button', { name: 'Voltar ao catálogo', exact: true }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(2);
  await expect(page.locator('video')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Reproduzir Segundo filme', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.catalog-card')).toHaveCount(2);
  await page.goForward();
  await expect(page.locator('video')).toHaveAttribute('src', '/api/drive/media/secondWatchVideo');
});

test('URL do filme identifica a seleção ao reabrir e acompanha trocas pelo menu', async ({ page, library }) => {
  library.videos = [video(firstId, 'Nossa viagem'), video('secondWatchVideo', 'Segundo filme')];
  library.revision = 'existing';
  await page.goto('/?filme=drive-secondWatchVideo');
  await expect(page.locator('video')).toHaveAttribute('src', '/api/drive/media/secondWatchVideo');
  await page.getByRole('button', { name: 'Escolher vídeo', exact: true }).click();
  await page.locator('.select-video').filter({ hasText: 'Nossa viagem' }).click();
  await expect(page).toHaveURL(new RegExp(`filme=drive-${firstId}$`));
  await page.reload();
  await expect(page.locator('video')).toHaveAttribute('src', `/api/drive/media/${firstId}`);
  await page.goto('/?filme=inexistente');
  await expect(page.locator('.catalog-card')).toHaveCount(2);
  await expect(page.locator('video')).toHaveCount(0);
});

test('remoção remota do filme em reprodução retorna ao catálogo sem tocar outro', async ({ page, library }) => {
  library.videos = [video(firstId, 'Vídeo inicial')];
  library.revision = 'existing';
  await page.goto('/');
  await watch(page, 'Vídeo inicial');
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  library.videos = [video('newNetworkVideo', 'Nova seleção')];
  library.revision = 'selection-removed';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(card(page, 'Nova seleção')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page).not.toHaveURL(/filme=/);
});

test('layout móvel, ilustrações locais e navegação por teclado', async ({ page, library }) => {
  library.videos = [{ ...video(firstId, 'Um filme com um título bastante longo e muitos detalhes'), director: 'Clara Monteiro', year: '2026', description: 'O cinema encontra uma história para a próxima sessão.' }];
  library.revision = 'existing';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.catalog-card')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.locator('.card-art img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: '/tmp/muvies-editorial-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Como funciona' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const titleLink = page.locator('.catalog-card h3 a');
  await titleLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Sala de projeção', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Escolher vídeo' }).click();
  await expect(page.getByLabel('Buscar vídeo')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dropdown')).not.toBeVisible();
});

test('mantém alternativa do Drive e erros públicos sem solicitar conexão ou Client ID', async ({ page, library }) => {
  library.videos = [video(firstId, 'Nossa viagem')];
  library.revision = 'existing';
  let code = 'AUTH_REQUIRED';
  await page.route(`**/api/drive/media/${firstId}`, route => route.fulfill({ status: code === 'AUTH_REQUIRED' ? 401 : 502, headers: { 'X-Muvies-Error': code }, json: { code } }));
  await page.route(`https://drive.google.com/file/d/${firstId}/preview`, route => route.fulfill({ contentType: 'text/html', body: '<p>Player do Drive</p>' }));
  await page.goto('/');
  await watch(page);
  await expect(page.locator('.player-error')).toContainText('Qualquer pessoa com o link');
  await expect(page.getByRole('button', { name: /Conectar Drive|Sincronizar Drive/ })).toHaveCount(0);
  code = 'PUBLIC_DOWNLOAD_UNAVAILABLE';
  await page.getByRole('button', { name: 'Recarregar player', exact: true }).click();
  await expect(page.locator('.player-error')).toContainText('download público');
  await page.getByRole('button', { name: 'Player do Drive', exact: true }).click();
  await page.getByRole('button', { name: 'Reproduzir Nossa viagem', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', `https://drive.google.com/file/d/${firstId}/preview`);
});

test('migração concorrente usa o arquivo já salvo em vez de bloquear a tela', async ({ context, page, library }) => {
  library.conflictOnce = true;
  await context.addInitScript(record => localStorage.setItem('muvies.library.v1', JSON.stringify([record])), video(firstId, 'Link antigo'));
  await page.goto('/');
  await expect(card(page, 'Adicionado em outro aparelho')).toBeVisible();
  await expect(page.getByText('Lista salva no aplicativo', { exact: true })).toBeVisible();
  await expect(page.locator('.catalog-problem')).toHaveCount(0);
});

test('cadastro envia pôster e imagem de destaque distintos e compartilha ambos após reabrir', async ({ page, context, browser, library }) => {
  const images = await imageRoutes(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${firstId}/view`);
  await page.getByLabel('Título', { exact: true }).fill('Nossa viagem');
  await page.getByLabel('Pôster do filme', { exact: true }).setInputFiles(await artworkFile());
  await expect(page.getByAltText('Prévia: pôster do filme')).toBeVisible();
  await page.getByLabel('Imagem de destaque', { exact: true }).setInputFiles(await artworkFile(false));
  await expect(page.getByAltText('Prévia: imagem de destaque')).toBeVisible();
  expect(images.uploads).toBe(0); // Selecting a file does not publish it before Save.
  await page.getByRole('button', { name: 'Adicionar à lista', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(images.uploads).toBe(2);
  const { poster, cover } = library.videos[0];
  expect(poster).toMatch(/^\/api\/images\/[a-f0-9]{64}\.webp$/);
  expect(cover).not.toBe(poster);
  await expect(card(page).getByAltText('Pôster: Nossa viagem')).toHaveAttribute('src', poster!);
  await expect(page.locator('.catalog-feature')).toHaveCount(0);
  const dimensions = await card(page).locator('.card-art').boundingBox();
  expect(dimensions!.height / dimensions!.width).toBeCloseTo(1.5, 1);
  await page.reload();
  await card(page).getByRole('button', { name: 'Editar Nossa viagem', exact: true }).click();
  await expect(page.getByAltText('Prévia: imagem de destaque')).toHaveAttribute('src', cover!);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  const second = await browser.newContext();
  await libraryRoutes(second, library); await imageRoutes(second, images);
  const another = await second.newPage(); await another.goto(page.url());
  await expect(card(another).getByAltText('Pôster: Nossa viagem')).toHaveAttribute('src', poster!);
  await card(another).getByRole('button', { name: 'Editar Nossa viagem', exact: true }).click();
  await expect(another.getByAltText('Prévia: imagem de destaque')).toHaveAttribute('src', cover!);
  await expect.poll(() => another.getByAltText('Prévia: imagem de destaque').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(320);
  await second.close();
});

test('edição preserva prévia e imagem anterior se a gravação falhar; permite remover só o destaque', async ({ page, context, library }) => {
  const images = await imageRoutes(context);
  await page.goto('/'); await addDriveVideo(page);
  await card(page).getByRole('button', { name: 'Editar Nossa viagem', exact: true }).click();
  await page.getByLabel('Pôster do filme', { exact: true }).setInputFiles(await artworkFile());
  await expect(page.getByAltText('Prévia: pôster do filme')).toBeVisible();
  await page.getByLabel('Imagem de destaque', { exact: true }).setInputFiles(await artworkFile(false));
  await expect(page.getByAltText('Prévia: imagem de destaque')).toBeVisible();
  library.failWrite = true;
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('A biblioteca anterior foi preservada');
  expect(library.videos[0].poster).toBeUndefined();
  expect(images.uploads).toBe(2);
  await expect(page.getByAltText('Prévia: pôster do filme')).toBeVisible();
  library.failWrite = false;
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(images.uploads).toBe(2); // Retry reuses already uploaded images.
  const poster = library.videos[0].poster;
  await card(page).getByRole('button', { name: 'Editar Nossa viagem', exact: true }).click();
  await expect(page.getByAltText('Prévia: pôster do filme')).toHaveAttribute('src', poster!);
  await page.getByRole('button', { name: 'Remover imagem de destaque', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Novo título');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(library.videos[0].poster).toBe(poster); expect(library.videos[0].cover).toBeUndefined();
  await expect(page.locator('.catalog-feature')).toHaveCount(0);
  await expect(card(page, 'Novo título').getByAltText('Pôster: Novo título')).toHaveAttribute('src', poster!);
});

test('arquivo inválido é recusado, cancelar não envia imagens e erro de upload mantém formulário', async ({ page, context, library }) => {
  const images = await imageRoutes(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Pôster do filme', { exact: true }).setInputFiles({ name: 'Inválido.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
  await expect(page.getByRole('alert')).toContainText('Não foi possível ler a imagem');
  await page.getByLabel('Pôster do filme', { exact: true }).setInputFiles(await artworkFile());
  await expect(page.getByAltText('Prévia: pôster do filme')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  expect(images.uploads).toBe(0);
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await expect(page.getByAltText('Prévia: pôster do filme')).toHaveCount(0);
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${firstId}/view`);
  await page.getByLabel('Título', { exact: true }).fill('Nossa viagem');
  await page.getByLabel('Pôster do filme', { exact: true }).setInputFiles(await artworkFile());
  await expect(page.getByAltText('Prévia: pôster do filme')).toBeVisible();
  images.fail = true;
  await page.getByRole('button', { name: 'Adicionar à lista', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível salvar a imagem');
  expect(library.videos).toEqual([]);
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Nossa viagem');
  images.fail = false;
  await page.getByRole('button', { name: 'Adicionar à lista', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(card(page).getByAltText('Pôster: Nossa viagem')).toBeVisible();
});

test('imagens em link repetido atualizam o filme existente sem duplicar nem mudar seus dados', async ({ page, context, library }) => {
  const images = await imageRoutes(context);
  const cover = `/api/images/${'c'.repeat(64)}.webp`;
  images.files.set(cover, await sharp((await artworkFile(false)).buffer).webp().toBuffer());
  library.videos = [{ ...video(firstId, 'Título preservado', 'Drama'), favorite: true, cover }]; library.revision = 'existing';
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar vídeo', exact: true }).click();
  await page.getByLabel('Link do vídeo').fill(`https://drive.google.com/file/d/${firstId}/view`);
  await page.getByLabel('Título', { exact: true }).fill('Não sobrescrever');
  await page.getByLabel('Pôster do filme', { exact: true }).setInputFiles(await artworkFile());
  await expect(page.getByAltText('Prévia: pôster do filme')).toBeVisible();
  library.conflictOnce = true;
  await page.getByRole('button', { name: 'Adicionar à lista', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('A lista mudou em outro aparelho');
  await page.getByRole('button', { name: 'Adicionar à lista', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(library.videos).toHaveLength(2);
  expect(library.videos[0]).toMatchObject({ title: 'Título preservado', genre: 'Drama', favorite: true, cover });
  expect(library.videos[0].poster).toMatch(/^\/api\/images\//);
});
