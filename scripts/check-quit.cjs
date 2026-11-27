// A real quit test, which the smoke suite can't do (quitting ends its run): launches the built
// app on a throwaway profile, quits it ONCE the way Cmd+Q does (the standard terminate request,
// sent to that one process, so a Sonus you have open is never touched), and checks that it really
// exited and that what it saved brings it back the same way.
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/check-quit.cjs [path/to/Sonus.app]
//
// (Run through Electron as Node: it needs a WebSocket, which the system Node lacks.) Cases:
//   1. a visible window (the mini player): exits on one Quit, keeps its size;
//   2. the main window hidden (closed with the red button / Cmd+W): exits on one Quit;
//   3. Strip mode: exits on one Quit, and reopens as the strip.
// Prints one CHECK_QUIT_RESULT:{...} line and exits 0/1. Needs Swift (Xcode's command line tools)
// to list on-screen windows.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appPath = path.resolve(process.argv[2] || 'release/mac-universal/Sonus.app');
const binary = path.join(appPath, 'Contents', 'MacOS', 'Sonus');
if (!fs.existsSync(binary)) { console.error(`No app at ${appPath}`); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

const display = { x: 0, y: 0, width: 4000, height: 4000 }; // only x/y/width/height must land on a display
const windowState = (w, h) => JSON.stringify({ width: w, height: h, x: 200, y: 200, displayBounds: display, isMaximized: false, isFullScreen: false });

// On-screen windows of one process: [{ x, y, w, h, layer }].
function windowsOf(pid) {
  const src = `import CoreGraphics; let l = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]; for w in l where (w["kCGWindowOwnerPID"] as? Int) == ${pid} { let b = w["kCGWindowBounds"] as! [String: Any]; print(b["X"]!, b["Y"]!, b["Width"]!, b["Height"]!, w["kCGWindowLayer"]!) }`;
  return execFileSync('swift', ['-e', src]).toString().trim().split('\n').filter(Boolean)
    .map((l) => { const [x, y, w, h, layer] = l.split(/\s+/).map(Number); return { x, y, w, h, layer }; });
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const quit = (pid) => execFileSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).terminate; 0`]);
async function waitExit(pid, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (!alive(pid)) return true; await sleep(200); }
  return false;
}
function launch(profile, extra = []) {
  // (without ELECTRON_RUN_AS_NODE, which runs this script: inherited, it would start Sonus as Node)
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, [`--user-data-dir=${profile}`, ...extra], { stdio: 'ignore', detached: true, env });
  child.unref();
  return child.pid;
}
// Asks the main page (over the remote-debugging port) to close its window, as the red button does.
async function closeMainWindow(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('strip=1') && !t.url.includes('editor=1'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'window.close(); 0' } }));
  await sleep(500);
  ws.close();
}
const newProfile = (name) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sonus-quit-${name}-`)); return dir; };
const kill = (pid) => { if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } };

(async () => {
  const profiles = [];
  try {
    // 1. a visible mini player
    {
      const p = newProfile('visible'); profiles.push(p);
      fs.writeFileSync(path.join(p, 'window-state.json'), windowState(420, 260));
      const pid = launch(p);
      await sleep(6000);
      const wins = windowsOf(pid);
      check(wins.some((w) => w.w === 420 && w.h === 260), `visible: the mini player opens at its saved size (${JSON.stringify(wins)})`);
      quit(pid);
      check(await waitExit(pid), 'visible: one Quit exits the app');
      kill(pid);
      const st = JSON.parse(fs.readFileSync(path.join(p, 'window-state.json'), 'utf8'));
      check(st.width === 420 && st.height === 260, `visible: the size is kept (${st.width}x${st.height})`);
    }
    // 2. the main window closed (hidden), then Quit
    {
      const p = newProfile('hidden'); profiles.push(p);
      fs.writeFileSync(path.join(p, 'window-state.json'), windowState(420, 260));
      const port = 9400 + Math.floor(Math.random() * 400);
      const pid = launch(p, [`--remote-debugging-port=${port}`]);
      await sleep(6000);
      await closeMainWindow(port);
      await sleep(800);
      check(alive(pid) && windowsOf(pid).length === 0, `hidden: closing the window hides it, the app keeps running (alive ${alive(pid)})`);
      quit(pid);
      check(await waitExit(pid), 'hidden: one Quit exits the app');
      kill(pid);
    }
    // 3. Strip mode
    {
      const p = newProfile('strip'); profiles.push(p);
      fs.writeFileSync(path.join(p, 'window-state.json'), windowState(420, 260));
      fs.writeFileSync(path.join(p, 'session.json'), JSON.stringify({ stripOpen: true }));
      let pid = launch(p);
      await sleep(6000);
      let wins = windowsOf(pid);
      check(wins.length === 1 && wins[0].layer > 0 && wins[0].h < 100, `strip: it opens as the strip, nothing else on screen (${JSON.stringify(wins)})`);
      quit(pid);
      check(await waitExit(pid), 'strip: one Quit exits the app (it used to need two)');
      kill(pid);
      let saved = {};
      try { saved = JSON.parse(fs.readFileSync(path.join(p, 'session.json'), 'utf8')); } catch { /* checked below */ }
      check(saved.stripOpen === true, `strip: quitting remembers the strip was open (saved ${saved.stripOpen})`);
      pid = launch(p);
      await sleep(6000);
      wins = windowsOf(pid);
      check(wins.length === 1 && wins[0].layer > 0 && wins[0].h < 100, `strip: reopened, it is the strip again (${JSON.stringify(wins)})`);
      quit(pid);
      check(await waitExit(pid), 'strip: and quits once again');
      kill(pid);
      const st = JSON.parse(fs.readFileSync(path.join(p, 'window-state.json'), 'utf8'));
      check(st.width === 420 && st.height === 260, `strip: the window behind it keeps its size (${st.width}x${st.height})`);
    }
  } catch (err) {
    failures.push(`error: ${err.stack || err}`);
  } finally {
    for (const p of profiles) fs.rmSync(p, { recursive: true, force: true });
  }
  console.log('CHECK_QUIT_RESULT:' + JSON.stringify({ ok: failures.length === 0, failures }));
  process.exit(failures.length === 0 ? 0 : 1);
})();
