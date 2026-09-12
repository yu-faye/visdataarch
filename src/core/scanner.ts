import { buildModuleIndex, extractImports } from './imports';
import { RULES } from './rules';
import { SINK_KINDS } from './types';
import type {
  DataClass,
  DataPath,
  Finding,
  Module,
  Rule,
  ScanResult,
  ScanStats,
  ScannedFile,
  Severity,
  Touchpoint,
} from './types';

/** Beyond this depth a claim of "the data gets there" stops being credible. */
const MAX_HOPS = 8;
/** One entry point that reaches sixty sinks is noise, not a finding. */
const MAX_PATHS_PER_ENTRY = 12;
const MAX_TOUCHPOINTS_PER_RULE_PER_FILE = 3;
const MAX_SNIPPET_LENGTH = 200;

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

/**
 * Identifiers that betray what kind of data is in scope. Inferring the class
 * from the surrounding code is the difference between a statement about the
 * vendor and a statement about this codebase.
 */
const DATA_CLASS_HINTS: [RegExp, DataClass][] = [
  [/\b(email|e_mail|phone|address|firstname|lastname|full_?name|dob|birth|ssn|nin|postcode|zip)\b/i, 'pii'],
  [/\b(password|passwd|secret|token|api_?key|credential|session_?id|auth)\b/i, 'auth'],
  [/\b(card|iban|payment|invoice|billing|amount|currency|revenue)\b/i, 'payment'],
  [/\b(diagnosis|patient|medical|health|prescription)\b/i, 'health'],
  [/\b(ip_?address|user_?agent|referrer|fingerprint|pageview|screen|device)\b/i, 'telemetry'],
  [/\b(body|content|document|message|note|comment|upload|file|recording|replay)\b/i, 'content'],
];

function inferDataClasses(lines: string[], index: number): DataClass[] {
  const from = Math.max(0, index - 3);
  const to = Math.min(lines.length, index + 4);
  const window = lines.slice(from, to).join('\n');

  const found = new Set<DataClass>();
  for (const [pattern, cls] of DATA_CLASS_HINTS) {
    if (pattern.test(window)) found.add(cls);
  }
  return [...found];
}

function matchRuleInFile(rule: Rule, file: ScannedFile, lines: string[]): Touchpoint[] {
  if (rule.pathPattern && !rule.pathPattern.test(file.path)) return [];

  const hits: Touchpoint[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!rule.patterns.some((pattern) => pattern.test(line))) continue;

    const inferred = inferDataClasses(lines, i);
    const declared = rule.dataClasses.filter((cls) => cls !== 'unknown');
    const classes = [...new Set([...declared, ...inferred])];

    hits.push({
      id: `tp:${file.path}:${i + 1}:${rule.id}`,
      moduleId: file.path,
      file: file.path,
      line: i + 1,
      kind: rule.kind,
      label: rule.label,
      destination: rule.destination,
      jurisdiction: rule.jurisdiction,
      sovereignty: rule.sovereignty,
      dataClasses: classes.length > 0 ? classes : ['unknown'],
      snippet: line.trim().slice(0, MAX_SNIPPET_LENGTH),
      ruleId: rule.id,
    });

    if (hits.length >= MAX_TOUCHPOINTS_PER_RULE_PER_FILE) break;
  }

  return hits;
}

/**
 * Data flow edges, which are not the same thing as import edges.
 *
 * When a file imports a helper and hands data to it, data travels the same way
 * as the import: `route.ts` imports `saveEvent`, and the payload flows into it.
 *
 * When a file imports a helper and gets data back, it travels the other way.
 * This is not an edge case. Real codebases funnel every request through one
 * parsing helper, so the entry point lives in a file that the handlers import
 * rather than in the handlers themselves. Following imports alone would report
 * that nothing reaches anything, which is exactly what the first run on umami
 * did: 127 route handlers, zero cross-file paths.
 *
 * So a module holding an entry touchpoint also flows to whoever imports it.
 * That reversal is limited to entry modules on purpose. Reversing every edge
 * would make the graph effectively undirected, and then everything reaches
 * everything, which is the same as knowing nothing.
 */
function buildFlowEdges(modules: Module[], entryModules: Set<string>): Map<string, string[]> {
  const edges = new Map<string, string[]>();

  for (const module of modules) {
    const existing = edges.get(module.id);
    if (existing) existing.push(...module.imports);
    else edges.set(module.id, [...module.imports]);

    for (const imported of module.imports) {
      if (!entryModules.has(imported)) continue;
      const back = edges.get(imported);
      if (back) back.push(module.id);
      else edges.set(imported, [module.id]);
    }
  }

  return edges;
}

/**
 * Shortest chains from one entry module to every sink module it can reach.
 *
 * Breadth first, so the first time a sink module is seen the chain leading to it
 * is the shortest one. Only the shortest is kept: showing every route between
 * two files buries the fact that a route exists at all, which is the finding.
 */
function reachableSinks(
  start: string,
  edges: Map<string, string[]>,
  sinkModules: Set<string>,
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const seen = new Set<string>([start]);
  let frontier: { id: string; chain: string[] }[] = [{ id: start, chain: [start] }];

  for (let depth = 0; depth < MAX_HOPS && frontier.length > 0; depth += 1) {
    const next: { id: string; chain: string[] }[] = [];

    for (const { id, chain } of frontier) {
      for (const target of edges.get(id) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);

        const extended = [...chain, target];
        if (sinkModules.has(target)) found.set(target, extended);
        next.push({ id: target, chain: extended });
      }
    }

    frontier = next;
  }

  return found;
}

