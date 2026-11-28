import { describe, it, expect } from 'vitest';
import {
  shuffled, dealOrder, startQueue, neighbour, markPlayed, withShuffle, withAdded,
  queueToSaved, queueFromSaved, QUEUE_SAVE_MAX,
} from './playQueue.js';

// a repeatable "random": a simple LCG, so every test is deterministic
const seeded = (seed = 1) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const L = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('shuffling', () => {
  it('a shuffle holds every song exactly once', () => {
    const s = shuffled(L, seeded(7));
    expect(s).toHaveLength(L.length);
    expect([...s].sort()).toEqual(L);
  });
  it('a dealt order starts with the picked song, then all the rest once', () => {
    const o = dealOrder(L, 'd', seeded(3));
    expect(o[0]).toBe('d');
    expect([...o].sort()).toEqual(L);
  });
  it('each deal is a new order', () => {
    const r = seeded(11);
    const orders = new Set(Array.from({ length: 8 }, () => dealOrder(L, 'a', r).join('')));
    expect(orders.size).toBeGreaterThan(4);
  });
});

describe('a list played in order', () => {
  const q = startQueue({ paths: L, start: 'c' });
  it('starts at the picked song and goes down the list', () => {
    expect(q.at).toBe('c');
    expect(neighbour(q, [], 'c', 1)).toBe('d');
    expect(neighbour(q, [], 'c', -1)).toBe('b');
  });
  it('stops at the end with Repeat off, and goes round with Repeat All', () => {
    expect(neighbour(q, [], 'f', 1)).toBe(null);
    expect(neighbour(q, [], 'f', 1, { wrap: true })).toBe('a');
    expect(neighbour(q, [], 'a', -1)).toBe(null);
    expect(neighbour(q, [], 'a', -1, { wrap: true })).toBe('f');
  });
  it('the songs above the picked one are part of the list too (they come round on Repeat All)', () => {
    const seen = [];
    let cur = 'c';
    for (let i = 0; i < 6; i++) { seen.push(cur); cur = neighbour(q, [], cur, 1, { wrap: true }); }
    expect(seen).toEqual(['c', 'd', 'e', 'f', 'a', 'b']);
  });
  it('a song that is no longer in the library is skipped', () => {
    expect(neighbour(q, [], 'c', 1, { playable: (p) => p !== 'd' })).toBe('e');
  });
});

describe('a list played shuffled', () => {
  const q = startQueue({ paths: L, start: 'c', shuffle: true, rand: seeded(5) });
  it('plays every song once, starting with the picked one, then stops', () => {
    const seen = [];
    let cur = 'c';
    while (cur) { seen.push(cur); cur = neighbour(q, [], cur, 1); }
    expect(seen[0]).toBe('c');
    expect([...seen].sort()).toEqual(L);
  });
  it('Previous goes back through the same order', () => {
    const second = neighbour(q, [], 'c', 1);
    expect(neighbour(q, [], second, -1)).toBe('c');
  });
  it('the page\'s own Shuffle (no song picked) starts anywhere', () => {
    const p = startQueue({ paths: L, shuffle: true, rand: seeded(9) });
    expect(p.order[0]).toBe(p.at);
    expect([...p.order].sort()).toEqual(L);
  });
});

describe('turning Shuffle on and off while a list plays', () => {
  it('on: a new order with the playing song first; off: the list order from the same song', () => {
    const q = startQueue({ paths: L, start: 'b' });
    const on = withShuffle(q, true, [], 'b', seeded(2));
    expect(on.order[0]).toBe('b');
    expect([...on.order].sort()).toEqual(L);
    const off = withShuffle(on, false, [], 'b');
    expect(off.order).toBe(null);
    expect(neighbour(off, [], 'b', 1)).toBe('c');
  });
  it('every time it is turned on, the order is dealt anew', () => {
    const r = seeded(13);
    const q = startQueue({ paths: L, start: 'a' });
    const orders = new Set(Array.from({ length: 6 }, () => withShuffle(q, true, [], 'a', r).order.join('')));
    expect(orders.size).toBeGreaterThan(3);
  });
});

