// What's playing: the list a song was started from, and the order it plays in. Pure functions on
// file paths (no React, no tracks), unit-tested in playQueue.test.js; App.jsx keeps one queue.
//
// A queue is { kind, paths, order, at }:
//   kind  'library' — the Library: the list is whatever it shows right now (its sort and search),
//         so it is passed in live (`livePaths`) every time; `paths` is unused.
//         'list' — anything else (an artist/album/… page, a Mix, a Home row): a snapshot of the
//         list as it was when you started, since the page changes when you leave it.
//   order the shuffled order (every song once), or null when Shuffle is off (then the list's own
//         order plays).
//   at    the last song of this list that played: where to carry on from when the song playing
//         isn't in it (a "Play Next" song, or one the Library's search no longer shows).
//
// "Play Next" songs are not part of a queue: App.jsx plays them first, then the queue continues.

/** A shuffled copy (Fisher–Yates). */
export function shuffled(list, rand = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A new shuffled order of `list`: `first` (when it's in it) first, then the rest at random. */
export function dealOrder(list, first, rand = Math.random) {
  if (first != null && list.includes(first)) return [first, ...shuffled(list.filter((p) => p !== first), rand)];
  return shuffled(list, rand);
}

/**
 * Starts a queue. `paths` is the list to play (for 'library': the Library as shown right now, only
 * used to deal a shuffled order). `start` is the song picked to play first (or null: the list's own
 * first, or a random one when shuffled).
 */
export function startQueue({ kind = 'list', paths, start = null, shuffle = false, rand = Math.random }) {
  const list = paths || [];
  const order = shuffle ? dealOrder(list, start, rand) : null;
  const first = start ?? (order ? order[0] : list[0]) ?? null;
  return { kind, paths: kind === 'list' ? list.slice() : null, order, at: first };
}

/** The list a queue plays from: the live Library, or its own snapshot. */
export function queueList(q, livePaths = []) {
  return q.kind === 'library' ? livePaths : q.paths;
}

/** The sequence songs play in: the shuffled order, or the list itself. */
export function queueSequence(q, livePaths = []) {
  return q.order ?? queueList(q, livePaths);
}

/**
 * The song after (dir 1) or before (dir -1) `current` in the queue, or null at an end. `wrap`
 * (Repeat All, or a Next pressed by hand) goes round from the last song to the first. `playable`
 * skips songs that are no longer in the library.
 */
export function neighbour(q, livePaths, current, dir, { wrap = false, playable = () => true } = {}) {
  if (!q) return null;
  const seq = queueSequence(q, livePaths);
  const n = seq.length;
  if (n === 0) return null;
  let i = seq.indexOf(current);
  if (i === -1) i = seq.indexOf(q.at);
  if (i === -1) {
    // lost our place entirely (the list changed under us): start from its beginning (or end)
    i = dir > 0 ? -1 : n;
  }
  for (let step = 1; step <= n; step++) {
    let j = i + dir * step;
    if (j < 0 || j >= n) {
      if (!wrap) return null;
      j = ((j % n) + n) % n;
    }
    if (seq[j] === current && n > 1) continue;
    if (playable(seq[j])) return seq[j];
  }
  return null;
}

/** Remembers `path` as where the queue is, if it belongs to it. */
export function markPlayed(q, path, livePaths = []) {
  if (!q || q.at === path) return q;
  return queueSequence(q, livePaths).includes(path) ? { ...q, at: path } : q;
}

/**
 * Shuffle turned on or off. On: a new order every time, with the song playing (or the queue's last
 * one) first, so the rest follows it. Off: the list's own order, carrying on from the same song.
 */
export function withShuffle(q, on, livePaths, current, rand = Math.random) {
  if (!q) return q;
  if (!on) return q.order ? { ...q, order: null } : q;
  const list = queueList(q, livePaths);
  const first = list.includes(current) ? current : q.at;
  return { ...q, order: dealOrder(list, first, rand), at: list.includes(current) ? current : q.at };
}

/**
 * Songs added while the queue plays ("Add to queue"): a list snapshot gets them at its end, and a
 * shuffled order at random places among the songs still to come. (The live Library already
 * shows them.)
 */
export function withAdded(q, added, current, rand = Math.random) {
  if (!q || !added?.length) return q;
  let next = q;
  if (q.kind === 'list') {
    const have = new Set(q.paths);
    const fresh = added.filter((p) => !have.has(p));
    if (fresh.length) next = { ...next, paths: [...q.paths, ...fresh] };
  }
  if (q.order) {
    const have = new Set(q.order);
    const fresh = added.filter((p) => !have.has(p));
    if (fresh.length) {
      const order = q.order.slice();
      let pos = order.indexOf(current);
      if (pos === -1) pos = order.indexOf(q.at);
      for (const p of fresh) {
        const at = pos + 1 + Math.floor(rand() * (order.length - pos));
        order.splice(at, 0, p);
      }
      next = { ...next, order };
    }
  }
  return next;
}

/** How many songs of a queue the session keeps (a 20,000-song Library shuffle keeps what's next). */
export const QUEUE_SAVE_MAX = 5000;

/** The queue as the session saves it: a list's songs, and the shuffled order from where it is. */
export function queueToSaved(q) {
  if (!q) return null;
  let order = null;
  if (q.order) {
    const i = Math.max(0, q.order.indexOf(q.at));
    order = q.order.slice(i, i + QUEUE_SAVE_MAX);
  }
  return {
    kind: q.kind,
    paths: q.kind === 'list' ? q.paths.slice(0, QUEUE_SAVE_MAX) : null,
    order,
    at: q.at ?? null,
  };
}

/**
 * A saved queue put back, against the library as it is now (`exists`), or null if it's unusable.
 * A shuffled order that was cut short gets the rest of its list after it, dealt anew.
 */
export function queueFromSaved(saved, { livePaths = [], exists = () => true, rand = Math.random } = {}) {
  if (!saved || typeof saved !== 'object') return null;
  const kind = saved.kind === 'library' ? 'library' : saved.kind === 'list' ? 'list' : null;
  if (!kind) return null;
  const clean = (v) => (Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p && exists(p)) : null);
  const paths = kind === 'list' ? clean(saved.paths) : null;
  if (kind === 'list' && !paths?.length) return null;
  let order = clean(saved.order);
  if (order) {
    const list = kind === 'list' ? paths : livePaths;
    const have = new Set(order);
    order = [...order, ...shuffled(list.filter((p) => !have.has(p)), rand)];
    if (!order.length) order = null;
  }
  const at = typeof saved.at === 'string' && exists(saved.at) ? saved.at : null;
  return { kind, paths, order, at };
}
