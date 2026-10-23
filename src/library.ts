export type Video = {
  id: string;
  title: string;
  genre: string;
  source: 'demo' | 'drive';
  driveId?: string;
  url: string;
  poster?: string;
  description?: string;
  duration?: string;
};

export const demos: Video[] = [
  {
    id: 'demo-bunny', title: 'Big Buck Bunny', genre: 'Animação', source: 'demo',
    url: '/media/big-buck-bunny.mp4',
    poster: '/media/big-buck-bunny.jpg',
    duration: '1:00', description: 'Um trecho do curta da Blender Foundation. Amostra de demonstração, CC BY 3.0.',
  },
  {
    id: 'demo-flower', title: 'Um instante na natureza', genre: 'Natureza', source: 'demo',
    url: '/media/flower.mp4',
    poster: '/media/flower.jpg',
    duration: '0:05', description: 'Uma pausa para olhar de perto. Vídeo de demonstração do MDN, domínio público (CC0).',
  },
];

const storageKey = 'muvies.library.v1';
export function getSavedVideos(): Video[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Video => !!item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.title === 'string'
      && typeof item.genre === 'string' && item.source === 'drive'
      && typeof item.driveId === 'string' && /^[\w-]{10,}$/.test(item.driveId))
      .map(item => ({ ...item, url: `https://drive.google.com/file/d/${item.driveId}/preview` }));
  } catch { return []; }
}
export function saveVideos(videos: Video[]) {
  localStorage.setItem(storageKey, JSON.stringify(videos));
}
export function parseDriveId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname)) return null;
    const id = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || url.searchParams.get('id');
    return id && /^[\w-]{10,}$/.test(id) ? id : null;
  } catch { return null; }
}

type DriveFile = { id: string; name: string; mimeType: string; videoMediaMetadata?: { durationMillis?: string } };
type TokenResponse = { access_token?: string; error?: string };
type Identity = { accounts: { oauth2: { initTokenClient: (options: {
  client_id: string; scope: string; callback: (response: TokenResponse) => void;
  error_callback: (error: { type: string }) => void;
}) => { requestAccessToken: () => void } } } };
declare global { interface Window { google?: Identity } }

export async function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts.oauth2) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('google-identity');
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.id = 'google-identity';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error('Não foi possível carregar o login do Google. Verifique sua conexão.')); };
    document.head.appendChild(script);
  });
}

export function authorizeDrive(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts.oauth2) return reject(new Error('O login do Google não está disponível.'));
    window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
      callback: response => response.access_token ? resolve(response.access_token) : reject(new Error('A autorização do Drive não foi concluída.')),
      error_callback: () => reject(new Error('O login foi fechado ou bloqueado. Permita o popup e tente novamente.')),
    }).requestAccessToken();
  });
}

export async function listDriveVideos(token: string): Promise<Video[]> {
  const videos: Video[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: "trashed = false and mimeType contains 'video/'", pageSize: '100',
      fields: 'nextPageToken,files(id,name,mimeType,videoMediaMetadata/durationMillis)',
      orderBy: 'name', ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 403
      ? 'Acesso negado. Confira se a API Google Drive está ativada no projeto Google Cloud e se sua conta tem permissão.'
      : 'Não foi possível listar os vídeos do Drive. Conecte novamente e tente outra vez.');
    const data: { files: DriveFile[]; nextPageToken?: string } = await response.json();
    videos.push(...data.files.map(file => {
      const seconds = Math.floor(Number(file.videoMediaMetadata?.durationMillis || 0) / 1000);
      return {
        id: `drive-${file.id}`, driveId: file.id, title: file.name.replace(/\.[^.]+$/, ''),
        genre: 'Sem gênero', source: 'drive' as const,
        url: `https://drive.google.com/file/d/${file.id}/preview`,
        duration: seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : undefined,
      };
    }));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return videos;
}
