import { describe, it, expect } from 'vitest';
import {
  formatTime, compareBy, sortTracks, getSortValue, SORT_FIELDS, sortFieldById,
  COLUMN_CYCLES, nextInCycle, activeFieldForColumn, MANUAL_SORT,
} from './trackUtils.js';

const t = (over = {}) => ({
  title: 'Song', artist: 'Artist', album: 'Album', year: 2000,
  duration: 200, dateAdded: 1000, playCount: 0, lastPlayed: null,
  filePath: '/x.mp3', ...over,
});

describe('formatTime', () => {
  it('formats m:ss', () => {
    expect(formatTime(125)).toBe('2:05');
    expect(formatTime(59)).toBe('0:59');
    expect(formatTime(3600)).toBe('60:00');
  });
  it('returns --:-- for missing/invalid', () => {
    expect(formatTime(0)).toBe('--:--');
    expect(formatTime(null)).toBe('--:--');
    expect(formatTime(NaN)).toBe('--:--');
  });
});

describe('getSortValue', () => {
  it('lowercases strings and nulls empties', () => {
    expect(getSortValue(t({ title: 'HeLLo' }), 'title')).toBe('hello');
    expect(getSortValue(t({ title: '' }), 'title')).toBeNull();
  });
  it('reads duration, rejecting zero and non-numbers', () => {
    expect(getSortValue(t({ duration: 240 }), 'duration')).toBe(240);
    expect(getSortValue(t({ duration: 0 }), 'duration')).toBeNull();
    expect(getSortValue(t({ duration: null }), 'duration')).toBeNull();
  });
  it('returns null for fields that are no longer sortable', () => {
    for (const gone of ['year', 'dateAdded', 'playCount', 'lastPlayed']) {
      expect(getSortValue(t({ year: 1999, dateAdded: 5, playCount: 3, lastPlayed: 7 }), gone)).toBeNull();
    }
  });
});

describe('compareBy', () => {
  it('sorts strings ascending, case-insensitive, numerically aware', () => {
    const list = [t({ title: 'b' }), t({ title: 'A' }), t({ title: 'Track 10' }), t({ title: 'Track 2' })];
    const sorted = [...list].sort(compareBy('title', 'asc')).map(x => x.title);
    expect(sorted).toEqual(['A', 'b', 'Track 2', 'Track 10']);
  });
  it('desc inverts values but keeps empties last', () => {
    const list = [t({ title: '' }), t({ title: 'a' }), t({ title: 'z' })];
    expect([...list].sort(compareBy('title', 'desc')).map(x => x.title)).toEqual(['z', 'a', '']);
    expect([...list].sort(compareBy('title', 'asc')).map(x => x.title)).toEqual(['a', 'z', '']);
  });
  it('numeric fields sort correctly both ways', () => {
    const list = [t({ duration: 190 }), t({ duration: 320 }), t({ duration: 240 })];
    expect([...list].sort(compareBy('duration', 'asc')).map(x => x.duration)).toEqual([190, 240, 320]);
    expect([...list].sort(compareBy('duration', 'desc')).map(x => x.duration)).toEqual([320, 240, 190]);
  });
  it('missing numerics sort last in both directions', () => {
    const list = [t({ duration: null, title: 'none' }), t({ duration: 100, title: 'short' }), t({ duration: 900, title: 'long' })];
    expect([...list].sort(compareBy('duration', 'asc')).map(x => x.title)).toEqual(['short', 'long', 'none']);
    expect([...list].sort(compareBy('duration', 'desc')).map(x => x.title)).toEqual(['long', 'short', 'none']);
  });
  it('ties preserve original order (stability)', () => {
    const list = [t({ album: 'Same', title: 'first' }), t({ album: 'Same', title: 'second' }), t({ album: 'Same', title: 'third' })];
    expect([...list].sort(compareBy('album', 'asc')).map(x => x.title)).toEqual(['first', 'second', 'third']);
  });
});

