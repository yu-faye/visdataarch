import { buildModuleIndex, extractImports, findPass } from './imports';
import { RULES } from './rules';
import { SINK_KINDS } from './types';
import type {
  DataClass,
  DataPath,
  Finding,
  HopEvidence,
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
/**
 * A cap of three was cheap until a rule started matching declarations rather
 * than calls. Projects keep their outbound hosts together in one constants
 * file, so the first three matches were documentation links and the telemetry
 * pixel underneath them never appeared.
 */
const MAX_TOUCHPOINTS_PER_RULE_PER_FILE = 12;
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
interface FlowGraph {
  /** Along the import: the importer hands something to the imported module. */
  forward: Map<string, string[]>;
  /** Out of a module holding an entry, to everything that imports it. */
  origin: Map<string, string[]>;
}

function buildFlowEdges(modules: Module[], entryModules: Set<string>): FlowGraph {
  const forward = new Map<string, string[]>();
  const origin = new Map<string, string[]>();

  for (const module of modules) {
    const targets = module.flows.map((flow) => flow.to);
    const existing = forward.get(module.id);
    if (existing) existing.push(...targets);
    else forward.set(module.id, targets);

    for (const imported of targets) {
      if (!entryModules.has(imported)) continue;
      const back = origin.get(imported);
      if (back) back.push(module.id);
      else origin.set(imported, [module.id]);
    }
  }

  return { forward, origin };
}

/**
 * What justifies one hop of a path, or that nothing does.
 *
 * Each hop is checked in both directions, because the edge that produced it
 * could be either. If `from` imports `to`, the hand-off looks like a call with
 * an argument. If `to` imports `from`, which is how an entry helper feeds its
 * callers, the hand-off is a return value being kept.
 *
 * Finding neither does not delete the hop. The scanner is reading text, and a
 * hand-off written in a shape it does not recognise is a gap in the reader, not
 * proof of absence. It is recorded as unproven and the path is marked so.
 */
function hopEvidence(
  from: string,
  to: string,
  moduleById: Map<string, Module>,
  textById: Map<string, string>,
): HopEvidence {
  const forward = moduleById.get(from)?.flows.find((flow) => flow.to === to);
  if (forward) {
    const site = findPass(textById.get(from) ?? '', forward.symbols, 'argument');
    if (site) return { from, to, kind: 'argument', file: from, ...site };
  }

  const reverse = moduleById.get(to)?.flows.find((flow) => flow.to === from);
  if (reverse) {
    const site = findPass(textById.get(to) ?? '', reverse.symbols, 'return');
    if (site) return { from, to, kind: 'return', file: to, ...site };
  }

  return { from, to, kind: 'none' };
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
  graph: FlowGraph,
  sinkModules: Set<string>,
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const seen = new Set<string>([start]);
  let frontier: { id: string; chain: string[] }[] = [{ id: start, chain: [start] }];

  for (let depth = 0; depth < MAX_HOPS && frontier.length > 0; depth += 1) {
    const next: { id: string; chain: string[] }[] = [];

    for (const { id, chain } of frontier) {
      // Reverse edges are only available on the first step, out of the module
      // where the data originates. Beyond that they turn a shared helper into a
      // hub: every route imports the request parser, so walking into it and
      // back out again connects every handler to every other handler's database
      // write. In the fixture that produced a four-hop route from an API key in
      // one file to a document write in a file it has nothing to do with.
      const targets =
        depth === 0
          ? [...(graph.forward.get(id) ?? []), ...(graph.origin.get(id) ?? [])]
          : (graph.forward.get(id) ?? []);

      for (const target of targets) {
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

/** The first hit of each rule in a file: what the file does, once per kind. */
function distinctByRule(sinks: Touchpoint[] | undefined): Touchpoint[] {
  if (!sinks) return [];

  const seen = new Set<string>();
  return sinks.filter((sink) => {
    if (seen.has(sink.ruleId)) return false;
    seen.add(sink.ruleId);
    return true;
  });
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
    pathsCarryingValue: paths.filter((path) => path.carriesValue).length,
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

  // A path whose every hop shows a hand-off deserves the slot over one that
  // only shows the files are connected, so it claims the rule pair first.
  const seenPair = new Set<string>();
  const ordered = [...leaving].sort(
    (a, b) => Number(b.carriesValue) - Number(a.carriesValue),
  );

  for (const path of ordered) {
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
    const verb = path.carriesValue ? 'reaches' : 'may reach';
    const explain = ruleById.get(sink.ruleId)?.explain ?? '';
    const caveat = path.carriesValue
      ? ''
      : ' These files are connected, but the scanner could not find the line where a value is handed over, so treat the route as unconfirmed.';

    findings.push({
      id: `finding:path:${path.id}`,
      ruleId: sink.ruleId,
      severity: ruleById.get(sink.ruleId)?.severity ?? 'info',
      title: `${entry.label} ${verb} ${sink.label}${where} in ${hops} ${hops === 1 ? 'hop' : 'hops'}`,
      detail: explain + caveat,
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
    if (!rule) continue;
    // Info rules are too numerous to list one by one. A declaration is the
    // exception: it never appears as the end of a path, so the aggregate is the
    // only place it can be seen at all.
    if (rule.severity === 'info' && !rule.declaration) continue;

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

    const { imports, flows } = extractImports(file, index);
    modules.push({
      id: file.path,
      imports,
      flows,
      touchpoints: found.map((tp) => tp.id),
    });
  }

  const byId = new Map(touchpoints.map((tp) => [tp.id, tp]));
  const entryModules = new Set(
    touchpoints.filter((tp) => tp.kind === 'entry').map((tp) => tp.moduleId),
  );
  const graph = buildFlowEdges(modules, entryModules);

  const declarationRules = new Set(RULES.filter((rule) => rule.declaration).map((r) => r.id));

  const sinksByModule = new Map<string, Touchpoint[]>();
  for (const tp of touchpoints) {
    if (!SINK_KINDS.includes(tp.kind)) continue;
    // A declared destination is still worth reporting, but nothing can flow to
    // a string literal, so it must not be somewhere a path ends.
    if (declarationRules.has(tp.ruleId)) continue;
    const list = sinksByModule.get(tp.moduleId);
    if (list) list.push(tp);
    else sinksByModule.set(tp.moduleId, [tp]);
  }
  const sinkModules = new Set(sinksByModule.keys());

  const paths: DataPath[] = [];
  const chainCache = new Map<string, Map<string, string[]>>();
  // Hops are shared between paths many times over, and each one costs a scan
  // of a whole file.
  const evidenceCache = new Map<string, HopEvidence>();
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const textById = new Map(files.map((file) => [file.path, file.text]));

  for (const entry of touchpoints) {
    if (entry.kind !== 'entry') continue;

    let chains = chainCache.get(entry.moduleId);
    if (!chains) {
      chains = reachableSinks(entry.moduleId, graph, sinkModules);
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
      // One path per distinct thing the file does, rather than per line and not
      // merely one for the whole file. Taking only the first sink meant a file
      // that both logs and writes to the database could only ever show one of
      // them, and which one it showed flipped whenever an unrelated rule
      // started matching, so the recorded boundary churned without the boundary
      // having moved. Collapsing by rule keeps five console.log lines as one
      // route while keeping the database write visible beside them.
      // The chain is a property of the two modules, so it is worked out once
      // and shared by every sink in the file at the far end.
      const evidence: HopEvidence[] = [];
      for (let i = 0; i + 1 < hops.length; i += 1) {
        const key = `${hops[i]}->${hops[i + 1]}`;
        let hop = evidenceCache.get(key);
        if (!hop) {
          hop = hopEvidence(hops[i], hops[i + 1], moduleById, textById);
          evidenceCache.set(key, hop);
        }
        evidence.push(hop);
      }

      // An empty list means the entry and the sink share a file, where the data
      // never has to cross anything. That is the strongest case, not the
      // weakest, so the vacuous `every` is the answer we want.
      const carriesValue = evidence.every((hop) => hop.kind !== 'none');

      for (const sink of distinctByRule(sinksByModule.get(sinkModuleId))) {
        paths.push({
          id: `path:${entry.id}->${sink.id}`,
          entryId: entry.id,
          sinkId: sink.id,
          hops,
          entryClasses: entry.dataClasses.filter((cls) => cls !== 'unknown'),
          sinkClasses: sink.dataClasses.filter((cls) => cls !== 'unknown'),
          evidence,
          carriesValue,
        });
      }
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
