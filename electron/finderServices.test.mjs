import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { serviceInstallAction, installFinderServices, SERVICES_VERSION } from './finderServices.mjs';

const decide = (exists, installedVersion, currentVersion = 2) =>
  serviceInstallAction({ exists, installedVersion, currentVersion });

describe('serviceInstallAction', () => {
  it('installs on a clean machine', () => {
    expect(decide(false, null)).toBe('install');
  });

  it('does not resurrect a bundle the user deleted', () => {
    // We installed it before (we have a record) and it is gone now: that was
    // the user's doing, so leave it alone — including across version bumps.
    expect(decide(false, 2)).toBe('skip');
    expect(decide(false, 1)).toBe('skip');
  });

  it('leaves an up-to-date bundle alone', () => {
    expect(decide(true, 2)).toBe('skip');
  });

  it('updates a stale bundle', () => {
    expect(decide(true, 1)).toBe('install');
  });

  it('updates a pre-marker install (bundle present, no record)', () => {
    // The exact migration case: v1 shipped without a marker file, so an
    // existing "Add to Queue" bundle has no recorded version but must be
    // replaced — its shell script writes the old flag file.
    expect(decide(true, null)).toBe('install');
  });

  it('treats a future/unknown recorded version as stale rather than current', () => {
    expect(decide(true, 99)).toBe('install');
  });

  it('exports a version the installer can actually compare against', () => {
    expect(typeof SERVICES_VERSION).toBe('number');
    expect(decide(true, SERVICES_VERSION, SERVICES_VERSION)).toBe('skip');
  });
});

describe('installFinderServices', () => {
  let dir, srcDir, destDir, markerPath;

  const BUNDLE = 'Add to Queue in Sonus.workflow';
  const OTHER = 'Play Next in Sonus.workflow';
  const scriptPath = (root, name) => path.join(root, name, 'Contents', 'document.wflow');

  const readMarker = async () => JSON.parse(await fs.readFile(markerPath, 'utf-8'));
  const exists = async (p) => { try { await fs.access(p); return true; } catch { return false; } };

  // Minimal stand-ins for the real .workflow packages: a nested file is enough
  // to prove recursive copying and wholesale replacement work.
  async function writeBundle(root, name, contents) {
    await fs.mkdir(path.join(root, name, 'Contents'), { recursive: true });
    await fs.writeFile(scriptPath(root, name), contents);
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonus-services-test-'));
    srcDir = path.join(dir, 'resources', 'services');
    destDir = path.join(dir, 'Library', 'Services');
    markerPath = path.join(dir, 'userData', 'services-installed.json');
    await writeBundle(srcDir, BUNDLE, 'v2-script');
    await writeBundle(srcDir, OTHER, 'v2-other');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const install = (version = 2) => installFinderServices({ srcDir, destDir, markerPath, version });

  it('installs every shipped bundle on a clean machine and records them', async () => {
    const installed = await install();
    expect(installed.sort()).toEqual([BUNDLE, OTHER].sort());
    expect(await fs.readFile(scriptPath(destDir, BUNDLE), 'utf-8')).toBe('v2-script');
    expect(await fs.readFile(scriptPath(destDir, OTHER), 'utf-8')).toBe('v2-other');
    expect(await readMarker()).toEqual({ [BUNDLE]: 2, [OTHER]: 2 });
  });

  it('is a no-op on the next launch', async () => {
    await install();
    expect(await install()).toEqual([]);
  });

  it('picks up a Service added in a later release without code changes', async () => {
    await install();
    await writeBundle(srcDir, 'Third Thing.workflow', 'v2-third');
    expect(await install()).toEqual(['Third Thing.workflow']);
  });

  it('updates a bundle whose shipped contents changed', async () => {
    await install(2);
    await writeBundle(srcDir, BUNDLE, 'v3-script');
    const installed = await install(3);
    expect(installed.sort()).toEqual([BUNDLE, OTHER].sort());
    expect(await fs.readFile(scriptPath(destDir, BUNDLE), 'utf-8')).toBe('v3-script');
    expect((await readMarker())[BUNDLE]).toBe(3);
  });

  it('migrates a pre-marker install (bundle on disk, no marker file)', async () => {
    // Exactly the shipped v1 situation: an old bundle writing the legacy flag,
    // with nothing recording that we put it there.
    await writeBundle(destDir, BUNDLE, 'v1-legacy-script');
    expect(await exists(markerPath)).toBe(false);
    await install();
    expect(await fs.readFile(scriptPath(destDir, BUNDLE), 'utf-8')).toBe('v2-script');
  });

  it('does not resurrect a bundle the user deleted', async () => {
    await install();
    await fs.rm(path.join(destDir, BUNDLE), { recursive: true });
    const installed = await install();
    expect(installed).toEqual([]);
    expect(await exists(path.join(destDir, BUNDLE))).toBe(false);
    // …not even across a version bump.
    expect(await install(3)).toEqual([OTHER]);
    expect(await exists(path.join(destDir, BUNDLE))).toBe(false);
  });

  it('replaces wholesale rather than merging over the old bundle', async () => {
    await install();
    const stale = path.join(destDir, BUNDLE, 'Contents', 'leftover.txt');
    await fs.writeFile(stale, 'should not survive');
    await install(3);
    expect(await exists(stale)).toBe(false);
  });

  it('survives a corrupt marker file by reinstalling', async () => {
    await install();
    await fs.writeFile(markerPath, 'not json {{{');
    expect((await install()).sort()).toEqual([BUNDLE, OTHER].sort());
    expect(await readMarker()).toEqual({ [BUNDLE]: 2, [OTHER]: 2 });
  });

  it('does nothing (and does not throw) when no bundles are shipped', async () => {
    await fs.rm(srcDir, { recursive: true, force: true });
    await expect(install()).resolves.toEqual([]);
    expect(await exists(markerPath)).toBe(false);
  });

  it('ignores non-workflow entries in the resources directory', async () => {
    await fs.writeFile(path.join(srcDir, '.DS_Store'), 'junk');
    const installed = await install();
    expect(installed.sort()).toEqual([BUNDLE, OTHER].sort());
    expect(await exists(path.join(destDir, '.DS_Store'))).toBe(false);
  });
});