describe('sortTracks', () => {
  const list = [t({ title: 'c' }), t({ title: 'a' }), t({ title: 'b' })];
  it('manual returns the same array untouched', () => {
    expect(sortTracks(list, 'manual', 'asc')).toBe(list);
    expect(sortTracks(list, 'nonsense', 'asc')).toBe(list);
  });
  it('returns a new sorted copy otherwise', () => {
    const out = sortTracks(list, 'title', 'asc');
    expect(out).not.toBe(list);
    expect(out.map(x => x.title)).toEqual(['a', 'b', 'c']);
    expect(list.map(x => x.title)).toEqual(['c', 'a', 'b']); // input untouched
  });
});

describe('SORT_FIELDS', () => {
  it('exposes only fields a column header can actually reach', () => {
    expect(SORT_FIELDS.map(f => f.id)).toEqual(['title', 'artist', 'album', 'duration']);
    expect(sortFieldById('title')).toBeTruthy();
    expect(sortFieldById('playCount')).toBeNull();
    expect(sortFieldById('bogus')).toBeNull();
  });

  it('every field appears in some column cycle — nothing is orphaned', () => {
    const reachable = new Set(Object.values(COLUMN_CYCLES).flat().map(s => s.field));
    for (const f of SORT_FIELDS) expect(reachable.has(f.id), f.id).toBe(true);
  });

  it('every cycle ends at manual, so drag-to-reorder is always reachable', () => {
    for (const [col, cycle] of Object.entries(COLUMN_CYCLES)) {
      expect(cycle[cycle.length - 1].field, col).toBe('manual');
    }
  });
});

describe('nextInCycle', () => {
  const walk = (columnId, steps) => {
    let s = MANUAL_SORT;
    const out = [];
    for (let i = 0; i < steps; i++) { s = nextInCycle(columnId, s); out.push(`${s.field}:${s.field === 'manual' ? '-' : s.dir}`); }
    return out;
  };

  it('walks the Title column: title ↑↓ → artist ↑↓ → manual → loop', () => {
    expect(walk('title', 6)).toEqual([
      'title:asc', 'title:desc', 'artist:asc', 'artist:desc', 'manual:-', 'title:asc',
    ]);
  });

  it('walks Time and Album: own field ↑↓ → manual → loop', () => {
    expect(walk('duration', 4)).toEqual(['duration:asc', 'duration:desc', 'manual:-', 'duration:asc']);
    expect(walk('album', 4)).toEqual(['album:asc', 'album:desc', 'manual:-', 'album:asc']);
  });

  it('clicking a different column restarts that column from the top', () => {
    const mid = nextInCycle('title', nextInCycle('title', MANUAL_SORT)); // title:desc
    expect(nextInCycle('duration', mid)).toEqual({ field: 'duration', dir: 'asc' });
    expect(nextInCycle('album', mid)).toEqual({ field: 'album', dir: 'asc' });
  });

  it('an unreachable stored field falls to the first state, never gets stuck', () => {
    expect(nextInCycle('title', { field: 'playCount', dir: 'desc' })).toEqual({ field: 'title', dir: 'asc' });
  });

  it('an unknown column is inert', () => {
    expect(nextInCycle('nope', { field: 'title', dir: 'asc' })).toBe(MANUAL_SORT);
  });
});

describe('activeFieldForColumn', () => {
  it('reports the borrowed field so the label can rename itself', () => {
    expect(activeFieldForColumn('title', { field: 'artist', dir: 'asc' })).toBe('artist');
    expect(activeFieldForColumn('title', { field: 'title', dir: 'asc' })).toBe('title');
  });
  it('is null for other columns and for manual', () => {
    expect(activeFieldForColumn('duration', { field: 'artist', dir: 'asc' })).toBeNull();
    expect(activeFieldForColumn('title', MANUAL_SORT)).toBeNull();
  });
});
