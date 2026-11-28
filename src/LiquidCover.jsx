import { useEffect, useRef, useState } from 'react';
import { paletteFromPixels, FALLBACK_PALETTE, paletteCache } from './coverPalette.js';

// The background behind Now Playing and the mini player: "liquid colour". The cover's four main
// colours (coverPalette.js) flow into each other like liquid, drawn by a small WebGL shader.
//
// Why it is built this way (it replaced two earlier backgrounds):
//  - three coloured circles inside a 100px CSS blur ("the lights") — the blur was recomputed on
//    every frame they moved, competing with drawing a list scrolled over it;
//  - the "living cover" — a 48px softened copy of the cover stretched ~40x and turned: stretching
//    that far leaves creases and rings that sweep across the window, and darkening it for the text
//    turned dark covers into muddy black.
// Here every pixel is computed smoothly (a weighted mix of four drifting colour points, its
// coordinates bent by a little noise), so there is nothing to stretch; the canvas is drawn at half
// the window's size and CSS scales it up, and a fixed, very faint dither in the shader itself breaks
// up the 8-bit banding a smooth dark gradient shows. (A film-grain layer over it did that job first;
// at 7% it read as a texture on the darker calm version and was removed for this "silk" finish.)
//
// Cost: one tiny full-screen pass per frame, and only while it is `active` and the music plays (or
// a new song's colours are still gliding in). Paused, hidden or Reduce Motion: it draws its last
// frame once and stops. No WebGL (or a lost context): a still CSS gradient of the same colours.
const SCALE = 0.5;
const GLIDE_S = 0.9; // a new song's colours crossfade in over this long, then drawing can stop

