import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ArrowLeft, Captions, Check, ChevronDown, CircleHelp, ExternalLink, Film, Info, Link, ListVideo, LoaderCircle, Maximize, Pencil, Play, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { driveMediaUrl, drivePreviewUrl, driveViewUrl, getSavedVideos, parseDriveId, playbackErrors, saveVideos, type Video } from './library';
import { LibraryError, readLibrary, writeLibrary, type LibrarySnapshot } from './storage';
import { useSubtitles } from './subtitles';
import { SubtitleTiming } from './SubtitleTiming';
import { SceneRecorder } from './SceneRecorder';
import './styles.css';
import { Catalog, filmUrl } from './Catalog';
import { ArtworkFields, useArtworkDraft } from './ArtworkFields';

type Modal = 'add' | 'help' | 'edit' | null;
const baseGenres = ['Animação', 'Aventura', 'Fantasia', 'Ação', 'Comédia', 'Documentário', 'Drama', 'Terror'];
function savedValue(key: string) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* The server file is the source of truth. */ }
}
function DriveIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3h8l7 12h-8Z" fill="#FCC64D"/><path d="M8 3 1 15l4 7 7-12Z" fill="#48B78B"/><path d="M5 22h14l4-7H9Z" fill="#6C9CF5"/></svg>;
}

