import { useEffect, useRef } from 'react';
import { quadMatrix3d } from './chillGeometry.js';
import { LAPTOP_SCREEN_QUAD, LAPTOP_LOCAL_W, LAPTOP_LOCAL_H } from './chillRoom.js';
import { pageParagraphs } from './chillLyrics.js';
import { isRTL } from './audioUtils.js';

const LAPTOP_TRANSFORM = quadMatrix3d(LAPTOP_LOCAL_W, LAPTOP_LOCAL_H, LAPTOP_SCREEN_QUAD);
// Supersampling: the screen is ~275 photo px wide and the page text is small, so the canvas is drawn at
// 2x and the browser downsamples it through the perspective transform (a 1x bitmap blurs the text).
const SS = 2;

// When the playing track has lyrics (`values.lyric`, from chillRoomFx.js) the page shows THEM, as
// real text typed one line at a time — wrapped to the page, right-to-left lyrics typed from the
// right edge — and clears and starts again when the lyrics are done. Without lyrics it is the
// generic grey text below, exactly as before.
//
// The laptop's screen, redrawn live over the photo's own (a word processor whose text is
// garbled): a window with a white page of text that GROWS while she types — the caret at
// the end of the line, the line filling, a new line, the page scrolling — and holds still
// while she has stopped, the caret blinking. Drawn on a 2D canvas in a 480x330 local space
// and mapped onto the display's quadrilateral by a homography, like the phone in the
// hammock scene. The engine's per-frame values ({ chars, env }) come in through `apiRef`
// (ChillRoom wires it to the engine's onFrame), and it redraws only when something changed.
const PAGE = { x: 96, y: 50, w: 288, h: 248, padX: 20, padTop: 18, line: 11, maxLines: 20 };
// the lyrics' type: large enough to read on a 275px-wide screen (it is still small in the window)
const LYRIC_FONT = '600 12px -apple-system, "Helvetica Neue", Arial, sans-serif';
const LYRIC_LINE = 15;
const LYRIC_ROWS = 13;
const TEXT_W = PAGE.w - 2 * PAGE.padX;
const PX_PER_CHAR = 4.6;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// One line as words: [x, width] segments, left to right, separated by gaps, up to `fill` px.
function lineSegments(seed, targetW) {
  const segs = [];
  let x = 0, k = 0;
  while (x < targetW) {
    const w = 9 + hash(seed * 31 + k) * 26;
    segs.push([x, Math.min(w, targetW - x)]);
    x += w + 4;
    k += 1;
  }
  return segs;
}

