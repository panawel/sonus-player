// Finder Services install policy + installer. No Electron imports — the caller
// supplies the paths, so this is unit-tested directly against temp dirs.

import fs from 'fs/promises';
import path from 'path';

//
// The bundles themselves are static resources (electron/resources/services),
// copied into ~/Library/Services at launch. Bump SERVICES_VERSION whenever a
// shipped bundle's contents change (e.g. its shell script), so existing installs
// get the new one instead of silently keeping a stale copy forever.
export const SERVICES_VERSION = 2;

// What to do with one workflow bundle, given whether it's on disk and which
// version we last installed there (null = we have no record).
//
//   absent  + no record        → install   (first run)
//   absent  + record           → skip      (user deleted it; don't fight that)
//   present + stale/no record  → install   (update — also migrates pre-marker
//                                           installs, which have no record but
//                                           do have an outdated bundle on disk)
//   present + current record   → skip
export function serviceInstallAction({ exists, installedVersion, currentVersion }) {
  if (!exists) return installedVersion == null ? 'install' : 'skip';
  return installedVersion === currentVersion ? 'skip' : 'install';
}

// Copy every shipped .workflow bundle into destDir according to the policy
// above, recording what was installed in markerPath. Returns the bundle names
// that were (re)installed. Never throws: a Service failing to install must not
// take the app's launch down with it.
export async function installFinderServices({ srcDir, destDir, markerPath, version = SERVICES_VERSION }) {
  let marker = {};
  try {
    const parsed = JSON.parse(await fs.readFile(markerPath, 'utf-8'));
    if (parsed && typeof parsed === 'object') marker = parsed;
  } catch { /* first run, or unreadable - treat as no record */ }

  // Read the shipped bundles rather than naming them, so adding a Service later
  // needs no change here.
  let bundles;
  try {
    bundles = (await fs.readdir(srcDir)).filter(name => name.endsWith('.workflow'));
  } catch (err) {
    console.error('No bundled Finder services to install:', err);
    return [];
  }

  const installed = [];
  for (const name of bundles) {
    const dest = path.join(destDir, name);
    let exists = true;
    try { await fs.access(dest); } catch { exists = false; }

    const action = serviceInstallAction({
      exists,
      installedVersion: typeof marker[name] === 'number' ? marker[name] : null,
      currentVersion: version,
    });
    if (action === 'skip') continue;

    try {
      // Replace wholesale: copying over an existing bundle would leave behind
      // any file the new version dropped.
      await fs.rm(dest, { recursive: true, force: true });
      await fs.mkdir(destDir, { recursive: true });
      await fs.cp(path.join(srcDir, name), dest, { recursive: true });
      marker[name] = version;
      installed.push(name);
    } catch (err) {
      console.error(`Failed to install Finder service "${name}":`, err);
      // Marker left untouched, so the next launch retries this bundle.
    }
  }

  if (installed.length > 0) {
    try {
      await fs.mkdir(path.dirname(markerPath), { recursive: true });
      await fs.writeFile(markerPath, JSON.stringify(marker));
    } catch (err) {
      console.error('Failed to record installed Finder services:', err);
    }
  }
  return installed;
}
