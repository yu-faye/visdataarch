/**
 * THE CONTRACT.
 *
 * This file is the only hard dependency between the scanner half (src/core)
 * and the visualisation half (src/ui). Freeze it early; change it only by
 * agreement, because every change breaks the other person's work in progress.
 *
 * The tool answers one question: inside this codebase, where does data come in,
 * where does it end up, and which entry points have a path to which sinks. Every
 * claim it makes has to be derivable from the source in front of it. Facts about
 * the outside world, such as which country a vendor operates in, are annotations
 * on top of that, never the substance.
 */

/** Where the data physically ends up. Only meaningful for a known destination. */
export type Jurisdiction =
  | 'local' // never leaves the user's machine
  | 'self-hosted' // infrastructure the project team controls
  | 'eu'
  | 'uk'
  | 'us'
  | 'ca'
  | 'cn'
  | 'global' // CDN / anycast, no single answer
  | 'unknown';

/** How much control the project still has over the data once it is there. */
export type SovereigntyLevel =
  | 'sovereign' // we own the machine and the keys
  | 'controlled' // third party, but the region and the data are ours to move
  | 'delegated' // third party holds plaintext under a contract
  | 'exposed'; // third party holds plaintext and may use it for their own ends

/** What kind of data is moving. */
export type DataClass =
  | 'pii'
  | 'auth'
  | 'payment'
  | 'health'
  | 'content'
  | 'telemetry'
  | 'unknown';

export type Severity = 'info' | 'warn' | 'critical';

/**
 * What a single line of code does to data.
 *
 * `log` is split out from `exit` on purpose. Writing to stdout is the most
 * common accidental egress channel in any codebase, and burying it among
 * deliberate network calls hides exactly the thing worth seeing.
 */
export type TouchpointKind =
  | 'entry' // data arrives from outside the process
  | 'store' // data is persisted
  | 'exit' // data leaves over the network or to disk
  | 'log'; // data is written to logs or stdout

/** Anything that is not an entry is somewhere data can come to rest or leave. */
export const SINK_KINDS: TouchpointKind[] = ['store', 'exit', 'log'];

/** A single location in the code that reads, persists or emits data. */
export interface Touchpoint {
  id: string;
  /** Module.id of the file it lives in. */
  moduleId: string;
  /** Path relative to the scanned root, POSIX separators. */
  file: string;
  line: number;
  kind: TouchpointKind;
  /** What happens here, e.g. "request body", "Prisma write", "outbound fetch". */
  label: string;
  /** Named counterparty when the code identifies one, e.g. "PostgreSQL". */
  destination?: string;
  jurisdiction?: Jurisdiction;
  sovereignty?: SovereigntyLevel;
  dataClasses: DataClass[];
  /** Single line, trimmed, truncated. Never include secrets. */
  snippet: string;
  ruleId: string;
}

/** One source file, plus the edges it has to other source files. */
export interface Module {
  /** Path relative to the scanned root. Doubles as the display id. */
  id: string;
  /** Module ids this file imports, already resolved. Unresolved ones are dropped. */
  imports: string[];
  /**
   * The subset of `imports` where the imported binding is actually invoked or
   * has its members used, rather than only rendered as a JSX tag.
   *
   * Reachability runs over this, not over `imports`. An import on its own is
   * not evidence that data travels: a component importing another component is
   * the most common edge in a front end and carries nothing.
   */
  flows: string[];
  /** Touchpoint ids found in this file. */
  touchpoints: string[];
}

/**
 * A route from an entry touchpoint to a sink, over the import graph.
 *
 * `hops` holds every module on the way, so the UI can collapse the middle into
 * a count and still offer the detail on demand. In a real codebase most files
 * are plumbing, and drawing them all produces a hairball nobody can read.
 */
export interface DataPath {
  id: string;
  /** Touchpoint.id of kind 'entry'. */
  entryId: string;
  /** Touchpoint.id of a sink kind. */
  sinkId: string;
  /** Ordered module ids, entry module first, sink module last. */
  hops: string[];
  dataClasses: DataClass[];
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  /** One or two sentences, plain English, aimed at a non-engineer. */
  detail: string;
  touchpointId?: string;
  pathId?: string;
}

export interface ScanStats {
  entries: number;
  stores: number;
  exits: number;
  logs: number;
  /** Entry points with at least one path to a sink. The headline number. */
  connectedEntries: number;
  /** Hop count of the longest path found. */
  longestPath: number;
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
  modules: Module[];
  touchpoints: Touchpoint[];
  paths: DataPath[];
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
 * A detection rule. Rules are data, not code paths: adding a pattern should be
 * a matter of appending an object to the rule pack, nothing else.
 */
export interface Rule {
  id: string;
  kind: TouchpointKind;
  /** Edge and node label, e.g. "request body". Keep it short. */
  label: string;
  /** Named counterparty, when the pattern identifies one. */
  destination?: string;
  jurisdiction?: Jurisdiction;
  sovereignty?: SovereigntyLevel;
  dataClasses: DataClass[];
  /** Any match counts as a hit. Must not carry /g, so they stay reusable. */
  patterns: RegExp[];
  /** Optional filter on file path; omit to check every scanned file. */
  pathPattern?: RegExp;
  severity: Severity;
  /** Shown in the findings panel. Plain English, no jargon. */
  explain: string;
}
