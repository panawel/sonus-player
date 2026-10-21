import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import ChillLivingPhoto from './ChillLivingPhoto.jsx';
import ChillPhoneScreen from './ChillPhoneScreen.jsx';

const FX = { frag: 'void main() {}', masks: [{ uniform: 'uMask', url: '/m.png' }], update: () => ({}) };

describe('ChillLivingPhoto', () => {
  const RealImage = window.Image;
  beforeEach(() => {
    // jsdom never loads images; make them "load" at once so the setup path runs.
    window.Image = class { set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } get naturalWidth() { return 2752; } get naturalHeight() { return 1536; } };
    // ...and has no WebGL: getContext returns null.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => { window.Image = RealImage; vi.restoreAllMocks(); });

  it('always renders the still photo, so there is no flash and nothing breaks without WebGL', async () => {
    const { container } = render(<ChillLivingPhoto photoUrl="/p.jpg" fx={FX} sceneW={2752} sceneH={1536} scale={1} />);
    const img = container.querySelector('img.chill-photo');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/p.jpg');
    const canvas = container.querySelector('canvas.chill-living');
    expect(canvas.dataset.live).toBe('false'); // hidden (opacity 0) until the first frame
    await waitFor(() => expect(canvas.dataset.gl).toBe('fallback'));
    expect(canvas.dataset.live).toBe('false');
    expect(container.querySelector('img.chill-photo')).toBeTruthy(); // the still photo is what you see
  });

  it('cleans up without throwing when it unmounts mid-load', () => {
    const { unmount } = render(<ChillLivingPhoto photoUrl="/p.jpg" fx={FX} sceneW={2752} sceneH={1536} scale={1} />);
    expect(() => unmount()).not.toThrow();
  });
});

describe('ChillPhoneScreen', () => {
  const props = {
    arts: [{ id: 1, src: '/a.jpg' }], artworkRgb: { r: 200, g: 60, b: 120 },
    title: 'Life in Cartoon Motion', artist: 'MIKA', shown: 30, duration: 120, isPlaying: true,
    formatTime: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
  };

  it('shows the real title, artist and times, and the artwork', () => {
    const { container } = render(<ChillPhoneScreen {...props} />);
    const text = container.textContent;
    expect(text).toContain('Life in Cartoon Motion');
    expect(text).toContain('MIKA');
    expect(text).toContain('0:30');
    expect(text).toContain('-1:30');
    expect(container.querySelector('.chill-phone-art img').getAttribute('src')).toBe('/a.jpg');
  });

  it('draws the progress bar at the real position', () => {
    const { container } = render(<ChillPhoneScreen {...props} />);
    expect(container.querySelector('.chill-phone-progress > div').style.width).toBe('25%');
    const zero = render(<ChillPhoneScreen {...props} duration={0} shown={0} />);
    expect(zero.container.querySelector('.chill-phone-progress > div').style.width).toBe('0%');
  });

  it('follows the real playback state with its icon', () => {
    const playing = render(<ChillPhoneScreen {...props} isPlaying />);
    expect(playing.container.querySelector('[data-chill-phone-state]').dataset.chillPhoneState).toBe('playing');
    const paused = render(<ChillPhoneScreen {...props} isPlaying={false} />);
    expect(paused.container.querySelector('[data-chill-phone-state]').dataset.chillPhoneState).toBe('paused');
  });

  it('has a placeholder when there is no artwork, and a perspective transform onto the photo', () => {
    const { container } = render(<ChillPhoneScreen {...props} arts={[{ id: 1, src: null }]} artworkRgb={null} />);
    expect(container.querySelector('.chill-phone-art-blank')).toBeTruthy();
    expect(container.querySelector('[data-chill-phone]').style.transform.startsWith('matrix3d(')).toBe(true);
  });
});

describe('ChillPosters and ChillLaptopScreen', () => {
  it('draws nothing on the posters until there is artwork, then one per poster with a perspective transform', async () => {
    const { default: ChillPosters } = await import('./ChillPosters.jsx');
    const { POSTERS } = await import('./chillRoom.js');
    const none = render(<ChillPosters arts={[{ id: 1, src: null }]} />);
    expect(none.container.querySelectorAll('[data-chill-poster]')).toHaveLength(0);
    const some = render(<ChillPosters arts={[{ id: 1, src: '/a.jpg' }]} />);
    const posters = some.container.querySelectorAll('[data-chill-poster]');
    expect(posters).toHaveLength(POSTERS.length);
    posters.forEach((el) => {
      expect(el.style.transform.startsWith('matrix3d(')).toBe(true);
      expect(el.querySelector('img').getAttribute('src')).toBe('/a.jpg');
    });
    // only the cover image: no text anywhere in them
    expect(some.container.textContent).toBe('');
    // the room's colour: every print carries its measured lighting
    posters.forEach((el) => { expect(parseFloat(el.style.getPropertyValue('--blur'))).toBeGreaterThan(0.2); expect(el.style.getPropertyValue('--dim')).not.toBe(''); expect(el.style.getPropertyValue('--tl')).toMatch(/^rgb\(/); expect(el.style.getPropertyValue('--tr')).toMatch(/^rgb\(/); });
  });

  it('crossfades the new artwork over the old on every poster', async () => {
    const { default: ChillPosters } = await import('./ChillPosters.jsx');
    const { container } = render(<ChillPosters arts={[{ id: 1, src: '/old.jpg' }, { id: 2, src: '/new.jpg' }]} />);
    container.querySelectorAll('[data-chill-poster]').forEach((el) => {
      const imgs = el.querySelectorAll('img');
      expect(imgs).toHaveLength(2);
      expect(imgs[1].className).toContain('chill-art--fade');
    });
  });

  it('mounts the laptop screen without a 2D canvas (jsdom has none) and cleans up', async () => {
    const { default: ChillLaptopScreen } = await import('./ChillLaptopScreen.jsx');
    const apiRef = { current: undefined };
    const { container, unmount } = render(<ChillLaptopScreen apiRef={apiRef} />);
    expect(container.querySelector('[data-chill-laptop]').style.transform.startsWith('matrix3d(')).toBe(true);
    expect(() => unmount()).not.toThrow();
  });
});
