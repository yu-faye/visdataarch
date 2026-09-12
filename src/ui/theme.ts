import type { DataClass, Jurisdiction, Severity, SovereigntyLevel } from '../core/types';

/**
 * One source of truth for the visual language, shared by the graph and the
 * findings panel. If the two halves drift apart the map stops being readable,
 * so colour decisions live here rather than in either component.
 */

export const SOVEREIGNTY_COLOR: Record<SovereigntyLevel, string> = {
  sovereign: '#2f9e6e',
  controlled: '#3f7fd6',
  delegated: '#d99424',
  exposed: '#d1495b',
};

export const SOVEREIGNTY_LABEL: Record<SovereigntyLevel, string> = {
  sovereign: 'Sovereign',
  controlled: 'Controlled',
  delegated: 'Delegated',
  exposed: 'Exposed',
};

export const SOVEREIGNTY_MEANING: Record<SovereigntyLevel, string> = {
  sovereign: 'You run the machine and hold the keys.',
  controlled: 'Someone else runs it, but the region and the data are yours to move.',
  delegated: 'A third party holds readable data under a contract.',
  exposed: 'A third party holds readable data and may use it for their own purposes.',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#d1495b',
  warn: '#d99424',
  info: '#3f7fd6',
};

export const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  local: 'On device',
  'self-hosted': 'Self-hosted',
  eu: 'European Union',
  us: 'United States',
  cn: 'China',
  global: 'Global CDN',
  unknown: 'Unverified',
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

export const SOVEREIGNTY_ORDER: SovereigntyLevel[] = [
  'sovereign',
  'controlled',
  'delegated',
  'exposed',
];

/** Most sensitive first. A flow takes the colour of the worst thing it carries. */
export const DATA_CLASS_ORDER: DataClass[] = [
  'health',
  'payment',
  'auth',
  'pii',
  'content',
  'telemetry',
  'unknown',
];

/**
 * Edge colours. Deliberately lighter and cooler than the sovereignty palette
 * so the two dimensions never read as one: nodes say who controls the data,
 * edges say what the data is.
 */
export const DATA_CLASS_COLOR: Record<DataClass, string> = {
  health: '#b678d8',
  payment: '#d98b6e',
  auth: '#c9b458',
  pii: '#62b6c4',
  content: '#8a9cc0',
  telemetry: '#7f8c8a',
  unknown: '#4a4a52',
};

/** Edge width in pixels, by the severity of the finding on that flow. */
export const SEVERITY_EDGE_WIDTH: Record<Severity, number> = {
  critical: 4,
  warn: 2.5,
  info: 1.5,
};
