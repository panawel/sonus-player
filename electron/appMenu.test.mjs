import { describe, it, expect, vi } from 'vitest';
import { fileMenuTemplate, controlsMenuTemplate, applyMenuState, MENU_COMMANDS } from './appMenu.mjs';

// A stand-in for Electron's Menu: items by id, mutable like real MenuItems.
const fakeMenu = (template) => {
  const items = new Map(template.filter((t) => t.id).map((t) => [t.id, { ...t }]));
  return { items, getMenuItemById: (id) => items.get(id) ?? null };
};

describe('fileMenuTemplate', () => {
  const send = vi.fn();
  const setWindowMode = vi.fn();
  const enterChill = vi.fn();
  const tpl = fileMenuTemplate({ send, setWindowMode, enterChill });
  const labels = tpl.filter((t) => t.label).map((t) => t.label);

  it('has exactly the agreed items, in order, ending with the Close Window role', () => {
    expect(labels).toEqual(['Add Music…', 'Filled Screen Mode', 'Narrow Mode', 'Mini Mode', 'Chill Mode']);
    expect(tpl[tpl.length - 1]).toEqual({ role: 'close' });
  });

  it('Add Music is Cmd+O and asks the renderer to run its add flow', () => {
    const add = tpl.find((t) => t.id === 'file-add-music');
    expect(add.accelerator).toBe('CommandOrControl+O');
    add.click();
    expect(send).toHaveBeenCalledWith('add-music');
  });

  it('each size item resizes the window to its own mode', () => {
    tpl.find((t) => t.id === 'file-filled').click();
    tpl.find((t) => t.id === 'file-narrow').click();
    tpl.find((t) => t.id === 'file-mini').click();
    expect(setWindowMode.mock.calls.map((c) => c[0])).toEqual(['filled', 'narrow', 'mini']);
  });

  it('each size item also tells the renderer to end Chill mode; Chill Mode itself does not', () => {
    for (const id of ['file-filled', 'file-narrow', 'file-mini']) {
      send.mockClear();
      tpl.find((t) => t.id === id).click();
      expect(send).toHaveBeenCalledWith('exit-chill');
    }
    send.mockClear();
    tpl.find((t) => t.id === 'file-chill').click();
    expect(send).not.toHaveBeenCalledWith('exit-chill');
  });

  it('Chill Mode is Shift+Cmd+C and hands over to enterChill', () => {
    const chill = tpl.find((t) => t.id === 'file-chill');
    expect(chill.accelerator).toBe('Shift+CommandOrControl+C');
    enterChill.mockClear();
    chill.click();
    expect(enterChill).toHaveBeenCalledTimes(1);
  });

  it('no two items share an accelerator', () => {
    const accels = [...tpl, ...controlsMenuTemplate({ send })].map((t) => t.accelerator).filter(Boolean);
    expect(new Set(accels).size).toBe(accels.length);
  });
});

describe('controlsMenuTemplate', () => {
  it('every click sends a command the renderer knows', () => {
    const send = vi.fn();
    for (const it of controlsMenuTemplate({ send })) it.click?.();
    expect(send.mock.calls.map((c) => c[0]).sort()).toEqual([...MENU_COMMANDS].filter((c) => c !== 'add-music' && c !== 'enter-chill' && c !== 'exit-chill').sort());
  });

  it('keeps Space and the text-editing arrows free: Play/Pause has no accelerator, Next/Prev use Alt+Cmd', () => {
    const tpl = controlsMenuTemplate({ send: () => {} });
    expect(tpl.find((t) => t.id === 'controls-play-pause').accelerator).toBeUndefined();
    expect(tpl.find((t) => t.id === 'controls-next').accelerator).toBe('Alt+CommandOrControl+Right');
    expect(tpl.find((t) => t.id === 'controls-previous').accelerator).toBe('Alt+CommandOrControl+Left');
  });

  it('does not take Shift+Cmd+R (View > Force Reload) for Repeat', () => {
    const repeat = controlsMenuTemplate({ send: () => {} }).find((t) => t.id === 'controls-repeat');
    expect(repeat.accelerator).not.toBe('Shift+CommandOrControl+R');
  });
});

describe('applyMenuState', () => {
  const make = () => fakeMenu(controlsMenuTemplate({ send: () => {} }));

  it('starts with nothing loaded: track-dependent items disabled', () => {
    const m = make();
    for (const id of ['controls-next', 'controls-previous', 'controls-go-to-current']) {
      expect(m.items.get(id).enabled).toBe(false);
    }
  });

  it('a loaded, playing track enables the items and flips Play to Pause', () => {
    const m = make();
    applyMenuState(m, { hasTrack: true, isPlaying: true, isShuffle: false, repeatMode: 'off' });
    expect(m.items.get('controls-play-pause').label).toBe('Pause');
    for (const id of ['controls-next', 'controls-previous', 'controls-go-to-current']) {
      expect(m.items.get(id).enabled).toBe(true);
    }
  });

  it('mirrors shuffle and repeat', () => {
    const m = make();
    applyMenuState(m, { hasTrack: true, isPlaying: false, isShuffle: true, repeatMode: 'all' });
    expect(m.items.get('controls-shuffle').checked).toBe(true);
    expect(m.items.get('controls-repeat').label).toBe('Repeat: All');
    applyMenuState(m, { hasTrack: true, isPlaying: false, isShuffle: false, repeatMode: 'one' });
    expect(m.items.get('controls-shuffle').checked).toBe(false);
    expect(m.items.get('controls-repeat').label).toBe('Repeat: One');
  });

  it('File > Chill Mode follows whether a song is loaded', () => {
    const m = fakeMenu(fileMenuTemplate({ send: () => {}, setWindowMode: () => {}, enterChill: () => {} }));
    expect(m.items.get('file-chill').enabled).toBe(false);
    applyMenuState(m, { hasTrack: true });
    expect(m.items.get('file-chill').enabled).toBe(true);
    applyMenuState(m, { hasTrack: false });
    expect(m.items.get('file-chill').enabled).toBe(false);
  });

  it('tolerates a missing menu and unknown items', () => {
    expect(() => applyMenuState(null, {})).not.toThrow();
    expect(() => applyMenuState({ getMenuItemById: () => null }, { hasTrack: true })).not.toThrow();
  });
});
