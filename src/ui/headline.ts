import type { Jurisdiction, ScanResult } from '../core/types';
import { JURISDICTION_PHRASE } from './theme';

/**
 * The one number a person can repeat after the demo, derived from the
 * ScanResult alone so the panel and the PNG export always agree.
 */
export interface Headline {
  /** Every node the project hands data to: stores, services and third parties. */
  destinations: number;
  /** Destinations holding readable data: delegated plus exposed. */
  outsideControl: number;
  /** The jurisdiction holding the most destinations, when there are any. */
  top: { jurisdiction: Jurisdiction; count: number } | null;
}

export function headline(result: ScanResult): Headline {
  const destinations = result.nodes.filter((node) => node.kind !== 'app' && node.kind !== 'browser');

  const byJurisdiction = new Map<Jurisdiction, number>();
  destinations.forEach((node) => {
    byJurisdiction.set(node.jurisdiction, (byJurisdiction.get(node.jurisdiction) ?? 0) + 1);
  });

  let top: Headline['top'] = null;
  byJurisdiction.forEach((count, jurisdiction) => {
    if (!top || count > top.count) top = { jurisdiction, count };
  });

  return {
    destinations: destinations.length,
    outsideControl: result.stats.delegated + result.stats.exposed,
    top,
  };
}

/** Lead is the large text; rest completes it, e.g. "5 outside your control, 4 in the United States". */
export function headlineParts(summary: Headline): { lead: string; rest: string } {
  const lead = `${summary.destinations} ${summary.destinations === 1 ? 'destination' : 'destinations'}`;
  if (summary.destinations === 0) return { lead, rest: 'Nothing leaves this project yet.' };

  const rest = [`${summary.outsideControl} outside your control`];
  if (summary.top) rest.push(`${summary.top.count} ${JURISDICTION_PHRASE[summary.top.jurisdiction]}`);
  return { lead, rest: rest.join(', ') };
}

/** "7 destinations, 5 outside your control, 4 in the United States" */
export function headlineSentence(summary: Headline): string {
  const { lead, rest } = headlineParts(summary);
  return summary.destinations === 0 ? lead : `${lead}, ${rest}`;
}
