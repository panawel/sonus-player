// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, copyFile, readFile, writeFile, rm, chmod, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { updateFile } from 'music-metadata';
import { toTagPatch, writeEditorTags, serializeTagWrite } from './tagWriter.mjs';

describe('editor integration', () => {
  it('maps partial updates, deletion, totals and rejects malformed input', () => {
    expect(toTagPatch({ title: '', albumArtist: 'AA', trackTotal: '12', picture: null }))
      .toEqual({ title: null, albumartist: 'AA', track: { of: 12 }, picture: null });
    expect(() => toTagPatch({ trackNumber: 'bad' })).toThrow();
    expect(() => toTagPatch({ picture: 'bad' })).toThrow();
  });
  it('serializes failed and successful saves without poisoning the queue', async () => {
    const order = [];
    const first = serializeTagWrite('a', async () => { order.push(1); throw Error('failure'); });
    const second = serializeTagWrite('a', async () => order.push(2));
    await expect(first).rejects.toThrow('failure');
    await second;
    expect(order).toEqual([1, 2]);
  });
  it('preserves custom FLAC fields across partial edits and deletions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sonus-flac-'));
    try {
      const file = path.join(dir, 'track.flac');
      const streamInfo = Buffer.alloc(34);
      streamInfo.writeUInt16BE(4608, 0);
      streamInfo.writeUInt16BE(4608, 2);
      streamInfo[10] = 1;
      streamInfo[11] = 244;
      streamInfo[13] = 240;
      const audio = Buffer.from('audio-payload');
      const staleBody = Buffer.from([0, ...Buffer.from('Stale title')]);
      const staleFrame = Buffer.alloc(10); staleFrame.write('TIT2'); staleFrame.writeUInt32BE(staleBody.length, 4);
      const prefix = Buffer.from([73,68,51,3,0,0,0,0,0,10 + staleBody.length]);
      await writeFile(file, Buffer.concat([prefix, staleFrame, staleBody, Buffer.from('fLaC'), Buffer.from([128, 0, 0, 34]), streamInfo, audio]));
      await updateFile(file, { artist: 'Keep artist', native: { CUSTOM: 'Keep custom' } });
      await writeEditorTags(file, { title: 'New title', lyrics: 'Text', year: '2022' });
      await writeEditorTags(file, { title: '', lyrics: '' });
      const metadata = await parseFile(file);
      expect(metadata.common.artist).toBe('Keep artist');
      expect(metadata.common.year).toBe(2022);
      expect(metadata.common.title).toBeUndefined();
      expect(metadata.native.vorbis.some(t => t.id === 'CUSTOM' && t.value === 'Keep custom')).toBe(true);
      expect((await readFile(file)).subarray(-audio.length)).toEqual(audio);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('round-trips real MP3 edits and preserves unrelated tags', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sonus-editor-'));
    try {
      const file = path.join(dir, 'track.mp3');
      await copyFile('test-fixture.mp3', file);
      const original = await readFile(file);
      await updateFile(file, { title: 'Initial', native: { 'TXXX:SONUS_TEST': 'preserve' } }, { replaceId3: true });
      await writeEditorTags(file, { title: 'Unicode 音楽', lyrics: 'Lyrics', trackNumber: '4', trackTotal: '12' });
      const metadata = await parseFile(file);
      expect(metadata.common.title).toBe('Unicode 音楽');
      expect(metadata.common.track).toEqual({ no: 4, of: 12 });
      expect(metadata.native['ID3v2.4'].some(t => t.id === 'TXXX:SONUS_TEST' && t.value === 'preserve')).toBe(true);
      await writeEditorTags(file, { lyrics: '', title: '' });
      expect((await parseFile(file)).common.title).toBeUndefined();
      // Audio suffix is copied verbatim by both updates.
      expect((await readFile(file)).subarray(-1000)).toEqual(original.subarray(-1000));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('writer compatibility', () => {
  it('converts legacy common tags and drops unmapped native fields', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sonus-legacy-'));
    try {
      const source = await readFile('test-fixture.mp3');
      const size = source.subarray(6, 10).reduce((n, b) => n * 128 + b, 0);
      const audio = source.subarray(10 + size);
      const frame = (id, value) => {
        const body = Buffer.concat([Buffer.from([0]), Buffer.from(value)]);
        const header = Buffer.alloc(10); header.write(id); header.writeUInt32BE(body.length, 4);
        return Buffer.concat([header, body]);
      };
      const body = Buffer.concat([frame('TIT2', 'Old'), frame('TPUB', 'Publisher'), frame('TXXX', 'CUSTOM\0Keep'), frame('TXXX', 'REPLAYGAIN_TRACK_GAIN\0-3 dB'), frame('TSOC', 'Composer sort')]);
      const header = Buffer.from([73,68,51,3,0,0,0,0,0,0]);
      let length = body.length;
      for (let i = 9; i >= 6; i--) { header[i] = length & 127; length >>>= 7; }
      const file = path.join(dir, 'track.mp3');
      await writeFile(file, Buffer.concat([header, body, audio]));
      await writeEditorTags(file, { title: 'New' });
      const after = await parseFile(file);
      expect(after.format.tagTypes).toContain('ID3v2.4');
      expect(after.common.label).toEqual(['Publisher']);
      expect(after.common.replaygain_track_gain?.dB).toBe(-3);
      expect(after.common.composersort).toBe('Composer sort');
      expect(after.native['ID3v2.4'].some(tag => tag.id === 'TXXX:CUSTOM')).toBe(false);
      expect((await readFile(file)).subarray(-audio.length)).toEqual(audio);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('writes through symlinks with file-only write permission', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sonus-permissions-'));
    try {
      const file = path.join(dir, 'track.mp3');
      const link = path.join(dir, 'link.mp3');
      await copyFile('test-fixture.mp3', file);
      await symlink(file, link);
      await chmod(dir, 0o555);
      await writeEditorTags(link, { title: 'Updated target' });
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect((await parseFile(file)).common.title).toBe('Updated target');
    } finally { await chmod(dir, 0o755); await rm(dir, { recursive: true, force: true }); }
  });
});
