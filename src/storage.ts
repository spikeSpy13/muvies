import type { Video } from './library';

export type LibrarySnapshot = { videos: Video[]; revision: string };

export class LibraryError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function snapshot(response: Response): Promise<LibrarySnapshot> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new LibraryError(data?.message || 'Não foi possível salvar a lista no computador.', response.status);
  if (!Array.isArray(data?.videos) || typeof data?.revision !== 'string') {
    throw new LibraryError('O servidor não retornou uma biblioteca válida. Inicie o aplicativo com npm run dev.', 502);
  }
  return data;
}

export async function readLibrary(signal?: AbortSignal): Promise<LibrarySnapshot> {
  return snapshot(await fetch('/api/library', { signal, cache: 'no-store' }));
}

export async function writeLibrary(videos: Video[], revision: string, signal?: AbortSignal): Promise<LibrarySnapshot> {
  return snapshot(await fetch('/api/library', {
    method: 'PUT', signal,
    headers: { 'Content-Type': 'application/json', 'If-Match': revision },
    body: JSON.stringify({ videos }),
  }));
}
