import type { ScanResult, Touchpoint } from './types';

/**
 * The shape the graph and the panel actually read.
 *
 * A full ScanResult carries every module and every unused touchpoint, which is
 * what the reachability search needed and what a gallery payload does not.
 * Dropping the import graph is the difference between a file you can commit
 * and a 2000-file dump nobody should open in git.
 */
export function slim(result: ScanResult): ScanResult {
  const used = new Set<string>();
  for (const path of result.paths) {
    used.add(path.entryId);
    used.add(path.sinkId);
  }
  for (const finding of result.findings) {
    if (finding.touchpointId) used.add(finding.touchpointId);
  }

  const touchpoints: Touchpoint[] = result.touchpoints.filter((tp) => used.has(tp.id));

  return {
    ...result,
    modules: [],
    touchpoints,
  };
}
