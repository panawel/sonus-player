import { describe, it, expect } from 'vitest';
import { sanitizeSession, launchPlan, SESSION_LIST_MAX } from './session.mjs';

describe('sanitizeSession', () => {
  it('keeps a well-formed session as it is', () => {
    const s = {
      currentTrackPath: '/m/a.mp3', currentTime: 83.5, isShuffle: true, repeatMode: 'one',
      view: 'now_playing', previousView: 'home', homeDetailItem: { type: 'mix', key: '/m/a.mp3', label: 'A' },
      homeDetailOrigin: 'library', queueSource: { label: 'Artist', item: { type: 'artist', key: 'Artist' } },
      isChillMode: true, isLyricsOpen: true, npBeside: true, playNext: ['/m/b.mp3'], history: ['/m/c.mp3'],
      playing: { kind: 'list', paths: ['/m/a.mp3', '/m/d.mp3'], order: ['/m/d.mp3', '/m/a.mp3'], at: '/m/a.mp3' },
      mix: { seedPath: '/m/a.mp3', paths: ['/m/d.mp3'] }, scroll: { library: 400, home: 20 },
      detailScrolls: { 'artist:X': 120 }, libraryScroll: 400, stripOpen: true,
    };
    expect(sanitizeSession(s)).toEqual(s);
  });

  it('gives the plain defaults for nothing, garbage or an empty file', () => {
    const d = sanitizeSession(null);
    expect(d).toMatchObject({ currentTrackPath: null, currentTime: 0, isShuffle: false, repeatMode: 'off', view: 'library', previousView: 'library', homeDetailItem: null, queueSource: null, isChillMode: false, playNext: [], history: [], mix: null, stripOpen: false });
    expect(sanitizeSession('x')).toEqual(d);
    expect(sanitizeSession([])).toEqual(d);
  });

  it('drops bad values one by one, keeping the good ones', () => {
    const s = sanitizeSession({ isShuffle: 'yes', repeatMode: 'twice', view: 'settings', currentTime: -4, playNext: ['/a', 5, '', null, '/b'], scroll: { library: 'x', home: 30, bad: -1 }, homeDetailItem: { type: 'album' }, isLyricsOpen: true });
    expect(s).toMatchObject({ isShuffle: false, repeatMode: 'off', view: 'library', currentTime: 0, playNext: ['/a', '/b'], scroll: { home: 30 }, homeDetailItem: null, isLyricsOpen: true });
  });

  it('never restores Now Playing as the page to go back to', () => {
    expect(sanitizeSession({ view: 'now_playing', previousView: 'now_playing' }).previousView).toBe('library');
  });

  it('caps the lists', () => {
    const many = Array.from({ length: SESSION_LIST_MAX + 50 }, (_, i) => `/m/${i}.mp3`);
    expect(sanitizeSession({ history: many }).history).toHaveLength(SESSION_LIST_MAX);
  });
});

describe('launchPlan', () => {
  it('reopens the strip only if it was open, and never in the smoke suite', () => {
    expect(launchPlan({ stripOpen: true })).toEqual({ openStrip: true });
    expect(launchPlan({ stripOpen: false })).toEqual({ openStrip: false });
    expect(launchPlan(null)).toEqual({ openStrip: false });
    expect(launchPlan({ stripOpen: true }, { smoke: true })).toEqual({ openStrip: false });
  });
});

describe('the list that is playing', () => {
  it('keeps a list, its shuffled order and where it is', async () => {
    const { sanitizeSession } = await import('./session.mjs');
    const s = sanitizeSession({ playing: { kind: 'list', paths: ['/a.mp3', '/b.mp3'], order: ['/b.mp3', '/a.mp3'], at: '/b.mp3' } });
    expect(s.playing).toEqual({ kind: 'list', paths: ['/a.mp3', '/b.mp3'], order: ['/b.mp3', '/a.mp3'], at: '/b.mp3' });
  });
  it('the Library keeps no list of its own; nonsense gives none', async () => {
    const { sanitizeSession, SESSION_PLAYING_MAX } = await import('./session.mjs');
    expect(sanitizeSession({ playing: { kind: 'library', paths: ['/a.mp3'], order: null, at: 7 } }).playing).toEqual({ kind: 'library', paths: null, order: null, at: null });
    expect(sanitizeSession({ playing: { kind: 'other' } }).playing).toBe(null);
    expect(sanitizeSession({ playing: 'x' }).playing).toBe(null);
    const long = Array.from({ length: SESSION_PLAYING_MAX + 9 }, (_, i) => '/' + i + '.mp3');
    expect(sanitizeSession({ playing: { kind: 'list', paths: long, order: long } }).playing.order).toHaveLength(SESSION_PLAYING_MAX);
  });
});
