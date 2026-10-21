// The File and Controls menu templates, plus the function that keeps the
// Controls items in step with the player. Electron-free: `send` and
// `setWindowMode` are injected by main.js, and applyMenuState only touches
// items through getMenuItemById, so vitest drives all of it with plain objects.
//
// Every item that needs the player (Add Music, Play/Pause, Next, ...) is a
// `menu-command` message to the renderer rather than logic here: the handlers
// it reuses (handleAddFiles, togglePlay, playNext, ...) already own the queue,
// history and confirm-modal rules. Accelerators have to live on the menu
// because a menu accelerator never reaches the page as a DOM keydown.
//
// Shortcuts deliberately avoid the text-editing keys: a menu accelerator wins
// over the focused field, so Space (Play/Pause) and Cmd+Left/Right (Next/Prev)
// would break typing in Search and the Tag Editor. Play/Pause therefore has no
// accelerator here and keeps its renderer-side Space handler. Repeat is Alt+Cmd+R
// because Shift+Cmd+R is Force Reload in the View menu.

export const MENU_COMMANDS = [
  'add-music',
  'play-pause',
  'next',
  'previous',
  'toggle-shuffle',
  'cycle-repeat',
  'go-to-current',
  'enter-chill',
  'exit-chill',
];

// enterChill: File > Chill Mode. main.js makes it a window resize plus the
// `enter-chill` command (see enterChillMode there).
export function fileMenuTemplate({ send, setWindowMode, enterChill }) {
  // The three size items also end Chill mode: it is a setting in the page, not
  // part of the window size, so a resize alone leaves it on (Filled Screen
  // Mode right after Chill Mode changed nothing, and a Narrow/Mini excursion
  // brought it back when the window grew again). Chill Mode's own resize goes
  // through main.js, not these, so it does not cancel itself.
  const resizeTo = (mode) => () => {
    setWindowMode(mode);
    send('exit-chill');
  };
  return [
    { id: 'file-add-music', label: 'Add Music…', accelerator: 'CommandOrControl+O', click: () => send('add-music') },
    { type: 'separator' },
    { id: 'file-filled', label: 'Filled Screen Mode', accelerator: 'Ctrl+Command+M', click: resizeTo('filled') },
    { id: 'file-narrow', label: 'Narrow Mode', accelerator: 'Alt+CommandOrControl+2', click: resizeTo('narrow') },
    { id: 'file-mini', label: 'Mini Mode', accelerator: 'Alt+CommandOrControl+3', click: resizeTo('mini') },
    // Needs a loaded song, like Next/Previous: see applyMenuState.
    { id: 'file-chill', label: 'Chill Mode', accelerator: 'Shift+CommandOrControl+C', enabled: false, click: () => enterChill() },
    { type: 'separator' },
    { role: 'close' },
  ];
}

export function controlsMenuTemplate({ send }) {
  return [
    // No accelerator: Space is handled by the renderer so it still types a space in a text field.
    { id: 'controls-play-pause', label: 'Play', click: () => send('play-pause') },
    { id: 'controls-next', label: 'Next', accelerator: 'Alt+CommandOrControl+Right', enabled: false, click: () => send('next') },
    { id: 'controls-previous', label: 'Previous', accelerator: 'Alt+CommandOrControl+Left', enabled: false, click: () => send('previous') },
    { type: 'separator' },
    { id: 'controls-shuffle', label: 'Shuffle', type: 'checkbox', checked: false, accelerator: 'Shift+CommandOrControl+S', click: () => send('toggle-shuffle') },
    { id: 'controls-repeat', label: 'Repeat: Off', accelerator: 'Alt+CommandOrControl+R', click: () => send('cycle-repeat') },
    { type: 'separator' },
    { id: 'controls-go-to-current', label: 'Go to Current Song', accelerator: 'CommandOrControl+L', enabled: false, click: () => send('go-to-current') },
  ];
}

const REPEAT_LABEL = { off: 'Off', all: 'All', one: 'One' };

// state: { hasTrack, isPlaying, isShuffle, repeatMode } as reported by the renderer.
export function applyMenuState(menu, state) {
  if (!menu) return;
  const item = (id) => menu.getMenuItemById(id);
  const set = (id, props) => {
    const it = item(id);
    if (it) Object.assign(it, props);
  };
  const hasTrack = !!state.hasTrack;
  set('controls-play-pause', { label: state.isPlaying ? 'Pause' : 'Play' });
  set('controls-next', { enabled: hasTrack });
  set('controls-previous', { enabled: hasTrack });
  set('controls-go-to-current', { enabled: hasTrack });
  set('file-chill', { enabled: hasTrack });
  set('controls-shuffle', { checked: !!state.isShuffle });
  set('controls-repeat', { label: `Repeat: ${REPEAT_LABEL[state.repeatMode] ?? 'Off'}` });
}
