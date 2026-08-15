// Automated smoke test, driven by `electron . --smoke` (see scripts/smoke.mjs).
// Runs inside the main process against an isolated temp userData dir, exercises
// the real parse → thumbnail → protocol pipeline plus renderer assertions via
// executeJavaScript, prints one JSON line prefixed SMOKE_RESULT:, then exits.

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { app, screen } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runSmoke({ mainWindow, parseFilePaths, getStore, loadLibraryState, seedOpenFileBatch, getOpenFileFlushCount, openTagEditor, getTagEditorWindow }) {
  const failures = [];
  const consoleErrors = [];
  // Numbers the suite measures but deliberately does not turn into pass/fail.
  // Hardware this app must run on spans an M-series Mac and a 2017 Intel iMac;
  // a threshold strict enough to be meaningful on one is a false failure on the
  // other, and a red build that everyone learns to ignore hides real
  // regressions. These are reported for a human to judge.
  const metrics = {};
  const check = (cond, label) => { if (!cond) failures.push(label); };

  // Fixed-duration sleeps are the suite's synchronisation primitive, and they
  // encode the speed of the machine they were written on (Apple Silicon).
  // Running the x86_64 slice under Rosetta (~1.8x slower) made four different
  // assertions fail across four runs - never the same two twice, which is the
  // signature of a harness race rather than a real defect. A 2017 Intel iMac,
  // which is the whole point of the universal build, is slower again.
  //
  // Two mitigations, in order of preference:
  //   1. waitFor() below - poll for the state an assertion depends on, so
  //      machine speed stops mattering entirely. Used at every point where a
  //      sleep gates a check().
  //   2. SLOW - a blunt multiplier for the remaining "let things settle"
  //      sleeps. Auto-detects Rosetta; override with SONUS_SMOKE_SLOW=<n>
  //      on genuinely slow native hardware.
  let SLOW = Number(process.env.SONUS_SMOKE_SLOW) || 0;
  if (!SLOW) {
    try {
      SLOW = execSync('sysctl -in sysctl.proc_translated 2>/dev/null').toString().trim() === '1' ? 2.5 : 1;
    } catch { SLOW = 1; }
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, Math.round(ms * SLOW)));

  // Poll a renderer-side expression until it satisfies `predicate`, or give up.
  // Returns the last value either way, so the caller's check() still runs and
  // still fails on timeout - this changes WHEN an assertion is evaluated, never
  // WHAT it asserts.
  // Stamped onto every SMOKE_RESULT line. A universal build produces one binary
  // that can execute as either architecture, so a bare pass/fail cannot tell you
  // WHICH slice was exercised - and the same JSON coming back from another Mac
  // is unattributable without this. `translated` distinguishes a real Intel Mac
  // from the x86_64 slice running under Rosetta on Apple Silicon.
  const envInfo = () => {
    let translated = false;
    try {
      translated = execSync('sysctl -in sysctl.proc_translated 2>/dev/null').toString().trim() === '1';
    } catch { /* not macOS, or sysctl unavailable */ }
    return {
      arch: process.arch,
      platform: process.platform,
      osRelease: os.release(),
      translated,
      slowFactor: SLOW,
      electron: process.versions.electron,
    };
  };

  const waitFor = async (expression, predicate, { timeout = 10000, interval = 100 } = {}) => {
    const deadline = Date.now() + timeout * SLOW;
    let last;
    for (;;) {
      try {
        last = await mainWindow.webContents.executeJavaScript(expression, true);
        if (predicate(last)) return last;
      } catch (err) {
        last = { __error: String(err) };
      }
      if (Date.now() >= deadline) return last;
      await new Promise(r => setTimeout(r, interval));
    }
  };

  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });

  // ── Cold-launch ordering (npx electron . --smoke --open-file=<path> …) ────
  // The seeded arbitration cases further down inject an already-settled batch,
  // which deliberately sidesteps the one timing assumption this refactor rests
  // on: that a real cold launch calls library:load *before* the renderer is
  // ready, so the batch is consumed there rather than flushed. This mode
  // exercises that real sequence end to end - open-file queued before the
  // window exists, real settle timer, real renderer mount - and then exits.
  const cliOpened = process.argv.filter(a => a.startsWith('--open-file=')).map(a => a.slice('--open-file='.length));
  if (cliOpened.length > 0) {
    try {
      await sleep(800); // let the launch settle: parse + first paint
      const expected = [...cliOpened].sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
      const state = await mainWindow.webContents.executeJavaScript(`
        (() => {
          if (!window.__sonusTest) return { noHook: true };
          return {
            lib: window.__sonusTest.getLibrary().map(t => t.filePath),
            view: window.__sonusTest.getView(),
            hasActiveRow: !!document.querySelector('.track-row.active'),
          };
        })()
      `, true);
      if (state.noHook) {
        failures.push('test hook (?test=1) not present in renderer');
      } else {
        check(state.lib.join('|') === expected.join('|'), `cold launch library is the opened batch (${state.lib.map(p => p.split('/').pop()).join(',')})`);
        check(state.view === 'library', `cold launch lands on Library (${state.view})`);
        check(state.hasActiveRow, 'cold launch marks a current track');
        // The whole point: the batch was resolved inside library:load, so the
        // renderer never rendered a session it was about to throw away.
        check(getOpenFileFlushCount() === 0, `cold launch consumed the batch in library:load, not the flush (flushes: ${getOpenFileFlushCount()})`);
      }
    } catch (err) {
      failures.push(`cold-launch ordering error: ${err.stack || err}`);
    }
    const realErrors = consoleErrors.filter(m => !/Autoplay|play\(\) failed|user didn't interact/i.test(m));
    if (realErrors.length > 0) failures.push(`renderer console errors: ${realErrors.join(' | ')}`);
    console.log('SMOKE_RESULT:' + JSON.stringify({ ok: failures.length === 0, failures, ...envInfo() }));
    app.exit(failures.length === 0 ? 0 : 1);
    return;
  }

  try {
    // 1. Parse the repo's fixture file through the real pipeline.
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const tracks = await parseFilePaths([fixture]);
    check(tracks.length === 1, `fixture parsed (got ${tracks.length} tracks)`);
    const track = tracks[0];

    if (track) {
      check(typeof track.title === 'string' && track.title.length > 0, 'track has title');
      check(typeof track.duration === 'number' && track.duration > 0, 'track has duration');
      check(!('picture' in track), 'track carries no picture field');
      check(JSON.stringify(track).indexOf('data:image') === -1, 'no base64 image in track object');
      check(/^sonus-thumb:\/\/art\/[0-9a-f]{40}\.(jpg|png|gif|webp)\?v=[0-9a-f]{8}$/.test(track.thumb || ''), `thumb URL well-formed (${track.thumb})`);
      check(typeof track.dateAdded === 'number' && track.dateAdded > 0, 'dateAdded populated');
      check(track.playCount === 0 && track.lastPlayed === null, 'fresh play stats');

      // 2. Thumbnail file exists on disk and is a real JPEG under the size cap.
      if (track.thumb) {
        const name = new URL(track.thumb).pathname.replace(/^\//, '');
        const thumbFile = path.join(app.getPath('userData'), 'thumbs', name.slice(0, 2), name);
        try {
          const buf = await fs.readFile(thumbFile);
          check(buf[0] === 0xFF && buf[1] === 0xD8, 'thumb file is JPEG');
          check(buf.length < 200 * 1024, `thumb file small enough (${buf.length}B)`);
        } catch {
          failures.push('thumb file exists on disk');
        }
      }

      // 3. Index entry recorded; second parse served from cache (identical mtime path).
      const entry = getStore().getEntry(fixture);
      check(!!entry && entry.mtimeMs > 0, 'index entry recorded with mtime');
      const again = await parseFilePaths([fixture]);
      check(again[0]?.thumb === track.thumb, 'second parse served from index');

      // 4. Play stats round-trip.
      const s1 = getStore().recordPlay(fixture, 123456);
      check(s1.playCount === 1 && s1.lastPlayed === 123456, 'recordPlay increments');

      // 5. Renderer-side: protocol resolves, mounted DOM stays sane.
      const rendererResult = await mainWindow.webContents.executeJavaScript(`
        (async () => {
          const out = {};
          try {
            const res = await fetch(${JSON.stringify(track.thumb)});
            out.thumbStatus = res.status;
            out.thumbType = res.headers.get('content-type');
            const blob = await res.blob();
            out.thumbSize = blob.size;
          } catch (e) { out.thumbError = String(e); }
          out.hasRoot = !!document.getElementById('root');
          out.appMounted = document.querySelectorAll('.glass-panel').length > 0;
          return out;
        })()
      `, true);
      check(rendererResult.thumbStatus === 200, `renderer fetched thumb over sonus-thumb:// (status ${rendererResult.thumbStatus}, err ${rendererResult.thumbError || 'none'})`);
      check(rendererResult.thumbType === 'image/jpeg', `thumb content-type (${rendererResult.thumbType})`);
      check(rendererResult.thumbSize > 500, 'thumb has real bytes');
      check(rendererResult.appMounted, 'renderer app mounted');
    }
  } catch (err) {
    failures.push(`unexpected error: ${err.stack || err}`);
  }

  // ── Tracklist UI: inject a synthetic library and drive the DOM ────────────
  try {
    const uiResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        if (!window.__sonusTest) { out.noHook = true; return out; }

        // 2,000 synthetic tracks injected in REVERSE title order, so manual
        // order and title-ascending order are distinguishable.
        const tracks = [];
        for (let i = 1999; i >= 0; i--) {
          tracks.push({
            title: 'Song ' + String(i).padStart(4, '0'),
            artist: 'Artist ' + (i % 40), album: 'Album ' + (i % 120), albumArtist: '',
            year: 1980 + (i % 45), duration: 120 + (i % 300), genre: '',
            thumb: null, lyrics: i % 3 === 0 ? 'la la' : null,
            trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
            composer: '', comment: '', bpm: '', bitrate: 320, codecProfile: null,
            dateAdded: 1700000000000 + i * 1000, playCount: i % 7, lastPlayed: i % 2 ? 1700000000000 : null,
            filePath: '/fake/song-' + i + '.mp3',
          });
        }
        window.__sonusTest.setLibrary(tracks);
        await sleep(400);

        out.rowCount = document.querySelectorAll('.track-row').length;
        out.hasHeader = !!document.querySelector('.track-list-header');
        // 2k tracks, manual order → drag is allowed → grip handles visible.
        // (Also validates the selector the 20k bench uses to assert their absence.)
        out.hasGripAt2k = !!document.querySelector('.track-row svg.lucide-grip-vertical');
        const firstTitle = () => document.querySelector('.track-row')?.children[2]?.children[0]?.textContent;
        out.manualFirst = firstTitle();

        // The Title column cycles title↑ → title↓ → artist↑ → artist↓ → manual.
        const clickTitle = async () => {
          document.querySelectorAll('.track-header-label')[0]?.click();
          await sleep(320);
        };
        await clickTitle(); out.ascFirst = firstTitle();
        await clickTitle(); out.descFirst = firstTitle();
        await clickTitle(); await clickTitle();   // through the two artist steps
        await clickTitle(); out.backToManualFirst = firstTitle();

        // Keyboard: focus list, ArrowDown selects row 0
        const list = document.querySelector('.track-list');
        list?.focus();
        list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await sleep(150);
        out.selectedCount = document.querySelectorAll('.track-row.selected').length;

        // Details view runs on the same engine (no drag, per-open sort).
        // Poll for the view swap instead of assuming a fixed delay: 400ms was
        // enough on Apple Silicon and not under Rosetta, which read 0 rows and
        // failed an assertion that had nothing wrong with it.
        //
        // The condition must be FALSE before the transition. Waiting on
        // '.track-row' alone is not: the Library's own rows are still mounted,
        // so the loop exits on the first iteration and samples the DOM before
        // HomeDetailView has rendered. 'Play All' exists only in the detail
        // view, so it is the honest marker for "the swap actually happened".
        window.__sonusTest.openDetail({ type: 'artist', key: 'Artist 1' });
        const detailReady = () =>
          [...document.querySelectorAll('button')].some(b => b.textContent.includes('Play All'))
          && document.querySelectorAll('.track-row').length > 0;
        for (let i = 0; i < 120 && !detailReady(); i++) await sleep(50);
        out.detailRows = document.querySelectorAll('.track-row').length;
        out.detailHeader = !!document.querySelector('.track-list-header');
        out.detailHasPlayAll = [...document.querySelectorAll('button')].some(b => b.textContent.includes('Play All'));
        window.__sonusTest.closeDetail();
        window.__sonusTest.setView('library');
        await sleep(150);

        window.__sonusTest.setLibrary([]);
        await sleep(100);
        return out;
      })()
    `, true);

    if (uiResult.noHook) {
      failures.push('test hook (?test=1) not present in renderer');
    } else {
      check(uiResult.hasHeader, 'tracklist header rendered');
      check(uiResult.hasGripAt2k, 'drag handles present at 2k manual order (selector sanity)');
      check(uiResult.rowCount > 0 && uiResult.rowCount < 80, `mounted rows bounded under virtualization (${uiResult.rowCount} of 2000)`);
      check(uiResult.manualFirst === 'Song 1999', `manual order preserved (first: ${uiResult.manualFirst})`);
      check(uiResult.ascFirst === 'Song 0000', `title sort ascending (first: ${uiResult.ascFirst})`);
      check(uiResult.descFirst === 'Song 1999', `title sort descending (first: ${uiResult.descFirst})`);
      check(uiResult.backToManualFirst === 'Song 1999', `fifth click returns to manual (first: ${uiResult.backToManualFirst})`);
      check(uiResult.selectedCount === 1, `ArrowDown selects one row (${uiResult.selectedCount})`);
      check(uiResult.detailRows > 0 && uiResult.detailRows <= 60, `detail view renders bounded rows (${uiResult.detailRows})`);
      check(uiResult.detailHeader, 'detail view has sortable header');
      check(uiResult.detailHasPlayAll, 'detail view hero intact (Play All present)');
    }
  } catch (err) {
    failures.push(`tracklist UI test error: ${err.stack || err}`);
  }

  // ── Library column header: geometry, alignment, and isolation from scroll ──
  // Asserted numerically rather than by eye. The design rests on three
  // measurable claims: it reclaims vertical space, its labels stay over the
  // columns they sort, and — the whole point of moving it out of the scroll
  // container — no row can ever overlap it and it does not move when the list
  // scrolls. If a row can reach it, the header needs an opaque fill again and
  // the darkening problem is back.
  try {
    const barResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        if (!window.__sonusTest) { out.noHook = true; return out; }
        window.__sonusTest.setView('library');

        const tracks = [];
        for (let i = 0; i < 300; i++) {
          tracks.push({
            title: 'Bar Song ' + String(i).padStart(3, '0'), artist: 'Artist ' + (i % 10),
            album: 'Album ' + (i % 20), albumArtist: '', year: 1990 + (i % 30),
            duration: 200 + (i % 100), genre: '', thumb: null, lyrics: null,
            trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
            composer: '', comment: '', bpm: '', bitrate: 320, codecProfile: null,
            dateAdded: 1700000000000 + i, playCount: 0, lastPlayed: null,
            filePath: '/bar/t' + i + '.mp3',
          });
        }
        window.__sonusTest.setLibrary(tracks);
        await sleep(500);

        const scroller = () => document.querySelector('.scrollable');
        const bar = () => document.querySelector('.track-list-header');
        const rows = () => [...document.querySelectorAll('.track-row')];

        scroller().scrollTop = 0;
        await sleep(300);

        out.barHeightRest = bar().offsetHeight;
        // The Library screen carries no title, song count or total duration
        // anywhere — guards against the identity line creeping back in and
        // against its CSS being left behind as dead rules.
        out.identityGone = !document.querySelector('.library-identity, .library-identity-title, .library-identity-meta');

        // Reclaimed space, measured from the panel's top edge — the header is no
        // longer inside the scroller, so a scroller-relative number is meaningless.
        const panel = document.querySelector('.glass-panel');
        const firstRow = rows()[0];
        out.panelTopToFirstRow = Math.round(
          firstRow.getBoundingClientRect().top - panel.getBoundingClientRect().top
        );
        out.panelTopToBar = Math.round(bar().getBoundingClientRect().top - panel.getBoundingClientRect().top);

        // Column alignment — the whole point of the two-tier structure.
        const labels = () => [...document.querySelectorAll('.track-header-label')];
        out.titleLabelX = Math.round(labels()[0].getBoundingClientRect().left);
        out.rowTitleX   = Math.round(firstRow.children[2].getBoundingClientRect().left);
        const timeLabel = labels()[labels().length - 1];
        out.timeLabelRight = Math.round(timeLabel.getBoundingClientRect().right);
        out.rowTimeRight   = Math.round(
          firstRow.children[firstRow.children.length - 1].getBoundingClientRect().right
        );

        // Rows must be evenly pitched — a constant-offset scrollMargin error
        // would not show up here, but a broken virtualizer would.
        const tops = rows().slice(0, 6).map(r => Math.round(r.getBoundingClientRect().top));
        out.rowPitches = tops.slice(1).map((t, i) => t - tops[i]);

        // The Title column's five-step cycle, label text included — the label is
        // the only thing telling the user which state they're in.
        const titleLabel = () => labels()[0];
        out.cycle = [];
        for (let i = 0; i < 6; i++) {
          titleLabel().click();
          await sleep(320);
          // primary is the row's bold line. StackedCell promotes whichever of
          // title/artist is being sorted, so reading it also proves the flip.
          out.cycle.push({
            label: titleLabel().textContent.trim(),
            active: titleLabel().classList.contains('active'),
            primary: rows()[0].children[2].children[0].textContent,
            secondary: rows()[0].children[2].children[1]?.textContent ?? null,
          });
        }
        // Land back on manual for the remaining checks.
        titleLabel().click();
        await sleep(320);
        titleLabel().click();
        await sleep(320);
        titleLabel().click();
        await sleep(320);
        titleLabel().click();
        await sleep(350);
        out.settledManual = !titleLabel().classList.contains('active');

        // The header must be visually inert — no fill at ANY scroll position, so
        // it can never "turn dark" the way the sticky version did.
        const backdrop = (el) => {
          const s = getComputedStyle(el);
          const plain = s.getPropertyValue('backdrop-filter');
          const webkit = s.getPropertyValue('-webkit-backdrop-filter');
          return (plain && plain !== 'none' ? plain : webkit) || 'none';
        };
        out.bgAtRest = getComputedStyle(bar()).backgroundColor;
        out.barTopAtRest = Math.round(bar().getBoundingClientRect().top);

        scroller().scrollTop = 1500;
        await sleep(400);
        out.bgAfter = getComputedStyle(bar()).backgroundColor;
        out.blurAfter = backdrop(bar());
        out.barTopAfter = Math.round(bar().getBoundingClientRect().top);
        // Glassmorphism regression guard, and the reason it lives in the smoke
        // suite rather than a unit test: the bug only exists in the BUILT css.
        // Writing -webkit-backdrop-filter alongside the plain property makes
        // Vite's minifier keep only the -webkit- one, which Electron's Chromium
        // no longer supports — so every glass surface silently loses its blur in
        // the packaged app while still looking correct under the dev server.
        out.glassBlur = getComputedStyle(document.querySelector('.glass-panel')).getPropertyValue('backdrop-filter');
        out.barHeightScrolled = bar().offsetHeight;

        // Inter is bundled rather than fetched from Google. Same class of
        // silent failure as the blur above: if the woff2 assets don't resolve
        // under file:// in the packaged app, nothing errors — the UI just
        // quietly renders in -apple-system and looks subtly wrong. Load the
        // faces explicitly, then confirm they are genuinely usable.
        // NOT document.fonts.check(): it returns true for a family that does not
        // exist at all, because the text is still renderable via the fallback
        // chain. Verified — it answered true for '__SonusNoSuchFont__', which
        // would have made a "font loaded" assertion pass unconditionally.
        //
        // FontFace.status is the honest signal: it is 'loaded' only once the
        // woff2 actually resolved and parsed, and goes to 'error' when the URL
        // does not resolve, which is precisely the packaged-app failure mode
        // this guards against.
        await document.fonts.ready;
        await document.fonts.load('400 16px Inter');
        await document.fonts.load('700 16px Inter');
        const interFaces = [...document.fonts].filter(f => f.family === 'Inter');
        out.interFaces = interFaces.length;                                    // CSS shipped
        out.interLoadedFaces = interFaces.filter(f => f.status === 'loaded').length; // bytes resolved
        out.interErrorFaces = interFaces.filter(f => f.status === 'error').length;
        // Control: an absent family must enumerate to zero faces. If this ever
        // becomes non-zero the enumeration is not discriminating and the
        // assertions above are meaningless.
        out.bogusFaces = [...document.fonts].filter(f => f.family === '__SonusNoSuchFont__').length;
        out.bodyFont = getComputedStyle(document.body).fontFamily.split(',')[0].replace(/['"]/g, '').trim();
        // THE assertion for this design: nothing may be PAINTED over the header.
        // Deliberately a hit-test, not a rect comparison — getBoundingClientRect
        // still reports geometry for rows scrolled out of view and clipped by the
        // scroller, so a rect test flags invisible rows and proves nothing.
        const hitNames = () => {
          const br = bar().getBoundingClientRect();
          const y = br.top + br.height / 2;
          return [br.left + 40, br.left + br.width / 2, br.right - 40].map(x => {
            const el = document.elementFromPoint(x, y);
            if (!el) return 'null';
            if (el.closest('.track-row')) return 'ROW';
            return el.closest('.track-list-header') ? 'header' : 'other';
          });
        };
        out.headerHitTest = hitNames();
        // The scroll container itself must begin at or below the header's bottom.
        out.scrollerStartsBelowBar =
          scroller().getBoundingClientRect().top >= bar().getBoundingClientRect().bottom - 1;

        scroller().scrollTop = 0;
        await sleep(300);

        // Density's only entry point. Alignment must survive the switch, since
        // artSize 30 → 40 changes the leading spacer the labels are placed from.
        out.hasDensityToggle = !!document.querySelector('.track-header-density');
        document.querySelector('.track-header-density')?.click();
        await sleep(450);
        const cRow = rows()[0];
        out.comfortableBarHeight = bar().offsetHeight;
        out.comfortableTitleLabelX = Math.round(labels()[0].getBoundingClientRect().left);
        out.comfortableRowTitleX = Math.round(cRow.children[2].getBoundingClientRect().left);
        out.comfortableRowHeight = Math.round(cRow.getBoundingClientRect().height);
        document.querySelector('.track-header-density')?.click(); // restore compact
        await sleep(400);
        out.restoredRowHeight = Math.round(rows()[0].getBoundingClientRect().height);

        // The Sort dropdown is gone for good.
        out.sortChipGone = !document.querySelector('.track-header-sort-chip');

        // A search matching nothing must KEEP the bar (count + sort controls).
        const input = document.querySelector('.wow-search-input');
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSet.call(input, 'zzz-no-such-track-zzz');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(400);
        out.barSurvivesEmptySearch = !!bar();
        out.emptySearchMessage = document.body.textContent.includes('No tracks match');
        out.emptySearchRowCount = rows().length;
        nativeSet.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(400);

        // Detail views render the same hairline header, above their own scroller.
        window.__sonusTest.openDetail({ type: 'artist', key: 'Artist 1' });
        await sleep(500);
        out.detailBarHeight = document.querySelector('.track-list-header')?.offsetHeight ?? null;
        // Details has its own inner scroller, so it has its own scrollbar-gutter
        // question — measure it rather than assume Library's answer carries over.
        const dRow = document.querySelector('.track-row');
        const dLabels = [...document.querySelectorAll('.track-header-label')];
        if (dRow && dLabels.length) {
          out.detailTitleLabelX = Math.round(dLabels[0].getBoundingClientRect().left);
          out.detailRowTitleX = Math.round(dRow.children[2].getBoundingClientRect().left);
          out.detailTimeLabelRight = Math.round(dLabels[dLabels.length - 1].getBoundingClientRect().right);
          out.detailRowTimeRight = Math.round(dRow.children[dRow.children.length - 1].getBoundingClientRect().right);
        }
        window.__sonusTest.closeDetail();
        window.__sonusTest.setView('library');
        await sleep(300);

        // Empty library: no bar at all.
        window.__sonusTest.setLibrary([]);
        await sleep(350);
        out.emptyLibraryHasBar = !!document.querySelector('.track-list-header');
        out.emptyLibraryPrompt = document.body.textContent.includes('Drag and drop files here');
        return out;
      })()
    `, true);

    if (barResult.noHook) {
      failures.push('test hook (?test=1) not present in renderer');
    } else {
      const alpha = (rgb) => { const m = /rgba?\([^)]*?,\s*([\d.]+)\)$/.exec(rgb || ''); return m ? parseFloat(m[1]) : 1; };

      check(barResult.barHeightRest === 26, `header is a 26px hairline (${barResult.barHeightRest})`);
      check(barResult.identityGone, 'no Library title / song count / duration anywhere on the screen');

      // 16 top padding + 26 header + 6 gap = 48.
      check(Math.abs(barResult.panelTopToFirstRow - 48) <= 3,
        `panel top → first row is ~48px, was 135px (${barResult.panelTopToFirstRow})`);

      // The five-step Title cycle, verified by what the user actually sees.
      const cyc = barResult.cycle || [];
      const step = (i) => cyc[i] || {};
      check(step(0).label === 'Title' && step(0).primary === 'Bar Song 000' && step(0).active,
        `click 1 → Title a–z (${step(0).label} / ${step(0).primary})`);
      check(step(1).label === 'Title' && step(1).primary === 'Bar Song 299' && step(1).active,
        `click 2 → Title z–a (${step(1).label} / ${step(1).primary})`);
      // Sorting by artist also promotes artist to the row's bold line.
      check(step(2).label === 'Artist' && step(2).primary === 'Artist 0' && step(2).active,
        `click 3 → label renames to Artist, a–z, row flips (${step(2).label} / ${step(2).primary})`);
      check(step(3).label === 'Artist' && step(3).primary === 'Artist 9' && step(3).active,
        `click 4 → Artist z–a (${step(3).label} / ${step(3).primary})`);
      check(step(4).label === 'Title' && step(4).primary === 'Bar Song 000' && !step(4).active,
        `click 5 → manual, label reverts with no arrow (${step(4).label}, active ${step(4).active})`);
      check(step(5).label === 'Title' && step(5).primary === 'Bar Song 000' && step(5).active,
        `click 6 → cycle loops back to Title a–z (${step(5).label})`);
      check(barResult.settledManual === true, 'cycle settles back on manual');

      check(barResult.titleLabelX === barResult.rowTitleX,
        `TITLE label sits over the row title column (label ${barResult.titleLabelX} vs row ${barResult.rowTitleX})`);
      check(barResult.timeLabelRight === barResult.rowTimeRight,
        `TIME label sits over the row duration column (label ${barResult.timeLabelRight} vs row ${barResult.rowTimeRight})`);
      check(barResult.rowPitches.every(p => p === 44),
        `compact rows evenly pitched at 44px (${barResult.rowPitches.join(',')})`);

      // The three that define this design: nothing behind it, it never moves,
      // and it never paints a fill (so it can never visibly darken).
      check(!(barResult.headerHitTest || []).includes('ROW'),
        `no row is painted over the header while scrolled (${(barResult.headerHitTest || []).join(',')})`);
      check(barResult.scrollerStartsBelowBar, 'the scroll container begins below the header');
      check(barResult.barTopAtRest === barResult.barTopAfter,
        `header does not move when the list scrolls (${barResult.barTopAtRest} → ${barResult.barTopAfter})`);
      check(alpha(barResult.bgAtRest) === 0 && alpha(barResult.bgAfter) === 0,
        `header stays fully transparent at every scroll position (${barResult.bgAtRest} → ${barResult.bgAfter})`);
      check(barResult.blurAfter === 'none',
        `header needs no backdrop blur, having nothing behind it (${barResult.blurAfter})`);
      check(/^blur\(/.test(barResult.glassBlur || ''),
        `.glass-panel has a real blur in the BUILT css — glassmorphism intact (${barResult.glassBlur})`);
      check(barResult.interFaces > 0,
        `Inter @font-face rules present in the built CSS (${barResult.interFaces} faces)`);
      check(barResult.interLoadedFaces > 0,
        `bundled Inter woff2 actually resolved under file:// — not silently falling back to a system font (${barResult.interLoadedFaces} loaded, ${barResult.interErrorFaces} errored)`);
      check(barResult.interErrorFaces === 0,
        `no Inter face failed to load (${barResult.interErrorFaces} errored)`);
      check(barResult.bogusFaces === 0,
        `font enumeration is discriminating — an absent family yields no faces (${barResult.bogusFaces})`);
      check(barResult.bodyFont === 'Inter', `body renders in Inter (${barResult.bodyFont})`);
      check(barResult.barHeightRest === barResult.barHeightScrolled,
        `header height constant while scrolling (${barResult.barHeightRest} → ${barResult.barHeightScrolled})`);

      check(barResult.sortChipGone, 'the Sort chip and its dropdown are gone');
      check(barResult.hasDensityToggle, 'density has an entry point in the header');
      check(barResult.comfortableRowHeight === 56, `density toggle took effect (row ${barResult.comfortableRowHeight}px)`);
      check(barResult.restoredRowHeight === 44, `density toggle switches back (row ${barResult.restoredRowHeight}px)`);
      check(barResult.comfortableBarHeight === 26, `header stays 26px in comfortable density (${barResult.comfortableBarHeight})`);
      check(barResult.comfortableTitleLabelX === barResult.comfortableRowTitleX,
        `alignment survives the density switch (label ${barResult.comfortableTitleLabelX} vs row ${barResult.comfortableRowTitleX})`);

      check(barResult.barSurvivesEmptySearch, 'bar survives a search that matches nothing');
      check(barResult.emptySearchMessage, 'empty search still shows its message');
      check(barResult.emptySearchRowCount === 0, `empty search renders no rows (${barResult.emptySearchRowCount})`);

      check(barResult.detailBarHeight === 26, `detail view renders the same 26px hairline (${barResult.detailBarHeight})`);
      check(barResult.detailTitleLabelX === barResult.detailRowTitleX,
        `detail Title label sits over its column (label ${barResult.detailTitleLabelX} vs row ${barResult.detailRowTitleX})`);
      check(barResult.detailTimeLabelRight === barResult.detailRowTimeRight,
        `detail Time label sits over its column (label ${barResult.detailTimeLabelRight} vs row ${barResult.detailRowTimeRight})`);

      check(barResult.emptyLibraryHasBar === false, 'empty library renders no bar');
      check(barResult.emptyLibraryPrompt, 'empty library still shows its prompt');
    }

    // The header has to survive the window's 700px minWidth
    // (electron/main.js). Driven from the main process because only it can
    // resize the window.
    const originalBounds = mainWindow.getBounds();
    mainWindow.setContentSize(700, 600);
    await sleep(600);
    const narrow = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        window.__sonusTest.setLibrary([{
          title: 'A Really Quite Long Track Title For Overflow', artist: 'Some Artist',
          album: 'Album', albumArtist: '', year: 2001, duration: 245, genre: '',
          thumb: null, lyrics: null, trackNumber: '', trackTotal: '', discNumber: '',
          discTotal: '', composer: '', comment: '', bpm: '', bitrate: 320,
          codecProfile: null, dateAdded: 1, playCount: 0, lastPlayed: null,
          filePath: '/narrow/a.mp3',
        }]);
        await sleep(500);
        const bar = document.querySelector('.track-list-header');
        const row = document.querySelector('.track-row');
        const label = document.querySelectorAll('.track-header-label')[0];
        return {
          height: bar.offsetHeight,
          // No internal overflow: the meta must ellipsize, not push layout wider.
          overflowX: bar.scrollWidth - bar.clientWidth,
          bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          labelX: Math.round(label.getBoundingClientRect().left),
          rowTitleX: Math.round(row.children[2].getBoundingClientRect().left),
        };
      })()
    `, true);
    mainWindow.setBounds(originalBounds);
    await sleep(500);
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setLibrary([])`, true);
    await sleep(200);

    check(narrow.height === 26, `header stays 26px at the 700px minWidth (${narrow.height})`);
    check(narrow.overflowX <= 1, `bar does not overflow horizontally when narrow (${narrow.overflowX}px)`);
    check(narrow.bodyOverflow <= 1, `page does not scroll horizontally when narrow (${narrow.bodyOverflow}px)`);
    check(narrow.labelX === narrow.rowTitleX,
      `alignment holds at minWidth (label ${narrow.labelX} vs row ${narrow.rowTitleX})`);
  } catch (err) {
    failures.push(`library command bar error: ${err.stack || err}`);
  }

  // ── Tag write round-trip over real IPC (MP3 path + index/thumb sync) ──────
  try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const tmpCopy = path.join(app.getPath('userData'), 'smoke-writetag.mp3');
    await fs.copyFile(fixture, tmpCopy);
    await parseFilePaths([tmpCopy]); // seed index entry (writeTag sync needs it)

    const wtResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const p = ${JSON.stringify(tmpCopy)};
        const res = await window.electronAPI.writeTag(p, {
          title: 'Smoke Title', artist: 'Smoke Artist', album: 'Smoke Album',
          albumArtist: '', year: '2024', genre: 'Test', trackNumber: '3', trackTotal: '9',
          discNumber: '', discTotal: '', composer: '', comment: 'smoke comment',
          bpm: '', lyrics: 'smoke lyrics line'
        });
        out.writeOk = res === true || res?.success === true;
        out.thumbAfterWrite = res?.thumb ?? null;
        const [reparsed] = await window.electronAPI.parseFiles([p]);
        out.title = reparsed?.title; out.artist = reparsed?.artist;
        out.year = reparsed?.year; out.lyrics = reparsed?.lyrics;
        out.trackNumber = reparsed?.trackNumber; out.trackTotal = reparsed?.trackTotal;
        out.fullArt = await window.electronAPI.readArtwork(p);
        const stats = await window.electronAPI.recordPlay(p);
        out.playCount = stats?.playCount;
        return out;
      })()
    `, true);

    check(wtResult.writeOk, 'writeTag succeeded');
    check(wtResult.title === 'Smoke Title' && wtResult.artist === 'Smoke Artist', `re-parse sees new tags (${wtResult.title} / ${wtResult.artist})`);
    check(String(wtResult.year) === '2024', `year round-trips (${wtResult.year})`);
    check(wtResult.lyrics === 'smoke lyrics line', 'lyrics round-trip');
    check(wtResult.trackNumber === '3' && wtResult.trackTotal === '9', `track n/of round-trips (${wtResult.trackNumber}/${wtResult.trackTotal})`);
    check(typeof wtResult.fullArt === 'string' && wtResult.fullArt.startsWith('data:image/'), 'readArtwork returns full-res data URL');
    check(wtResult.playCount === 1, `recordPlay over IPC (${wtResult.playCount})`);
    await fs.rm(tmpCopy, { force: true });
  } catch (err) {
    failures.push(`writeTag round-trip error: ${err.stack || err}`);
  }

  // ── WAV + FLAC writer round-trips (real files generated on the fly) ───────
  try {
    // Minimal valid WAV: RIFF/fmt/data, 0.2s of 16-bit mono silence @ 8kHz.
    const sampleCount = 1600;
    const dataSize = sampleCount * 2;
    const wav = Buffer.alloc(44 + dataSize);
    wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVE', 8, 'ascii');
    wav.write('fmt ', 12, 'ascii'); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii'); wav.writeUInt32LE(dataSize, 40);
    const wavPath = path.join(app.getPath('userData'), 'smoke.wav');
    await fs.writeFile(wavPath, wav);
    await parseFilePaths([wavPath]); // seed index

    const wavResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const p = ${JSON.stringify(wavPath)};
        const res = await window.electronAPI.writeTag(p, {
          title: 'Wav Title', artist: 'Wav Artist', album: 'Wav Album', albumArtist: '',
          year: '2023', genre: '', trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
          composer: '', comment: '', bpm: '', lyrics: 'wav lyrics'
        });
        const [t] = await window.electronAPI.parseFiles([p]);
        return { ok: res === true || res?.success === true, title: t?.title, artist: t?.artist, lyrics: t?.lyrics };
      })()
    `, true);
    check(wavResult.ok, 'WAV writeTag succeeded');
    check(wavResult.title === 'Wav Title' && wavResult.artist === 'Wav Artist', `WAV tags round-trip (${wavResult.title}/${wavResult.artist})`);
    check(wavResult.lyrics === 'wav lyrics', 'WAV lyrics round-trip');
    await fs.rm(wavPath, { force: true });

    // Hand-crafted minimal FLAC (fLaC marker + STREAMINFO only) — plus a
    // variant with a leading ID3v2 header, exercising the writer's strip path.
    const streamInfo = Buffer.alloc(34);
    streamInfo.writeUInt16BE(4608, 0);
    streamInfo.writeUInt16BE(4608, 2);
    streamInfo[10] = 8000 >> 12;
    streamInfo[11] = (8000 >> 4) & 0xFF;
    streamInfo[12] = ((8000 & 0xF) << 4);
    streamInfo[13] = (15 & 0xF) << 4;      // 16 bps, total-samples high nibble 0
    streamInfo.writeUInt32BE(1600, 14);    // total samples
    const flacBytes = Buffer.concat([Buffer.from('fLaC', 'ascii'), Buffer.from([0x80, 0x00, 0x00, 0x22]), streamInfo]);
    const id3Prefix = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]); // 'ID3' v2.3, size 0

    for (const [name, bytes] of [['plain', flacBytes], ['id3-prefixed', Buffer.concat([id3Prefix, flacBytes])]]) {
      const flacPath = path.join(app.getPath('userData'), `smoke-${name}.flac`);
      await fs.writeFile(flacPath, bytes);
      await parseFilePaths([flacPath]);
      const flacResult = await mainWindow.webContents.executeJavaScript(`
        (async () => {
          const p = ${JSON.stringify(flacPath)};
          const res = await window.electronAPI.writeTag(p, {
            title: 'Flac Title', artist: 'Flac Artist', album: 'Flac Album', albumArtist: 'AA',
            year: '2022', genre: 'G', trackNumber: '2', trackTotal: '8', discNumber: '', discTotal: '',
            composer: '', comment: '', bpm: '', lyrics: 'flac lyrics'
          });
          const [t] = await window.electronAPI.parseFiles([p]);
          return { ok: res === true || res?.success === true, title: t?.title, artist: t?.artist, year: t?.year, lyrics: t?.lyrics, albumArtist: t?.albumArtist };
        })()
      `, true);
      check(flacResult.ok, `FLAC writeTag succeeded (${name})`);
      check(flacResult.title === 'Flac Title' && flacResult.artist === 'Flac Artist', `FLAC tags round-trip (${name}: ${flacResult.title}/${flacResult.artist})`);
      check(String(flacResult.year) === '2022', `FLAC year round-trips (${name}: ${flacResult.year})`);
      check(flacResult.lyrics === 'flac lyrics', `FLAC lyrics round-trip (${name})`);
      check(flacResult.albumArtist === 'AA', `FLAC albumArtist round-trips (${name})`);
      // The writer must emit a clean file starting at fLaC (ID3 prefix dropped).
      const written = await fs.readFile(flacPath);
      check(written.slice(0, 4).toString('ascii') === 'fLaC', `saved FLAC starts with fLaC marker (${name})`);
      await fs.rm(flacPath, { force: true });
    }
  } catch (err) {
    failures.push(`WAV/FLAC round-trip error: ${err.stack || err}`);
  }

  // ── Background reindex: drop the index entry, reload, verify it heals ─────
  try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    await fs.writeFile(
      path.join(app.getPath('userData'), 'library.json'),
      JSON.stringify({ trackPaths: [fixture], currentTrackPath: null, currentTime: 0 })
    );
    getStore().removeEntries([fixture]); // simulate missing/stale index (migration)

    const loadResult = await mainWindow.webContents.executeJavaScript(
      `window.electronAPI.loadLibraryState()`, true
    );
    check(loadResult.tracks.length === 1, 'instant load returns a row for unindexed path');
    check(loadResult.tracks[0].pending === true, 'unindexed path served as placeholder');
    check(typeof loadResult.tracks[0].title === 'string' && loadResult.tracks[0].title.length > 0, 'placeholder has a display title');

    // background verify should re-parse and heal the index
    await new Promise(r => setTimeout(r, 2500));
    const healed = getStore().getEntry(fixture);
    check(!!healed && typeof healed.mtimeMs === 'number', 'background verify re-indexed the stale path');
    check(typeof healed?.dateAdded === 'number' && healed.dateAdded > 0, 'reindex set dateAdded (birthtime mode)');
  } catch (err) {
    failures.push(`reindex pipeline error: ${err.stack || err}`);
  }

  // ── File-open launch: arbitration in library:load + replace semantics ─────
  // Cold-launch arbitration is exercised against loadLibraryState directly: in
  // a real cold launch the renderer isn't ready when the batch settles, which
  // is precisely what lets library:load win the batch. Smoke runs with a fully
  // loaded renderer, so driving it over IPC would test the warm path instead.
  // The warm path is covered separately, below, through the renderer.
  try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const udir = app.getPath('userData');
    // Real, parseable copies whose names sort differently from the order the
    // batch is handed to us in.
    const copyC = path.join(udir, 'open-c.mp3');
    const copyA = path.join(udir, 'open-a.mp3');
    const copyB = path.join(udir, 'open-b.mp3');
    const copyD = path.join(udir, 'open-d.mp3');
    const sessionFile = path.join(udir, 'open-session.mp3');
    for (const p of [copyC, copyA, copyB, copyD, sessionFile]) await fs.copyFile(fixture, p);
    const SERVICE_FLAG = 'service-action.flag';

    // A saved session that a file-open launch must beat, and a Services launch
    // must fall back to. Indexed up front so the restore path can be checked
    // for *real* metadata rather than placeholders (see below).
    await parseFilePaths([sessionFile]);
    // Re-seeded before every case that reads it: the renderer's own debounced
    // library:save overwrites library.json whenever its library changes, which
    // several cases below deliberately do. Writing it once up front leaves the
    // later cases racing that save.
    //
    // Re-seeding alone is still not enough. App.jsx debounces that save by
    // 500ms, so a mutation from the previous case can be sitting in flight and
    // land *after* the seed, clobbering it - the read then returns the wrong
    // library. It cost an intermittent "unreadable open falls back to the saved
    // session" failure under Rosetta. Waiting out the debounce window first
    // means the file we write is the last word.
    const SAVE_DEBOUNCE_MS = 500; // must match App.jsx's library:save debounce
    const seedSession = async () => {
      await sleep(SAVE_DEBOUNCE_MS + 250);
      await fs.writeFile(
        path.join(udir, 'library.json'),
        JSON.stringify({ trackPaths: [sessionFile], currentTrackPath: sessionFile, currentTime: 42 })
      );
    };
    await seedSession();

    // 1. Double-click cold launch: the opened file wins outright.
    seedOpenFileBatch([copyC]);
    const opened = await loadLibraryState();
    check(opened.tracks.length === 1, `file-open launch returns only the opened file (${opened.tracks.length})`);
    check(opened.tracks[0]?.filePath === copyC, 'file-open launch discards the saved session');
    check(opened.autoPlay === true, 'file-open launch flags autoPlay');
    check(opened.currentTime === 0, 'file-open launch ignores the saved resume position');
    check(opened.failedOpenCount === 0, 'file-open launch reports no failures');

    // 2. Multi-file selection: sorted by file name, first one becomes current.
    seedOpenFileBatch([copyC, copyA, copyB]);
    const multi = await loadLibraryState();
    const order = multi.tracks.map(t => path.basename(t.filePath)).join(',');
    check(order === 'open-a.mp3,open-b.mp3,open-c.mp3', `multi-file batch sorted by name (${order})`);
    check(multi.currentTrackPath === copyA, 'first track by name becomes current');

    // 3. A Services invocation is NOT a file-open launch: the saved session
    //    restores, paused at its position, and the batch is left for the flush.
    await seedSession();
    await fs.writeFile(path.join(udir, 'service-action.flag'), 'add-to-queue');
    seedOpenFileBatch([copyC]);
    const svc = await loadLibraryState();
    check(svc.tracks[0]?.filePath === sessionFile, 'Services launch restores the saved session');
    check(svc.autoPlay === false, 'Services launch does not autoplay');
    check(svc.currentTime === 42, `Services launch keeps the saved position (${svc.currentTime})`);
    // The restore must come from the index, not be a placeholder. This is the
    // observable symptom of the store being read before it finished loading
    // (see ensureStoreLoaded in main.js): every path looks unknown, so the whole
    // library comes back pending and triggers a spurious full reindex.
    check(svc.tracks[0]?.pending !== true, 'session restore serves indexed metadata, not a placeholder');
    check(typeof svc.tracks[0]?.duration === 'number' && svc.tracks[0].duration > 0,
      `restored track carries real metadata (duration ${svc.tracks[0]?.duration})`);
    // That batch was deliberately left unconsumed, so loadLibraryState's
    // hand-back must now deliver it to the renderer as a service-add-to-queue -
    // a Services launch that queued nothing would be a silent dead end. (Also
    // has to land before the replace cases below, or it appends mid-test.)
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setLibrary([])`, true);
    await sleep(700);
    const afterService = await mainWindow.webContents.executeJavaScript(
      `window.__sonusTest.getLibrary().map(t => t.filePath)`, true
    );
    check(afterService.length === 1 && afterService[0] === copyC,
      `Services batch still delivered after the session load (${afterService.length})`);

    // 4. Unreadable files must never leave the user with an empty library.
    await seedSession();
    seedOpenFileBatch([path.join(udir, 'no-such-file.mp3')]);
    const failedOpen = await loadLibraryState();
    check(failedOpen.tracks[0]?.filePath === sessionFile, 'unreadable open falls back to the saved session');
    check(failedOpen.failedOpenCount === 1, `failure count reported (${failedOpen.failedOpenCount})`);
    check(failedOpen.autoPlay === false, 'failed open does not autoplay');

    // 5. Warm double-click, through the renderer: replaces the library, clears
    //    the detail view, and lands on Library.
    await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        window.__sonusTest.setLibrary([
          { title: 'Old A', artist: 'Artist 1', album: 'Old', year: 2000, duration: 100, thumb: null, lyrics: null, filePath: '/old/a.mp3', playCount: 0, lastPlayed: null, dateAdded: 1 },
          { title: 'Old B', artist: 'Artist 1', album: 'Old', year: 2000, duration: 100, thumb: null, lyrics: null, filePath: '/old/b.mp3', playCount: 0, lastPlayed: null, dateAdded: 2 },
          { title: 'Old C', artist: 'Artist 2', album: 'Old', year: 2000, duration: 100, thumb: null, lyrics: null, filePath: '/old/c.mp3', playCount: 0, lastPlayed: null, dateAdded: 3 }
        ]);
        await sleep(150);
        window.__sonusTest.openDetail({ type: 'artist', key: 'Artist 1' });
        await sleep(250);
        return true;
      })()
    `, true);

    mainWindow.webContents.send('open-external-file', { tracks: multi.tracks, failedCount: 0 });
    await sleep(500);

    const afterWarm = await mainWindow.webContents.executeJavaScript(`
      (() => ({
        count: window.__sonusTest.getLibrary().length,
        first: window.__sonusTest.getLibrary()[0]?.filePath,
        view: window.__sonusTest.getView(),
        hasActiveRow: !!document.querySelector('.track-row.active'),
      }))()
    `, true);
    check(afterWarm.count === 3, `warm open replaces the library (${afterWarm.count} tracks)`);
    check(afterWarm.first === copyA, 'warm open library is the opened batch, name-sorted');
    check(afterWarm.view === 'library', `warm open leaves a detail view for Library (${afterWarm.view})`);
    check(afterWarm.hasActiveRow, 'warm open marks the new first track as current');

    // 6. Now Playing is the one screen that stays put across a replace.
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setView('now_playing')`, true);
    await sleep(150);
    mainWindow.webContents.send('open-external-file', { tracks: [multi.tracks[2]], failedCount: 0 });
    // Wait for the replace to actually land rather than assuming it fits in
    // 400ms. On timeout the last value is returned unchanged, so the checks
    // below still run and still fail - only the timing assumption is gone.
    const afterNp = await waitFor(
      `(() => ({ view: window.__sonusTest.getView(), count: window.__sonusTest.getLibrary().length }))()`,
      (s) => s?.count === 1,
    );
    check(afterNp.view === 'now_playing', `Now Playing survives a replace (${afterNp.view})`);
    check(afterNp.count === 1, `replace still happened while in Now Playing (${afterNp.count})`);

    // 7. A warm open where everything failed must not wipe the library.
    mainWindow.webContents.send('open-external-file', { tracks: [], failedCount: 2 });
    await sleep(400);
    const afterFail = await mainWindow.webContents.executeJavaScript(`
      (() => ({ count: window.__sonusTest.getLibrary().length }))()
    `, true);
    check(afterFail.count === 1, `failed warm open leaves the library intact (${afterFail.count})`);

    // 8. Services actions, delivered through the real flag → flush → renderer
    //    path. Start from a known 3-track library whose *first* track is the
    //    current one, so "play next" has an unambiguous insertion point.
    mainWindow.webContents.send('open-external-file', { tracks: multi.tracks, failedCount: 0 });
    await sleep(500);

    const serviceCases = [
      { flag: SERVICE_FLAG, action: 'add-to-queue', file: copyD, expectIndex: 3, label: 'add-to-queue appends' },
      { flag: SERVICE_FLAG, action: 'play-next', file: copyD, expectIndex: 1, label: 'play-next inserts after the current track' },
      // The pre-2.0 bundle's flag must still mean add-to-queue: an old bundle
      // survives until the first packaged launch updates it, and falling
      // through to the file-open path would replace the user's library.
      { flag: 'service-add-to-queue.flag', action: '', file: copyD, expectIndex: 3, label: 'legacy flag still means add-to-queue' },
    ];

    for (const tc of serviceCases) {
      // Reset to the same 3-track baseline before each case.
      mainWindow.webContents.send('open-external-file', { tracks: multi.tracks, failedCount: 0 });
      await sleep(400);
      await fs.writeFile(path.join(udir, tc.flag), tc.action);
      seedOpenFileBatch([tc.file]);
      await loadLibraryState();
      await sleep(700);
      const state = await mainWindow.webContents.executeJavaScript(
        `({ lib: window.__sonusTest.getLibrary().map(t => t.filePath), view: window.__sonusTest.getView() })`, true
      );
      check(state.lib.length === 4, `${tc.label}: one track added (${state.lib.length})`);
      check(state.lib[tc.expectIndex] === copyD, `${tc.label} (index ${state.lib.indexOf(copyD)})`);
      check(state.lib[0] === copyA, `${tc.label}: current track stays first`);
    }

    // 9. A Service handing over tracks already in the library is a no-op.
    await fs.writeFile(path.join(udir, SERVICE_FLAG), 'add-to-queue');
    seedOpenFileBatch([copyD]);
    await loadLibraryState();
    await sleep(700);
    const dupState = await mainWindow.webContents.executeJavaScript(
      `window.__sonusTest.getLibrary().length`, true
    );
    check(dupState === 4, `duplicate Services add is a no-op (${dupState})`);

    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setView('library'); window.__sonusTest.setLibrary([]);`, true);
    await sleep(150);
  } catch (err) {
    failures.push(`file-open launch error: ${err.stack || err}`);
  }

  // ── Re-opening the already-loaded file restarts it ───────────────────────
  // Regression guard for a real bug: <audio>'s src is derived from the track's
  // path, so re-opening the file that is already loaded produces an IDENTICAL
  // src. React then makes no DOM change, autoPlay never re-fires, and the
  // element just sits where it was — paused, mid-track. The suite previously
  // only ever opened *different* files, which is why this went unnoticed.
  //
  // Asserts currentTime rewinding to 0, deliberately not "is audible": Chromium
  // blocks unmuted autoplay without a user gesture, so asserting real playback
  // would be flaky for reasons unrelated to this bug.
  try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const [track] = await parseFilePaths([fixture]);

    mainWindow.webContents.send('open-external-file', { tracks: [track], failedCount: 0 });
    await sleep(900);

    const before = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const a = document.querySelector('audio');
        if (!a) return { noAudio: true };
        // Decoding a 13MB MP3 far enough to expose a seekable duration takes
        // longer on slower hardware; the old flat 2s cap expired first under
        // Rosetta and reported readyState 0. Poll for the real condition.
        for (let i = 0; i < 200 && a.readyState < 1; i++) await sleep(50);
        a.pause();
        a.currentTime = 5;
        // currentTime is applied asynchronously - wait for the seek to take
        // rather than assuming 200ms is always enough.
        for (let i = 0; i < 60 && a.currentTime < 4; i++) await sleep(50);
        return { src: a.src, currentTime: a.currentTime, paused: a.paused, readyState: a.readyState };
      })()
    `, true);

    // The reported action: double-click the same file again in Finder.
    mainWindow.webContents.send('open-external-file', { tracks: [track], failedCount: 0 });

    // The rewind is the behaviour under test, so poll for it rather than
    // sampling once after a fixed 900ms and hoping the restart already ran.
    const after = await waitFor(
      `(() => {
        const a = document.querySelector('audio');
        return a ? { currentTime: a.currentTime, src: a.src } : { noAudio: true };
      })()`,
      (s) => s && !s.noAudio && s.currentTime < 1,
    );

    check(!before.noAudio && !after.noAudio, 'audio element present across the re-open');
    check(before.readyState >= 1, `fixture loaded far enough to seek (readyState ${before.readyState})`);
    check(before.currentTime >= 4, `seek to 5s took effect before re-opening (${before.currentTime})`);
    check(after.src === before.src, 'still the same file after re-opening it');
    check(after.currentTime < 1, `re-opening the loaded file rewinds it to the start (${after.currentTime})`);

    // Same root cause, second route: double-clicking the row of the track that
    // is already loaded also lands in playTrack with an unchanged src.
    const viaRow = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const a = document.querySelector('audio');
        const row = document.querySelector('.track-row');
        if (!a || !row) return { missing: true };
        a.pause();
        a.currentTime = 7;
        for (let i = 0; i < 60 && a.currentTime < 6; i++) await sleep(50);
        const seeded = a.currentTime;
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        // Poll for the restart instead of a flat 600ms.
        for (let i = 0; i < 100 && a.currentTime >= 1; i++) await sleep(50);
        return { seeded, currentTime: a.currentTime };
      })()
    `, true);
    check(!viaRow.missing, 'row present for the in-app double-click test');
    check(viaRow.seeded >= 6, `seek to 7s took effect before the row double-click (${viaRow.seeded})`);
    check(viaRow.currentTime < 1, `double-clicking the loaded track's row restarts it (${viaRow.currentTime})`);

    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setLibrary([])`, true);
    await sleep(200);
  } catch (err) {
    failures.push(`re-open same file error: ${err.stack || err}`);
  }

  // ── Tag Editor opens centred on its display ──────────────────────────────
  // The window is created at a 720px fallback height and only resized once the
  // renderer reports the form's real height. setContentSize pins the top-left
  // corner, so without an explicit re-position the window's centre slides by
  // half the height difference — measured at ~67px too low for a tall form,
  // and too high for a short one.
  try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const [track] = await parseFilePaths([fixture]);
    openTagEditor(track);

    let win = null;
    for (let i = 0; i < 50; i++) {
      await sleep(150);
      const w = getTagEditorWindow();
      if (w && !w.isDestroyed() && w.isVisible()) { win = w; break; }
    }

    if (!win) {
      failures.push('tag editor window never became visible');
    } else {
      await sleep(500); // let the fit-to-content resize settle
      const b = win.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      const dx = (b.x + b.width / 2) - (wa.x + wa.width / 2);
      const dy = (b.y + b.height / 2) - (wa.y + wa.height / 2);
      check(Math.abs(dx) <= 2, `tag editor horizontally centred (off by ${Math.round(dx)}px)`);
      check(Math.abs(dy) <= 2, `tag editor vertically centred (off by ${Math.round(dy)}px)`);
      check(b.width === 960, `tag editor keeps its fixed 960 width (${b.width})`);
      check(b.y >= wa.y && b.y + b.height <= wa.y + wa.height,
        `tag editor sits fully inside the work area (y ${b.y}, h ${b.height}, wa ${wa.y}..${wa.y + wa.height})`);

      // Search Online results: an overlay, not part of the form. Driven through
      // the ?test=1 hook so the suite never calls iTunes/MusicBrainz.
      const heightBeforePopup = win.getBounds().height;
      const popup = await win.webContents.executeJavaScript(`
        (async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          if (!window.__sonusTagEditorTest) return { noHook: true };
          const formBefore = document.querySelector('.scrollable').scrollHeight;
          // 40 distinct songs, each one duplicated: only 10 should survive, and
          // they must be the first 10 — proving dedupe runs BEFORE the cap.
          const rows = [];
          for (let i = 0; i < 40; i++) {
            const row = { title: 'Song ' + i, artist: 'A', album: 'Al', year: String(2000 + i), source: 'iTunes', artworkUrl: null };
            rows.push(row, { ...row });
          }
          window.__sonusTagEditorTest.openSearchResults(rows);
          await sleep(450);
          const backdrop = document.querySelector('.tag-search-backdrop');
          if (!backdrop) return { noBackdrop: true };
          const cs = getComputedStyle(backdrop);
          const out = {
            cardCount: [...backdrop.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Use this').length,
            text: backdrop.textContent,
            appRegion: cs.getPropertyValue('-webkit-app-region') || backdrop.style.webkitAppRegion || '',
            insideForm: !!backdrop.closest('.scrollable'),
            formBefore,
            formAfter: document.querySelector('.scrollable').scrollHeight,
          };
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(350);
          out.closedByEscape = !document.querySelector('.tag-search-backdrop');
          return out;
        })()
      `, true);

      if (popup.noHook) failures.push('tag editor test hook (?test=1) not present');
      else if (popup.noBackdrop) failures.push('search results popup did not open');
      else {
        check(popup.insideForm === false, 'results popup renders outside the scrolling form');
        check(win.getBounds().height === heightBeforePopup,
          `window does not resize when results open (${heightBeforePopup} → ${win.getBounds().height})`);
        check(popup.formAfter === popup.formBefore,
          `results no longer inflate the form's height (${popup.formBefore} → ${popup.formAfter})`);
        // The silent trap: without no-drag the panel background drags the window.
        check(popup.appRegion === 'no-drag', `results popup opts out of the window drag region (${popup.appRegion || 'unset'})`);
        check(popup.cardCount === 10, `10 results shown from a 40-duplicated-to-80 pool (${popup.cardCount})`);
        check(popup.text.includes('10 results found'), 'header reports the de-duplicated count');
        check(popup.text.includes('Song 0') && popup.text.includes('Song 9') && !popup.text.includes('Song 10'),
          'the 10 shown are the first 10, in relevance order');
        check(popup.closedByEscape === true, 'Escape closes the results popup');
      }

      win.destroy();
      await sleep(400);

      // The shorter layout: a format with no Lyrics column (only MP3/FLAC/WAV
      // get one). A synthetic track is enough — the editor is handed the whole
      // object over IPC and only reads the extension to decide. Also re-checks
      // that a *fresh* window centres, not just the first one of the run.
      openTagEditor({ ...track, filePath: '/synthetic/no-lyrics-column.m4a', lyrics: null });
      let win2 = null;
      for (let i = 0; i < 50; i++) {
        await sleep(150);
        const w = getTagEditorWindow();
        if (w && !w.isDestroyed() && w.isVisible()) { win2 = w; break; }
      }
      if (!win2) {
        failures.push('tag editor did not reopen for the no-lyrics layout');
      } else {
        await sleep(500);
        const b2 = win2.getBounds();
        const wa2 = screen.getDisplayMatching(b2).workArea;
        const dy2 = (b2.y + b2.height / 2) - (wa2.y + wa2.height / 2);
        check(Math.abs(dy2) <= 2, `no-lyrics-column layout also centred (off by ${Math.round(dy2)}px)`);
        win2.destroy();
        await sleep(300);
      }
    }
  } catch (err) {
    failures.push(`tag editor centring error: ${err.stack || err}`);
  }

  // ── Scale bench: 20k tracks — bounded DOM, fast sort, live scroll window ──
  try {
    const benchResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        if (!window.__sonusTest) { out.noHook = true; return out; }
        window.__sonusTest.setView('library');

        const N = 20000;
        const tracks = new Array(N);
        for (let i = 0; i < N; i++) {
          tracks[i] = {
            title: 'Bench ' + String(i).padStart(5, '0'), artist: 'Artist ' + (i % 500),
            album: 'Album ' + (i % 2000), albumArtist: '', year: 1960 + (i % 66),
            duration: 90 + (i % 400), genre: '', thumb: null, lyrics: null,
            trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
            composer: '', comment: '', bpm: '', bitrate: 256, codecProfile: null,
            dateAdded: 1600000000000 + i, playCount: (i * 7) % 100, lastPlayed: null,
            filePath: '/bench/t' + i + '.mp3',
          };
        }
        const t0 = performance.now();
        window.__sonusTest.setLibrary(tracks);
        await sleep(600);
        out.injectMs = performance.now() - t0;
        out.rowCount = document.querySelectorAll('.track-row').length;

        // canDrag must be gated off above 5k — leading cell shows index, not grip
        out.hasGrip = !!document.querySelector('.track-row svg.lucide-grip-vertical');

        // sort 20k by title (click header) and time it
        const t1 = performance.now();
        document.querySelectorAll('.track-header-label')[0]?.click();
        await sleep(500);
        out.sortMs = performance.now() - t1 - 500;
        const firstTitle = document.querySelector('.track-row')?.children[2]?.children[0]?.textContent;
        out.sortedFirst = firstTitle;
        out.rowCountAfterSort = document.querySelectorAll('.track-row').length;

        // deep programmatic scroll: window must move, stay bounded
        const scrollEl = document.querySelector('.scrollable');
        scrollEl.scrollTop = 400000;
        await sleep(400);
        out.rowCountDeep = document.querySelectorAll('.track-row').length;
        out.deepFirst = document.querySelector('.track-row')?.children[2]?.children[0]?.textContent;

        // Walk the rest of the Title cycle back to manual, then clean up.
        for (let i = 0; i < 4; i++) {
          document.querySelectorAll('.track-header-label')[0]?.click();
          await sleep(200);
        }
        window.__sonusTest.setLibrary([]);
        await sleep(100);
        return out;
      })()
    `, true);

    if (!benchResult.noHook) {
      check(benchResult.rowCount > 0 && benchResult.rowCount < 80, `20k: mounted rows bounded (${benchResult.rowCount})`);
      check(benchResult.rowCountAfterSort < 80, `20k: bounded after sort (${benchResult.rowCountAfterSort})`);
      check(benchResult.rowCountDeep < 80, `20k: bounded after deep scroll (${benchResult.rowCountDeep})`);
      check(!benchResult.hasGrip, '20k: drag gated off (no grip handles)');
      check(benchResult.sortedFirst === 'Bench 00000', `20k: title sort correct (${benchResult.sortedFirst})`);
      check(benchResult.deepFirst !== benchResult.sortedFirst, `20k: scroll window actually moved (${benchResult.deepFirst})`);
      metrics.bench20k = {
        injectMs: Math.round(benchResult.injectMs),
        sortMs: Math.round(benchResult.sortMs),
        mountedRows: benchResult.rowCount,
      };
      // This budget was suspected of being an Apple-Silicon assumption that
      // would false-fail on a 2017 Intel iMac. Measuring it settled the
      // question: sortMs is ~1ms, because only the ~21 mounted rows re-render,
      // not all 20,000. The 1500ms ceiling therefore has three orders of
      // magnitude of headroom and is in no danger on slow hardware — it stays
      // tight, because what it exists to catch (virtualization lost, all 20k
      // rows re-rendered) costs seconds and a loose ceiling would let a real
      // regression through. The measured value is recorded above regardless.
      check(benchResult.sortMs < 1500, `20k: sort re-render under budget (${Math.round(benchResult.sortMs)}ms)`);
    }
  } catch (err) {
    failures.push(`scale bench error: ${err.stack || err}`);
  }

  // ── Compositor cost of the glass UI (measured, deliberately not asserted) ──
  // Sonus's whole look is GPU blur: .glass-panel blur(30px), the player panel
  // and Now Playing backdrop at blur(40px), and — the expensive one — three
  // independently animated circles inside a blur(100px) container behind the
  // artwork. On Apple Silicon that is free. On a 2017 Intel iMac (Iris Plus 640
  // or a Radeon Pro pushing a 5K panel) it may not be, and "does it feel
  // smooth?" is not something a screenshot or an opinion can answer.
  //
  // Two windows are sampled so the result is comparable ACROSS machines with
  // different refresh rates: a baseline in Library (no overlay, no furnace) and
  // Now Playing with the furnace running. A 120Hz ProMotion Mac idles at
  // ~8.3ms and a 60Hz iMac at ~16.7ms, so the absolute p50 means little on its
  // own — the ratio between the two windows is the signal.
  //
  // Reported as metrics, never asserted: the correct threshold for "too slow"
  // is a judgement call, and a hard limit here would turn slow-but-working
  // hardware into a red build and mask real failures. The only assertion is
  // that the measurement actually ran.
  try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const [track] = await parseFilePaths([fixture]);
    mainWindow.webContents.send('open-external-file', { tracks: [track], failedCount: 0 });
    await sleep(1200);

    const frame = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        if (!window.__sonusTest) { out.noHook = true; return out; }

        // Collect raw requestAnimationFrame deltas for a fixed wall-clock window.
        const sampleFrames = (ms) => new Promise(resolve => {
          const deltas = [];
          let last = performance.now();
          const start = last;
          const tick = (now) => {
            deltas.push(now - last);
            last = now;
            if (now - start < ms) requestAnimationFrame(tick);
            // Drop the first few: the frame a view switch lands on includes
            // layout and first paint, which is startup cost, not steady state.
            else resolve(deltas.slice(3));
          };
          requestAnimationFrame(tick);
        });
        const pctl = (arr, p) => {
          if (!arr.length) return null;
          const s = [...arr].sort((a, b) => a - b);
          return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
        };
        const summarize = (d) => ({
          frames: d.length,
          p50: pctl(d, 0.5),
          p95: pctl(d, 0.95),
          max: d.length ? Math.round(Math.max(...d) * 10) / 10 : null,
          // At 60Hz a frame over 20ms was dropped; a useful count on any display.
          janky: d.filter(x => x > 20).length,
        });

        // ── Baseline: Library, no overlay, no furnace ──
        window.__sonusTest.setView('library');
        await sleep(700);
        out.baseline = summarize(await sampleFrames(1500));

        // ── Stress: Now Playing with the furnace live ──
        // The flares render only when artworkRgb resolved (fast-average-color
        // over the thumbnail) AND isPlaying is true — they are opacity 0 and
        // animation-paused otherwise, so measuring a paused player would
        // measure nothing. Muted playback is used deliberately: Chromium allows
        // it with no user gesture, and the compositing work is identical.
        const a = document.querySelector('audio');
        if (a) { a.muted = true; try { await a.play(); } catch { /* policy */ } }
        window.__sonusTest.setView('now_playing');

        const flareCount = () => [...document.querySelectorAll('div')]
          .filter(el => (getComputedStyle(el).animationName || '').includes('np-flare')).length;
        // Poll for the furnace to actually exist rather than trusting a delay.
        for (let i = 0; i < 120 && flareCount() === 0; i++) await sleep(50);
        out.flares = flareCount();
        out.playing = a ? !a.paused : false;
        out.artworkPresent = !!document.querySelector('.np-artwork');
        // The furnace wrapper fades in over 1.5s; measure the settled state.
        await sleep(1700);
        out.nowPlaying = summarize(await sampleFrames(2500));

        if (a) { a.pause(); a.muted = false; }
        window.__sonusTest.setView('library');
        window.__sonusTest.setLibrary([]);
        await sleep(150);
        return out;
      })()
    `, true);

    if (!frame.noHook) {
      metrics.frameTimeMs = {
        baseline: frame.baseline,
        nowPlaying: frame.nowPlaying,
        flares: frame.flares,
        playing: frame.playing,
        // How much the glass UI costs over an ordinary list view. ~1.0 means
        // the furnace is free; a large ratio is the number to act on.
        npCostRatio: frame.baseline?.p50 && frame.nowPlaying?.p50
          ? Math.round((frame.nowPlaying.p50 / frame.baseline.p50) * 100) / 100
          : null,
      };
      // Sanity only — proves the probe ran, asserts nothing about speed.
      check((frame.baseline?.frames ?? 0) > 20 && (frame.nowPlaying?.frames ?? 0) > 20,
        `frame-time probe collected samples (baseline ${frame.baseline?.frames}, NP ${frame.nowPlaying?.frames})`);
      // If the furnace never rendered, the NP number is measuring an empty
      // panel and must not be mistaken for a clean bill of health.
      check(frame.flares === 3 && frame.playing === true,
        `frame-time probe actually stressed the blur furnace (flares ${frame.flares}, playing ${frame.playing})`);
    }
  } catch (err) {
    failures.push(`frame-time probe error: ${err.stack || err}`);
  }

  // Renderer console errors are failures (ignore benign autoplay policy noise).
  const realErrors = consoleErrors.filter(m => !/Autoplay|play\(\) failed|user didn't interact/i.test(m));
  if (realErrors.length > 0) failures.push(`renderer console errors: ${realErrors.join(' | ')}`);

  console.log('SMOKE_RESULT:' + JSON.stringify({ ok: failures.length === 0, failures, metrics, ...envInfo() }));
  app.exit(failures.length === 0 ? 0 : 1);
}
