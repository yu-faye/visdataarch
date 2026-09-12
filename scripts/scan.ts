/**
 * Command line harness.
 *
 * The browser is the product, but iterating on rules through a file picker is
 * far too slow. This runs the exact same pure scanner over a directory on disk,
 * so a rule change can be checked against a real codebase in a second.
 *
 *   npm run scan -- ~/scan-targets/umami
 *   npm run scan -- ~/scan-targets/umami --json > result.json
 *
 * It is also where the boundary check lives, which is the form the tool takes
 * once it stops being something you visit and starts being something that
 * speaks up on its own:
 *
 *   npm run scan -- . --update-baseline   record the boundary as it is today
 *   npm run scan -- . --check             fail if anything new has appeared
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { scan } from '../src/core/scanner.ts';
import { isScannable, IGNORED_DIRS } from '../src/core/fileSource.ts';
import {
  buildBaseline,
  diffBaseline,
  formatDiff,
  hasAdditions,
  type Baseline,
} from '../src/core/baseline.ts';
import type { DataPath, ScannedFile, Touchpoint } from '../src/core/types.ts';

async function collect(root: string): Promise<{ files: ScannedFile[]; skipped: number }> {
  const files: ScannedFile[] = [];
  let skipped = 0;

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.isFile()) continue;

      const path = `${prefix}${entry.name}`;
      const full = join(dir, entry.name);
      const { size } = await stat(full);

      if (!isScannable(path, size)) {
        skipped += 1;
        continue;
      }
      files.push({ path, text: await readFile(full, 'utf8') });
    }
  }

  await walk(root, '');
  return { files, skipped };
}

function bar(count: number, max: number, width = 28): string {
  if (max === 0) return '';
  return '#'.repeat(Math.max(1, Math.round((count / max) * width)));
}

/**
 * Prints a path with the hand-off behind every hop.
 *
 * The hop list on its own only ever said the files were connected. Printing the
 * line where a value actually changes hands is the difference between a claim
 * and a claim you can check, and it is the fastest way to catch the scanner
 * inventing a route.
 */
function printPath(path: DataPath, byId: Map<string, Touchpoint>): void {
  const entry = byId.get(path.entryId) as Touchpoint;
  const sink = byId.get(path.sinkId) as Touchpoint;
  const where = sink.destination ? ` (${sink.destination})` : '';
  const confidence = path.carriesValue ? '' : '  [unconfirmed]';

  console.log(`\n  ${entry.label} -> ${sink.label}${where}${confidence}`);
  console.log(`  ${entry.file}:${entry.line}  mentions [${path.entryClasses.join(', ') || '-'}]`);

  for (const hop of path.evidence) {
    if (hop.kind === 'none') {
      console.log(`    ?  ${hop.to}  no hand-off found`);
    } else {
      console.log(`    ${hop.kind === 'argument' ? '->' : '<-'} ${hop.to}  ${hop.symbol} at ${hop.file}:${hop.line}`);
    }
  }

  console.log(`  ${sink.file}:${sink.line}  mentions [${path.sinkClasses.join(', ') || '-'}]`);
}

