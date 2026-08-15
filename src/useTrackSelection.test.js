import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackSelection } from './useTrackSelection.js';

const tracks = Array.from({ length: 10 }, (_, i) => ({ filePath: `/t${i}.mp3`, title: `T${i}` }));
const click = (over = {}) => ({ metaKey: false, ctrlKey: false, shiftKey: false, ...over });

describe('useTrackSelection', () => {
  it('plain click selects a single row', () => {
    const { result } = renderHook(() => useTrackSelection(tracks));
    act(() => result.current.handleRowClick(tracks[3], 3, click()));
    expect(result.current.selectedPaths).toEqual(['/t3.mp3']);
    expect(result.current.focusedIndex).toBe(3);
    act(() => result.current.handleRowClick(tracks[5], 5, click()));
    expect(result.current.selectedPaths).toEqual(['/t5.mp3']);
  });

  it('cmd-click toggles rows in and out', () => {
    const { result } = renderHook(() => useTrackSelection(tracks));
    act(() => result.current.handleRowClick(tracks[1], 1, click()));
    act(() => result.current.handleRowClick(tracks[4], 4, click({ metaKey: true })));
    expect(new Set(result.current.selectedPaths)).toEqual(new Set(['/t1.mp3', '/t4.mp3']));
    act(() => result.current.handleRowClick(tracks[1], 1, click({ metaKey: true })));
    expect(result.current.selectedPaths).toEqual(['/t4.mp3']);
  });

  it('shift-click selects a range from the anchor, in either direction', () => {
    const { result } = renderHook(() => useTrackSelection(tracks));
    act(() => result.current.handleRowClick(tracks[5], 5, click()));
    act(() => result.current.handleRowClick(tracks[2], 2, click({ shiftKey: true })));
    expect(result.current.selectedPaths.sort()).toEqual(['/t2.mp3', '/t3.mp3', '/t4.mp3', '/t5.mp3']);
    act(() => result.current.handleRowClick(tracks[7], 7, click({ shiftKey: true })));
    expect(result.current.selectedPaths.sort()).toEqual(['/t5.mp3', '/t6.mp3', '/t7.mp3']);
  });

  it('selectAll / clear', () => {
    const { result } = renderHook(() => useTrackSelection(tracks));
    act(() => result.current.selectAll());
    expect(result.current.selectedPaths.length).toBe(10);
    act(() => result.current.clear());
    expect(result.current.selectedPaths).toEqual([]);
    expect(result.current.focusedIndex).toBeNull();
  });

  it('moveFocus walks rows and clamps at the edges', () => {
    const { result } = renderHook(() => useTrackSelection(tracks));
    let idx;
    act(() => { idx = result.current.moveFocus(1); });   // nothing focused → first row
    expect(idx).toBe(0);
    expect(result.current.selectedPaths).toEqual(['/t0.mp3']);
    act(() => { idx = result.current.moveFocus(-1); });  // clamp at top
    expect(idx).toBe(0);
    act(() => { idx = result.current.moveFocus(1); });
    expect(idx).toBe(1);
    expect(result.current.selectedPaths).toEqual(['/t1.mp3']);
  });

  it('moveFocus with extend grows the range from the anchor', () => {
    const { result } = renderHook(() => useTrackSelection(tracks));
    act(() => result.current.handleRowClick(tracks[3], 3, click()));
    act(() => result.current.moveFocus(1, true));
    act(() => result.current.moveFocus(1, true));
    expect(result.current.selectedPaths.sort()).toEqual(['/t3.mp3', '/t4.mp3', '/t5.mp3']);
    expect(result.current.focusedIndex).toBe(5);
  });

  it('focusIndex jumps to absolute positions (Home/End)', () => {
    const { result } = renderHook(() => useTrackSelection(tracks));
    act(() => result.current.focusIndex(9));
    expect(result.current.focusedIndex).toBe(9);
    expect(result.current.selectedPaths).toEqual(['/t9.mp3']);
    act(() => result.current.focusIndex(0));
    expect(result.current.selectedPaths).toEqual(['/t0.mp3']);
  });

  it('prune drops removed paths and keeps the rest', () => {
    const { result } = renderHook(() => useTrackSelection(tracks));
    act(() => result.current.selectAll());
    act(() => result.current.prune(['/t0.mp3', '/t5.mp3', '/missing.mp3']));
    expect(result.current.selectedPaths.length).toBe(8);
    expect(result.current.isSelected('/t0.mp3')).toBe(false);
    expect(result.current.isSelected('/t1.mp3')).toBe(true);
  });

  it('selection survives the tracks array being filtered (search)', () => {
    const { result, rerender } = renderHook(({ list }) => useTrackSelection(list), { initialProps: { list: tracks } });
    act(() => result.current.handleRowClick(tracks[2], 2, click()));
    rerender({ list: tracks.slice(0, 1) }); // search hides everything but t0
    expect(result.current.isSelected('/t2.mp3')).toBe(true);
  });
});
