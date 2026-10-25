import type { MouseEvent } from 'react';
import { ArrowRight, Bookmark, Check, CircleHelp, Film, Info, LoaderCircle, Pencil, Play, Plus, Search, X } from 'lucide-react';
import type { Video } from './library';
import './catalog.css';

export function filmUrl(video: Video) { return `?filme=${encodeURIComponent(video.id)}`; }
function illustration(video: Video) {
  let hash = 0;
  for (const character of video.driveId || video.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `/illustrations/cinema-${hash % 8 + 1}.svg`;
}
function FilmMeta({ video }: { video: Video }) {
  return <div className="film-meta"><span>{video.genre}</span>{video.year && <span>{video.year}</span>}{video.country && <span>{video.country}</span>}{video.duration && <span>{video.duration}</span>}</div>;
}

type Props = {
  videos: Video[]; ready: boolean; saving: boolean; locked: boolean; problem: string; actionProblem: string;
  genre: string; year: string; country: string; search: string; favoritesOnly: boolean;
  onGenre: (genre: string) => void; onYear: (year: string) => void; onCountry: (country: string) => void;
  onSearch: (search: string) => void; onFavorites: (value: boolean) => void;
  onWatch: (event: MouseEvent<HTMLAnchorElement>, video: Video) => void;
  onAdd: () => void; onEdit: (video: Video) => void; onFavorite: (video: Video) => void; onHelp: () => void; onRetry: () => void;
};

function searchable(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function Catalog(props: Props) {
  const { videos, ready, saving, locked, problem, actionProblem, genre, year, country, search, favoritesOnly, onGenre, onYear, onCountry, onSearch, onFavorites, onWatch, onAdd, onEdit, onFavorite, onHelp, onRetry } = props;
  const genres = [...new Set(videos.map(video => video.genre))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const years = [...new Set(videos.flatMap(video => video.year ? [video.year] : []))].sort((a, b) => Number(b) - Number(a));
  const countries = [...new Set(videos.flatMap(video => video.country ? [video.country] : []))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const query = searchable(search.trim());
  const filtered = videos.filter(video => (genre === 'Todos' || video.genre === genre)
    && (!year || video.year === year) && (!country || video.country === country)
    && (!favoritesOnly || video.favorite)
    && (!query || [video.title, video.director, video.year, video.genre, video.country].some(value => value && searchable(value).includes(query))));
  const favorites = videos.filter(video => video.favorite).length;
  const hasFilters = genre !== 'Todos' || !!year || !!country || !!search || favoritesOnly;
  const emptyFavorites = favoritesOnly && genre === 'Todos' && !year && !country && !query;
  const reset = () => { onGenre('Todos'); onYear(''); onCountry(''); onSearch(''); onFavorites(false); };

  return <div className="catalog-page">
    <header className="catalog-header editorial-shell">
      <div className="catalog-actions">
        <div className="catalog-heading">
          <h1>Filmes</h1>
          <p className="catalog-save-status" role="status">
            {saving || !ready ? <LoaderCircle size={13} className={problem ? '' : 'spin'}/> : problem ? <Info size={13}/> : <Check size={13}/>}
            {saving ? 'Salvando lista…' : !ready ? 'Carregando acervo…' : problem ? 'Sincronização pendente' : 'Lista salva no aplicativo'}
          </p>
        </div>
        <div className="catalog-header-buttons">
          <button className="editorial-help" aria-label="Como funciona" onClick={onHelp}><CircleHelp size={17}/></button>
          <button className="editorial-button dark" onClick={onAdd} disabled={!ready || locked}><Plus size={15}/>Adicionar vídeo</button>
        </div>
      </div>
      <div className="editorial-navigation">
        <nav aria-label="Filtrar por gênero">
          <button aria-pressed={genre === 'Todos' && !favoritesOnly} onClick={reset}>Todos</button>
          {genres.map(item => <button key={item} aria-pressed={genre === item && !favoritesOnly} onClick={() => { onGenre(item); onFavorites(false); }}>{item}</button>)}
          <button className="favorites-tab" aria-pressed={favoritesOnly} onClick={() => { onFavorites(true); onGenre('Todos'); }}><Bookmark size={13}/>Minha lista<span>{favorites}</span></button>
        </nav>
      </div>
      <div className="catalog-filters" role="search" aria-label="Buscar e filtrar filmes">
        <label className="catalog-search"><input type="search" aria-label="Buscar no catálogo" placeholder="Buscar filmes…" value={search} onChange={event => onSearch(event.target.value)}/><Search size={17}/></label>
        <label className="catalog-filter"><span>Ano</span><select aria-label="Filtrar por ano" value={year} onChange={event => onYear(event.target.value)}><option value="">Todos os anos</option>{years.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="catalog-filter"><span>País</span><select aria-label="Filtrar por país" value={country} onChange={event => onCountry(event.target.value)}><option value="">Todos os países</option>{countries.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        {hasFilters && <button className="clear-catalog-filters" onClick={reset}><X size={14}/>Limpar filtros</button>}
      </div>
    </header>
    <main className="editorial-shell catalog-main">
      {(problem || actionProblem) && <div className="catalog-problem" role="alert"><Info size={18}/><span>{actionProblem || problem}</span>{!ready && <button onClick={onRetry}>Tentar carregar novamente</button>}</div>}
      {!ready ? <section className="catalog-loading" aria-label="Carregando acervo"><Film size={38} strokeWidth={1}/><h2>{problem ? 'Seu acervo está protegido' : 'Carregando seus filmes'}</h2><p>Aguardando a biblioteca salva no aplicativo.</p></section> : !videos.length ? <section className="catalog-welcome">
        <Film size={36} strokeWidth={1}/><h2>O seu cinema começa aqui.</h2><p>Adicione seu primeiro vídeo para começar o catálogo.</p>
        <button className="editorial-button dark" onClick={onAdd} disabled={locked}><Plus size={16}/>Adicionar primeiro vídeo</button>
      </section> : <section className="catalog-collection" aria-labelledby="catalog-title">
        <div className="collection-heading"><h2 id="catalog-title">{favoritesOnly ? 'Minha lista' : genre === 'Todos' ? 'Todos os filmes' : genre}</h2><p role="status">{filtered.length} {filtered.length === 1 ? 'filme' : 'filmes'}{hasFilters ? ` de ${videos.length}` : ' no acervo'}</p></div>
        {filtered.length ? <div className="catalog-grid">{filtered.map(video => <article className="catalog-card" key={video.id} data-film-id={video.id}>
          <FilmMeta video={video}/>
          <a href={filmUrl(video)} onClick={event => onWatch(event, video)} aria-label={`Assistir ${video.title}`} className="card-art poster-art"><img className={video.poster ? 'uploaded-poster' : undefined} src={video.poster || illustration(video)} alt={video.poster ? `Pôster: ${video.title}` : 'Ilustração de cinema em nanquim, vermelho e ocre'} loading="lazy"/><span>Assistir <ArrowRight size={13}/></span></a>
          <h3><a href={filmUrl(video)} onClick={event => onWatch(event, video)}>{video.title}</a></h3>
          {video.director && <p className="card-director">Dir. {video.director}</p>}
          {video.description && <p className="card-description">{video.description}</p>}
          <div className="card-actions">
            <a href={filmUrl(video)} onClick={event => onWatch(event, video)} className="editorial-button dark"><Play size={13} fill="currentColor"/>Assistir filme</a>
            <button className="catalog-icon-button" aria-label={`${video.favorite ? 'Remover da' : 'Adicionar à'} Minha lista: ${video.title}`} aria-pressed={!!video.favorite} disabled={locked} onClick={() => onFavorite(video)}><Bookmark size={16} fill={video.favorite ? 'currentColor' : 'none'}/></button>
            <button className="catalog-icon-button" aria-label={`Editar ${video.title}`} disabled={locked} onClick={() => onEdit(video)}><Pencil size={14}/></button>
          </div>
        </article>)}</div> : <div className="catalog-no-results"><Search size={30} strokeWidth={1}/><h3>{emptyFavorites ? 'Sua próxima escolha está no catálogo' : 'Nenhum filme encontrado'}</h3><p>{emptyFavorites ? 'Use o marcador de um filme para guardá-lo na Minha lista.' : 'Tente outra busca ou altere os filtros de gênero, ano e país.'}</p><button onClick={reset}>Ver catálogo completo <ArrowRight size={15}/></button></div>}
      </section>}
    </main>
  </div>;
}
