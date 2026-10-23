import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, ChevronDown, CircleHelp, Clapperboard, Cloud, ExternalLink, Film, FolderOpen, Info, Link, ListVideo, LoaderCircle, Maximize, Pencil, Play, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { authorizeDrive, demos, getSavedVideos, listDriveVideos, loadGoogleIdentity, parseDriveId, saveVideos, type Video } from './library';
import './styles.css';

type Modal = 'add' | 'connect' | 'help' | 'edit' | null;
const baseGenres = ['Animação', 'Aventura', 'Fantasia', 'Ação', 'Comédia', 'Documentário', 'Drama', 'Terror'];
function savedClientId() {
  try { return localStorage.getItem('muvies.google-client-id') || ''; }
  catch { return ''; }
}

function DriveIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3h8l7 12h-8Z" fill="#FCC64D"/><path d="M8 3 1 15l4 7 7-12Z" fill="#48B78B"/><path d="M5 22h14l4-7H9Z" fill="#6C9CF5"/></svg>;
}

function App() {
  const [saved, setSaved] = useState<Video[]>(getSavedVideos);
  const [activeId, setActiveId] = useState(() => getSavedVideos()[0]?.id || demos[0].id);
  const [genre, setGenre] = useState('Todos');
  const [tab, setTab] = useState<'all' | 'drive'>('all');
  const [playing, setPlaying] = useState(false);
  const [playerError, setPlayerError] = useState(false);
  const [driveFrameVersion, setDriveFrameVersion] = useState(0);
  const [dropdown, setDropdown] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [newGenre, setNewGenre] = useState('Sem gênero');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);
  const [clientId, setClientId] = useState(savedClientId);
  const [connected, setConnected] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const allVideos = [...saved, ...demos];
  const active = allVideos.find(video => video.id === activeId) || demos[0];
  const genres = [...new Set([...saved.map(video => video.genre), ...demos.map(video => video.genre)])];
  const filtered = allVideos.filter(video => (tab === 'all' || video.source === 'drive') && (genre === 'Todos' || video.genre === genre));
  const options = filtered.filter(video => video.title.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));

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
  useEffect(() => {
    if (modal) modalRef.current?.showModal();
    else modalRef.current?.close();
    setError('');
    if (modal === 'connect') {
      let cancelled = false;
      loadGoogleIdentity().then(() => { if (!cancelled) setIdentityReady(true); }).catch(error => { if (!cancelled) setError(error.message); });
      return () => { cancelled = true; };
    }
  }, [modal]);

  function persist(videos: Video[]): boolean {
    try { saveVideos(videos); setSaved(videos); return true; }
    catch { setError('O navegador não conseguiu salvar a biblioteca. Libere o armazenamento local e tente novamente.'); return false; }
  }
  function choose(video: Video) {
    setActiveId(video.id); setPlaying(false); setPlayerError(false); setDropdown(false); setSearch('');
  }
  function openAdd() { setTitle(''); setUrl(''); setNewGenre('Sem gênero'); setEditing(null); setModal('add'); }
  function openEdit(video: Video) { setEditing(video.id); setTitle(video.title); setNewGenre(video.genre); setModal('edit'); }
  function addVideo(event: React.FormEvent) {
    event.preventDefault();
    const driveId = parseDriveId(url);
    if (!driveId) return setError('Cole um link de vídeo do Google Drive, como drive.google.com/file/d/ID/view. Links de pastas não são aceitos.');
    const duplicate = saved.find(video => video.driveId === driveId);
    if (duplicate) { choose(duplicate); setGenre('Todos'); setTab('all'); setModal(null); setToast('Este vídeo já está na sua biblioteca.'); return; }
    const video: Video = { id: `drive-${driveId}`, driveId, title: title.trim(), genre: newGenre.trim() || 'Sem gênero', source: 'drive', url: `https://drive.google.com/file/d/${driveId}/preview` };
    if (!persist([...saved, video])) return;
    choose(video); setGenre('Todos'); setTab('all'); setModal(null); setToast('Vídeo adicionado à sua biblioteca.');
  }
  function editVideo(event: React.FormEvent) {
    event.preventDefault();
    if (!persist(saved.map(video => video.id === editing ? { ...video, title: title.trim(), genre: newGenre.trim() || 'Sem gênero' } : video))) return;
    setGenre('Todos'); setModal(null); setToast('Informações do vídeo atualizadas.');
  }
  function removeVideo() {
    if (!persist(saved.filter(video => video.id !== editing))) return;
    if (activeId === editing) choose(demos[0]);
    setGenre('Todos'); setModal(null); setToast('Vídeo removido da biblioteca. O arquivo continua no seu Drive.');
  }
  async function connect() {
    if (!clientId.trim().endsWith('.apps.googleusercontent.com')) return setError('Informe um Client ID OAuth válido, terminado em .apps.googleusercontent.com.');
    setBusy(true); setError('');
    try {
      // Request from the click handler so the browser can open the Google popup.
      const token = await authorizeDrive(clientId.trim());
      const imported = await listDriveVideos(token);
      const merged = [...saved];
      for (const video of imported) if (!merged.some(item => item.id === video.id)) merged.push(video);
      if (!persist(merged)) return;
      try { localStorage.setItem('muvies.google-client-id', clientId.trim()); } catch { /* The public client ID can be entered again. */ }
      setConnected(true); setGenre('Todos'); setTab('drive');
      if (imported[0]) choose(merged.find(video => video.id === imported[0].id) || imported[0]);
      setModal(null); setToast(imported.length ? `${imported.length} vídeo(s) encontrado(s) no seu Drive.` : 'Conta conectada. Nenhum vídeo encontrado no Drive.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível conectar. Tente novamente.'); }
    finally { setBusy(false); }
  }
  async function startPlayback() {
    setPlaying(true); setPlayerError(false);
    if (active.source === 'demo') {
      try { await videoRef.current?.play(); }
      catch { setPlayerError(true); }
    }
  }

  return <>
    <header className="header"><div className="header-inner">
      <a className="brand" href="#" aria-label="Muvies, início" onClick={() => { setTab('all'); setGenre('Todos'); }}><span className="brand-symbol"><span /><Play size={22} fill="currentColor" strokeWidth={0} /></span>muvies<span className="brand-dot">.</span></a>
      <nav aria-label="Navegação principal"><button className={tab === 'all' ? 'nav-active' : ''} onClick={() => { setTab('all'); setGenre('Todos'); }}><Clapperboard size={17} /> Biblioteca</button><button className={tab === 'drive' ? 'nav-active' : ''} onClick={() => { setTab('drive'); setGenre('Todos'); }}><Cloud size={18} /> Meu Drive {saved.length > 0 && <span className="nav-count">{saved.length}</span>}</button></nav>
      <button className="help-button" aria-label="Como funciona" onClick={() => setModal('help')}><CircleHelp size={17} /><span>Como funciona</span></button>
    </div></header>

    <main>
      <section className="intro">
        <div><div className="eyebrow"><span /> SEU ESPAÇO, SUAS HISTÓRIAS</div><h1>Seu cinema. <span>Do seu jeito.</span></h1><p>Seus vídeos do Google Drive, com lugar na primeira fila.</p></div>
        <div className="intro-actions"><button className="button secondary" onClick={() => setModal('connect')}><DriveIcon size={18} />{connected ? 'Sincronizar Drive' : 'Conectar Drive'}</button><button className="button primary" onClick={openAdd}><Plus size={18} />Adicionar vídeo</button></div>
      </section>

      <section className="watch-section" aria-label="Player e seleção de vídeos">
        <div className="library-toolbar">
          <div className="genre-tabs" aria-label="Filtrar por gênero"><button className={genre === 'Todos' ? 'genre selected' : 'genre'} onClick={() => setGenre('Todos')}>Todos <span>{tab === 'drive' ? saved.length : allVideos.length}</span></button>{genres.filter(item => tab !== 'drive' || saved.some(video => video.genre === item)).map(item => <button key={item} className={genre === item ? 'genre selected' : 'genre'} onClick={() => setGenre(item)}>{item}</button>)}</div>
          <div className="video-selector" ref={dropdownRef}>
            <button className={`selector-button ${dropdown ? 'is-open' : ''}`} aria-label="Escolher vídeo" aria-expanded={dropdown} aria-controls="video-list" onClick={() => setDropdown(!dropdown)}><ListVideo size={18} /><span>Escolher vídeo</span><ChevronDown size={15} /></button>
            {dropdown && <div className="dropdown" id="video-list"><div className="search-field"><Search size={17}/><input autoFocus aria-label="Buscar vídeo" placeholder="Buscar na sua biblioteca..." value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setDropdown(false); }} /></div><div className="dropdown-options">{options.length ? options.map(video => <button key={video.id} onClick={() => choose(video)}><span className="small-video-icon"><Film size={17}/></span><span><strong>{video.title}</strong><small>{video.genre} · {video.source === 'drive' ? 'Google Drive' : 'Demonstração'}</small></span>{active.id === video.id && <Check className="check" size={17}/>}</button>) : <p className="no-options">Nenhum vídeo encontrado.</p>}</div><button className="dropdown-add" onClick={() => { setDropdown(false); openAdd(); }}><Plus size={16}/>Adicionar um vídeo</button></div>}
          </div>
        </div>

        <div className={`player ${playing ? 'is-playing' : ''}`} ref={playerRef}>
          {active.source === 'demo' ? <video key={active.id} ref={videoRef} src={active.url} poster={active.poster} controls={playing} preload="none" playsInline onError={() => setPlayerError(true)} onEnded={() => setPlaying(false)} aria-label={`Player: ${active.title}`} /> : playing && <iframe key={`${active.id}-${driveFrameVersion}`} src={active.url} title={`Player do Google Drive: ${active.title}`} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />}
          {!playing && <div className={`player-cover ${active.source === 'drive' ? 'drive-cover' : ''}`}>
            <div className="player-top"><span className="player-label"><span/> {active.source === 'drive' ? 'DO SEU GOOGLE DRIVE' : 'SESSÃO DE DEMONSTRAÇÃO'}</span><span className="quality-label">{active.source === 'drive' ? <DriveIcon size={17}/> : active.id === 'demo-bunny' ? 'BLENDER OPEN MOVIE' : 'UM RESPIRO NA ROTINA'}</span></div>
            <button className="big-play" aria-label={`Reproduzir ${active.title}`} onClick={startPlayback}><Play size={27} fill="currentColor" strokeWidth={0}/></button>
            <div className="cover-bottom"><div><div className="cover-genre">{active.genre} {active.duration && <><span>·</span>{active.duration}</>}</div><h2>{active.title}</h2><p>{active.source === 'drive' ? 'Seu próximo play está aqui.' : 'Uma boa história começa com um play.'}</p></div><button className="fullscreen" aria-label="Abrir player em tela cheia" onClick={() => { playerRef.current?.requestFullscreen?.().catch(() => setToast('Use a opção de tela cheia nos controles do vídeo.')); }}><Maximize size={19}/></button></div>
          </div>}
          {playerError && <div className="player-error"><Info size={24}/><strong>Não foi possível carregar o vídeo.</strong><p>Verifique sua conexão e tente novamente.</p><button className="button secondary" onClick={() => { videoRef.current?.load(); startPlayback(); }}>Tentar novamente</button></div>}
        </div>
        <div className="now-playing"><div><span className="playing-indicator"><i/><i/><i/></span><span>{active.source === 'drive' || !playing ? 'Vídeo selecionado' : 'Você está assistindo'}</span><strong>{active.title}</strong></div><span className="source-badge">{active.source === 'drive' ? <><DriveIcon size={14}/> Google Drive</> : <><Film size={14}/> Vídeo de demonstração</>}</span></div>
        {active.source === 'drive' && <aside className="drive-playback-help" aria-label="Ajuda com a reprodução do Drive">
          <div className="drive-help-heading"><Info size={17}/><div><strong>O vídeo não começou?</strong><p>Para vídeos privados, use a conta Google com acesso ao arquivo.</p></div></div>
          <div className="drive-help-actions">
            {playing && <button className="button secondary" onClick={() => setDriveFrameVersion(version => version + 1)}><RefreshCw size={14}/>Recarregar player</button>}
            <a className="button secondary" href={`https://drive.google.com/file/d/${active.driveId}/view`} target="_blank" rel="noreferrer">Abrir no Drive<ExternalLink size={14}/></a>
          </div>
          <details className="drive-processing-help"><summary>O Drive diz que o vídeo ainda está sendo processado?</summary><p>Abra o arquivo no Drive para conferir. Se a mesma mensagem aparecer lá, aguarde o processamento do Google e tente novamente. O Muvies não consegue acelerar essa etapa.</p><p>Se o vídeo já reproduz no Drive, confira se o navegador permite cookies do Google, entre na mesma conta e use <strong>Recarregar player</strong>. Se necessário, assista diretamente no Drive.</p><p>Se precisar assistir antes do processamento terminar, tente baixar o arquivo pelo próprio Drive e abri-lo em um player local, como o VLC, desde que você tenha permissão para download.</p></details>
        </aside>}
      </section>

      <section className="collection" aria-labelledby="collection-title"><div className="section-heading"><div><h2 id="collection-title">{tab === 'drive' ? 'Do seu Drive' : genre === 'Todos' ? 'Na sua biblioteca' : genre}<span>{filtered.length}</span></h2><p>{tab === 'drive' ? 'Seus arquivos, organizados em um só lugar.' : 'Escolha uma história e fique à vontade.'}</p></div><span className="collection-detail"><span/> Tudo pronto para o play</span></div>
        <div className="video-grid">{filtered.map(video => <article className={`video-card ${active.id === video.id ? 'active-card' : ''}`} key={video.id}>
          <button className={`thumbnail ${video.source === 'drive' ? 'drive-thumbnail' : ''}`} onClick={() => choose(video)} aria-label={`Selecionar ${video.title}`}>
            {video.poster ? <img src={video.poster} alt="" loading="lazy"/> : <div className="drive-art"><Film size={36} strokeWidth={1}/><span>{video.genre}</span></div>}
            <span className="thumbnail-shade"/>{active.id === video.id ? <span className="selected-badge"><span/>Selecionado</span> : <span className="hover-play"><Play size={20} fill="currentColor" strokeWidth={0}/></span>}
            {video.duration && <span className="duration">{video.duration}</span>}
          </button><div className="card-info"><div><button className="card-title" onClick={() => choose(video)}>{video.title}</button><p>{video.genre}<span>·</span>{video.source === 'drive' ? 'Google Drive' : 'Demonstração'}</p></div>{video.source === 'drive' && <button className="edit-button" aria-label={`Editar ${video.title}`} onClick={() => openEdit(video)}><Pencil size={15}/></button>}</div>
        </article>)}<button className="add-card" onClick={openAdd}><span className="add-card-icon"><Plus size={24} strokeWidth={1.5}/></span><strong>Mais uma boa história?</strong><span>Adicione um vídeo do seu Drive</span><span className="add-card-link">Adicionar vídeo<ArrowRight size={14}/></span></button></div>
        {filtered.length === 0 && <div className="empty-message"><FolderOpen size={20}/><p>{tab === 'drive' ? 'Sua biblioteca do Drive começa aqui. Adicione um link ou conecte sua conta.' : 'Ainda não há vídeos neste gênero.'}</p>{tab === 'drive' && <button onClick={() => setModal('connect')}>Conectar meu Drive<ArrowRight size={14}/></button>}</div>}
      </section>

      <div className="privacy-strip"><div className="privacy-icon"><ShieldCheck size={20}/></div><div><strong>Seus vídeos continuam sendo seus.</strong><p>Os arquivos ficam no seu Drive. O Muvies só prepara a pipoca.</p></div><button onClick={() => setModal('help')}>Saiba mais<ArrowRight size={15}/></button></div>
      <footer><a className="footer-brand" href="#">muvies<span>.</span></a><span>Feito para dar play nas suas histórias.</span><span className="footer-note">Sente, relaxe e aperte o play<Play size={11} fill="currentColor"/></span></footer>
    </main>

    <dialog ref={modalRef} onCancel={event => { if (busy) event.preventDefault(); else setModal(null); }} onClick={event => { if (event.target === event.currentTarget && !busy) setModal(null); }} onClose={() => setModal(null)} aria-labelledby="dialog-title"><div className="modal-content"><button className="close-modal" aria-label="Fechar" onClick={() => setModal(null)} disabled={busy}><X size={20}/></button>
      {(modal === 'add' || modal === 'edit') && <><div className="modal-icon"><Link size={24}/></div><h2 id="dialog-title">{modal === 'edit' ? 'Do seu jeito' : 'Uma nova história na biblioteca'}</h2><p className="modal-description">{modal === 'edit' ? 'Edite o título e organize o vídeo por gênero.' : 'Cole o link de um vídeo do Google Drive. Público ou privado, ele tem lugar aqui.'}</p><form onSubmit={modal === 'edit' ? editVideo : addVideo}>
        {modal === 'add' && <label>Link do vídeo<input type="url" placeholder="https://drive.google.com/file/d/.../view" required value={url} onChange={event => setUrl(event.target.value)} autoFocus/></label>}
        <label>Título<input required maxLength={120} placeholder="Como se chama essa história?" value={title} onChange={event => setTitle(event.target.value)}/></label>
        <label>Gênero<input list="genre-options" placeholder="Escolha ou crie um gênero" maxLength={32} value={newGenre} onChange={event => setNewGenre(event.target.value)}/><datalist id="genre-options">{[...new Set([...baseGenres, ...genres])].map(item => <option value={item} key={item}/>)}</datalist></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {modal === 'add' && <div className="form-note"><ShieldCheck size={17}/><span>Vídeos privados continuam privados. O player usa as permissões da sua conta Google.</span></div>}
        <div className="modal-actions">{modal === 'edit' && <button type="button" className="delete-button" onClick={removeVideo}><Trash2 size={16}/>Remover</button>}<button className="button primary" type="submit">{modal === 'edit' ? <Check size={17}/> : <Plus size={17}/>} {modal === 'edit' ? 'Salvar alterações' : 'Adicionar à biblioteca'}</button></div>
      </form></>}

      {modal === 'connect' && <><div className="modal-icon google"><DriveIcon size={28}/></div><h2 id="dialog-title">Seu Drive, na primeira fila.</h2><p className="modal-description">Conecte sua conta para encontrar e importar seus vídeos, incluindo os privados. Você escolhe o que assistir.</p>
        <div className="connection-benefits"><span><Check size={16}/> Importa os vídeos da sua conta</span><span><Check size={16}/> Preserva os títulos e gêneros que você editou</span><span><ShieldCheck size={16}/> Não altera ou exclui arquivos do Drive</span></div>
        <details className="setup-details" open={!clientId}><summary>Configuração da conexão Google<ChevronDown size={15}/></summary><p>Para ativar o login neste aplicativo, use um Client ID OAuth do tipo “Aplicativo da Web”, com a API Google Drive ativada e esta origem autorizada:</p><code>{window.location.origin}</code><label>Client ID do Google<input value={clientId} onChange={event => setClientId(event.target.value)} placeholder="Seu identificador.apps.googleusercontent.com" autoComplete="off"/></label><p>Configure o consentimento com a permissão <code>drive.metadata.readonly</code>. Em modo de teste, inclua sua conta como usuário de teste. Esse identificador é público; não informe um Client Secret.</p></details>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary connect-submit" onClick={connect} disabled={busy || !identityReady}>{busy ? <LoaderCircle size={18} className="spin"/> : <DriveIcon size={18}/>} {busy ? 'Importando seus vídeos…' : 'Continuar com o Google'}</button><button className="text-button" disabled={busy} onClick={openAdd}>Prefiro adicionar um link<ArrowRight size={14}/></button><p className="connection-footnote">A autorização é usada somente nesta sessão. Seus tokens não são salvos. O player do Drive exige uma sessão Google com acesso aos vídeos privados.</p>
      </>}

      {modal === 'help' && <><div className="modal-icon"><Clapperboard size={25}/></div><h2 id="dialog-title">Sua sala de cinema particular.</h2><p className="modal-description">Sem complicação. Só você e as suas histórias.</p><ol className="help-steps"><li><span>01</span><div><strong>Traga seus vídeos</strong><p>Adicione um link de vídeo do Drive ou conecte sua conta para importar a lista.</p></div></li><li><span>02</span><div><strong>Organize do seu jeito</strong><p>Escolha um gênero ao adicionar. Use o lápis ao lado do vídeo para editar ou remover da biblioteca.</p></div></li><li><span>03</span><div><strong>Dê o play</strong><p>Escolha um vídeo na lista ou nos cartões e clique no player. Para vídeos privados, use a conta Google com acesso ao arquivo.</p></div></li></ol><div className="form-note"><Info size={19}/><span>A biblioteca fica salva neste navegador. Seus arquivos não são copiados. As amostras são <a href="https://www.bigbuckbunny.org/" target="_blank" rel="noreferrer">Big Buck Bunny</a> (Blender Foundation, <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a>) e Flower (MDN, CC0). A reprodução no Drive depende das permissões do arquivo e dos cookies do Google.</span></div><button className="button primary connect-submit" onClick={() => setModal(null)}>Vamos assistir<Play size={16}/></button></>}
    </div></dialog>
    {toast && <div className="toast" role="status"><Check size={18}/>{toast}<button aria-label="Dispensar aviso" onClick={() => setToast('')}><X size={16}/></button></div>}
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
