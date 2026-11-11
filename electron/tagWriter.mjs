import { parseFile } from 'music-metadata';
import { updateFile } from 'music-metadata';

const pending = new Map();

// Include index/cache refresh in the queue, so notifications retain save order.
export function serializeTagWrite(filePath, operation) {
  const previous = pending.get(filePath) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  pending.set(filePath, current);
  return current.finally(() => {
    if (pending.get(filePath) === current) pending.delete(filePath);
  });
}

export function toTagPatch(tags) {
  const patch = {};
  for (const [field, target] of Object.entries({
    title: 'title', artist: 'artist', album: 'album', albumArtist: 'albumartist',
    year: 'date', genre: 'genre', composer: 'composer', bpm: 'bpm',
    comment: 'comment', lyrics: 'lyrics'
  })) {
    if (field in tags) patch[target] = tags[field] === '' ? null : tags[field];
  }
  for (const [number, total, target] of [
    ['trackNumber', 'trackTotal', 'track'], ['discNumber', 'discTotal', 'disk']
  ]) {
    const pair = {};
    for (const [field, key] of [[number, 'no'], [total, 'of']]) {
      if (!(field in tags)) continue;
      const value = String(tags[field] ?? '').trim();
      if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
        throw new Error(`Invalid ${field}`);
      }
      pair[key] = value ? Number(value) : null;
    }
    if (Object.keys(pair).length) patch[target] = pair;
  }
  if ('picture' in tags) {
    if (tags.picture === null) patch.picture = null;
    else {
      const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(tags.picture);
      if (!match) throw new Error('Invalid artwork data URL');
      patch.picture = [{ data: Buffer.from(match[2], 'base64'), format: match[1],
        type: 'Cover (front)', description: 'Cover' }];
    }
  }
  return patch;
}

export async function writeEditorTags(filePath, tags) {
  const metadata = await parseFile(filePath);
  const legacy = metadata.format.tagTypes?.some(type => type === 'ID3v2.2' || type === 'ID3v2.3') ?? false;
  const edits = toTagPatch(tags);
  let patch = edits;
  if (legacy && /\.(mp3|wav)$/i.test(filePath)) {
    const common = metadata.common;
    patch = { ...common };
    // Pair edits are partial, so retain an unchanged number or total.
    for (const key of ['track', 'disk']) {
      if (edits[key] && typeof edits[key] === 'object') edits[key] = { ...patch[key], ...edits[key] };
    }
    patch = { ...patch, ...edits };
  }
  await updateFile(filePath, patch, { atomic: false, stripFlacId3: true,
    replaceId3: legacy && /\.(mp3|wav)$/i.test(filePath) });
}