function summarise(target: string, result: ReturnType<typeof scan>): void {
  const byId = new Map(result.touchpoints.map((tp) => [tp.id, tp]));

  console.log(`\n${result.rootName}  (${target})`);
  console.log(`${result.fileCount} files scanned, ${result.skippedCount} skipped\n`);

  console.log('TOUCHPOINTS');
  console.log(`  entry ${String(result.stats.entries).padStart(5)}`);
  console.log(`  store ${String(result.stats.stores).padStart(5)}`);
  console.log(`  exit  ${String(result.stats.exits).padStart(5)}`);
  console.log(`  log   ${String(result.stats.logs).padStart(5)}`);

  console.log('\nREACHABILITY');
  console.log(`  ${result.paths.length} paths from an entry point to a sink`);
  console.log(
    `  ${result.stats.connectedEntries} of ${result.stats.entries} entry points reach at least one sink`,
  );
  console.log(`  longest path: ${result.stats.longestPath} hops`);
  console.log(
    `  ${result.stats.pathsCarryingValue} of ${result.paths.length} show a hand-off at every hop`,
  );

  const perRule = new Map<string, number>();
  for (const tp of result.touchpoints) perRule.set(tp.ruleId, (perRule.get(tp.ruleId) ?? 0) + 1);
  const ranked = [...perRule.entries()].sort((a, b) => b[1] - a[1]);
  const max = ranked[0]?.[1] ?? 0;

  console.log('\nRULE HITS');
  for (const [ruleId, count] of ranked) {
    console.log(`  ${ruleId.padEnd(30)} ${String(count).padStart(5)}  ${bar(count, max)}`);
  }

  // A short path to a database write is a strong claim. A long path to a log
  // line, through a chain of React components that merely import each other, is
  // the weakest thing the graph can produce. Rank accordingly, or the noise
  // buries the finding.
  const sinkRank: Record<string, number> = { exit: 0, store: 1, log: 2, entry: 3 };
  const strongest = [...result.paths]
    .sort((a, b) => {
      // Evidence outranks everything. A route to the network that cannot show a
      // hand-off is a worse lead than a route to a log line that can.
      if (a.carriesValue !== b.carriesValue) return Number(b.carriesValue) - Number(a.carriesValue);
      const ka = sinkRank[byId.get(a.sinkId)!.kind];
      const kb = sinkRank[byId.get(b.sinkId)!.kind];
      if (ka !== kb) return ka - kb;
      return a.hops.length - b.hops.length;
    })
    .slice(0, 10);

  console.log('\nSTRONGEST PATHS');
  for (const path of strongest) printPath(path, byId);

  const distribution = new Map<number, number>();
  for (const path of result.paths) {
    const hops = path.hops.length - 1;
    distribution.set(hops, (distribution.get(hops) ?? 0) + 1);
  }
  console.log('\nPATH LENGTHS');
  for (const [hops, count] of [...distribution].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${hops} hops ${String(count).padStart(5)}  ${bar(count, result.paths.length)}`);
  }

  console.log('\nFINDINGS');
  for (const finding of result.findings.slice(0, 15)) {
    console.log(`  [${finding.severity.padEnd(8)}] ${finding.title}`);
  }
}

/** Explains one module: what was detected in it, and what it links to. */
function inspect(result: ReturnType<typeof scan>, needle: string): void {
  const matches = result.modules.filter((module) => module.id.includes(needle));
  if (matches.length === 0) {
    console.log(`no module path contains "${needle}"`);
    return;
  }

  const byId = new Map(result.touchpoints.map((tp) => [tp.id, tp]));

  for (const module of matches.slice(0, 6)) {
    console.log(`\n${module.id}`);
    console.log(`  touchpoints: ${module.touchpoints.length}`);
    for (const id of module.touchpoints) {
      const tp = byId.get(id)!;
      console.log(`    ${tp.kind.padEnd(6)} line ${String(tp.line).padStart(4)}  ${tp.ruleId}`);
      console.log(`           ${tp.snippet.slice(0, 90)}`);
    }
    console.log(`  imports: ${module.imports.length}`);
    for (const id of module.imports.slice(0, 25)) console.log(`    -> ${id}`);

    const importers = result.modules.filter((other) => other.imports.includes(module.id));
    console.log(`  imported by: ${importers.length}`);
    for (const other of importers.slice(0, 8)) console.log(`    <- ${other.id}`);
  }
}

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const target = resolve(positional[0] ?? '.');
const wantsJson = args.includes('--json');
const debugIndex = args.indexOf('--module');
const pathIndex = args.indexOf('--paths');

const baselineIndex = args.indexOf('--baseline');
// The baseline belongs to the project being scanned. It is committed there, so
// that its history answers "when did we start sending data to this host".
const baselinePath =
  baselineIndex !== -1
    ? resolve(args[baselineIndex + 1] ?? '')
    : join(target, 'visdataarch.baseline.json');

const { files, skipped } = await collect(target);
const result = scan(files, basename(target), skipped);

if (args.includes('--update-baseline')) {
  await writeFile(baselinePath, `${JSON.stringify(buildBaseline(result), null, 2)}\n`, 'utf8');
  const { touchpoints, paths } = buildBaseline(result);
  console.log(
    `wrote ${baselinePath}\n  ${touchpoints.length} touchpoints, ${paths.length} confirmed routes`,
  );
} else if (args.includes('--check')) {
  let previous: Baseline | null = null;
  try {
    previous = JSON.parse(await readFile(baselinePath, 'utf8')) as Baseline;
  } catch {
    console.error(
      `No baseline at ${baselinePath}.\nRecord the current boundary first:\n  npm run scan -- ${positional[0] ?? '.'} --update-baseline`,
    );
    process.exit(2);
  }

  const diff = diffBaseline(previous, buildBaseline(result));
  console.log(formatDiff(diff));
  if (hasAdditions(diff)) process.exit(1);
} else if (pathIndex !== -1) {
  const needle = args[pathIndex + 1] ?? '';
  const byId = new Map(result.touchpoints.map((tp) => [tp.id, tp]));
  const hits = result.paths.filter((path) => {
    const entry = byId.get(path.entryId)!;
    const sink = byId.get(path.sinkId)!;
    return (
      entry.file.includes(needle) ||
      sink.file.includes(needle) ||
      path.hops.some((hop) => hop.includes(needle))
    );
  });

  console.log(`\n${hits.length} paths touching "${needle}"`);
  for (const path of hits.slice(0, 20)) printPath(path, byId);
} else if (debugIndex !== -1) inspect(result, args[debugIndex + 1] ?? '');
else if (wantsJson) console.log(JSON.stringify(result, null, 2));
else summarise(target, result);
