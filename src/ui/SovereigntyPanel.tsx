import { useMemo } from 'react';
import type { ScanResult } from '../core/types';
import { KIND_COLOR, KIND_LABEL, KIND_MEANING, KIND_ORDER } from './theme';
import { VulnDetail, VulnList, type Vuln } from './vuln';

interface SovereigntyPanelProps {
  result: ScanResult;
  lead?: string;
  vulns: Vuln[];
  selectedVulnId: string | null;
  onSelectVuln: (id: string) => void;
  onShowFlow: () => void;
}

export function SovereigntyPanel({
  result,
  lead,
  vulns,
  selectedVulnId,
  onSelectVuln,
  onShowFlow,
}: SovereigntyPanelProps) {
  const selected = useMemo(
    () => vulns.find((vuln) => vuln.id === selectedVulnId) ?? null,
    [vulns, selectedVulnId],
  );
  const onAFlow = vulns.filter((vuln) => vuln.flow).length;

  return (
    <aside className="panel">
      <section className="panel-lead">
        <p className="headline">
          {vulns.length} {vulns.length === 1 ? 'finding' : 'findings'}
          {onAFlow > 0 && (
            <span className="headline-count">
              {' '}
              · {onAFlow} on a flow
            </span>
          )}
        </p>
        {lead ? <p className="headline-sub">{lead}</p> : null}
        <p className="scan-line">
          {result.stats.connectedEntries} of {result.stats.entries} entries reach a sink ·{' '}
          {result.rootName}
        </p>
      </section>

      <div className="vuln-list-wrap">
        <VulnList vulns={vulns} selectedId={selectedVulnId} onSelect={onSelectVuln} />
      </div>

      <VulnDetail vuln={selected} onShowFlow={onShowFlow} />

      <details className="about-scan">
        <summary>About this scan</summary>
        <div className="tally">
          {KIND_ORDER.map((kind) => (
            <div key={kind} className="tally-row" title={KIND_MEANING[kind]}>
              <span className="swatch" style={{ background: KIND_COLOR[kind] }} />
              <span className="tally-label">{KIND_LABEL[kind]}</span>
              <span className="tally-count">{kindCount(result, kind)}</span>
            </div>
          ))}
        </div>
        <p className="muted">
          {result.fileCount} files read in this tab, {result.skippedCount} skipped. Nothing was
          uploaded. {result.stats.exitsDefault} exit{result.stats.exitsDefault === 1 ? '' : 's'} fire
          on a default install, {result.stats.exitsOptIn} only if configured,{' '}
          {result.stats.exitsProduct} are the product talking to the world.
        </p>
        <dl className="legend">
          {KIND_ORDER.map((kind) => (
            <div key={kind}>
              <dt>
                <span className="swatch" style={{ background: KIND_COLOR[kind] }} />
                {KIND_LABEL[kind]}
              </dt>
              <dd>{KIND_MEANING[kind]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </aside>
  );
}

function kindCount(result: ScanResult, kind: (typeof KIND_ORDER)[number]): number {
  if (kind === 'entry') return result.stats.entries;
  if (kind === 'store') return result.stats.stores;
  if (kind === 'exit') return result.stats.exits;
  return result.stats.logs;
}
