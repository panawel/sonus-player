// Generates test-fixture.mp3 — the audio file the smoke suite parses, tags,
// copies and re-opens (electron/smokeTest.mjs).
//
// It exists because the suite needs a *real* MP3: it exercises music-metadata
// parsing, artwork normalisation, thumbnail generation, the sonus-thumb://
// protocol, and node-id3 tag round-trips. A stub would test none of that.
//
// It is generated rather than being a real song because this repo is public.
// Shipping a commercial track would put a copyrighted recording both in the
// git history and inside every packaged .app (the fixture lives in app.asar,
// which is what lets the built app run `--smoke` on a target machine).
//
// No ffmpeg or other external tooling: the audio is assembled directly from
// MPEG-1 Layer III frame headers, and tagged with node-id3, which the project
// already depends on. Regenerate with:
//
//   node scripts/make-test-fixture.mjs

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import NodeID3 from 'node-id3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test-fixture.mp3');
const COVER = path.join(__dirname, 'fixture-cover.jpg');

// MPEG-1 Layer III · 128 kbps · 44.1 kHz · mono · no CRC.
//   FF FB : 11 sync bits, version 11 (MPEG-1), layer 01 (III), protection 1 (none)
//   90    : bitrate index 1001 (128 kbps), sample rate 00 (44100), no padding
//   C4    : channel mode 11 (mono), not copyrighted, original
const FRAME_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0xc4]);
const BITRATE = 128_000;
const SAMPLE_RATE = 44_100;
const SAMPLES_PER_FRAME = 1152;
// Standard MPEG-1 Layer III frame size, unpadded.
const FRAME_BYTES = Math.floor((144 * BITRATE) / SAMPLE_RATE); // 417
// Must comfortably exceed the longest seek the smoke suite performs. It seeks
// to 5s and then to 7s and asserts the playhead actually landed there
// ("seek to 5s took effect…", "seek to 7s took effect…"); on a shorter file
// those seeks clamp to the end and the assertions fail for a reason that has
// nothing to do with the behaviour under test. 20s leaves plenty of room and
// still costs only ~310KB at 128 kbps.
const DURATION_SECONDS = 20;

const frameCount = Math.round((DURATION_SECONDS * SAMPLE_RATE) / SAMPLES_PER_FRAME);

// One silent frame: a valid header followed by a zeroed payload. Decoders read
// this as silence; the suite never listens to it, it only needs the file to
// parse with a real duration and bitrate.
const frame = Buffer.alloc(FRAME_BYTES);
FRAME_HEADER.copy(frame, 0);

await fs.writeFile(OUT, Buffer.concat(Array.from({ length: frameCount }, () => frame)));

const ok = NodeID3.write(
  {
    title: 'Sonus Test Tone',
    artist: 'Sonus',
    album: 'Test Fixture',
    performerInfo: 'Sonus',
    year: '2026',
    genre: 'Test',
    trackNumber: '1/1',
    comment: { language: 'eng', text: 'Generated fixture — see scripts/make-test-fixture.mjs' },
    // Embedded cover art is load-bearing: it drives the thumbnail pipeline,
    // the artwork-normalisation path and the fs:readArtwork assertions.
    image: {
      mime: 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'Cover',
      imageBuffer: await fs.readFile(COVER),
    },
  },
  OUT
);

if (!ok) {
  console.error('node-id3 failed to write tags');
  process.exit(1);
}

const { size } = await fs.stat(OUT);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${(size / 1024).toFixed(1)} KB, ${frameCount} frames (~${DURATION_SECONDS}s)`);