function buildStats(touchpoints: Touchpoint[], paths: DataPath[]): ScanStats {
  const connected = new Set(paths.map((path) => path.entryId));
  return {
    entries: touchpoints.filter((tp) => tp.kind === 'entry').length,
    stores: touchpoints.filter((tp) => tp.kind === 'store').length,
    exits: touchpoints.filter((tp) => tp.kind === 'exit').length,
    logs: touchpoints.filter((tp) => tp.kind === 'log').length,
    connectedEntries: connected.size,
    longestPath: paths.reduce((max, path) => Math.max(max, path.hops.length - 1), 0),
  };
}

function buildFindings(
  touchpoints: Touchpoint[],
  paths: DataPath[],
  byId: Map<string, Touchpoint>,
): Finding[] {
  const findings: Finding[] = [];
  const ruleById = new Map(RULES.map((rule) => [rule.id, rule]));

  // A route that leaves the process is the thing worth leading with.
  const leaving = paths.filter((path) => {
    const sink = byId.get(path.sinkId);
    return sink?.kind === 'exit' || sink?.kind === 'log';
  });

  const seenPair = new Set<string>();
  for (const path of leaving) {
    const entry = byId.get(path.entryId);
    const sink = byId.get(path.sinkId);
    if (!entry || !sink) continue;

    // One finding per pair of rules, not per pair of lines, or the panel fills
    // with fifty restatements of the same architectural fact.
    const pair = `${entry.ruleId}->${sink.ruleId}`;
    if (seenPair.has(pair)) continue;
    seenPair.add(pair);

    const hops = path.hops.length - 1;
    const where = sink.destination ? ` (${sink.destination})` : '';

    findings.push({
      id: `finding:path:${path.id}`,
      ruleId: sink.ruleId,
      severity: ruleById.get(sink.ruleId)?.severity ?? 'info',
      title: `${entry.label} reaches ${sink.label}${where} in ${hops} ${hops === 1 ? 'hop' : 'hops'}`,
      detail: ruleById.get(sink.ruleId)?.explain ?? '',
      touchpointId: sink.id,
      pathId: path.id,
    });
  }

  // Then the touchpoints that matter on their own, aggregated by rule.
  const byRule = new Map<string, Touchpoint[]>();
  for (const tp of touchpoints) {
    const list = byRule.get(tp.ruleId);
    if (list) list.push(tp);
    else byRule.set(tp.ruleId, [tp]);
  }

  for (const [ruleId, hits] of byRule) {
    const rule = ruleById.get(ruleId);
    if (!rule || rule.severity === 'info') continue;

    const files = new Set(hits.map((hit) => hit.file)).size;
    findings.push({
      id: `finding:rule:${ruleId}`,
      ruleId,
      severity: rule.severity,
      title: `${rule.label} in ${files} ${files === 1 ? 'file' : 'files'}`,
      detail: rule.explain,
      touchpointId: hits[0].id,
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return findings;
}

/**
 * Pure. Same input always produces the same ScanResult, which is what makes the
 * fixtures a trustworthy development target for the UI.
 */
export function scan(files: ScannedFile[], rootName: string, skippedCount = 0): ScanResult {
  const index = buildModuleIndex(files);

  const touchpoints: Touchpoint[] = [];
  const modules: Module[] = [];

  for (const file of files) {
    const lines = file.text.split('\n');
    const found = RULES.flatMap((rule) => matchRuleInFile(rule, file, lines));
    touchpoints.push(...found);

    modules.push({
      id: file.path,
      imports: extractImports(file, index),
      touchpoints: found.map((tp) => tp.id),
    });
  }

  const byId = new Map(touchpoints.map((tp) => [tp.id, tp]));
  const entryModules = new Set(
    touchpoints.filter((tp) => tp.kind === 'entry').map((tp) => tp.moduleId),
  );
  const edges = buildFlowEdges(modules, entryModules);

  const sinksByModule = new Map<string, Touchpoint[]>();
  for (const tp of touchpoints) {
    if (!SINK_KINDS.includes(tp.kind)) continue;
    const list = sinksByModule.get(tp.moduleId);
    if (list) list.push(tp);
    else sinksByModule.set(tp.moduleId, [tp]);
  }
  const sinkModules = new Set(sinksByModule.keys());

  const paths: DataPath[] = [];
  const chainCache = new Map<string, Map<string, string[]>>();

  for (const entry of touchpoints) {
    if (entry.kind !== 'entry') continue;

    let chains = chainCache.get(entry.moduleId);
    if (!chains) {
      chains = reachableSinks(entry.moduleId, edges, sinkModules);
      chainCache.set(entry.moduleId, chains);
    }

    // A sink in the same file as the entry is still a real path, zero hops long.
    const local = sinksByModule.get(entry.moduleId);
    const targets: [string, string[]][] = local ? [[entry.moduleId, [entry.moduleId]]] : [];
    targets.push(...chains);

    const ranked = targets
      .sort((a, b) => a[1].length - b[1].length)
      .slice(0, MAX_PATHS_PER_ENTRY);

    for (const [sinkModuleId, hops] of ranked) {
      const sink = sinksByModule.get(sinkModuleId)?.[0];
      if (!sink) continue;

      paths.push({
        id: `path:${entry.id}->${sink.id}`,
        entryId: entry.id,
        sinkId: sink.id,
        hops,
        dataClasses: [...new Set([...entry.dataClasses, ...sink.dataClasses])].filter(
          (cls) => cls !== 'unknown',
        ),
      });
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    rootName,
    fileCount: files.length,
    skippedCount,
    modules,
    touchpoints,
    paths,
    findings: buildFindings(touchpoints, paths, byId),
    stats: buildStats(touchpoints, paths),
  };
}