describe('the Library: the list is what it shows', () => {
  const q = startQueue({ kind: 'library', paths: L, start: 'b' });
  it('in order, the next song follows the Library as it is sorted now', () => {
    expect(neighbour(q, L, 'b', 1)).toBe('c');
    const resorted = ['f', 'e', 'd', 'c', 'b', 'a'];
    expect(neighbour(q, resorted, 'b', 1)).toBe('a');
  });
  it('with a search on, only the results play', () => {
    expect(neighbour(q, ['b', 'e'], 'b', 1)).toBe('e');
    expect(neighbour(q, ['b', 'e'], 'e', 1)).toBe(null);
  });
  it('a song the search hides carries on from where the list was', () => {
    const at = markPlayed(q, 'd', L);
    expect(neighbour(at, L, 'x-play-next-song', 1)).toBe('e');
  });
  it('shuffled, the order holds whatever the sort', () => {
    const s = startQueue({ kind: 'library', paths: L, start: 'a', shuffle: true, rand: seeded(4) });
    const next = neighbour(s, L, 'a', 1);
    expect(neighbour(s, ['f', 'e', 'd', 'c', 'b', 'a'], 'a', 1)).toBe(next);
  });
});

describe('songs added while a list plays', () => {
  it('in order they join a list at its end', () => {
    const q = withAdded(startQueue({ paths: L, start: 'f' }), ['g', 'h'], 'f');
    expect(neighbour(q, [], 'f', 1)).toBe('g');
    expect(neighbour(q, [], 'g', 1)).toBe('h');
  });
  it('shuffled they land among the songs still to come, never before the playing one', () => {
    const q0 = startQueue({ paths: L, start: 'a', shuffle: true, rand: seeded(8) });
    const cur = q0.order[2];
    const q = withAdded(q0, ['g', 'h'], cur, seeded(6));
    const pos = q.order.indexOf(cur);
    expect(q.order.indexOf('g')).toBeGreaterThan(pos);
    expect(q.order.indexOf('h')).toBeGreaterThan(pos);
    expect(q.order).toHaveLength(8);
  });
  it('a song already in the list is not added twice', () => {
    const q = withAdded(startQueue({ paths: L, start: 'a' }), ['b'], 'a');
    expect(q.paths).toEqual(L);
  });
});

describe('saved in the session and put back', () => {
  it('a list and its shuffled order come back as they were', () => {
    const q = markPlayed(startQueue({ paths: L, start: 'c', shuffle: true, rand: seeded(12) }), null);
    const back = queueFromSaved(JSON.parse(JSON.stringify(queueToSaved(q))));
    expect(back.paths).toEqual(L);
    expect(back.order).toEqual(q.order);
    expect(back.at).toBe('c');
  });
  it('a long Library shuffle keeps what is still to come, and deals the rest after it', () => {
    const big = Array.from({ length: QUEUE_SAVE_MAX + 50 }, (_, i) => 'p' + i);
    const q = startQueue({ kind: 'library', paths: big, start: 'p0', shuffle: true, rand: seeded(21) });
    const saved = queueToSaved(q);
    expect(saved.order).toHaveLength(QUEUE_SAVE_MAX);
    const back = queueFromSaved(saved, { livePaths: big, rand: seeded(22) });
    expect(back.order.slice(0, QUEUE_SAVE_MAX)).toEqual(saved.order);
    expect(new Set(back.order).size).toBe(big.length);
  });
  it('songs no longer in the library are dropped, and a broken entry gives no queue', () => {
    const q = startQueue({ paths: L, start: 'a' });
    const back = queueFromSaved(queueToSaved(q), { exists: (p) => p !== 'b' });
    expect(back.paths).toEqual(['a', 'c', 'd', 'e', 'f']);
    expect(queueFromSaved({ kind: 'nonsense' })).toBe(null);
    expect(queueFromSaved({ kind: 'list', paths: [] })).toBe(null);
    expect(queueFromSaved(null)).toBe(null);
  });
});
