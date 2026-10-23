export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

export class SrtError extends Error {
  constructor(message, status = 400, code = 'INVALID_SUBTITLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message) { throw new SrtError(message); }

function decode(bytes) {
  if (bytes.byteLength > MAX_SUBTITLE_BYTES) throw new SrtError('A legenda excede o limite de 2 MB.', 413, 'SUBTITLE_TOO_LARGE');
  if (!bytes.byteLength) invalid('O arquivo de legenda está vazio.');
  let value;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) value = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) value = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    else {
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { value = new TextDecoder('windows-1252', { fatal: true }).decode(bytes); }
    }
  } catch { invalid('Não foi possível ler a codificação da legenda. Salve o arquivo SRT em UTF-8.'); }
  value = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) {
    invalid('A legenda contém caracteres inválidos. Salve o arquivo SRT em UTF-8 ou UTF-16 com BOM.');
  }
  return value;
}

function milliseconds(hours, minutes, seconds, fraction, cue) {
  if (Number(minutes) > 59 || Number(seconds) > 59) invalid(`Horário inválido no trecho ${cue} da legenda.`);
  return Number(hours) * 3600000 + Number(minutes) * 60000 + Number(seconds) * 1000 + Number(fraction);
}

function time(value, separator) {
  const hours = String(Math.floor(value / 3600000)).padStart(2, '0');
  const minutes = String(Math.floor(value / 60000) % 60).padStart(2, '0');
  const seconds = String(Math.floor(value / 1000) % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}${separator}${String(value % 1000).padStart(3, '0')}`;
}

function vttText(value) {
  // WebVTT has its own markup parser. Keep captions literal, including any
  // apparent HTML tags, cue settings, entities, or embedded timing arrows.
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Decode common SRT encodings, validate every cue and emit canonical UTF-8. */
export function parseSrt(bytes) {
  const value = decode(bytes);
  const blocks = value.trim().split(/\n[ \t]*\n+/);
  const cues = [];
  const timestamps = /^\s*(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})\s*$/;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (/^\s*\d+\s*$/.test(lines[0])) lines.shift();
    const cue = cues.length + 1;
    const match = lines.shift()?.match(timestamps);
    if (!match) invalid(`O trecho ${cue} não tem horários SRT válidos (00:00:01,000 --> 00:00:02,000).`);
    const start = milliseconds(...match.slice(1, 5), cue);
    const end = milliseconds(...match.slice(5, 9), cue);
    if (end <= start) invalid(`O fim do trecho ${cue} deve ser posterior ao início.`);
    if (!lines.some(line => line.trim())) invalid(`O trecho ${cue} não contém texto de legenda.`);
    cues.push({ start, end, text: lines.join('\n') });
  }
  const srt = `${cues.map((cue, index) => `${index + 1}\n${time(cue.start, ',')} --> ${time(cue.end, ',')}\n${cue.text}`).join('\n\n')}\n`;
  if (Buffer.byteLength(srt) > MAX_SUBTITLE_BYTES) throw new SrtError('A legenda em UTF-8 excede o limite de 2 MB.', 413, 'SUBTITLE_TOO_LARGE');
  const vtt = `WEBVTT\n\n${cues.map((cue, index) => `${index + 1}\n${time(cue.start, '.')} --> ${time(cue.end, '.')}\n${vttText(cue.text)}`).join('\n\n')}\n`;
  return { srt, vtt, cueCount: cues.length };
}
