/**
 * THE CONTRACT.
 *
 * This file is the only hard dependency between the scanner half (src/core)
 * and the visualisation half (src/ui). Freeze it early; change it only by
 * agreement, because every change breaks the other person's work in progress.
 */

/** Where the data physically ends up. */
export type Jurisdiction =
  | 'local' // never leaves the user's machine
  | 'self-hosted' // infrastructure the project team controls
  | 'eu'
  | 'us'
  | 'cn'
  | 'global' // CDN / anycast, no single answer
  | 'unknown';

/** How much control the project still has over the data once it is there. */
export type SovereigntyLevel =
  | 'sovereign' // we own the machine and the keys
  | 'controlled' // third party, but data is encrypted or contractually fenced
  | 'delegated' // third party holds plaintext, we hold a contract
  | 'exposed'; // third party holds plaintext, terms allow secondary use

/** What kind of data is moving. Drives edge colour and finding severity. */
export type DataClass =
  | 'pii'
  | 'auth'
  | 'payment'
  | 'health'
  | 'content'
  | 'telemetry'
  | 'unknown';

export type NodeKind =
  | 'app' // the code being scanned
  | 'browser' // the end user's device
  | 'store' // database, object storage, cache
  | 'service' // backend we run ourselves
  | 'thirdParty'; // someone else's servers

export interface Evidence {
  /** Path relative to the scanned root. */
  file: string;
  line: number;
  /** Single line, trimmed, truncated to 200 chars. Never include secrets. */
  snippet: string;
  ruleId: string;
}

export interface DataNode {
  id: string;
  label: string;
  kind: NodeKind;
  jurisdiction: Jurisdiction;
  sovereignty: SovereigntyLevel;
  /** Company behind the node, when it is a third party. */
  vendor?: string;
}

export interface DataFlow {
  id: string;
  /** DataNode.id */
  source: string;
  /** DataNode.id */
  target: string;
  label: string;
  dataClasses: DataClass[];
  encrypted: boolean | 'unknown';
  evidence: Evidence[];
}

export type Severity = 'info' | 'warn' | 'critical';

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  /** One or two sentences, plain English, aimed at a non-engineer. */
  detail: string;
  nodeId?: string;
  flowId?: string;
  evidence: Evidence[];
}

export interface ScanStats {
  sovereign: number;
  controlled: number;
  delegated: number;
  exposed: number;
}

/**
 * The single object handed from the scanner to the UI.
 * The UI must render correctly for any valid ScanResult, including an empty one.
 */
export interface ScanResult {
  /** ISO 8601. */
  scannedAt: string;
  rootName: string;
  fileCount: number;
  skippedCount: number;
  nodes: DataNode[];
  flows: DataFlow[];
  findings: Finding[];
  stats: ScanStats;
}

/** A file the scanner has already read into memory. */
export interface ScannedFile {
  /** Path relative to the scanned root, POSIX separators. */
  path: string;
  text: string;
}

/**
 * A detection rule. Rules are data, not code paths: adding a vendor should be
 * a matter of appending an object to the rule pack, nothing else.
 */
export interface Rule {
  id: string;
  /** Human name of the destination, e.g. "Stripe". */
  vendor: string;
  kind: NodeKind;
  jurisdiction: Jurisdiction;
  sovereignty: SovereigntyLevel;
  dataClasses: DataClass[];
  /** Any match counts as a hit. Must be global-free (no /g) to stay reusable. */
  patterns: RegExp[];
  /** Optional filter on file path; omit to scan every text file. */
  pathPattern?: RegExp;
  /** Edge label in the graph, e.g. "card payments". */
  flowLabel: string;
  severity: Severity;
  /** Shown in the findings panel. Plain English, no jargon. */
  explain: string;
}
