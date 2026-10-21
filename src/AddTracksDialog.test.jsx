import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddTracksDialog from './AddTracksDialog.jsx';
import { describeAddition } from './trackUtils.js';

const song = (over = {}) => ({ title: 'Mini Smoke Track', artist: 'Mini Artist', thumb: 'sonus-thumb://art/x.jpg', filePath: '/a.mp3', ...over });

describe('describeAddition', () => {
  it('one song: its name, artist and "1 song"', () => {
    expect(describeAddition([song()])).toEqual({ heading: 'Mini Smoke Track', detail: 'Mini Artist · 1 song', art: 'sonus-thumb://art/x.jpg' });
  });
  it('one song with no artist does not leave a dangling separator', () => {
    expect(describeAddition([song({ artist: '' })]).detail).toBe('1 song');
  });
  it('several songs: the count, led by the first', () => {
    expect(describeAddition([song(), song({ title: 'B' }), song({ title: 'C' })])).toMatchObject({ heading: '3 songs', detail: 'Mini Smoke Track and 2 more' });
  });
  it('copes with a song without a title or artwork', () => {
    expect(describeAddition([{ filePath: '/x.mp3' }])).toEqual({ heading: 'Untitled', detail: '1 song', art: null });
  });
});

describe('AddTracksDialog', () => {
  it('names what is being added and offers the three actions plus Cancel', () => {
    render(<AddTracksDialog tracks={[song()]} onResolve={() => {}} />);
    expect(screen.getByRole('dialog', { name: /add songs to your library/i })).toBeTruthy();
    expect(screen.getByText('Mini Smoke Track')).toBeTruthy();
    expect(screen.getByText('Mini Artist · 1 song')).toBeTruthy();
    for (const name of [/play now/i, /play next/i, /add to queue/i, /^cancel$/i]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('the buttons show only their names; the subtext lives in one hint line', () => {
    const { container } = render(<AddTracksDialog tracks={[song()]} hasCurrentTrack onResolve={() => {}} />);
    const buttons = Array.from(container.querySelectorAll('.add-dialog-option'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Play now', 'Play next', 'Add to queue']);
    expect(container.querySelectorAll('.add-dialog-hint')).toHaveLength(1);
  });

  it('the hint starts with what Play does, follows the pointer, and goes back when it leaves', () => {
    const { container } = render(<AddTracksDialog tracks={[song()]} hasCurrentTrack onResolve={() => {}} />);
    const hint = () => container.querySelector('.add-dialog-hint').textContent;
    expect(hint()).toBe('Replaces your current library');
    fireEvent.mouseEnter(screen.getByRole('button', { name: /play next/i }));
    expect(hint()).toBe('Right after the current song');
    fireEvent.mouseEnter(screen.getByRole('button', { name: /add to queue/i }));
    expect(hint()).toBe('At the end of your library');
    fireEvent.mouseLeave(screen.getByRole('button', { name: /add to queue/i }));
    expect(hint()).toBe('Replaces your current library');
  });

  it('keyboard focus drives the hint too, and a hover wins over it while the pointer is there', () => {
    const { container } = render(<AddTracksDialog tracks={[song()]} onResolve={() => {}} />);
    const hint = () => container.querySelector('.add-dialog-hint').textContent;
    fireEvent.focus(screen.getByRole('button', { name: /add to queue/i }));
    expect(hint()).toBe('At the end of your library');
    fireEvent.mouseEnter(screen.getByRole('button', { name: /play next/i }));
    expect(hint()).toBe('At the top of your library');
    fireEvent.mouseLeave(screen.getByRole('button', { name: /play next/i }));
    expect(hint()).toBe('At the end of your library');
  });

  it('only the regular layout has the title-bar drag band; both keep the hint line', () => {
    const regular = render(<AddTracksDialog tracks={[song()]} onResolve={() => {}} />);
    expect(regular.container.querySelector('.add-dialog-drag-strip')).toBeTruthy();
    regular.unmount();
    const compact = render(<AddTracksDialog tracks={[song()]} compact onResolve={() => {}} />);
    expect(compact.container.querySelector('.add-dialog-drag-strip')).toBeNull();
    expect(compact.container.querySelector('.add-dialog-hint').textContent).toBe('Replaces your current library');
  });

  describe('moving the window while the dialog is open', () => {
    const withApi = () => {
      const dragWindow = vi.fn();
      window.electronAPI = { dragWindow };
      return dragWindow;
    };
    afterEach(() => { delete window.electronAPI; });

    it('holding the dialog background and moving the pointer ticks the main process, then ends on release', () => {
      const dragWindow = withApi();
      const { container } = render(<AddTracksDialog tracks={[song()]} onResolve={() => {}} />);
      fireEvent.mouseDown(container.querySelector('.add-dialog-header'), { button: 0 });
      fireEvent.mouseMove(window);
      fireEvent.mouseMove(window);
      fireEvent.mouseUp(window);
      fireEvent.mouseMove(window);
      expect(dragWindow.mock.calls).toEqual([['start'], ['move'], ['move'], ['end']]);
    });

    it('the title-bar band drags too, and releasing on it does not cancel the dialog', () => {
      const dragWindow = withApi();
      const onResolve = vi.fn();
      const { container } = render(<AddTracksDialog tracks={[song()]} onResolve={onResolve} />);
      const strip = container.querySelector('.add-dialog-drag-strip');
      fireEvent.mouseDown(strip, { button: 0, screenX: 10, screenY: 10 });
      fireEvent.mouseUp(window);
      fireEvent.click(strip);
      expect(dragWindow).toHaveBeenCalledWith('start');
      expect(onResolve).not.toHaveBeenCalled();
    });

    it('the click right after a drag is swallowed, so it cannot cancel the dialog; a plain click still works', async () => {
      withApi();
      const onResolve = vi.fn();
      const { container } = render(<AddTracksDialog tracks={[song()]} onResolve={onResolve} />);
      const backdrop = container.querySelector('.add-dialog-backdrop');
      fireEvent.mouseDown(container.querySelector('.add-dialog-header'), { button: 0 });
      fireEvent.mouseMove(window);
      fireEvent.mouseUp(window);
      fireEvent.click(backdrop);   // the pointer landed on the backdrop after the drag
      expect(onResolve).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 5));   // the one-shot swallow is gone by the next task
      fireEvent.click(backdrop);
      expect(onResolve).toHaveBeenCalledWith('cancel');
    });

    it('does not drag from a button, nor with the right mouse button', () => {
      const dragWindow = withApi();
      render(<AddTracksDialog tracks={[song()]} onResolve={() => {}} />);
      fireEvent.mouseDown(screen.getByRole('button', { name: /play next/i }), { button: 0, screenX: 1, screenY: 1 });
      fireEvent.mouseDown(screen.getByRole('dialog'), { button: 2, screenX: 1, screenY: 1 });
      expect(dragWindow).not.toHaveBeenCalled();
    });

    it('closing the dialog mid-drag ends the drag', () => {
      const dragWindow = withApi();
      const { container, unmount } = render(<AddTracksDialog tracks={[song()]} compact onResolve={() => {}} />);
      fireEvent.mouseDown(container.querySelector('.add-dialog-header'), { button: 0, screenX: 5, screenY: 5 });
      unmount();
      expect(dragWindow.mock.calls.at(-1)).toEqual(['end']);
    });

    it('is a no-op outside Electron (no API)', () => {
      const { container } = render(<AddTracksDialog tracks={[song()]} onResolve={() => {}} />);
      expect(() => fireEvent.mouseDown(container.querySelector('.add-dialog-header'), { button: 0 })).not.toThrow();
    });
  });

  it('each button resolves with its own action', () => {
    const onResolve = vi.fn();
    render(<AddTracksDialog tracks={[song()]} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole('button', { name: /play now/i }));
    fireEvent.click(screen.getByRole('button', { name: /play next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onResolve.mock.calls.map((c) => c[0])).toEqual(['play', 'play-next', 'add-to-queue', 'cancel']);
  });

  it('clicking outside cancels; clicking inside the panel does not', () => {
    const onResolve = vi.fn();
    const { container } = render(<AddTracksDialog tracks={[song()]} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onResolve).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.add-dialog-backdrop'));
    expect(onResolve).toHaveBeenCalledWith('cancel');
  });

  it('focuses Play so Enter confirms the default', () => {
    render(<AddTracksDialog tracks={[song()]} onResolve={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /play now/i }));
  });

  it('the compact layout keeps all four actions, and Cancel sits in the header', () => {
    const { container } = render(<AddTracksDialog tracks={[song(), song({ title: 'B' })]} compact onResolve={() => {}} />);
    expect(container.querySelector('.add-dialog--compact')).toBeTruthy();
    expect(screen.getByText('2 songs')).toBeTruthy();
    for (const name of [/^play$/i, /play next/i, /add to queue/i, /^cancel$/i]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(container.querySelector('.add-dialog-header .add-dialog-cancel')).toBeTruthy();
  });

  it('the Play next hint is honest when nothing is playing', () => {
    const hintOnHover = (hasCurrentTrack) => {
      const { container, unmount } = render(<AddTracksDialog tracks={[song()]} hasCurrentTrack={hasCurrentTrack} onResolve={() => {}} />);
      fireEvent.mouseEnter(screen.getByRole('button', { name: /play next/i }));
      const text = container.querySelector('.add-dialog-hint').textContent;
      unmount();
      return text;
    };
    expect(hintOnHover(true)).toBe('Right after the current song');
    expect(hintOnHover(false)).toBe('At the top of your library');
  });

  it('shows the artwork when the song has some, a placeholder when it has none', () => {
    const { container, unmount } = render(<AddTracksDialog tracks={[song()]} onResolve={() => {}} />);
    expect(container.querySelector('.add-dialog-art img')?.getAttribute('src')).toBe('sonus-thumb://art/x.jpg');
    unmount();
    const r = render(<AddTracksDialog tracks={[song({ thumb: null })]} onResolve={() => {}} />);
    expect(r.container.querySelector('.add-dialog-art img')).toBeNull();
    expect(r.container.querySelector('.add-dialog-art svg')).toBeTruthy();
  });
});
