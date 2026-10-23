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
  director?: string;
  year?: string;
  favorite?: boolean;
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
  AUTH_REQUIRED: 'O Google está exigindo login para baixar este arquivo. Compartilhe o vídeo como “Qualquer pessoa com o link” e permita o download no Drive, ou abra o arquivo diretamente no Google.',
  PUBLIC_DOWNLOAD_UNAVAILABLE: 'O Google não liberou o download público deste link. Abra o arquivo no Drive e confira se ele pode ser baixado sem login, ou tente o player alternativo.',
  DRIVE_BLOCKED: 'O Google bloqueou o download deste arquivo. Abra o arquivo no Drive para consultar o motivo.',
  DRIVE_FORBIDDEN: 'O download deste arquivo foi bloqueado ou limitado pelo Drive. Confira as permissões do link no Google.',
  DRIVE_NOT_FOUND: 'Arquivo não encontrado ou sem acesso público por este link.',
  DRIVE_LIMIT: 'O Drive limitou os downloads. Aguarde e tente novamente.',
  DRIVE_UNAVAILABLE: 'Não foi possível receber o original do Drive. Verifique a conexão e tente novamente.',
  NOT_VIDEO: 'O Drive não retornou um arquivo de vídeo reproduzível.',
  LOCAL_ONLY: 'Abra o Muvies no servidor local para reproduzir o arquivo original.',
};
