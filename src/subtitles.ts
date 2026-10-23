import { useEffect, useRef, useState } from 'react';

export type Subtitle = { filename: string; revision: string };
type Snapshot = { subtitle: Subtitle | null };
type State = Snapshot & { driveId?: string; ready: boolean; busy: boolean; enabled: boolean; problem: string; syncProblem: string; trackProblem: string };

class SubtitleError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function snapshot(response: Response): Promise<Snapshot> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new SubtitleError(data?.message || 'Não foi possível acessar a legenda salva.', response.status);
  if (!data || !(data.subtitle === null || (typeof data.subtitle?.filename === 'string' && typeof data.subtitle?.revision === 'string'))) {
    throw new SubtitleError('O servidor não retornou uma legenda válida. Atualize e reinicie o aplicativo.', 502);
  }
  return data;
}

function initial(driveId?: string): State {
  return { driveId, subtitle: null, ready: false, busy: false, enabled: true, problem: '', syncProblem: '', trackProblem: '' };
}

/** Subtitles belong to the server's video, while visibility is a viewer preference. */
export function useSubtitles(driveId?: string) {
  const [state, setState] = useState<State>(() => initial(driveId));
  const currentId = useRef(driveId);
  currentId.current = driveId;
  const currentSubtitle = useRef<Subtitle | null>(null);
  const mutating = useRef(false);
  const generation = useRef(0);
  const endpoint = driveId ? `/api/subtitles/${encodeURIComponent(driveId)}` : '';

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    currentSubtitle.current = null;
    mutating.current = false;
    generation.current++;
    setState(initial(driveId));
    if (!driveId) return;
    async function synchronize() {
      if (cancelled || pending || mutating.current || document.hidden) return;
      pending = true;
      const requestedGeneration = generation.current;
      try {
        const result = await snapshot(await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(15000) }));
        if (cancelled || mutating.current || requestedGeneration !== generation.current) return;
        currentSubtitle.current = result.subtitle;
        setState(previous => ({ ...previous, ...result, ready: true, syncProblem: '', trackProblem: previous.subtitle?.revision === result.subtitle?.revision ? previous.trackProblem : '', enabled: previous.subtitle ? previous.enabled : true }));
      } catch (error) {
        if (!cancelled && requestedGeneration === generation.current) {
          setState(previous => ({ ...previous, syncProblem: error instanceof Error ? error.message : 'Não foi possível sincronizar a legenda.' }));
        }
      } finally { pending = false; }
    }
    void synchronize();
    const timer = setInterval(synchronize, 3000);
    window.addEventListener('focus', synchronize);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', synchronize); };
  }, [driveId, endpoint]);

  async function change(file?: File): Promise<boolean> {
    if (!driveId || state.driveId !== driveId || !state.ready || mutating.current) return false;
    if (file && (!/\.srt$/i.test(file.name) || !file.size || file.size > 2 * 1024 * 1024)) {
      setState(previous => ({ ...previous, problem: 'Escolha um arquivo .srt não vazio de até 2 MB.' }));
      return false;
    }
    const requestedId = driveId;
    const requestGeneration = ++generation.current;
    mutating.current = true;
    setState(previous => ({ ...previous, busy: true, problem: '' }));
    try {
      const headers: Record<string, string> = { 'If-Match': currentSubtitle.current?.revision || '0' };
      if (file) {
        headers['Content-Type'] = 'application/x-subrip';
        headers['X-Subtitle-Filename'] = encodeURIComponent(file.name);
      }
      const result = await snapshot(await fetch(endpoint, {
        method: file ? 'PUT' : 'DELETE', headers,
        body: file ? await file.arrayBuffer() : undefined,
        signal: AbortSignal.timeout(15000),
      }));
      if (currentId.current !== requestedId || generation.current !== requestGeneration) return false;
      currentSubtitle.current = result.subtitle;
      setState(previous => ({ ...previous, ...result, enabled: true, syncProblem: '', problem: '', trackProblem: '' }));
      return true;
    } catch (error) {
      if (currentId.current !== requestedId || generation.current !== requestGeneration) return false;
      let message = error instanceof Error ? error.message : 'Não foi possível salvar a legenda.';
      if (error instanceof SubtitleError && error.status === 409) {
        try {
          const latest = await snapshot(await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(15000) }));
          if (currentId.current !== requestedId || generation.current !== requestGeneration) return false;
          currentSubtitle.current = latest.subtitle;
          setState(previous => ({ ...previous, ...latest }));
        } catch { /* Keep the current subtitle if synchronization also fails. */ }
        message = 'A legenda mudou em outro aparelho. Confira a versão atual e tente novamente.';
      }
      if (currentId.current !== requestedId || generation.current !== requestGeneration) return false;
      setState(previous => ({ ...previous, problem: message }));
      return false;
    } finally {
      if (currentId.current === requestedId && generation.current === requestGeneration) {
        mutating.current = false;
        setState(previous => ({ ...previous, busy: false }));
      }
    }
  }

  const current = state.driveId === driveId ? state : initial(driveId);
  return {
    ...current,
    problem: current.problem || current.syncProblem || current.trackProblem,
    trackUrl: current.subtitle ? `${endpoint}/track.vtt?revision=${encodeURIComponent(current.subtitle.revision)}` : '',
    upload: (file: File) => change(file),
    remove: () => change(),
    toggle: () => setState(previous => ({ ...previous, enabled: !previous.enabled })),
    setEnabled: (enabled: boolean) => setState(previous => previous.enabled === enabled ? previous : ({ ...previous, enabled })),
    trackLoaded: () => setState(previous => previous.trackProblem ? ({ ...previous, trackProblem: '' }) : previous),
    trackFailed: () => setState(previous => ({ ...previous, trackProblem: 'Não foi possível carregar a legenda. Tente recarregar a página ou enviar o arquivo novamente.' })),
  };
}