const VERTEX = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
const FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 res; uniform float t; uniform float dim; uniform vec3 c0, c1, c2, c3;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * n(p); p *= 2.02; a *= .5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / res; vec2 p = uv * vec2(res.x / res.y, 1.);
  vec2 w = vec2(fbm(p * 1.3 + vec2(t * .045, -t * .03)), fbm(p * 1.3 + vec2(-t * .035, t * .05) + 5.2));
  vec2 q = p + (w - .5) * .9;
  vec2 a0 = vec2(.25 + .2 * sin(t * .11), .3 + .2 * cos(t * .13));
  vec2 a1 = vec2(1.25 + .25 * cos(t * .09), .7 + .2 * sin(t * .12 + 1.));
  vec2 a2 = vec2(.7 + .3 * sin(t * .07 + 2.), .95 + .15 * cos(t * .1));
  vec2 a3 = vec2(1.1 + .3 * cos(t * .08 + 3.), .15 + .15 * sin(t * .14 + 2.));
  float w0 = 1. / pow(distance(q, a0) + .05, 2.4), w1 = 1. / pow(distance(q, a1) + .05, 2.4);
  float w2 = 1. / pow(distance(q, a2) + .05, 2.4), w3 = 1. / pow(distance(q, a3) + .05, 2.4);
  vec3 col = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / (w0 + w1 + w2 + w3);
  col *= .82 * dim;
  col *= mix(.62, 1., smoothstep(1.25, .25, length(uv - vec2(.35, .45))));  // a soft vignette, for the text
  col += (h(gl_FragCoord.xy) - .5) / 64.;                                    // dither: fixed, so nothing twinkles
  gl_FragColor = vec4(col, 1.);
}`;

// The cover's palette, read from a 32px sample of its thumbnail (loaded CORS-enabled, as
// fast-average-color does, so its pixels can be read), remembered in the shared paletteCache: a
// background that appears later (the mini player after a mode switch) has its colours on its very
// first frame. While a NEW cover is still being read, the previous colours stay (never a flash of
// the fallback violet between two songs).
const loading = new Map(); // src -> Promise, so two backgrounds never read the same cover twice
function readPalette(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 32;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(img, 0, 0, 32, 32);
          resolve(paletteFromPixels(x.getImageData(0, 0, 32, 32).data));
        } catch { resolve(FALLBACK_PALETTE); }
      };
      img.onerror = () => resolve(FALLBACK_PALETTE);
      img.src = src;
    }).then((pal) => { paletteCache.set(src, pal); loading.delete(src); return pal; }));
  }
  return loading.get(src);
}
function usePalette(src) {
  const [, setLoaded] = useState(0);
  const known = src ? paletteCache.get(src) : FALLBACK_PALETTE;
  const shownRef = useRef(known || FALLBACK_PALETTE);
  if (known) shownRef.current = known;
  useEffect(() => {
    if (!src || paletteCache.has(src)) return undefined;
    let alive = true;
    readPalette(src).then(() => { if (alive) setLoaded((n) => n + 1); });
    return () => { alive = false; };
  }, [src]);
  return shownRef.current;
}

const cssFallback = (pal) => {
  const c = pal.map(([r, g, b]) => `rgb(${Math.round(r * 0.82)}, ${Math.round(g * 0.82)}, ${Math.round(b * 0.82)})`);
  return `radial-gradient(70% 80% at 22% 30%, ${c[0]}, transparent), radial-gradient(70% 80% at 90% 70%, ${c[1]}, transparent), radial-gradient(60% 70% at 60% 100%, ${c[2]}, transparent), ${c[3]}`;
};

// `calm` is the version behind the pages (Library, Home, details): dimmer, a third of the speed,
// at most CALM_FPS frames a second, and still while anything scrolls (and for a moment after), so
// it never competes with drawing a list.
const CALM = { dim: 0.62, speed: 0.33, fps: 15, scrollRestMs: 450 };

export default function LiquidCover({ src, isPlaying, active = true, calm = false }) {
  const palette = usePalette(src);
  const canvasRef = useRef(null);
  const glRef = useRef(null);          // { gl, u, cur, t, last, raf } once WebGL is up
  const stateRef = useRef({ palette, moving: false });
  const [noGl, setNoGl] = useState(false);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  stateRef.current = { palette, moving: active && isPlaying && !reduceMotion, active, calm };

  // WebGL, once
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    let gl = null;
    try { gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false }); } catch { gl = null; }
    if (!gl) { setNoGl(true); return undefined; }
    const sh = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const vs = sh(gl.VERTEX_SHADER, VERTEX), fs = sh(gl.FRAGMENT_SHADER, FRAGMENT);
    const prog = gl.createProgram();
    if (!vs || !fs) { setNoGl(true); return undefined; }
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setNoGl(true); return undefined; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = Object.fromEntries(['res', 't', 'dim', 'c0', 'c1', 'c2', 'c3'].map((k) => [k, gl.getUniformLocation(prog, k)]));
    const norm = (pal) => pal.map((c) => c.map((v) => v / 255));
    const g = { gl, u, cur: norm(stateRef.current.palette), from: null, to: stateRef.current.palette, p: 1, t: 0, last: 0, raf: 0 };
    glRef.current = g;

    // Draw what is current, now. Resizing a canvas wipes it (black, with no alpha), so a resize
    // paints AT ONCE, in the ResizeObserver callback (after layout, before the frame is painted),
    // never on a later frame: that gap was the black flash while resizing (several frames behind
    // the pages, whose calm version only draws 15 times a second). The canvas stays invisible
    // until its first paint, over a still gradient of the same colours.
    const paint = () => {
      gl.uniform2f(u.res, cv.width, cv.height);
      gl.uniform1f(u.t, g.t);
      gl.uniform1f(u.dim, stateRef.current.calm ? CALM.dim : 1);
      ['c0', 'c1', 'c2', 'c3'].forEach((k, i) => gl.uniform3fv(u[k], g.cur[i]));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      g.frames = (g.frames || 0) + 1;
      cv.dataset.liquidFrames = String(g.frames);
      if (cv.dataset.liquidDirty) delete cv.dataset.liquidDirty;
      if (!g.shown) { g.shown = true; cv.dataset.shown = '1'; }
    };
    const size = () => {
      const w = Math.max(32, Math.round(cv.clientWidth * SCALE)), h = Math.max(24, Math.round(cv.clientHeight * SCALE));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w; cv.height = h; gl.viewport(0, 0, w, h);
        cv.dataset.liquidDirty = '1';
        paint();
        kick();
      }
    };
    let scrolledAt = -1e9;
    const onAnyScroll = () => { scrolledAt = performance.now(); };
    if (stateRef.current.calm) document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
    const draw = (now) => {
      g.raf = 0;
      const { palette: pal, moving, active: on, calm: isCalm } = stateRef.current;
      let holdMotion = false;
      if (isCalm && on) {
        // calm: at most CALM.fps frames a second, and nothing is drawn while a list scrolls (and a
        // moment after): neither the flowing motion nor a one-off frame woken while paused (a
        // play/pause, say, mid-scroll; that used to draw at once, measured under Rosetta, where a
        // stuttering song woke it mid-scroll). A new song's colours still crossfade in AT ONCE: a
        // skip auto-scrolls the Library to the new song, and waiting for that scroll made the
        // colour change visibly late. Those few frames are cheap; everything else waits.
        // (by the clock, like scrolledAt: a frame's own timestamp can run ahead of it — measured
        // 400-700ms ahead on a slow machine (Rosetta), which made a scroll 16ms ago look over)
        const scrolling = performance.now() - scrolledAt < CALM.scrollRestMs;
        const colourChange = g.p < 1 || pal !== g.to;
        const animating = moving || colourChange;
        if ((scrolling && !colourChange) || (animating && g.last && now - g.last < 1000 / CALM.fps)) { g.raf = requestAnimationFrame(draw); return; }
        holdMotion = scrolling;
      }
      const dt = g.last ? Math.min(isCalm ? 0.2 : 0.05, (now - g.last) / 1000) : 0;
      g.last = now;
      if (moving && !holdMotion) g.t += dt * (isCalm ? CALM.speed : 1);
      // a new palette crossfades in over GLIDE_S (from whatever is showing), then it is done
      if (pal !== g.to) { g.from = g.cur; g.to = pal; g.p = 0; }
      if (g.p < 1) {
        g.p = Math.min(1, g.p + dt / GLIDE_S);
        const e = g.p * g.p * (3 - 2 * g.p);
        const to = norm(g.to);
        g.cur = g.from.map((c, i) => c.map((v, k) => v + (to[i][k] - v) * e));
      }
      const gliding = g.p < 1;
      // (tests wait for a colour change to finish: only it may draw while a list scrolls)
      if (gliding) cv.dataset.liquidGlide = '1'; else if (cv.dataset.liquidGlide) delete cv.dataset.liquidGlide;
      paint();
      // keep going only while there is something to show
      if (on && (moving || gliding)) g.raf = requestAnimationFrame(draw);
      else g.last = 0;
    };
    const kick = () => { if (!g.raf) g.raf = requestAnimationFrame(draw); };
    g.kick = kick;
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    size();
    const lost = (e) => { e.preventDefault(); setNoGl(true); };
    cv.addEventListener('webglcontextlost', lost);
    return () => {
      ro.disconnect();
      document.removeEventListener('scroll', onAnyScroll, { capture: true });
      cv.removeEventListener('webglcontextlost', lost);
      if (g.raf) cancelAnimationFrame(g.raf);
      glRef.current = null;
      // Give the GPU context back now rather than whenever it is collected: the mini player makes a
      // new one each time it appears, and Chromium drops the oldest past 16. Only once the canvas
      // has really left the page (StrictMode's practice unmount keeps it, and would get a dead
      // context back on its remount).
      setTimeout(() => { if (!cv.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext(); }, 0);
    };
  }, []);

  // anything that can start (or end) the motion: draw again
  useEffect(() => { glRef.current?.kick?.(); }, [palette, isPlaying, active, calm]);

  return (
    <div className={`liquid-cover${calm ? ' liquid-cover--calm' : ''}`} data-playing={isPlaying ? 'true' : 'false'} data-liquid={noGl ? 'still' : 'gl'} aria-hidden="true"
      data-liquid-palette={palette.map((c) => c.join(',')).join(' ')}
      style={{ background: cssFallback(palette) }}
    >
      {/* invisible until its first paint (see `paint`), so an undrawn canvas never shows */}
      {!noGl && <canvas ref={canvasRef} className="liquid-cover-canvas" />}
      {/* the pages' version: a soft light from the top, like the glass sheet in the split */}
      {calm && <div className="liquid-cover-sheen" />}
    </div>
  );
}
