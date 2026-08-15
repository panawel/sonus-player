import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackSort } from './useTrackSort.js';

const tracks = [
  { filePath: '/c.mp3', title: 'c', artist: 'z', duration: 100 },
  { filePath: '/a.mp3', title: 'a', artist: 'y', duration: 300 },
  { filePath: '/b.mp3', title: 'b', artist: 'x', duration: 200 },
];

beforeEach(() => localStorage.clear());

describe('useTrackSort', () => {
  it('starts manual: sorted === input array', () => {
    const { result } = renderHook(() => useTrackSort(tracks));
    expect(result.current.isManual).toBe(true);
    expect(result.current.sorted).toBe(tracks);
  });

  it('the Title column walks title ↑↓ → artist ↑↓ → manual, sorting as it goes', () => {
    const { result } = renderHook(() => useTrackSort(tracks));
    const click = () => act(() => result.current.cycleColumn('title'));

    click();
    expect(result.current.sort).toEqual({ field: 'title', dir: 'asc' });
    expect(result.current.sorted.map(t => t.title)).toEqual(['a', 'b', 'c']);
    click();
    expect(result.current.sort).toEqual({ field: 'title', dir: 'desc' });
    expect(result.current.sorted.map(t => t.title)).toEqual(['c', 'b', 'a']);
    click();
    expect(result.current.sort).toEqual({ field: 'artist', dir: 'asc' });
    expect(result.current.sorted.map(t => t.artist)).toEqual(['x', 'y', 'z']);
    click();
    expect(result.current.sort).toEqual({ field: 'artist', dir: 'desc' });
    expect(result.current.sorted.map(t => t.artist)).toEqual(['z', 'y', 'x']);
    click();
    expect(result.current.isManual).toBe(true);
    expect(result.current.sorted).toBe(tracks);
    click();
    expect(result.current.sort).toEqual({ field: 'title', dir: 'asc' }); // loops
  });

  it('the Time column walks duration ↑↓ → manual', () => {
    const { result } = renderHook(() => useTrackSort(tracks));
    const click = () => act(() => result.current.cycleColumn('duration'));
    click();
    expect(result.current.sorted.map(t => t.duration)).toEqual([100, 200, 300]);
    click();
    expect(result.current.sorted.map(t => t.duration)).toEqual([300, 200, 100]);
    click();
    expect(result.current.isManual).toBe(true);
  });

  it('clicking another column restarts that column from the top', () => {
    const { result } = renderHook(() => useTrackSort(tracks));
    act(() => result.current.cycleColumn('title'));
    act(() => result.current.cycleColumn('title')); // title desc
    act(() => result.current.cycleColumn('duration'));
    expect(result.current.sort).toEqual({ field: 'duration', dir: 'asc' });
  });

  it('persists to and restores from localStorage', () => {
    const KEY = 'test.sort';
    const a = renderHook(() => useTrackSort(tracks, { storageKey: KEY }));
    act(() => a.result.current.cycleColumn('duration'));
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ field: 'duration', dir: 'asc' });
    a.unmount();

    const b = renderHook(() => useTrackSort(tracks, { storageKey: KEY }));
    expect(b.result.current.sort).toEqual({ field: 'duration', dir: 'asc' });
  });

  it('ignores corrupt persisted values', () => {
    localStorage.setItem('bad.sort', '{"field":"hacked","dir":"up"}');
    const { result } = renderHook(() => useTrackSort(tracks, { storageKey: 'bad.sort' }));
    expect(result.current.isManual).toBe(true);
  });

  // Migration: sessions saved while the Sort dropdown still existed can hold a
  // field no column can reach. Restoring it would strand the user in a state
  // with no way out, so it must fall back to manual.
  it('drops a persisted sort field that no column can reach any more', () => {
    localStorage.setItem('legacy.sort', '{"field":"playCount","dir":"desc"}');
    const { result } = renderHook(() => useTrackSort(tracks, { storageKey: 'legacy.sort' }));
    expect(result.current.isManual).toBe(true);
  });

  it('resetKey change snaps back to manual', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useTrackSort(tracks, { resetKey: key }),
      { initialProps: { key: 'album:X' } }
    );
    act(() => result.current.cycleColumn('title'));
    expect(result.current.isManual).toBe(false);
    rerender({ key: 'album:Y' });
    expect(result.current.isManual).toBe(true);
  });

  it('setManual returns to default order directly', () => {
    const { result } = renderHook(() => useTrackSort(tracks));
    act(() => result.current.cycleColumn('title'));
    act(() => result.current.setManual());
    expect(result.current.isManual).toBe(true);
  });
});
