import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import ArtCrossfade, { ART_FADE_MS, UPGRADE_MS } from './ArtCrossfade.jsx';

afterEach(() => vi.useRealTimers());
// [layer role, [srcs bottom-to-top]]
const layers = (c) => [...c.querySelectorAll('[data-art-layer]')].map((l) => [l.dataset.artLayer, [...l.querySelectorAll('img')].map((i) => i.getAttribute('src'))]);

describe('ArtCrossfade', () => {
  it('shows one cover to begin with', () => {
    const { container } = render(<ArtCrossfade trackKey="a" src="a.jpg" />);
    expect(layers(container)).toEqual([['current', ['a.jpg']]]);
  });

  it('a song change keeps the old cover under the new one while it fades, then drops it', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ArtCrossfade trackKey="a" src="a.jpg" />);
    rerender(<ArtCrossfade trackKey="b" src="b.jpg" />);
    expect(layers(container)).toEqual([['out', ['a.jpg']], ['in', ['b.jpg']]]);
    act(() => { vi.advanceTimersByTime(ART_FADE_MS + 60); });
    expect(layers(container)).toEqual([['current', ['b.jpg']]]);
  });

  it('never holds more than one outgoing cover when songs are skipped quickly', () => {
    const { container, rerender } = render(<ArtCrossfade trackKey="a" src="a.jpg" />);
    rerender(<ArtCrossfade trackKey="b" src="b.jpg" />);
    rerender(<ArtCrossfade trackKey="c" src="c.jpg" />);
    rerender(<ArtCrossfade trackKey="d" src="d.jpg" />);
    expect(layers(container).length).toBe(2);
    expect(layers(container)[1]).toEqual(['in', ['d.jpg']]);
  });

  it('the same song upgrading its cover fades the sharp one in over the stand-in, then drops the stand-in', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ArtCrossfade trackKey="a" src="thumb.jpg" />);
    rerender(<ArtCrossfade trackKey="a" src="full.jpg" />);
    expect(layers(container)).toEqual([['current', ['thumb.jpg', 'full.jpg']]]);
    const top = container.querySelectorAll('img')[1];
    expect(top.style.animation).toContain(`${UPGRADE_MS}ms`);
    act(() => { vi.advanceTimersByTime(Math.max(ART_FADE_MS, UPGRADE_MS) + 60); });
    expect(layers(container)).toEqual([['current', ['full.jpg']]]);
  });
});
