import { useEffect, useRef, useState, type RefObject } from 'react';
import { Circle, Download, Pause, Play, Square, Trash2 } from 'lucide-react';
import { deleteRecording, listRecordings, recordingBlob, saveRecording, type Recording } from './recording-store';
import './recording.css';

type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
type Session = {
  recorder: MediaRecorder; stream: MediaStream; recording: Recording;
  writes: Promise<void>; sequence: number; manualPause: boolean;
  elapsed: number; segmentStart: number; failed: boolean; storageFailed: boolean;
};
const elapsed = (session: Session) => session.elapsed + (session.segmentStart ? performance.now() - session.segmentStart : 0);
const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
function filename(title: string, mime: string) {
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Cena';
  return `${safe} - cena ${new Date().toISOString().replace(/[:.]/g, '-')}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
}

export function SceneRecorder({ videoRef, videoId, title, direct }: {
  videoRef: RefObject<HTMLVideoElement | null>; videoId: string; title: string; direct: boolean;
}) {
  const session = useRef<Session | null>(null);
  const mounted = useRef(false);
  const starting = useRef(false);
  const contextVersion = useRef(0);
  const [status, setStatus] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'saving'>('idle');
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');
  const [clips, setClips] = useState<Recording[]>([]);
  const [downloading, setDownloading] = useState(false);
  const supported = typeof MediaRecorder !== 'undefined' && typeof HTMLVideoElement !== 'undefined'
    && ('captureStream' in HTMLVideoElement.prototype || 'mozCaptureStream' in HTMLVideoElement.prototype);

  async function refresh() {
    const recordings = await listRecordings();
    if (mounted.current) setClips(recordings.filter(clip => clip.bytes > 0 && clip.id !== session.current?.recording.id));
  }
  async function download(clip: Recording) {
    setDownloading(true);
    try {
      const blob = await recordingBlob(clip);
      if (!blob.size) throw new Error('Este trecho ainda não tem dados para baixar.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = clip.filename;
      document.body.append(link); link.click(); link.remove();
      // Keep the URL alive while the browser begins the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (mounted.current) setProblem('Não foi possível baixar o trecho. A cópia local foi mantida; tente baixar novamente.');
    } finally { if (mounted.current) setDownloading(false); }
  }
  function stop() {
    const current = session.current;
    if (!current || current.recorder.state === 'inactive') return;
    current.elapsed = elapsed(current);
    current.segmentStart = 0;
    current.recorder.stop();
    if (mounted.current) { setDuration(current.elapsed / 1000); setStatus('saving'); }
  }
  function pause(current: Session) {
    if (current.recorder.state !== 'recording') return;
    current.elapsed = elapsed(current);
    current.segmentStart = 0;
    current.recorder.pause();
    if (mounted.current) { setDuration(current.elapsed / 1000); setStatus('paused'); }
  }
  function resume(current: Session) {
    const video = videoRef.current;
    if (current.recorder.state !== 'paused' || !video || video.paused || video.ended || video.readyState < 3) return;
    current.segmentStart = performance.now();
    current.recorder.resume();
    if (mounted.current) setStatus('recording');
  }
  function togglePause() {
    const current = session.current;
    if (!current) return;
    current.manualPause = !current.manualPause;
    if (current.manualPause) pause(current); else resume(current);
  }

  useEffect(() => {
    mounted.current = true;
    const updateClips = () => {
      void refresh().catch(() => {
        if (mounted.current) setProblem('O armazenamento local não está disponível. Libere espaço ou permita os dados deste site para gravar.');
      });
    };
    updateClips();
    window.addEventListener('muvies-recordings-changed', updateClips);
    const timer = window.setInterval(() => {
      if (session.current) setDuration(elapsed(session.current) / 1000);
    }, 250);
    const leaving = (event: BeforeUnloadEvent) => {
      if (session.current || starting.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leaving);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener('beforeunload', leaving); window.removeEventListener('muvies-recordings-changed', updateClips); stop(); };
  }, []);

  useEffect(() => {
    contextVersion.current++;
    const video = videoRef.current;
    setReady(!!video && video.readyState >= 2);
    const updateReady = () => setReady(!!video && video.readyState >= 2 && !video.error);
    const autoPause = () => { if (session.current) pause(session.current); };
    const autoResume = () => { if (session.current && !session.current.manualPause) resume(session.current); };
    video?.addEventListener('loadeddata', updateReady);
    video?.addEventListener('error', updateReady);
    for (const name of ['pause', 'waiting', 'seeking']) video?.addEventListener(name, autoPause);
    for (const name of ['playing', 'seeked']) video?.addEventListener(name, autoResume);
    video?.addEventListener('ended', stop);
    return () => {
      contextVersion.current++;
      stop();
      video?.removeEventListener('loadeddata', updateReady);
      video?.removeEventListener('error', updateReady);
      for (const name of ['pause', 'waiting', 'seeking']) video?.removeEventListener(name, autoPause);
      for (const name of ['playing', 'seeked']) video?.removeEventListener(name, autoResume);
      video?.removeEventListener('ended', stop);
    };
  }, [videoId, direct, videoRef]);

  async function start() {
    if (starting.current || session.current || !direct || !supported) return;
    const video = videoRef.current as CapturableVideo | null;
    if (!video || video.readyState < 2) return;
    starting.current = true; setStatus('starting'); setProblem('');
    const version = contextVersion.current;
    let stream: MediaStream | undefined;
    let created: Recording | undefined;
    try {
      await video.play();
      if (!mounted.current || version !== contextVersion.current) return;
      stream = (video.captureStream || video.mozCaptureStream)!.call(video);
      if (!stream.getVideoTracks().length) throw new Error('Nenhuma imagem disponível para gravar. Inicie a reprodução e tente novamente.');
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(mime => MediaRecorder.isTypeSupported(mime));
      if (!mimeType) throw new Error('Este navegador não oferece um formato de gravação compatível. Tente Chrome ou Firefox no computador.');
      const recorder = new MediaRecorder(stream, { mimeType });
      created = { id: crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-'), title, filename: filename(title, mimeType), mimeType, createdAt: Date.now(), bytes: 0, duration: 0, complete: false };
      await saveRecording(created);
      if (!mounted.current || version !== contextVersion.current) {
        await deleteRecording(created.id); stream.getTracks().forEach(track => track.stop()); return;
      }
      const current: Session = { recorder, stream, recording: created, sequence: 0, writes: Promise.resolve(), manualPause: false, elapsed: 0, segmentStart: performance.now(), failed: false, storageFailed: false };
      session.current = current;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        const sequence = current.sequence++;
        current.writes = current.writes.then(async () => {
          if (current.storageFailed) return;
          const next = { ...current.recording, bytes: current.recording.bytes + event.data.size, duration: elapsed(current) / 1000 };
          await saveRecording(next, event.data, sequence);
          current.recording = next;
        }).catch(() => {
          current.failed = true; current.storageFailed = true;
          if (mounted.current) setProblem('O armazenamento local falhou ou ficou sem espaço. A gravação foi interrompida; os dados já salvos continuam disponíveis abaixo.');
          if (session.current === current) stop();
        });
      };
      recorder.onerror = () => {
        if (mounted.current) setProblem('A captura foi interrompida pelo navegador. Baixe o trecho local disponível e tente novamente.');
        current.failed = true;
        if (recorder.state !== 'inactive') stop();
      };
      recorder.onstop = async () => {
        current.elapsed = elapsed(current);
        current.segmentStart = 0;
        current.stream.getTracks().forEach(track => track.stop());
        await current.writes;
        const final = { ...current.recording, duration: current.elapsed / 1000, complete: !current.failed };
        try {
          if (final.bytes) await saveRecording(final); else await deleteRecording(final.id);
        } catch { if (mounted.current) setProblem('Não foi possível finalizar a cópia local. Os dados já gravados foram mantidos.'); }
        if (session.current === current) session.current = null;
        window.dispatchEvent(new Event('muvies-recordings-changed'));
        if (mounted.current) {
          setStatus('idle');
          await refresh().catch(() => setProblem('Não foi possível listar os trechos locais. Tente recarregar a página.'));
          if (final.bytes) await download(final);
          else setProblem('A gravação não gerou dados. Reproduza o vídeo por alguns segundos e tente novamente.');
        }
      };
      recorder.start(1000);
      setDuration(0); setStatus('recording');
      if (video.paused) pause(current);
      if (video.ended) stop();
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (created) void deleteRecording(created.id).catch(() => {});
      session.current = null;
      if (mounted.current) setProblem(error instanceof DOMException ? 'Não foi possível iniciar a captura ou salvar os dados locais. Verifique o espaço disponível e as permissões de armazenamento deste site.' : error instanceof Error ? error.message : 'Não foi possível iniciar a gravação neste navegador.');
    } finally {
      starting.current = false;
      if (mounted.current && !session.current) setStatus('idle');
    }
  }

  const busy = status !== 'idle';
  return <section className="scene-recorder" aria-label="Gravar cenas do vídeo">
    <div className="recording-controls">
      <div className="recording-heading"><strong>Gravar cena</strong><span role="status">{status === 'recording' ? 'Gravando' : status === 'paused' ? 'Gravação pausada' : status === 'saving' ? 'Salvando trecho…' : status === 'starting' ? 'Preparando gravação…' : 'Trechos do seu vídeo'}{busy && ` · ${time(duration)}`}</span></div>
      {!busy ? <button className="record-start" onClick={() => void start()} disabled={!direct || !supported || !ready || downloading}><Circle size={14} fill="currentColor"/>Gravar cena</button> : <>
        <button onClick={togglePause} disabled={status === 'starting' || status === 'saving' || (status === 'paused' && !session.current?.manualPause)}>{status === 'paused' ? <Play size={14}/> : <Pause size={14}/>} {session.current?.manualPause ? 'Continuar gravação' : status === 'paused' ? 'Aguardando vídeo' : 'Pausar gravação'}</button>
        <button className="record-stop" onClick={stop} disabled={status === 'starting' || status === 'saving'}><Square size={13} fill="currentColor"/>Parar e salvar</button>
      </>}
    </div>
    <p className="recording-hint">{!direct ? 'Para gravar cenas, selecione Reprodução direta.' : !supported ? 'Gravação indisponível neste navegador. Use Chrome ou Firefox no computador.' : 'Grave durante a reprodução. Pausar interrompe só a gravação; ao parar, o trecho é baixado. Uma cópia fica salva neste navegador.'}</p>
    {problem && <p className="recording-problem" role="alert">{problem}</p>}
    {clips.length > 0 && <details className="local-recordings" open><summary>Trechos salvos neste navegador ({clips.length})</summary>{clips.map(clip => <div className="recorded-clip" key={clip.id}>
      <div><strong>{clip.title}</strong><small>{time(clip.duration)} · {(clip.bytes / 1024 / 1024).toFixed(1)} MB{!clip.complete && ' · Trecho parcial'}</small></div>
      <button disabled={downloading} onClick={() => void download(clip)} aria-label={`Baixar trecho de ${clip.title}`}><Download size={15}/>Baixar</button>
      <button aria-label={`Excluir cópia local de ${clip.title}`} disabled={busy || downloading} onClick={() => void deleteRecording(clip.id).then(refresh).catch(() => setProblem('Não foi possível excluir a cópia local.'))}><Trash2 size={15}/></button>
    </div>)}</details>}
  </section>;
}
