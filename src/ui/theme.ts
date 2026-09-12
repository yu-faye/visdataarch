import type {
  DataClass,
  ExitRole,
  Jurisdiction,
  Severity,
  SovereigntyLevel,
  TouchpointKind,
} from '../core/types';

/**
 * One source of truth for the visual language, shared by the graph and the
 * findings panel. If the two drift apart the map stops being readable, so the
 * colour and wording decisions live here rather than in either component.
 */

export const KIND_COLOR: Record<TouchpointKind, string> = {
  entry: '#3f7fd6',
  store: '#2f9e6e',
  exit: '#d1495b',
  log: '#d99424',
};

export const KIND_LABEL: Record<TouchpointKind, string> = {
  entry: 'Entry',
  store: 'Storage',
  exit: 'Exit',
  log: 'Log',
};

export const KIND_MEANING: Record<TouchpointKind, string> = {
  entry: 'Data arrives from outside the process here.',
  store: 'Data comes to rest here and is subject to retention and deletion duties.',
  exit: 'Data leaves the process here, over the network or to disk.',
  log: 'Data is written to logs, which is the most common accidental egress channel.',
};

/** Left to right, in the order data travels. */
export const KIND_ORDER: TouchpointKind[] = ['entry', 'store', 'log', 'exit'];

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#d1495b',
  warn: '#d99424',
  info: '#3f7fd6',
};

/**
 * Edges on the map. What a route looks like is decided here, next to the
 * severity colours, so the legend in the panel and the lines on the graph
 * cannot drift apart.
 *
 * Weight and colour follow the severity of the finding at the route's sink.
 * That is the one judgement the scanner actually makes about a route; the
 * data classes seen near either end are hints about those lines and never
 * label an edge, because an edge label reads as a claim about what travels.
 */
export const SEVERITY_EDGE_WIDTH: Record<Severity, number> = {
  critical: 3.5,
  warn: 2.5,
  info: 1.5,
};

/**
 * A route the scanner cannot show a value travelling along is dashed and
 * dimmer, so on the map it never outranks a route it can prove.
 */
export const EDGE_UNCONFIRMED_OPACITY = 0.55;
export const EDGE_DASH_PATTERN: [number, number] = [5, 4];

export const EDGE_MEANING = {
  solid: 'Solid: every hop points at a line where a value changes hands.',
  dashed:
    'Dashed: the files are connected, but the scanner could not find the line where data makes the trip.',
  weight:
    'Colour and weight follow the finding at the far end of the route: thickest and red is critical, then warning, then informational.',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'critical',
  warn: 'warning',
  info: 'informational',
};

export const SEVERITY_ORDER_UI: Severity[] = ['critical', 'warn', 'info'];

/** Short enough to sit on an edge label next to the hop count. */
export const EXIT_ROLE_SHORT: Record<ExitRole, string> = {
  default: 'on by default',
  'opt-in': 'opt-in',
  product: 'the product',
};

export const DATA_CLASS_LABEL: Record<DataClass, string> = {
  pii: 'personal data',
  auth: 'credentials',
  payment: 'payment data',
  health: 'health data',
  content: 'user content',
  telemetry: 'telemetry',
  unknown: 'unclassified',
};

/**
 * Jurisdiction and sovereignty describe the outside world, so they annotate a
 * destination rather than define it. Data in an EU datacentre run by a US
 * company is 'eu' and 'delegated' at once, and collapsing the two into a single
 * axis is the most common mistake in this area.
 */
export const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  local: 'On device',
  'self-hosted': 'Self-hosted',
  eu: 'European Union',
  uk: 'United Kingdom',
  us: 'United States',
  ca: 'Canada',
  cn: 'China',
  global: 'Global CDN',
  unknown: 'Unverified',
};

export const EXIT_ROLE_LABEL: Record<ExitRole, string> = {
  default: 'fires on a default install',
  'opt-in': 'fires only if configured',
  product: 'the product talking to the world',
};

export const SOVEREIGNTY_LABEL: Record<SovereigntyLevel, string> = {
  sovereign: 'Sovereign',
  controlled: 'Controlled',
  delegated: 'Delegated',
  exposed: 'Exposed',
};
