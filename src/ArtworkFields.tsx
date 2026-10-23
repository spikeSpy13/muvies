import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import type { Video } from './library';

type Kind = 'poster' | 'cover';
type Draft = { url?: string; file?: File; preview?: string; changed?: boolean };
type Drafts = Record<Kind, Draft>;
const MAX_BYTES = 10 * 1024 * 1024;

export function useArtworkDraft() {
  const [drafts, setDrafts] = useState<Drafts>({ poster: {}, cover: {} });
  const [pending, setPending] = useState({ poster: false, cover: false });
  const [problem, setProblem] = useState('');
  const versions = useRef({ poster: 0, cover: 0 });
  const uploads = useRef(new WeakMap<File, Promise<string>>());
  const original = useRef<{ poster?: string; cover?: string }>({});
  const previews = useRef<{ poster?: string; cover?: string }>({});
  function release(kind: Kind) {
    const url = previews.current[kind];
    if (url) URL.revokeObjectURL(url);
    delete previews.current[kind];
  }
  useEffect(() => () => {
    versions.current.poster++; versions.current.cover++;
    release('poster'); release('cover');
  }, []);

  function reset(video?: Video) {
    versions.current.poster++; versions.current.cover++;
    release('poster'); release('cover');
    original.current = { poster: video?.poster, cover: video?.cover };
    setDrafts({ poster: { url: video?.poster }, cover: { url: video?.cover } });
    setPending({ poster: false, cover: false }); setProblem('');
  }
  async function select(kind: Kind, file: File) {
    const version = ++versions.current[kind];
    setProblem('');
    setPending(previous => ({ ...previous, [kind]: false }));
    if (!file.size || file.size > MAX_BYTES || !(file.type ? /^image\/(jpeg|png|webp)$/.test(file.type) : /\.(jpe?g|png|webp)$/i.test(file.name))) {
      setProblem('Escolha uma imagem JPG, PNG ou WebP não vazia, de até 10 MB.');
      return;
    }
    setPending(previous => ({ ...previous, [kind]: true }));
    const url = URL.createObjectURL(file);
    let retained = false;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Image too large');
      if (versions.current[kind] === version) {
        release(kind);
        previews.current[kind] = url;
        retained = true;
        setDrafts(previous => ({ ...previous, [kind]: { file, preview: url, changed: true } }));
      }
    } catch {
      if (versions.current[kind] === version) setProblem('Não foi possível ler a imagem. Use um JPG, PNG ou WebP válido, com até 40 megapixels.');
    } finally {
      if (!retained) URL.revokeObjectURL(url);
      if (versions.current[kind] === version) setPending(previous => ({ ...previous, [kind]: false }));
    }
  }
  function remove(kind: Kind) {
    versions.current[kind]++;
    release(kind);
    setPending(previous => ({ ...previous, [kind]: false }));
    setDrafts(previous => ({ ...previous, [kind]: { changed: !!original.current[kind] } })); setProblem('');
  }
  async function uploadFile(file: File) {
    let result = uploads.current.get(file);
    if (!result) {
      result = (async () => {
        const mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg');
        const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': mime }, body: file, signal: AbortSignal.timeout(30000) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.message || 'Não foi possível salvar a imagem. Tente novamente.');
        if (typeof data?.url !== 'string' || !/^\/api\/images\/[a-f0-9]{64}\.webp$/.test(data.url)) throw new Error('O servidor não retornou uma imagem salva válida.');
        return data.url as string;
      })();
      uploads.current.set(file, result);
    }
    try { return await result; }
    catch (error) { uploads.current.delete(file); throw error; }
  }
  async function upload(latest?: Video): Promise<{ poster?: string; cover?: string }> {
    const [poster, cover] = await Promise.all((['poster', 'cover'] as const).map(kind => drafts[kind].changed
      ? drafts[kind].file ? uploadFile(drafts[kind].file!) : drafts[kind].url
      : latest ? latest[kind] : drafts[kind].url));
    return { poster, cover };
  }
  return { drafts, pending, problem, validating: pending.poster || pending.cover, changed: !!drafts.poster.changed || !!drafts.cover.changed, reset, select, remove, upload };
}

function ImageField({ kind, draft, pending, disabled, onSelect, onRemove }: { kind: Kind; draft: Draft; pending: boolean; disabled: boolean; onSelect: (kind: Kind, file: File) => void; onRemove: (kind: Kind) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const preview = draft.preview || draft.url;
  const poster = kind === 'poster';
  const label = poster ? 'Pôster do filme' : 'Imagem de destaque';
  return <div className={`artwork-field ${kind}`}>
    <span className="artwork-label" id={`${kind}-label`}>{label}</span>
    <input ref={input} type="file" className="visually-hidden" tabIndex={-1} accept="image/jpeg,image/png,image/webp" aria-labelledby={`${kind}-label`} disabled={disabled || pending} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onSelect(kind, file); }}/>
    <button type="button" className="artwork-preview" aria-label={`${preview ? 'Trocar' : 'Enviar'} ${poster ? 'pôster' : 'imagem de destaque'}`} disabled={disabled || pending} onClick={() => input.current?.click()}>
      {preview ? <img src={preview} alt={`Prévia: ${label.toLocaleLowerCase('pt-BR')}`}/> : <><ImagePlus size={27} strokeWidth={1}/><span>{poster ? 'Imagem vertical' : 'Imagem horizontal'}</span></>}
      {pending && <span className="artwork-validating"><LoaderCircle size={20} className="spin"/></span>}
    </button>
    <div className="artwork-file-actions"><button type="button" disabled={disabled || pending} onClick={() => input.current?.click()}>{preview ? 'Trocar imagem' : 'Escolher imagem'}</button>{(draft.file || draft.url) && <button type="button" aria-label={`Remover ${poster ? 'pôster' : 'imagem de destaque'}`} disabled={disabled || pending} onClick={() => onRemove(kind)}><Trash2 size={13}/></button>}</div>
    <small>{poster ? 'Para os cards. Proporção sugerida: 2:3.' : 'Para o destaque. Proporção sugerida: 16:9.'}</small>
  </div>;
}

export function ArtworkFields({ artwork, disabled }: { artwork: ReturnType<typeof useArtworkDraft>; disabled: boolean }) {
  return <fieldset className="artwork-fields"><legend>Imagens do filme <span>(opcional)</span></legend><p>JPG, PNG ou WebP de até 10 MB cada. As imagens ficam salvas no aplicativo.</p><div className="artwork-grid">{(['poster', 'cover'] as const).map(kind => <ImageField key={kind} kind={kind} draft={artwork.drafts[kind]} pending={artwork.pending[kind]} disabled={disabled} onSelect={artwork.select} onRemove={artwork.remove}/>)}</div>{artwork.problem && <p className="form-error" role="alert">{artwork.problem}</p>}</fieldset>;
}
