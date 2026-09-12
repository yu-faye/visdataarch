import type { ScanResult } from '../core/types';
import {
  DATA_CLASS_LABEL,
  JURISDICTION_LABEL,
  SEVERITY_COLOR,
  SOVEREIGNTY_COLOR,
  SOVEREIGNTY_LABEL,
  SOVEREIGNTY_MEANING,
  SOVEREIGNTY_ORDER,
} from './theme';
import { headline, headlineParts } from './headline';

interface SovereigntyPanelProps {
  result: ScanResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function SovereigntyPanel({ result, selectedId, onSelect }: SovereigntyPanelProps) {
  const nodeById = new Map(result.nodes.map((node) => [node.id, node]));
  const summary = headlineParts(headline(result));

  return (
    <aside className="panel">
      <section className="panel-section headline">
        <p className="headline-lead">{summary.lead}</p>
        <p className="headline-rest">{summary.rest}</p>
      </section>

      <section className="panel-section">
        <h2>Where it stands</h2>
        <div className="tally">
          {SOVEREIGNTY_ORDER.map((level) => (
            <div key={level} className="tally-row" title={SOVEREIGNTY_MEANING[level]}>
              <span className="swatch" style={{ background: SOVEREIGNTY_COLOR[level] }} />
              <span className="tally-label">{SOVEREIGNTY_LABEL[level]}</span>
              <span className="tally-count">{result.stats[level]}</span>
            </div>
          ))}
        </div>
        <p className="muted">
          {result.fileCount} files read in your browser, {result.skippedCount} skipped. Nothing was
          uploaded.
        </p>
      </section>

      <section className="panel-section">
        <h2>Findings</h2>
        {result.findings.length === 0 && (
          <p className="muted">No third-party destinations detected yet.</p>
        )}
        <ul className="findings">
          {result.findings.map((finding) => {
            const node = finding.nodeId ? nodeById.get(finding.nodeId) : undefined;
            const isSelected = selectedId === finding.nodeId || selectedId === finding.flowId;

            return (
              <li key={finding.id}>
                <button
                  type="button"
                  className={isSelected ? 'finding selected' : 'finding'}
                  onClick={() => onSelect(isSelected ? null : finding.nodeId ?? null)}
                >
                  <span className="finding-head">
                    <span
                      className="severity-dot"
                      style={{ background: SEVERITY_COLOR[finding.severity] }}
                    />
                    <strong>{node?.vendor ?? finding.title}</strong>
                    {node && <span className="chip">{JURISDICTION_LABEL[node.jurisdiction]}</span>}
                  </span>
                  <p className="finding-detail">{finding.detail}</p>
                  {isSelected && (
                    <ul className="evidence">
                      {finding.evidence.map((item) => (
                        <li key={`${item.file}:${item.line}`}>
                          <code>
                            {item.file}:{item.line}
                          </code>
                          <pre>{item.snippet}</pre>
                        </li>
                      ))}
                    </ul>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel-section">
        <h2>Legend</h2>
        <dl className="legend">
          {SOVEREIGNTY_ORDER.map((level) => (
            <div key={level}>
              <dt>
                <span className="swatch" style={{ background: SOVEREIGNTY_COLOR[level] }} />
                {SOVEREIGNTY_LABEL[level]}
              </dt>
              <dd>{SOVEREIGNTY_MEANING[level]}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">
          Data classes in play:{' '}
          {[...new Set(result.flows.flatMap((flow) => flow.dataClasses))]
            .map((cls) => DATA_CLASS_LABEL[cls])
            .join(', ')}
          .
        </p>
      </section>
    </aside>
  );
}
