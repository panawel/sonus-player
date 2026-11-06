import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Bubble from './Bubble.jsx';

// jsdom has no Web Animations API: give elements a fake animate() so the component takes its
// animated path, and count what it plays.
let animateCalls;
beforeEach(() => {
  animateCalls = 0;
  HTMLElement.prototype.animate = function () {
    animateCalls++;
    const a = { cancel() {}, onfinish: null };
    queueMicrotask(() => { a.onfinish?.(); });
    return a;
  };
});
afterEach(() => { delete HTMLElement.prototype.animate; vi.restoreAllMocks(); });

const Item = ({ show, instant }) => (
  <Bubble show={show} instant={instant} variant="slot" width={30}><button>x</button></Bubble>
);

describe('Bubble', () => {
  it('does not animate a first render that is already shown', () => {
    render(<Item show />);
    expect(screen.getByRole('button')).toBeTruthy();
    expect(animateCalls).toBe(0);
  });

  it('animates in, and stays mounted but inert while it leaves, then unmounts', async () => {
    const { rerender, container } = render(<Item show={false} />);
    expect(container.querySelector('[data-bubble]')).toBeNull();
    rerender(<Item show />);
    expect(container.querySelector('[data-bubble="in"]')).not.toBeNull();
    expect(animateCalls).toBeGreaterThan(0);
    rerender(<Item show={false} />);
    const leaving = container.querySelector('[data-bubble="out"]');
    expect(leaving).not.toBeNull();
    expect(leaving.hasAttribute('inert')).toBe(true);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-bubble]')).toBeNull();
  });

  it('an instant change appears and disappears at once, without animating', () => {
    const { rerender, container } = render(<Item show={false} instant />);
    rerender(<Item show instant />);
    expect(container.querySelector('[data-bubble="in"]')).not.toBeNull();
    expect(animateCalls).toBe(0);
    rerender(<Item show={false} instant />);
    expect(container.querySelector('[data-bubble]')).toBeNull();
    expect(animateCalls).toBe(0);
  });
});
