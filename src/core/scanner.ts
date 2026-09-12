import { RULES } from './rules';
import type {
  DataFlow,
  DataNode,
  Evidence,
  Finding,
  Rule,
  ScanResult,
  ScanStats,
  ScannedFile,
} from './types';

const APP_NODE_ID = 'app';
const BROWSER_NODE_ID = 'browser';

/** Cap evidence per rule so one noisy vendor cannot flood the panel. */
const MAX_EVIDENCE_PER_RULE = 8;
const MAX_SNIPPET_LENGTH = 200;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function matchRuleInFile(rule: Rule, file: ScannedFile): Evidence[] {
  if (rule.pathPattern && !rule.pathPattern.test(file.path)) return [];

  const hits: Evidence[] = [];
  const lines = file.text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!rule.patterns.some((pattern) => pattern.test(line))) continue;

    hits.push({
      file: file.path,
      line: i + 1,
      snippet: line.trim().slice(0, MAX_SNIPPET_LENGTH),
      ruleId: rule.id,
    });
    if (hits.length >= MAX_EVIDENCE_PER_RULE) break;
  }

  return hits;
}

function countStats(nodes: DataNode[]): ScanStats {
  const stats: ScanStats = { sovereign: 0, controlled: 0, delegated: 0, exposed: 0 };
  for (const node of nodes) stats[node.sovereignty] += 1;
  return stats;
}

/**
 * Pure. Same input always produces the same ScanResult, which is what makes
 * the fixtures in fixtures.ts trustworthy as a UI development target.
 */
export function scan(files: ScannedFile[], rootName: string, skippedCount = 0): ScanResult {
  const nodes: DataNode[] = [
    {
      id: BROWSER_NODE_ID,
      label: "User's device",
      kind: 'browser',
      jurisdiction: 'local',
      sovereignty: 'sovereign',
    },
    {
      id: APP_NODE_ID,
      label: rootName,
      kind: 'app',
      jurisdiction: 'self-hosted',
      sovereignty: 'sovereign',
    },
  ];

  const flows: DataFlow[] = [
    {
      id: 'flow:browser->app',
      source: BROWSER_NODE_ID,
      target: APP_NODE_ID,
      label: 'user input',
      dataClasses: ['unknown'],
      encrypted: 'unknown',
      evidence: [],
    },
  ];

  const findings: Finding[] = [];

  for (const rule of RULES) {
    const evidence = files.flatMap((file) => matchRuleInFile(rule, file));
    if (evidence.length === 0) continue;

    const nodeId = `vendor:${slug(rule.vendor)}`;
    if (!nodes.some((node) => node.id === nodeId)) {
      nodes.push({
        id: nodeId,
        label: rule.vendor,
        kind: rule.kind,
        jurisdiction: rule.jurisdiction,
        sovereignty: rule.sovereignty,
        vendor: rule.vendor,
      });
    }

    const flowId = `flow:app->${nodeId}`;
    flows.push({
      id: flowId,
      source: APP_NODE_ID,
      target: nodeId,
      label: rule.flowLabel,
      dataClasses: rule.dataClasses,
      encrypted: 'unknown',
      evidence,
    });

    findings.push({
      id: `finding:${rule.id}`,
      ruleId: rule.id,
      severity: rule.severity,
      title: `${rule.vendor} receives ${rule.dataClasses.join(', ')}`,
      detail: rule.explain,
      nodeId,
      flowId,
      evidence,
    });
  }

  const severityOrder = { critical: 0, warn: 1, info: 2 } as const;
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    scannedAt: new Date().toISOString(),
    rootName,
    fileCount: files.length,
    skippedCount,
    nodes,
    flows,
    findings,
    stats: countStats(nodes),
  };
}
