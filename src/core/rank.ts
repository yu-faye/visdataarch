import { EXIT_ROLE_ORDER } from './types';
import type { DataPath, ExitRole, Touchpoint } from './types';

const SINK_RANK: Record<string, number> = { exit: 0, store: 1, log: 2, entry: 3 };

/**
 * Shared sort for the graph, the CLI, and the findings list.
 *
 * A default-on vendor exit outranks an opt-in one, which outranks the product
 * talking to the world on purpose. Evidence still beats a guess: a confirmed
 * opt-in route is a better lead than an unconfirmed default.
 */
export function comparePaths(
  a: DataPath,
  b: DataPath,
  byId: Map<string, Touchpoint>,
): number {
  if (a.carriesValue !== b.carriesValue) return Number(b.carriesValue) - Number(a.carriesValue);

  const sa = byId.get(a.sinkId);
  const sb = byId.get(b.sinkId);
  const ra = EXIT_ROLE_ORDER[(sa?.role ?? 'product') as ExitRole];
  const rb = EXIT_ROLE_ORDER[(sb?.role ?? 'product') as ExitRole];
  if (ra !== rb) return ra - rb;

  const ka = SINK_RANK[sa?.kind ?? 'entry'];
  const kb = SINK_RANK[sb?.kind ?? 'entry'];
  if (ka !== kb) return ka - kb;

  return a.hops.length - b.hops.length;
}