function App() {
  const [saved, setSaved] = useState<Video[]>([]);
  const [routeId, setRouteId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('filme'));
  const routeRef = useRef(routeId);
  routeRef.current = routeId;
  const watching = routeId !== null;
  const initialAutoplay = useRef(watching);
  const [activeId, setActiveId] = useState(() => new URLSearchParams(window.location.search).get('filme') || savedValue('muvies.active-video.v1'));
  const [libraryReady, setLibraryReady] = useState(false);
  const [storageProblem, setStorageProblem] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const revision = useRef('0');
  const savedRef = useRef<Video[]>([]);
  const savingRef = useRef(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [genre, setGenre] = useState('Todos');
  const [catalogYear, setCatalogYear] = useState('');
  const [catalogCountry, setCatalogCountry] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [playbackMode, setPlaybackMode] = useState<'direct' | 'drive'>('direct');
  const [playerLoading, setPlayerLoading] = useState(false);
  const [driveFrameVersion, setDriveFrameVersion] = useState(0);
  const [dropdown, setDropdown] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [newGenre, setNewGenre] = useState('Sem gênero');
  const [director, setDirector] = useState('');
  const [year, setYear] = useState('');
  const [country, setCountry] = useState('');
  const [description, setDescription] = useState('');
  const artwork = useArtworkDraft();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const playbackModeRef = useRef(playbackMode);
  playbackModeRef.current = playbackMode;
  const playerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const playAttempt = useRef(0);
  const diagnosedAttempt = useRef(-1);
  const active = saved.find(video => video.id === activeId) || saved[0] || null;
  const subtitles = useSubtitles(watching ? active?.driveId : undefined);
  const subtitleEnabled = useRef(subtitles.enabled);
  subtitleEnabled.current = subtitles.enabled;
  const genres = [...new Set(saved.map(video => video.genre))];
  const currentGenre = genres.includes(genre) ? genre : 'Todos';
  const currentCatalogYear = saved.some(video => video.year === catalogYear) ? catalogYear : '';
  const currentCatalogCountry = saved.some(video => video.country === catalogCountry) ? catalogCountry : '';
  const filtered = saved.filter(video => currentGenre === 'Todos' || video.genre === currentGenre);
  const options = filtered.filter(video => video.title.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const locked = saving || artwork.validating;

  function applySnapshot(snapshot: LibrarySnapshot) {
    const previousId = activeIdRef.current;
    const selectedId = snapshot.videos.some(video => video.id === previousId) ? previousId : snapshot.videos[0]?.id || '';
    if (previousId && previousId !== selectedId) stopPlayback();
    if (routeRef.current && !snapshot.videos.some(video => video.id === routeRef.current)) {
      navigateCatalog(true);
      setToast('Este filme não está mais no catálogo.');
    }
    activeIdRef.current = selectedId;
    setActiveId(selectedId);
    revision.current = snapshot.revision;
    savedRef.current = snapshot.videos;
    setSaved(snapshot.videos);
    try { saveVideos(snapshot.videos); } catch { /* The file has already been saved. */ }
  }
  function stopPlayback() {
    playAttempt.current++;
    videoRef.current?.pause();
    setPlaying(false); setPlayerError(''); setPlayerLoading(false);
  }
  function choose(video: Video) {
    stopPlayback(); activeIdRef.current = video.id; setActiveId(video.id); remember('muvies.active-video.v1', video.id);
    if (routeRef.current && routeRef.current !== video.id) {
      routeRef.current = video.id;
      setRouteId(video.id);
      window.history.replaceState(null, '', filmUrl(video));
    }
    setDropdown(false); setSearch('');
  }
  function navigateCatalog(replace = false) {
    initialAutoplay.current = false;
    stopPlayback();
    routeRef.current = null;
    setRouteId(null);
    const target = new URL(window.location.href);
    target.searchParams.delete('filme');
    window.history[replace ? 'replaceState' : 'pushState'](null, '', target.pathname + target.search);
    window.scrollTo(0, 0);
  }
  function openFilm(event: React.MouseEvent<HTMLAnchorElement>, video: Video) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    initialAutoplay.current = false;
    window.history.pushState(null, '', filmUrl(video));
    // Mount the native player before play(), preserving the click's user activation.
    flushSync(() => { choose(video); setPlaybackMode('direct'); routeRef.current = video.id; setRouteId(video.id); });
    window.scrollTo(0, 0);
    void startPlayback(video);
  }
  async function toggleFavorite(video: Video) {
    await persist(savedRef.current.map(item => item.id === video.id ? { ...item, favorite: !item.favorite } : item));
  }
  useEffect(() => {
    const navigate = () => {
      initialAutoplay.current = false;
      stopPlayback();
      const id = new URLSearchParams(window.location.search).get('filme');
      routeRef.current = id;
      setRouteId(id);
      if (id) { activeIdRef.current = id; setActiveId(id); }
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);
  useEffect(() => {
    document.title = watching && active ? `${active.title} — Muvies` : 'Filmes — Muvies';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', watching ? '#101014' : '#FBF9F5');
    if (libraryReady && watching && !savedRef.current.some(video => video.id === routeId)) {
      navigateCatalog(true);
      setToast('Este filme não está mais no catálogo.');
      return;
    }
    if (libraryReady && initialAutoplay.current && watching && active?.id === routeId) {
      initialAutoplay.current = false;
      void startPlayback(active);
    }
  }, [libraryReady, watching, routeId, active?.id, active?.title]);

  useEffect(() => {
    const controller = new AbortController();
    setLibraryReady(false); setStorageProblem('');
    (async () => {
      try {
        let snapshot = await readLibrary(controller.signal);
        if (controller.signal.aborted) return;
        // Import the old browser library only before a server file exists.
        // A deliberately emptied shared library must remain empty.
        const previous = getSavedVideos();
        if (snapshot.revision === '0' && previous.length) {
          try { snapshot = await writeLibrary(previous, '0', controller.signal); }
          catch (error) {
            if (error instanceof LibraryError && error.status === 409) snapshot = await readLibrary(controller.signal);
            else throw error;
          }
        }
        if (controller.signal.aborted) return;
        applySnapshot(snapshot);
        setLibraryReady(true);
      } catch (error) {
        if (!controller.signal.aborted) setStorageProblem(error instanceof Error ? error.message : 'Não foi possível carregar a lista salva.');
      }
    })();
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(() => {
    if (!libraryReady) return;
    let cancelled = false;
    let pending = false;
    async function synchronize() {
      if (pending || savingRef.current || document.hidden) return;
      pending = true;
      const requestedRevision = revision.current;
      try {
        const snapshot = await readLibrary();
        if (cancelled || savingRef.current || revision.current !== requestedRevision) return;
        if (snapshot.revision !== revision.current) {
          applySnapshot(snapshot);
        }
        setStorageProblem('');
      } catch {
        if (!cancelled) setStorageProblem('Não foi possível sincronizar a lista. Os links já salvos foram mantidos; tentaremos novamente.');
      } finally { pending = false; }
    }
    const timer = setInterval(synchronize, 3000);
    window.addEventListener('focus', synchronize);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', synchronize); };
  }, [libraryReady]);

  useEffect(() => {
    if (trackRef.current) trackRef.current.track.mode = subtitles.enabled ? 'showing' : 'disabled';
  }, [subtitles.enabled, subtitles.trackUrl, playbackMode]);
  useEffect(() => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    const changed = () => {
      if (trackRef.current?.readyState === 2) subtitles.setEnabled(trackRef.current.track.mode === 'showing');
    };
    tracks.addEventListener('change', changed);
    return () => tracks.removeEventListener('change', changed);
  }, [active?.id, subtitles.trackUrl, playbackMode]);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const loaded = () => { track.track.mode = subtitleEnabled.current ? 'showing' : 'disabled'; subtitles.trackLoaded(); };
    const failed = () => subtitles.trackFailed();
    track.addEventListener('load', loaded);
    track.addEventListener('error', failed);
    // A cached track can finish loading before the effect installs its listeners.
    if (track.readyState === 2) loaded();
    else if (track.readyState === 3) failed();
    return () => { track.removeEventListener('load', loaded); track.removeEventListener('error', failed); };
  }, [subtitles.trackUrl, playbackMode]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!dropdownRef.current?.contains(event.target as Node)) setDropdown(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  useLayoutEffect(() => {
    if (modal) modalRef.current?.showModal(); else modalRef.current?.close();
    setError('');
  }, [modal]);

  async function persist(videos: Video[] | (() => Promise<Video[]>)): Promise<boolean> {
    if (!libraryReady || savingRef.current) return false;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const prepared = typeof videos === 'function' ? await videos() : videos;
      applySnapshot(await writeLibrary(prepared, revision.current));
      setStorageProblem('');
      return true;
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Não foi possível salvar os links no aplicativo.';
      if (error instanceof LibraryError && error.status === 409) {
        try { applySnapshot(await readLibrary()); } catch { /* Preserve the current view if the server is unavailable. */ }
        message = 'A lista mudou em outro aparelho. Ela foi atualizada aqui; confira os dados e tente salvar novamente.';
      }
      setError(message);
      return false;
    } finally { savingRef.current = false; setSaving(false); }
  }
  function changePlaybackMode(mode: 'direct' | 'drive') { stopPlayback(); setPlaybackMode(mode); }
  function resetCatalogFilters() { setGenre('Todos'); setCatalogYear(''); setCatalogCountry(''); setCatalogSearch(''); setFavoritesOnly(false); }
  function openAdd() { artwork.reset(); setTitle(''); setUrl(''); setNewGenre('Sem gênero'); setDirector(''); setYear(''); setCountry(''); setDescription(''); setEditing(null); setModal('add'); }
  function openEdit(video: Video) { artwork.reset(video); setEditing(video.id); setTitle(video.title); setNewGenre(video.genre); setDirector(video.director || ''); setYear(video.year || ''); setCountry(video.country || ''); setDescription(video.description || ''); setModal('edit'); }
  async function addVideo(event: React.FormEvent) {
    event.preventDefault();
    const driveId = parseDriveId(url);
    if (!driveId) return setError('Cole um link de vídeo do Google Drive, como drive.google.com/file/d/ID/view. Links de pastas não são aceitos.');
    const resourceKey = new URL(url.trim()).searchParams.get('resourcekey') || undefined;
    if (resourceKey && !/^[\w-]{1,256}$/.test(resourceKey)) return setError('A chave de compartilhamento deste link é inválida. Copie o link novamente no Drive.');
    const currentVideos = savedRef.current;
    const duplicate = currentVideos.find(video => video.driveId === driveId);
    if (duplicate) {
      let updated = resourceKey ? { ...duplicate, resourceKey } : duplicate;
      if ((resourceKey || artwork.changed) && !await persist(async () => {
        if (artwork.changed) updated = { ...updated, ...await artwork.upload(updated) };
        return savedRef.current.map(video => video.id === duplicate.id ? updated : video);
      })) return;
      choose(updated); resetCatalogFilters(); setModal(null);
      setToast(resourceKey || artwork.changed ? 'Filme atualizado e salvo no aplicativo.' : 'Este vídeo já está na sua lista.');
      return;
    }
    const video: Video = { id: `drive-${driveId}`, driveId, resourceKey, title: title.trim(), genre: newGenre.trim() || 'Sem gênero', source: 'drive', url: `https://drive.google.com/file/d/${driveId}/preview`, director: director.trim() || undefined, year: year.trim() || undefined, country: country.trim() || undefined, description: description.trim() || undefined };
    if (!await persist(async () => [...savedRef.current, { ...video, ...await artwork.upload() }])) return;
    choose(video); resetCatalogFilters(); setModal(null); setToast('Link salvo no aplicativo.');
  }
  async function editVideo(event: React.FormEvent) {
    event.preventDefault();
    if (!await persist(async () => {
      const current = savedRef.current.find(video => video.id === editing);
      if (!current) throw new Error('Este filme foi removido em outro aparelho. Confira o catálogo antes de salvar.');
      const images = await artwork.upload(current);
      return savedRef.current.map(video => video.id === editing ? { ...video, ...images, title: title.trim(), genre: newGenre.trim() || 'Sem gênero', director: director.trim() || undefined, year: year.trim() || undefined, country: country.trim() || undefined, description: description.trim() || undefined } : video);
    })) return;
    resetCatalogFilters(); setModal(null); setToast('Alterações salvas.');
  }
  async function removeVideo() {
    const remaining = savedRef.current.filter(video => video.id !== editing);
    if (!await persist(remaining)) return;
    if (active?.id === editing) {
      if (remaining[0]) choose(remaining[0]); else { stopPlayback(); setActiveId(''); remember('muvies.active-video.v1', ''); }
    }
    resetCatalogFilters(); setModal(null); setToast('Link removido da lista. O arquivo continua no seu Drive.');
  }
  async function diagnosePlayback(video: Video, attempt: number) {
    if (attempt !== playAttempt.current || diagnosedAttempt.current === attempt) return;
    diagnosedAttempt.current = attempt;
    let message = 'Não foi possível reproduzir este formato. Tente um MP4 com vídeo H.264 e áudio AAC, ou use o player do Drive.';
    try {
      const response = await fetch(driveMediaUrl(video), { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      const code = response.headers.get('X-Muvies-Error') || '';
      if (!response.ok) message = playbackErrors[code] || 'Não foi possível receber o arquivo pelo servidor do Muvies.';
    } catch { message = 'Não foi possível acessar o servidor ou o Drive. Verifique a conexão e tente novamente.'; }
    if (attempt !== playAttempt.current) return;
    setPlayerError(message); setPlayerLoading(false);
  }
  async function startPlayback(selected = active) {
    if (!selected || (!videoRef.current && playbackModeRef.current === 'direct')) return;
    const attempt = ++playAttempt.current;
    setPlaying(true); setPlayerError('');
    if (playbackModeRef.current === 'drive') return;
    setPlayerLoading(true);
    try { await videoRef.current?.play(); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError' && attempt === playAttempt.current) setPlayerError('O navegador bloqueou o início. Clique em Tentar novamente para dar o play.');
      else await diagnosePlayback(selected, attempt);
    } finally { if (attempt === playAttempt.current) setPlayerLoading(false); }
  }
  function retryPlayback() {
    if (!active) return;
    if (playbackMode === 'drive') setDriveFrameVersion(version => version + 1);
    else { videoRef.current?.load(); void startPlayback(); }
  }
  async function uploadSubtitle(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !active) return;
    const selectedId = active.id;
    if (!await subtitles.upload(file) || activeIdRef.current !== selectedId) return;
    if (playbackModeRef.current === 'drive') changePlaybackMode('direct');
    setToast('Legenda salva no aplicativo e ativada na reprodução direta.');
  }
  async function removeSubtitle() {
    if (await subtitles.remove()) setToast('Legenda removida deste vídeo no aplicativo.');
  }

  return <>
    {!watching ? <Catalog videos={saved} ready={libraryReady} saving={saving} locked={locked} problem={storageProblem} actionProblem={modal ? '' : error} genre={currentGenre} year={currentCatalogYear} country={currentCatalogCountry} search={catalogSearch} favoritesOnly={favoritesOnly} onGenre={setGenre} onYear={setCatalogYear} onCountry={setCatalogCountry} onSearch={setCatalogSearch} onFavorites={setFavoritesOnly} onWatch={openFilm} onAdd={openAdd} onEdit={openEdit} onFavorite={toggleFavorite} onHelp={() => setModal('help')} onRetry={() => setLoadAttempt(value => value + 1)}/> : <>
    <header className="header"><div className="header-inner compact-header">
      <a className="watch-brand" href="?" onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateCatalog(); } }}>Muvies</a>
      <div className="header-actions"><button className="watch-catalog-back" onClick={() => navigateCatalog()}><ArrowLeft size={16}/>Voltar ao catálogo</button><button className="help-button" aria-label="Como funciona" onClick={() => setModal('help')}><CircleHelp size={18}/></button></div>
    </div></header>
    <main className="compact-main">
      <section className="watch-section" aria-label="Listas e player">
        <div className="list-heading"><div><h1>Sala de projeção</h1><p className="save-status">{saving ? <LoaderCircle size={13} className="spin"/> : libraryReady && !storageProblem ? <Check size={13}/> : <Info size={13}/>} {saving ? 'Salvando lista…' : !libraryReady ? 'Carregando lista…' : storageProblem ? 'Sincronização pendente' : 'Lista salva no aplicativo'}</p></div><button className="button primary" onClick={openAdd} disabled={!libraryReady || locked}><Plus size={17}/>Adicionar vídeo</button></div>
        {storageProblem && <div className="storage-problem" role="alert"><Info size={17}/><span>{storageProblem}</span>{!libraryReady && <button onClick={() => setLoadAttempt(value => value + 1)}>Tentar carregar novamente</button>}</div>}
        <div className="library-toolbar">
          <div className="genre-tabs" aria-label="Filtrar por gênero"><button className={currentGenre === 'Todos' ? 'genre selected' : 'genre'} onClick={() => setGenre('Todos')}>Todos<span>{saved.length}</span></button>{genres.map(item => <button key={item} className={currentGenre === item ? 'genre selected' : 'genre'} onClick={() => setGenre(item)}>{item}</button>)}</div>
          <div className="video-selector" ref={dropdownRef}><button className={`selector-button ${dropdown ? 'is-open' : ''}`} aria-label="Escolher vídeo" aria-expanded={dropdown} aria-controls="video-list" onClick={() => setDropdown(!dropdown)} disabled={!libraryReady}><ListVideo size={18}/><span>{active?.title || 'Escolher vídeo'}</span><ChevronDown size={15}/></button>
            {dropdown && <div className="dropdown" id="video-list"><div className="search-field"><Search size={17}/><input autoFocus aria-label="Buscar vídeo" placeholder="Buscar na lista…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setDropdown(false); }}/></div><div className="dropdown-options">{options.length ? options.map(video => <div className="dropdown-row" key={video.id}><button className="select-video" onClick={() => choose(video)}><span className="small-video-icon"><Film size={17}/></span><span><strong>{video.title}</strong><small>{video.genre}</small></span>{active?.id === video.id && <Check className="check" size={17}/>}</button><button className="edit-button" aria-label={`Editar ${video.title}`} onClick={() => { setDropdown(false); openEdit(video); }}><Pencil size={15}/></button></div>) : <p className="no-options">{saved.length ? 'Nenhum vídeo encontrado.' : 'Sua lista ainda está vazia.'}</p>}</div><button className="dropdown-add" onClick={() => { setDropdown(false); openAdd(); }}><Plus size={16}/>Adicionar um vídeo</button></div>}
          </div>
        </div>
        {active && libraryReady && <div className="playback-toolbar"><div className="selected-title"><Film size={15}/><strong>{active.title}</strong><button className="edit-button" aria-label={`Editar ${active.title}`} onClick={() => openEdit(active)} disabled={locked}><Pencil size={14}/></button></div><div className="playback-modes" role="group" aria-label="Modo de reprodução"><button aria-pressed={playbackMode === 'direct'} onClick={() => changePlaybackMode('direct')}>Reprodução direta</button><button aria-pressed={playbackMode === 'drive'} onClick={() => changePlaybackMode('drive')}>Player do Drive</button></div><div className="player-links">{playing && <button aria-label="Recarregar player" onClick={retryPlayback}><RefreshCw size={15}/></button>}<a href={driveViewUrl(active)} target="_blank" rel="noreferrer" aria-label="Abrir no Drive"><ExternalLink size={15}/></a></div></div>}
        {active && libraryReady && <div className="subtitle-toolbar" aria-label="Legendas do vídeo">
          <input ref={subtitleInputRef} type="file" accept=".srt,application/x-subrip" aria-label="Arquivo de legenda SRT" className="visually-hidden" tabIndex={-1} onChange={uploadSubtitle}/>
          <button className="subtitle-upload" onClick={() => subtitleInputRef.current?.click()} disabled={!subtitles.ready || subtitles.busy}>{subtitles.busy ? <LoaderCircle size={15} className="spin"/> : <Upload size={15}/>} {subtitles.busy ? 'Salvando legenda…' : subtitles.subtitle ? 'Trocar legenda (.srt)' : 'Carregar legenda (.srt)'}</button>
          {subtitles.subtitle && <><span className="subtitle-filename" title={subtitles.subtitle.filename}>{subtitles.subtitle.filename}</span><button className="subtitle-toggle" aria-pressed={subtitles.enabled && playbackMode === 'direct'} onClick={subtitles.toggle} disabled={playbackMode !== 'direct' || subtitles.busy}><Captions size={17}/>{subtitles.enabled ? 'Ocultar legendas' : 'Mostrar legendas'}</button><button className="subtitle-remove" aria-label="Remover legenda" onClick={removeSubtitle} disabled={subtitles.busy}><Trash2 size={14}/></button></>}
          {subtitles.subtitle && active.driveId && <SubtitleTiming key={`${active.driveId}:${subtitles.subtitle.revision}`} trackRef={trackRef} videoId={active.driveId} revision={subtitles.subtitle.revision} disabled={playbackMode !== 'direct' || subtitles.busy || !subtitles.enabled}/>}
          {playbackMode === 'drive' && <span className="subtitle-hint">SRT usa a reprodução direta.</span>}
          {subtitles.problem && <p className="subtitle-problem" role="alert"><Info size={14}/>{subtitles.problem}</p>}
        </div>}
        <div className={`player ${playing ? 'is-playing' : ''}`} ref={playerRef}>
          {!libraryReady || !active ? <div className="player-empty">{!libraryReady ? <LoaderCircle size={38} className={storageProblem ? '' : 'spin'}/> : <Film size={44} strokeWidth={1}/>}<h2>{!libraryReady ? storageProblem ? 'Sua lista está protegida' : 'Carregando sua lista' : 'Seu próximo vídeo começa aqui'}</h2><p>{!libraryReady ? 'Aguardando a biblioteca salva no aplicativo.' : 'Adicione um link do Drive e escolha um vídeo na lista acima.'}</p>{libraryReady && <button className="button secondary" onClick={openAdd}><Plus size={16}/>Adicionar primeiro vídeo</button>}</div> : <>
            {playbackMode === 'direct' ? <video key={active.id} ref={videoRef} src={driveMediaUrl(active)} controls={playing} preload="none" playsInline onError={event => { if (playing && event.target === event.currentTarget && event.currentTarget === videoRef.current) void diagnosePlayback(active, playAttempt.current); }} onEnded={() => setPlaying(false)} aria-label={`Player: ${active.title}`}>
              {subtitles.subtitle && <track key={subtitles.trackUrl} ref={trackRef} kind="subtitles" src={subtitles.trackUrl} label={subtitles.subtitle.filename} srcLang="und" default={subtitles.enabled}/>}
            </video> : playing && <iframe key={`${active.id}-${driveFrameVersion}`} src={drivePreviewUrl(active)} title={`Player do Google Drive: ${active.title}`} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen/>}
            {!playing && <div className="player-cover drive-cover"><div className="player-top"><span className="player-label"><span/>GOOGLE DRIVE</span><DriveIcon size={18}/></div><button className="big-play" aria-label={`Reproduzir ${active.title}`} onClick={() => void startPlayback()}><Play size={27} fill="currentColor" strokeWidth={0}/></button><div className="cover-bottom"><div><div className="cover-genre">{active.genre}{active.duration && <><span>·</span>{active.duration}</>}</div><h2>{active.title}</h2></div><button className="fullscreen" aria-label="Abrir player em tela cheia" onClick={() => playerRef.current?.requestFullscreen?.().catch(() => setToast('Use a opção de tela cheia nos controles do vídeo.'))}><Maximize size={19}/></button></div></div>}
            {playerLoading && !playerError && <div className="player-loading" role="status"><LoaderCircle size={30} className="spin"/><span>Carregando arquivo original…</span></div>}
            {playerError && <div className="player-error"><Info size={24}/><strong>Não foi possível iniciar o vídeo.</strong><p>{playerError}</p><div className="player-error-actions"><button className="button secondary" onClick={retryPlayback}>Tentar novamente</button></div></div>}
          </>}
        </div>
        {active && libraryReady && <SceneRecorder videoRef={videoRef} videoId={active.id} title={active.title} direct={playbackMode === 'direct'}/>}
      </section>
    </main>
    </>}
    <dialog ref={modalRef} onCancel={event => { if (locked) event.preventDefault(); else setModal(null); }} onClick={event => { if (event.target === event.currentTarget && !locked) setModal(null); }} onClose={() => { if (!modalRef.current?.open) setModal(null); }} aria-labelledby="dialog-title"><div className="modal-content"><button className="close-modal" aria-label="Fechar" onClick={() => setModal(null)} disabled={locked}><X size={20}/></button>
      {(modal === 'add' || modal === 'edit') && <><div className="modal-icon"><Link size={24}/></div><h2 id="dialog-title">{modal === 'edit' ? 'Editar vídeo' : 'Adicionar à sua lista'}</h2><p className="modal-description">{modal === 'edit' ? 'As alterações são salvas na lista compartilhada do aplicativo.' : 'Cole um link público do Drive com download permitido. Ele fica salvo no aplicativo e aparece para quem acessa esta instalação.'}</p><form onSubmit={modal === 'edit' ? editVideo : addVideo}>
        {modal === 'add' && <label>Link do vídeo<input type="url" placeholder="https://drive.google.com/file/d/.../view" required value={url} onChange={event => setUrl(event.target.value)} autoFocus disabled={saving}/></label>}
        <label>Título<input required maxLength={120} placeholder="Nome do vídeo" value={title} onChange={event => setTitle(event.target.value)} disabled={saving}/></label>
        <ArtworkFields artwork={artwork} disabled={saving}/>
        <label>Gênero<input list="genre-options" placeholder="Escolha ou crie um gênero" maxLength={32} value={newGenre} onChange={event => setNewGenre(event.target.value)} disabled={saving}/><datalist id="genre-options">{[...new Set([...baseGenres, ...genres])].map(item => <option value={item} key={item}/>)}</datalist></label>
        <div className="film-classification-fields"><label>Ano<input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="Ex.: 2026 (opcional)" value={year} onChange={event => setYear(event.target.value)} disabled={saving}/></label><label>País<input list="country-options" maxLength={128} placeholder="Ex.: Brasil (opcional)" value={country} onChange={event => setCountry(event.target.value)} disabled={saving}/><datalist id="country-options">{[...new Set(saved.flatMap(video => video.country ? [video.country] : []))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(item => <option value={item} key={item}/>)}</datalist></label></div>
        <details className="film-details-fields"><summary>Detalhes do filme (opcional)</summary><label>Direção<input maxLength={200} value={director} onChange={event => setDirector(event.target.value)} disabled={saving}/></label><label>Sinopse<textarea rows={3} maxLength={3000} value={description} onChange={event => setDescription(event.target.value)} disabled={saving}/></label></details>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">{modal === 'edit' && <button type="button" className="delete-button" onClick={removeVideo} disabled={locked}><Trash2 size={16}/>Remover</button>}<button className="button primary" type="submit" disabled={locked}>{saving || artwork.validating ? <LoaderCircle size={17} className="spin"/> : <Check size={17}/>} {saving ? 'Salvando…' : artwork.validating ? 'Preparando imagem…' : modal === 'edit' ? 'Salvar alterações' : 'Adicionar à lista'}</button></div>
      </form></>}
      {modal === 'help' && <><div className="modal-icon"><ListVideo size={25}/></div><h2 id="dialog-title">Sua lista, sempre aqui.</h2><ol className="help-steps"><li><span>01</span><div><strong>Adicione um link</strong><p>Cole o link do Drive, escolha um título e um gênero. Você também pode informar o ano e o país para organizar o acervo.</p></div></li><li><span>02</span><div><strong>Escolha um filme no catálogo</strong><p>Todos os filmes aparecem ao abrir. Use a busca e combine os filtros de gênero, ano e país; clique em um filme para abrir o player. Use o marcador para guardar seus favoritos na Minha lista.</p></div></li><li><span>03</span><div><strong>Acesse de outros aparelhos</strong><p>Na mesma rede, abra o endereço de rede mostrado pelo servidor. A lista é a mesma e as alterações aparecem em poucos segundos.</p></div></li></ol><div className="form-note"><ShieldCheck size={18}/><span>A lista é salva no aplicativo, não depende deste navegador. Os vídeos continuam no Drive e mantêm suas permissões. Adicione os filmes por links públicos com download permitido. Não é necessário conectar uma conta Google. O original precisa ter codecs compatíveis; H.265 depende do navegador. O player alternativo do Drive continua dependendo do processamento do Google.</span></div><button className="button primary connect-submit" onClick={() => setModal(null)}>Entendi<Check size={16}/></button></>}
    </div></dialog>
    {toast && <div className="toast" role="status"><Check size={18}/>{toast}<button aria-label="Dispensar aviso" onClick={() => setToast('')}><X size={16}/></button></div>}
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
