import { useEffect, useRef, useState, type RefObject } from 'react';
import { Pencil } from 'lucide-react';

const LIMIT = 600;
function savedOffset(key: string) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && Math.abs(value) <= LIMIT ? value : 0;
  } catch { return 0; }
}

type OriginalCue = { cue: TextTrackCue; start: number; end: number };

/** The parent keys this component by video and subtitle revision. */
export function SubtitleTiming({ trackRef, videoId, revision, disabled }: {
  trackRef: RefObject<HTMLTrackElement | null>; videoId: string; revision: string; disabled: boolean;
}) {
  const storageKey = `muvies.subtitle-offset.v1:${videoId}:${revision}`;
  const [offset, setOffset] = useState(() => savedOffset(storageKey));
  const [input, setInput] = useState(String(offset));
  const original = useRef<{ element: HTMLTrackElement; cues: OriginalCue[] } | null>(null);

  useEffect(() => {
    const element = trackRef.current;
    if (!element || disabled) return;
    function apply() {
      const track = element!.track;
      if (element!.readyState !== 2 || !track.cues) return;
      if (original.current?.element !== element) {
        original.current = { element: element!, cues: Array.from(track.cues, cue => ({ cue, start: cue.startTime, end: cue.endTime })) };
      }
      // Always use the original timestamps, including cues shifted before time zero.
      for (const cue of Array.from(track.cues)) track.removeCue(cue);
      for (const { cue, start, end } of original.current!.cues) {
        if (end + offset <= 0) continue;
        cue.startTime = Math.max(0, start + offset);
        cue.endTime = end + offset;
        track.addCue(cue);
      }
    }
    element.addEventListener('load', apply);
    apply();
    return () => element.removeEventListener('load', apply);
  }, [trackRef, offset, disabled]);

  function update(value: number) {
    const next = Math.round(Math.max(-LIMIT, Math.min(LIMIT, value)) * 1000) / 1000;
    setOffset(next); setInput(String(next));
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Still works for this session. */ }
  }

  return <details className="subtitle-timing">
    <summary><Pencil size={13}/>Ajustar legenda{offset !== 0 && <span>{offset > 0 ? '+' : ''}{offset.toLocaleString('pt-BR')} s</span>}</summary>
    <div className="subtitle-timing-controls">
      <button type="button" onClick={() => update(offset - 0.5)} disabled={disabled || offset <= -LIMIT}>Adiantar 0,5 s</button>
      <label>Deslocamento (segundos)<input type="number" aria-label="Ajuste da legenda em segundos" min={-LIMIT} max={LIMIT} step="0.1" value={input} disabled={disabled} onChange={event => {
        const raw = event.target.value;
        setInput(raw);
        const value = event.target.valueAsNumber;
        if (raw && Number.isFinite(value) && Math.abs(value) <= LIMIT) {
          setOffset(value);
          try { localStorage.setItem(storageKey, String(value)); } catch { /* Session only. */ }
        }
      }} onBlur={() => setInput(String(offset))}/></label>
      <button type="button" onClick={() => update(offset + 0.5)} disabled={disabled || offset >= LIMIT}>Atrasar 0,5 s</button>
      <button type="button" onClick={() => update(0)} disabled={disabled || offset === 0}>Zerar ajuste</button>
      <p>Negativo adianta; positivo atrasa. O ajuste fica salvo neste navegador para esta legenda.</p>
    </div>
  </details>;
}
