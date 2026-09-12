/**
 * Builds the three gallery payloads from local clones.
 *
 *   npm run gallery:build
 *
 * Reads ~/scan-targets/{excalidraw,umami,uptime-kuma}, runs the same scanner
 * the CLI uses, and writes a slimed ScanResult next to the catalog. The
 * sentences on the cards are hand-written in src/gallery/catalog.ts; this
 * script only refreshes the graphs underneath them.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { scan } from '../src/core/scanner.ts';
import { slim } from '../src/core/slim.ts';
import { isIgnoredPath, isScannable, IGNORED_DIRS } from '../src/core/fileSource.ts';
import type { ScannedFile } from '../src/core/types.ts';

const TARGETS = [
  { id: 'excalidraw', dir: 'excalidraw', rootName: 'excalidraw/excalidraw' },
  { id: 'umami', dir: 'umami', rootName: 'umami-software/umami' },
  { id: 'uptime-kuma', dir: 'uptime-kuma', rootName: 'louislam/uptime-kuma' },
];

async function collect(root: string): Promise<{ files: ScannedFile[]; skipped: number }> {
  const files: ScannedFile[] = [];
  let skipped = 0;

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const next = `${prefix}${entry.name}/`;
        if (isIgnoredPath(next)) continue;
        await walk(join(dir, entry.name), next);
        continue;
      }
      if (!entry.isFile()) continue;
      const path = `${prefix}${entry.name}`;
      const full = join(dir, entry.name);
      const { size } = await stat(full);
      if (isIgnoredPath(path) || !isScannable(path, size)) {
        skipped += 1;
        continue;
      }
      files.push({ path, text: await readFile(full, 'utf8') });
    }
  }

  await walk(root, '');
  return { files, skipped };
}

const outDir = new URL('../src/gallery/', import.meta.url);
await mkdir(outDir, { recursive: true });

for (const target of TARGETS) {
  const root = join(homedir(), 'scan-targets', target.dir);
  const { files, skipped } = await collect(root);
  const result = slim(scan(files, target.rootName, skipped));
  const dest = new URL(`./${target.id}.json`, outDir);
  await writeFile(dest, `${JSON.stringify(result)}\n`, 'utf8');
  console.log(
    `${target.rootName}  ${result.fileCount} files, ${result.paths.length} routes, ${result.touchpoints.length} touchpoints kept`,
  );
}
