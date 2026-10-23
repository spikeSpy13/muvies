export type Video = {
  id: string;
  title: string;
  genre: string;
  source: 'drive';
  driveId?: string;
  resourceKey?: string;
  url: string;
  poster?: string;
  description?: string;
  duration?: string;
};

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

export function driveMediaUrl(video: Video): string {
  const query = video.resourceKey ? `?resourceKey=${encodeURIComponent(video.resourceKey)}` : '';
  return `/api/drive/media/${encodeURIComponent(video.driveId || '')}${query}`;
}

export function driveViewUrl(video: Video): string {
  const query = video.resourceKey ? `?resourcekey=${encodeURIComponent(video.resourceKey)}` : '';
  return `https://drive.google.com/file/d/${video.driveId}/view${query}`;
}

export function drivePreviewUrl(video: Video): string {
  const query = video.resourceKey ? `?resourcekey=${encodeURIComponent(video.resourceKey)}` : '';
  return `https://drive.google.com/file/d/${video.driveId}/preview${query}`;
}

export const playbackErrors: Record<string, string> = {
  AUTH_REQUIRED: 'O Google está exigindo login para baixar este arquivo. Confira se o link permite acesso e download sem login, ou conecte uma conta com acesso.',
  PUBLIC_DOWNLOAD_UNAVAILABLE: 'O Google não liberou o download público deste link. Abra o arquivo no Drive e confira se ele pode ser baixado sem login. Não é necessário configurar Client ID para um download público disponível.',
  DRIVE_BLOCKED: 'O Google bloqueou o download deste arquivo. Abra o arquivo no Drive para consultar o motivo.',
  DRIVE_FORBIDDEN: 'Sua conta não pode baixar este arquivo ou o Drive limitou os downloads. Confira as permissões do arquivo no Drive.',
  DRIVE_NOT_FOUND: 'Arquivo não encontrado ou sem acesso nesta conta Google.',
  DRIVE_LIMIT: 'O Drive limitou os downloads. Aguarde e tente novamente.',
  DRIVE_UNAVAILABLE: 'Não foi possível receber o original do Drive. Verifique a conexão e tente novamente.',
  NOT_VIDEO: 'O Drive não retornou um arquivo de vídeo reproduzível.',
  LOCAL_ONLY: 'Abra o Muvies no servidor local para reproduzir o arquivo original.',
};

type DriveFile = { id: string; name: string; mimeType: string; resourceKey?: string; videoMediaMetadata?: { durationMillis?: string } };
type TokenResponse = { access_token?: string; expires_in?: number | string; error?: string };
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

export function authorizeDrive(clientId: string): Promise<{ token: string; expiresIn: number }> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts.oauth2) return reject(new Error('O login do Google não está disponível.'));
    window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: response => response.access_token ? resolve({ token: response.access_token, expiresIn: Number(response.expires_in || 3600) }) : reject(new Error('A autorização do Drive não foi concluída.')),
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
      fields: 'nextPageToken,files(id,name,mimeType,resourceKey,videoMediaMetadata/durationMillis)',
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
        id: `drive-${file.id}`, driveId: file.id, resourceKey: file.resourceKey, title: file.name.replace(/\.[^.]+$/, ''),
        genre: 'Sem gênero', source: 'drive' as const,
        url: `https://drive.google.com/file/d/${file.id}/preview`,
        duration: seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : undefined,
      };
    }));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return videos;
}
