export type Recording = {
  id: string; filename: string; title: string; mimeType: string;
  createdAt: number; bytes: number; duration: number; complete: boolean;
};

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('muvies-recordings', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('recordings', { keyPath: 'id' });
      request.result.createObjectStore('chunks', { keyPath: ['id', 'sequence'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(['recordings', 'chunks'], mode); }
    catch (error) { db.close(); reject(error); return; }
    let value: T;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('Não foi possível salvar a gravação local.')); };
    try { run(tx, result => { value = result; }); }
    catch (error) { tx.abort(); reject(error); }
  });
}

const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
export function saveRecording(recording: Recording, chunk?: Blob, sequence = 0) {
  return transaction<void>('readwrite', tx => {
    tx.objectStore('recordings').put(recording);
    if (chunk) tx.objectStore('chunks').put({ id: recording.id, sequence, data: chunk });
  });
}
export function listRecordings() {
  return transaction<Recording[]>('readonly', (tx, result) => {
    tx.objectStore('recordings').getAll().onsuccess = event => result((event.target as IDBRequest<Recording[]>).result.sort((a, b) => b.createdAt - a.createdAt));
  });
}
export function recordingBlob(recording: Recording) {
  return transaction<Blob>('readonly', (tx, result) => {
    tx.objectStore('chunks').getAll(chunkRange(recording.id)).onsuccess = event => {
      const chunks = (event.target as IDBRequest<{ data: Blob }[]>).result;
      result(new Blob(chunks.map(chunk => chunk.data), { type: recording.mimeType }));
    };
  });
}
export function deleteRecording(id: string) {
  return transaction<void>('readwrite', tx => {
    tx.objectStore('recordings').delete(id);
    tx.objectStore('chunks').delete(chunkRange(id));
  });
}
