import { useEffect, useRef } from 'react';

// The shared engine that makes a scene's photo gently alive: a WebGL canvas draws the
// photo through a scene-specific fragment shader that nudges the texture lookup — but
// only where that scene's masks say so. What is generic lives here; what is specific to
// a scene is its `fx`:
//   fx.frag            the fragment shader (uPhoto is the photo; vUv the flipped uv)
//   fx.masks           [{ uniform, url }] extra textures — masks carry DATA, not colour
//   fx.create()        optional: per-mount state object handed back to update()
//   fx.update(t, set, state, live)   sets this frame's uniforms (set.f / set.v2 by name)
//                      and returns whatever values the scene's DOM overlays need
// `live` is `liveState` (e.g. { isPlaying }), read afresh every frame. `onFrame(values)`
// receives update()'s return value each frame — how a DOM overlay (the phone's screen,
// the laptop's) stays glued to what the shader moves.
//
// The plain <img> is ALWAYS rendered underneath, so there is no flash while the
// textures load and, if WebGL is unavailable or its context is lost, the scene
// is simply the still photo (data-gl="fallback"). The canvas fades in over it once
// the first frame is drawn (data-live="true"); data-frames counts drawn frames (every 10).
//
// Cost control: it keeps moving while paused where a scene wants that, so it is kept
// cheap — 30fps, a drawing buffer no bigger than the photo's own pixels or the window's
// device pixels (whichever is smaller, never below 0.45x), the low-power GPU where there
// is a choice, and no drawing at all while the page is hidden.
const FPS = 30;
const MIN_BUFFER_SCALE = 0.45;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
  return sh;
}

export default function ChillLivingPhoto({ photoUrl, fx, sceneW, sceneH, scale, liveState, onFrame }) {
  const canvasRef = useRef(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const liveRef = useRef(liveState);
  liveRef.current = liveState;
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    let rafId = 0;
    let gl = null;
    const fail = () => { canvas.dataset.gl = 'fallback'; canvas.dataset.live = 'false'; };

    (async () => {
      try {
        const [photo, ...maskImages] = await Promise.all([loadImage(photoUrl), ...fx.masks.map((m) => loadImage(m.url))]);
        if (cancelled) return;
        gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
        if (!gl) { fail(); return; }
        if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < Math.max(photo.naturalWidth, photo.naturalHeight)) { fail(); return; }

        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fx.frag));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const makeTexture = (unit, image, exactColors) => {
          const tex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          // Masks carry DATA, not colour: no colour-space conversion on them.
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, exactColors ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        };
        makeTexture(0, photo, false);
        gl.uniform1i(gl.getUniformLocation(prog, 'uPhoto'), 0);
        maskImages.forEach((img, i) => {
          makeTexture(i + 1, img, true);
          gl.uniform1i(gl.getUniformLocation(prog, fx.masks[i].uniform), i + 1);
        });

        // Uniforms by name, looked up once.
        const locs = new Map();
        const uloc = (name) => { if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name)); return locs.get(name); };
        const set = { f: (name, v) => gl.uniform1f(uloc(name), v), v2: (name, x, y) => gl.uniform2f(uloc(name), x, y), v3: (name, x, y, z) => gl.uniform3f(uloc(name), x, y, z) };
        const uTime = uloc('uTime');
        const state = fx.create ? fx.create() : {};

        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(rafId); fail(); });

        const t0 = performance.now();
        let last = 0;
        let frames = 0;
        const frame = (now) => {
          rafId = requestAnimationFrame(frame);
          if (document.hidden || now - last < 1000 / FPS - 2) return;
          const dt = Math.min(0.25, (now - last) / 1000);
          last = now;
          // The drawing buffer follows the window: no more than the photo's own
          // pixels (more is pure waste) or the window's device pixels.
          const s = Math.min(1, Math.max(MIN_BUFFER_SCALE, scaleRef.current));
          const bw = Math.round(sceneW * s);
          const bh = Math.round(sceneH * s);
          if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; gl.viewport(0, 0, bw, bh); }
          const t = ((now - t0) / 1000) % 3600;
          gl.uniform1f(uTime, t);
          const values = fx.update(t, set, state, liveRef.current || {}, dt);
          // DOM overlays follow what the shader moves (they are not in the shader).
          if (frames > 0) onFrameRef.current?.(values);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          frames += 1;
          if (frames === 1) { canvas.dataset.gl = 'ok'; canvas.dataset.live = 'true'; }
          if (frames % 10 === 0) canvas.dataset.frames = String(frames);
        };
        rafId = requestAnimationFrame(frame);
      } catch {
        fail();
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [photoUrl, fx, sceneW, sceneH]);

  return (
    <>
      <img className="chill-photo" src={photoUrl} alt="" draggable={false} />
      <canvas ref={canvasRef} className="chill-living" data-gl="pending" data-live="false" style={{ width: sceneW, height: sceneH }} />
    </>
  );
}
