import type { ScanResult, TouchpointKind } from './types';

/**
 * The data boundary, written down so that changes to it become reviewable.
 *
 * A map is something you look at once. The question a developer actually has is
 * never "what does my architecture look like", it is "did this change add a new
 * way for data to leave". That question has to be asked automatically, on every
 * change, or it does not get asked at all.
 *
 * So the boundary is committed to the repository and compared against on each
 * run. Nothing is reported unless it moved. This also makes the scanner's
 * imprecision survivable: several hundred existing routes are unreadable, but
 * "two new ones since last week" is not, and a false positive accepted into the
 * baseline once never interrupts anybody again.
 */

export const BASELINE_VERSION = 1;

export interface BaselineTouchpoint {
  key: string;
  file: string;
  ruleId: string;
  kind: TouchpointKind;
  label: string;
  destination?: string;
  /** Shown to the reader, deliberately not part of the comparison. */
  count: number;
}

export interface BaselinePath {
  key: string;
  from: string;
  to: string;
  hops: number;
}

export interface Baseline {
  version: number;
  root: string;
  touchpoints: BaselineTouchpoint[];
  paths: BaselinePath[];
}

export interface BaselineDiff {
  addedTouchpoints: BaselineTouchpoint[];
  removedTouchpoints: BaselineTouchpoint[];
  addedPaths: BaselinePath[];
  removedPaths: BaselinePath[];
}

/**
 * Identity of a touchpoint, chosen to survive ordinary editing.
 *
 * Line numbers are excluded on purpose. Keyed by line, inserting an import at
 * the top of a file would report every touchpoint below it as removed and
 * re-added, and a check that cries wolf on an unrelated edit gets switched off
 * within the week.
 *
 * The count is excluded for the same reason at a smaller scale. A file that
 * already logs gaining a second log line has not moved the boundary; the first
 * one did.
 */
function touchpointKey(file: string, ruleId: string, destination?: string): string {
  return `${file}|${ruleId}|${destination ?? ''}`;
}

function pathKey(entryFile: string, entryRule: string, sinkFile: string, sinkRule: string): string {
  return `${entryFile}|${entryRule}>${sinkFile}|${sinkRule}`;
}

/**
 * Note what is absent: the timestamp, the file count, the hop lists. Anything
 * that moves on its own would put noise into every diff and bury the one line
 * that matters.
 */
export function buildBaseline(result: ScanResult): Baseline {
  const byId = new Map(result.touchpoints.map((tp) => [tp.id, tp]));

  const touchpoints = new Map<string, BaselineTouchpoint>();
  for (const tp of result.touchpoints) {
    const key = touchpointKey(tp.file, tp.ruleId, tp.destination);
    const existing = touchpoints.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    touchpoints.set(key, {
      key,
      file: tp.file,
      ruleId: tp.ruleId,
      kind: tp.kind,
      label: tp.label,
      destination: tp.destination,
      count: 1,
    });
  }

  const paths = new Map<string, BaselinePath>();
  for (const path of result.paths) {
    // Only routes the scanner can prove. An unconfirmed path is its own
    // uncertainty, and failing somebody's build over it is how a useful check
    // earns a reputation for being wrong.
    if (!path.carriesValue) continue;

    const entry = byId.get(path.entryId);
    const sink = byId.get(path.sinkId);
    if (!entry || !sink) continue;

    const key = pathKey(entry.file, entry.ruleId, sink.file, sink.ruleId);
    if (paths.has(key)) continue;

    paths.set(key, {
      key,
      from: `${entry.label} in ${entry.file}`,
      to: `${sink.label}${sink.destination ? ` (${sink.destination})` : ''} in ${sink.file}`,
      hops: path.hops.length - 1,
    });
  }

  const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);

  return {
    version: BASELINE_VERSION,
    root: result.rootName,
    touchpoints: [...touchpoints.values()].sort(byKey),
    paths: [...paths.values()].sort(byKey),
  };
}

export function diffBaseline(previous: Baseline, current: Baseline): BaselineDiff {
  const previousTouchpoints = new Set(previous.touchpoints.map((tp) => tp.key));
  const currentTouchpoints = new Set(current.touchpoints.map((tp) => tp.key));
  const previousPaths = new Set(previous.paths.map((path) => path.key));
  const currentPaths = new Set(current.paths.map((path) => path.key));

  return {
    addedTouchpoints: current.touchpoints.filter((tp) => !previousTouchpoints.has(tp.key)),
    removedTouchpoints: previous.touchpoints.filter((tp) => !currentTouchpoints.has(tp.key)),
    addedPaths: current.paths.filter((path) => !previousPaths.has(path.key)),
    removedPaths: previous.paths.filter((path) => !currentPaths.has(path.key)),
  };
}

/**
 * Only additions fail. Removing a way for data to leave is the outcome the tool
 * exists to encourage, and a check that punishes it would be arguing against
 * itself. Removals are still reported, so the baseline gets tidied up.
 */
export function hasAdditions(diff: BaselineDiff): boolean {
  return diff.addedTouchpoints.length > 0 || diff.addedPaths.length > 0;
}

export function isEmpty(diff: BaselineDiff): boolean {
  return (
    !hasAdditions(diff) &&
    diff.removedTouchpoints.length === 0 &&
    diff.removedPaths.length === 0
  );
}

/** Plain lines, readable in a terminal and in a pull request comment alike. */
export function formatDiff(diff: BaselineDiff): string {
  if (isEmpty(diff)) return 'The data boundary is unchanged.';

  const out: string[] = [];

  if (diff.addedPaths.length > 0) {
    out.push(`New routes from an entry point to a sink (${diff.addedPaths.length}):`);
    for (const path of diff.addedPaths) {
      out.push(`  + ${path.from}`);
      out.push(`      reaches ${path.to} in ${path.hops} ${path.hops === 1 ? 'hop' : 'hops'}`);
    }
    out.push('');
  }

  if (diff.addedTouchpoints.length > 0) {
    out.push(`New touchpoints (${diff.addedTouchpoints.length}):`);
    for (const tp of diff.addedTouchpoints) {
      const where = tp.destination ? ` -> ${tp.destination}` : '';
      out.push(`  + ${tp.kind.padEnd(5)} ${tp.label}${where}  ${tp.file}`);
    }
    out.push('');
  }

  const removed = diff.removedPaths.length + diff.removedTouchpoints.length;
  if (removed > 0) {
    out.push(`Gone since the baseline (${removed}), which does not fail the check:`);
    for (const path of diff.removedPaths) out.push(`  - ${path.from} -> ${path.to}`);
    for (const tp of diff.removedTouchpoints) out.push(`  - ${tp.label}  ${tp.file}`);
    out.push('');
  }

  out.push('If every line above is intended, run `npm run scan -- <dir> --update-baseline`');
  out.push('and commit the result, so the change is recorded rather than discovered later.');

  return out.join('\n');
}