export default function ChillLaptopScreen({ apiRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) { apiRef.current = null; return undefined; }
    // the bitmap is 2x the local size (see the <canvas> below): draw in local units
    ctx.setTransform(SS, 0, 0, SS, 0, 0);
    // The document so far: full lines, then the one being typed.
    let nextSeed = 1;
    const lines = [];
    for (let i = 0; i < 14; i += 1) { lines.push({ seed: nextSeed, w: i === 5 || i === 11 ? TEXT_W * 0.45 : TEXT_W * (0.82 + 0.18 * hash(nextSeed)) }); nextSeed += 1; }
    let typing = { seed: nextSeed++, target: TEXT_W * (0.8 + 0.2 * hash(nextSeed)), fill: 0 };
    let lastChars = 0;
    let lastKey = '';

    const draw = (caretOn) => {
      const W = LAPTOP_LOCAL_W, H = LAPTOP_LOCAL_H;
      // the window
      ctx.fillStyle = '#b9c1c8'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e4e7ea'; ctx.fillRect(0, 0, W, 14);                 // menu bar
      ctx.fillStyle = '#3c4046'; for (let i = 0; i < 7; i += 1) ctx.fillRect(10 + i * 34, 5, 20 + (i % 3) * 6, 3);
      ctx.fillStyle = '#d3d8dc'; ctx.fillRect(0, 14, W, 26);                // toolbar
      ctx.fillStyle = '#8a9096'; for (let i = 0; i < 14; i += 1) ctx.fillRect(14 + i * 20, 22, 11, 9);
      ctx.fillStyle = '#a9b2ba'; ctx.fillRect(0, 40, W, H - 40);            // document area
      // the page
      ctx.fillStyle = '#e9ecee'; ctx.fillRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(PAGE.x, PAGE.y, PAGE.w, PAGE.h); ctx.clip();
      ctx.fillStyle = '#4a4f57';
      const all = lines.concat([{ seed: typing.seed, w: typing.fill, live: true }]);
      const visible = all.slice(Math.max(0, all.length - PAGE.maxLines));
      visible.forEach((ln, i) => {
        const y = PAGE.y + PAGE.padTop + i * PAGE.line;
        for (const [sx, sw] of lineSegments(ln.seed, ln.w)) ctx.fillRect(PAGE.x + PAGE.padX + sx, y, sw, 2.6);
      });
      // the caret, at the end of the line being typed
      if (caretOn) {
        const i = visible.length - 1;
        ctx.fillStyle = '#1b1e22';
        ctx.fillRect(PAGE.x + PAGE.padX + typing.fill + 1, PAGE.y + PAGE.padTop + i * PAGE.line - 3, 1.6, 9);
      }
      ctx.restore();
      // the dock
      ctx.fillStyle = 'rgba(232,235,238,0.92)'; ctx.fillRect(24, H - 30, W - 48, 24);
      const colors = ['#e0674f', '#f0b443', '#58b368', '#4a90d9', '#9b6bd1', '#d9d9d9', '#e0674f', '#4ab0c4', '#f0b443', '#58b368', '#4a90d9'];
      colors.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(34 + i * 38, H - 27, 18, 18); });
    };

    // wrap one paragraph to the page's width, measuring the real font
    const wrap = (text, maxW) => {
      if (!text) return [''];
      const words = text.split(' ');
      const rows = [];
      let cur = '';
      for (const w of words) {
        const trial = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(trial).width > maxW) { rows.push(cur); cur = w; } else cur = trial;
      }
      rows.push(cur);
      return rows;
    };
    const drawLyrics = (lyric, caretOn) => {
      const W = LAPTOP_LOCAL_W, H = LAPTOP_LOCAL_H;
      ctx.fillStyle = '#b9c1c8'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e4e7ea'; ctx.fillRect(0, 0, W, 14);
      ctx.fillStyle = '#3c4046'; for (let i = 0; i < 7; i += 1) ctx.fillRect(10 + i * 34, 5, 20 + (i % 3) * 6, 3);
      ctx.fillStyle = '#d3d8dc'; ctx.fillRect(0, 14, W, 26);
      ctx.fillStyle = '#8a9096'; for (let i = 0; i < 14; i += 1) ctx.fillRect(14 + i * 20, 22, 11, 9);
      ctx.fillStyle = '#a9b2ba'; ctx.fillRect(0, 40, W, H - 40);
      ctx.fillStyle = '#e9ecee'; ctx.fillRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(PAGE.x, PAGE.y, PAGE.w, PAGE.h); ctx.clip();
      ctx.font = LYRIC_FONT; ctx.textBaseline = 'alphabetic';
      const textW = PAGE.w - 2 * PAGE.padX;
      const paras = pageParagraphs(lyric.script, lyric.lineIndex, lyric.partial);
      // each paragraph may be right-to-left on its own (a song can mix scripts)
      const rows = [];
      for (const para of paras) { const rtl = isRTL(para); for (const row of wrap(para, textW)) rows.push({ row, rtl }); }
      const visible = rows.slice(Math.max(0, rows.length - LYRIC_ROWS));
      let caret = null;
      visible.forEach((r, i) => {
        const y = PAGE.y + PAGE.padTop + 10 + i * LYRIC_LINE;
        ctx.direction = r.rtl ? 'rtl' : 'ltr';
        ctx.textAlign = r.rtl ? 'right' : 'left';
        const x = r.rtl ? PAGE.x + PAGE.w - PAGE.padX : PAGE.x + PAGE.padX;
        ctx.fillStyle = '#2f343b';
        ctx.fillText(r.row, x, y);
        if (i === visible.length - 1) caret = { x: r.rtl ? x - ctx.measureText(r.row).width - 2 : x + ctx.measureText(r.row).width + 2, y };
      });
      if (caretOn && caret) { ctx.fillStyle = '#1b1e22'; ctx.fillRect(caret.x, caret.y - 11, 1.6, 13); }
      ctx.restore();
      ctx.direction = 'ltr'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(232,235,238,0.92)'; ctx.fillRect(24, H - 30, W - 48, 24);
      const colors = ['#e0674f', '#f0b443', '#58b368', '#4a90d9', '#9b6bd1', '#d9d9d9', '#e0674f', '#4ab0c4', '#f0b443', '#58b368', '#4a90d9'];
      colors.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(34 + i * 38, H - 27, 18, 18); });
    };

    apiRef.current = {
      update(values) {
        if (values && values.lyric) {
          // the track's lyrics: drawn from the clock's state, nothing accumulated here
          const ly = values.lyric;
          const caretOn = Math.floor(performance.now() / 530) % 2 === 0 || values.typing;
          canvas.dataset.lyrics = '1';
          canvas.dataset.typing = values.typing ? '1' : '0';
          canvas.dataset.lyricLine = String(ly.lineIndex);
          canvas.dataset.lyricChars = String(ly.partial);
          canvas.dataset.lyricCycle = String(ly.cycle);
          canvas.dataset.lyricRows = String(ly.script.lines.length);
          const lk = `L|${ly.cycle}|${ly.lineIndex}|${ly.partial}|${caretOn ? 1 : 0}|${ly.script.lines.length}`;
          if (lk !== lastKey) { lastKey = lk; drawLyrics(ly, caretOn); }
          return;
        }
        canvas.dataset.lyrics = '0';
        const chars = values && values.chars != null ? values.chars : 0;
        const caretOn = Math.floor(performance.now() / 530) % 2 === 0 || (values && values.typing);
        const dChars = chars - lastChars;
        lastChars = chars;
        if (dChars > 0) {
          typing.fill += dChars * PX_PER_CHAR;
          while (typing.fill >= typing.target) {
            lines.push({ seed: typing.seed, w: typing.target });
            typing = { seed: nextSeed++, target: TEXT_W * (0.55 + 0.45 * hash(nextSeed)), fill: typing.fill - typing.target };
            if (lines.length > PAGE.maxLines + 4) lines.shift();
          }
        }
        // exposed for the smoke suite: is she typing right now, and how much has she typed
        canvas.dataset.typing = values && values.typing ? '1' : '0';
        canvas.dataset.chars = String(Math.floor(chars));
        const key = `${Math.round(typing.fill)}|${lines.length}|${caretOn ? 1 : 0}`;
        if (key !== lastKey) { lastKey = key; draw(caretOn); }
      },
    };
    draw(true);
    return () => { apiRef.current = null; };
  }, [apiRef]);

  return (
    <canvas
      ref={canvasRef}
      className="chill-laptop"
      width={LAPTOP_LOCAL_W * SS}
      height={LAPTOP_LOCAL_H * SS}
      data-chill-laptop
      style={{ width: LAPTOP_LOCAL_W, height: LAPTOP_LOCAL_H, transform: LAPTOP_TRANSFORM }}
    />
  );
}
