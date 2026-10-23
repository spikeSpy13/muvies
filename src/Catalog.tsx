import type { MouseEvent } from 'react';
import { ArrowRight, Bookmark, Check, CircleHelp, Film, Info, LoaderCircle, Pencil, Play, Plus, Search } from 'lucide-react';
import type { Video } from './library';
import './catalog.css';

export function filmUrl(video: Video) { return `?filme=${encodeURIComponent(video.id)}`; }
function illustration(video: Video) {
  let hash = 0;
  for (const character of video.driveId || video.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `/illustrations/cinema-${hash % 8 + 1}.svg`;
}
function FilmMeta({ video }: { video: Video }) {
  return <div className="film-meta"><span>{video.genre}</span>{video.year && <span>{video.year}</span>}{video.duration && <span>{video.duration}</span>}</div>;
}

type Props = {
  videos: Video[]; ready: boolean; saving: boolean; locked: boolean; problem: string; actionProblem: string;
  genre: string; search: string; favoritesOnly: boolean;
  onGenre: (genre: string) => void; onSearch: (search: string) => void; onFavorites: (value: boolean) => void;
  onWatch: (event: MouseEvent<HTMLAnchorElement>, video: Video) => void;
  onAdd: () => void; onEdit: (video: Video) => void; onFavorite: (video: Video) => void; onHelp: () => void; onRetry: () => void;
};

export function Catalog(props: Props) {
  const { videos, ready, saving, locked, problem, actionProblem, genre, search, favoritesOnly, onGenre, onSearch, onFavorites, onWatch, onAdd, onEdit, onFavorite, onHelp, onRetry } = props;
  const genres = [...new Set(videos.map(video => video.genre))];
  const query = search.trim().toLocaleLowerCase('pt-BR');
  const filtered = videos.filter(video => (genre === 'Todos' || video.genre === genre) && (!favoritesOnly || video.favorite)
    && (!query || [video.title, video.director, video.year, video.genre].some(value => value?.toLocaleLowerCase('pt-BR').includes(query))));
  const featured = filtered[0];
  const favorites = videos.filter(video => video.favorite).length;
  const date = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date());
  const reset = () => { onGenre('Todos'); onSearch(''); onFavorites(false); };
  const favoriteButton = (video: Video, hero = false) => <button className={hero ? 'editorial-button bookmark-hero' : 'catalog-icon-button'} aria-label={`${video.favorite ? 'Remover da' : 'Adicionar à'} Minha lista: ${video.title}`} aria-pressed={!!video.favorite} disabled={locked} onClick={() => onFavorite(video)}><Bookmark size={hero ? 17 : 16} fill={video.favorite ? 'currentColor' : 'none'}/>{hero && (video.favorite ? 'Na minha lista' : 'Minha lista')}</button>;

  return <div className="catalog-page">
    <header className="catalog-header editorial-shell">
      <div className="edition-line"><span>EDIÇÃO PESSOAL <b>•</b> ACERVO DE CINEMA</span><em>“Onde cada filme encontra o seu momento”</em><span>{date} <b>•</b> {ready ? `${videos.length} ${videos.length === 1 ? 'FILME' : 'FILMES'}` : 'CARREGANDO'}</span></div>
      <div className="masthead"><img src="/illustrations/emblem.svg" width="76" height="76" alt=""/><h1>THE METROPOLIS</h1><p>Caderno de cinema & sessões particulares</p></div>
      <div className="catalog-actions"><p className="catalog-save-status" role="status">{saving || !ready ? <LoaderCircle size={13} className={problem ? '' : 'spin'}/> : problem ? <Info size={13}/> : <Check size={13}/>} {saving ? 'Salvando lista…' : !ready ? 'Carregando acervo…' : problem ? 'Sincronização pendente' : 'Lista salva no aplicativo'}</p><div><button className="editorial-help" aria-label="Como funciona" onClick={onHelp}><CircleHelp size={17}/></button><button className="editorial-button dark" onClick={onAdd} disabled={!ready || locked}><Plus size={15}/>Adicionar vídeo</button></div></div>
      <div className="editorial-navigation"><nav aria-label="Filtrar por gênero"><button aria-pressed={genre === 'Todos' && !favoritesOnly} onClick={reset}>Todos</button>{genres.map(item => <button key={item} aria-pressed={genre === item && !favoritesOnly} onClick={() => { onGenre(item); onFavorites(false); }}>{item}</button>)}<button className="favorites-tab" aria-pressed={favoritesOnly} onClick={() => { onFavorites(true); onGenre('Todos'); }}><Bookmark size={13}/>Minha lista<span>{favorites}</span></button></nav><label className="catalog-search"><input type="search" aria-label="Buscar no catálogo" placeholder="Buscar título, direção ou ano…" value={search} onChange={event => onSearch(event.target.value)}/><Search size={17}/></label></div>
    </header>
    <main className="editorial-shell catalog-main">
      {(problem || actionProblem) && <div className="catalog-problem" role="alert"><Info size={18}/><span>{actionProblem || problem}</span>{!ready && <button onClick={onRetry}>Tentar carregar novamente</button>}</div>}
      {!ready ? <section className="catalog-loading" aria-label="Carregando acervo"><Film size={38} strokeWidth={1}/><h2>{problem ? 'Seu acervo está protegido' : 'Preparando a próxima sessão'}</h2><p>Aguardando a biblioteca salva no aplicativo.</p></section> : featured ? <section className="catalog-feature" aria-labelledby="feature-title">
        <div className="editorial-kicker"><span><i/>Em destaque <b>•</b> Do seu acervo</span><span className="kicker-aside">A próxima sessão começa com uma escolha</span></div>
        <div className="feature-layout"><figure><a href={filmUrl(featured)} onClick={event => onWatch(event, featured)} aria-label={`Assistir ${featured.title}`} className={`feature-art ${featured.cover ? "has-cover" : ""}`}><img className={featured.cover ? "uploaded-cover" : featured.poster ? "featured-poster" : undefined} src={featured.cover || featured.poster || "/illustrations/cover.svg"} alt={featured.cover ? `Imagem de destaque: ${featured.title}` : featured.poster ? `Pôster: ${featured.title}` : "Ilustração de uma cidade à noite, em nanquim e ocre"}/><span><Play size={14} fill="currentColor"/>Abrir sala de projeção</span></a><figcaption>Uma janela aberta para outras histórias.</figcaption></figure><div className="feature-copy"><FilmMeta video={featured}/><h2 id="feature-title"><a href={filmUrl(featured)} onClick={event => onWatch(event, featured)}>{featured.title}</a></h2>{featured.director && <p className="feature-director">Direção de {featured.director}</p>}<div className="editorial-flourish" aria-hidden="true">❧</div><p className="feature-description">{featured.description || 'Há histórias que pedem uma pausa no mundo. Escolha o seu lugar, apague as luzes e deixe o cinema acontecer.'}</p><blockquote>“O melhor lugar para estar é dentro de uma boa história.”<cite>Seu cinema, no seu tempo.</cite></blockquote><div className="feature-buttons"><a className="editorial-button dark" href={filmUrl(featured)} onClick={event => onWatch(event, featured)}><Play size={15} fill="currentColor"/>Assistir ao filme</a>{favoriteButton(featured, true)}<button className="catalog-icon-button" aria-label={`Editar ${featured.title}`} onClick={() => onEdit(featured)} disabled={locked}><Pencil size={16}/></button></div></div></div>
      </section> : !videos.length ? <section className="catalog-welcome"><img src="/illustrations/cover.svg" alt="Ilustração editorial de uma cidade e uma sala de cinema"/><div><span className="editorial-eyebrow">UM ACERVO AINDA POR DESCOBRIR</span><h2>O seu cinema<br/>começa aqui.</h2><p>Os filmes que você escolhe. As histórias que ficam. Adicione o primeiro link e prepare a sua sessão.</p><button className="editorial-button dark" onClick={onAdd}><Plus size={16}/>Adicionar primeiro vídeo</button><small>Seus links ficam salvos no aplicativo, disponíveis também nos aparelhos da sua rede.</small></div></section> : null}
      {ready && videos.length > 0 && <section className="catalog-collection" aria-labelledby="catalog-title"><div className="collection-heading"><div><span className="editorial-eyebrow">{favoritesOnly ? 'SUAS ESCOLHAS, SEMPRE POR PERTO' : 'HISTÓRIAS PARA A SUA PRÓXIMA SESSÃO'}</span><h2 id="catalog-title">{favoritesOnly ? 'Minha lista' : 'Em cartaz no catálogo'}</h2></div><p>{filtered.length} {filtered.length === 1 ? 'filme no acervo' : 'filmes no acervo'}</p></div>
        {filtered.length ? <div className="catalog-grid">{filtered.map(video => <article className="catalog-card" key={video.id} data-film-id={video.id}><FilmMeta video={video}/><a href={filmUrl(video)} onClick={event => onWatch(event, video)} aria-label={`Assistir ${video.title}`} className="card-art poster-art"><img className={video.poster ? "uploaded-poster" : undefined} src={video.poster || illustration(video)} alt={video.poster ? `Pôster: ${video.title}` : "Ilustração de cinema em nanquim, vermelho e ocre"} loading="lazy"/><span>Assistir <ArrowRight size={13}/></span></a><h3><a href={filmUrl(video)} onClick={event => onWatch(event, video)}>{video.title}</a></h3>{video.director && <p className="card-director">Dir. {video.director}</p>}{video.description && <p className="card-description">{video.description}</p>}<div className="card-actions"><a href={filmUrl(video)} onClick={event => onWatch(event, video)} className="editorial-button dark"><Play size={13} fill="currentColor"/>Assistir filme</a>{favoriteButton(video)}<button className="catalog-icon-button" aria-label={`Editar ${video.title}`} disabled={locked} onClick={() => onEdit(video)}><Pencil size={14}/></button></div></article>)}</div> : <div className="catalog-no-results"><Search size={30} strokeWidth={1}/><h3>{favoritesOnly && !query ? 'Sua próxima escolha está no catálogo' : 'Nenhum filme encontrado'}</h3><p>{favoritesOnly && !query ? 'Use o marcador de um filme para guardá-lo na Minha lista.' : 'Tente outro título, direção, ano ou gênero.'}</p><button onClick={reset}>Ver catálogo completo <ArrowRight size={15}/></button></div>}
      </section>}
      {ready && videos.length > 0 && <aside className="catalog-invitation"><div className="invitation-ornament" aria-hidden="true"><Film size={40} strokeWidth={1}/></div><div><span className="editorial-eyebrow">SEMPRE CABE MAIS UMA HISTÓRIA</span><h2>O próximo filme é uma escolha sua.</h2><p>Adicione um link ao acervo. O resto é dar o play.</p></div><button className="editorial-button" onClick={onAdd} disabled={locked}><Plus size={16}/>Adicionar filme</button></aside>}
    </main>
    <footer className="catalog-footer editorial-shell"><div><strong>THE METROPOLIS</strong><p>Seu acervo. Seu tempo. Seu cinema.</p></div><span className="finis">✦ <i>FINIS</i> ✦</span><p>Muvies <span>•</span> Cinema em casa</p></footer>
  </div>;
}
