import type { DataPath, Finding, HopEvidence, ScanResult, Severity, Touchpoint } from '../../core/types';

/**
 * UI view of a scanner Finding.
 *
 * `ScanResult.findings` is the contract. This adapter resolves the linked
 * path and touchpoints so list, detail, and the graph share one object.
 * A later data-flow pipeline can replace `vulnsFromScan` without touching
 * the components, as long as it still produces `Vuln[]`.
 */
export interface VulnFlow {
  pathId: string;
  hops: string[];
  carriesValue: boolean;
  entry: Touchpoint;
  sink: Touchpoint;
  evidence: HopEvidence[];
}

export interface Vuln {
  id: string;
  severity: Severity;
  title: string;
  /** Short scan line, e.g. "browser storage read → Google Fonts". */
  lead: string;
  detail: string;
  ruleId: string;
  touchpoint?: Touchpoint;
  flow?: VulnFlow;
}

export function vulnsFromScan(result: ScanResult): Vuln[] {
  const touchById = new Map(result.touchpoints.map((tp) => [tp.id, tp]));
  const pathById = new Map(result.paths.map((path) => [path.id, path]));

  return result.findings.map((finding) => toVuln(finding, touchById, pathById));
}

export function pickLeadVuln(vulns: Vuln[]): Vuln | null {
  return (
    vulns.find((vuln) => vuln.flow && vuln.flow.sink.kind !== 'log') ??
    vulns.find((vuln) => vuln.flow) ??
    vulns[0] ??
    null
  );
}

export function vulnForPath(vulns: Vuln[], pathId: string): Vuln | undefined {
  return vulns.find((vuln) => vuln.flow?.pathId === pathId);
}

export function vulnForNode(vulns: Vuln[], nodeId: string): Vuln | undefined {
  return vulns.find(
    (vuln) =>
      vuln.flow?.entry.id === nodeId ||
      vuln.flow?.sink.id === nodeId ||
      vuln.touchpoint?.id === nodeId,
  );
}

export function flowCaption(vuln: Vuln | null): string | null {
  if (!vuln) return null;
  return vuln.flow ? vuln.lead : vuln.title;
}

function toVuln(
  finding: Finding,
  touchById: Map<string, Touchpoint>,
  pathById: Map<string, DataPath>,
): Vuln {
  const touchpoint = finding.touchpointId ? touchById.get(finding.touchpointId) : undefined;
  const path = finding.pathId ? pathById.get(finding.pathId) : undefined;
  const entry = path ? touchById.get(path.entryId) : undefined;
  const sink = path ? touchById.get(path.sinkId) : undefined;
  const flow =
    path && entry && sink
      ? {
          pathId: path.id,
          hops: path.hops,
          carriesValue: path.carriesValue,
          entry,
          sink,
          evidence: path.evidence,
        }
      : undefined;

  return {
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    lead: flowLead(finding, flow),
    detail: finding.detail,
    ruleId: finding.ruleId,
    touchpoint,
    flow,
  };
}

function flowLead(finding: Finding, flow: VulnFlow | undefined): string {
  if (!flow) {
    return finding.title.replace(/\s+in \d+ files?\b.*$/i, '');
  }
  const dest = flow.sink.destination ?? flow.sink.label;
  return `${flow.entry.label} → ${dest}`;
}

export function hopLabel(flow: VulnFlow): string {
  const hops = flow.hops.length - 1;
  if (hops <= 0) return 'same file';
  return `${hops} ${hops === 1 ? 'hop' : 'hops'}`;
}

export function proofLabel(flow: VulnFlow): string {
  return flow.carriesValue ? 'confirmed hand-off' : 'files connected, unconfirmed';
}
