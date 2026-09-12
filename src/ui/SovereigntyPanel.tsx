import { useMemo } from 'react';
import type { ScanResult, Touchpoint } from '../core/types';
import {
  DATA_CLASS_LABEL,
  JURISDICTION_LABEL,
  KIND_COLOR,
  KIND_LABEL,
  KIND_MEANING,
  KIND_ORDER,
  SEVERITY_COLOR,
} from './theme';

interface SovereigntyPanelProps {
  result: ScanResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function SovereigntyPanel({ result, selectedId, onSelect }: SovereigntyPanelProps) {
  const byId = useMemo(
    () => new Map(result.touchpoints.map((tp) => [tp.id, tp])),
    [result.touchpoints],
  );

  const counts: Record<string, number> = {
    entry: result.stats.entries,
    store: result.stats.stores,
    exit: result.stats.exits,
    log: result.stats.logs,
  };

  // Read off the touchpoints, not the paths. These are words the scanner saw
  // near a line, which says something about that line and nothing about where
  // the data goes afterwards.
  const classes = useMemo(() => {
    const found = new Set(
      result.touchpoints.flatMap((tp) => tp.dataClasses.filter((cls) => cls !== 'unknown')),
    );
    return [...found];
  }, [result.touchpoints]);

  return (
    <aside className="panel">
      <section className="panel-section">
        <p className="headline">
          {result.stats.connectedEntries} of {result.stats.entries} entry points
        </p>
        <p className="headline-sub">
          have a path to somewhere data is stored, logged or sent out. The scanner followed{' '}
          {result.modules.length} files and found {result.paths.length}{' '}
          {result.paths.length === 1 ? 'route' : 'routes'} in total, of which{' '}
          {result.stats.pathsCarryingValue} can point at a line handing a value over at every step.
          The rest are drawn dashed: the files are connected, but the hand-off was not found.
        </p>
      </section>

      <section className="panel-section">
        <h2>Touchpoints</h2>
        <div className="tally">
          {KIND_ORDER.map((kind) => (
            <div key={kind} className="tally-row" title={KIND_MEANING[kind]}>
              <span className="swatch" style={{ background: KIND_COLOR[kind] }} />
              <span className="tally-label">{KIND_LABEL[kind]}</span>
              <span className="tally-count">{counts[kind]}</span>
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
          <p className="muted">Nothing detected. Either the project is unusually clean, or the
          rules do not yet cover the way it is written.</p>
        )}
        <ul className="findings">
          {result.findings.slice(0, 40).map((finding) => {
            const touchpoint = finding.touchpointId ? byId.get(finding.touchpointId) : undefined;
            const isSelected = selectedId === finding.touchpointId;

            return (
              <li key={finding.id}>
                <button
                  type="button"
                  className={isSelected ? 'finding selected' : 'finding'}
                  onClick={() => onSelect(isSelected ? null : finding.touchpointId ?? null)}
                >
                  <span className="finding-head">
                    <span
                      className="severity-dot"
                      style={{ background: SEVERITY_COLOR[finding.severity] }}
                    />
                    <strong>{finding.title}</strong>
                  </span>
                  {touchpoint?.jurisdiction && (
                    <span className="chip">{JURISDICTION_LABEL[touchpoint.jurisdiction]}</span>
                  )}
                  <p className="finding-detail">{finding.detail}</p>
                  {isSelected && touchpoint && <Evidence touchpoint={touchpoint} />}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel-section">
        <h2>Legend</h2>
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
        {classes.length > 0 && (
          <p className="muted">
            Named in the code within three lines of a touchpoint:{' '}
            {classes.map((cls) => DATA_CLASS_LABEL[cls]).join(', ')}. These are words the scanner
            read next to a line, not a claim that such data travels anywhere.
          </p>
        )}
      </section>
    </aside>
  );
}

function Evidence({ touchpoint }: { touchpoint: Touchpoint }) {
  return (
    <div className="evidence">
      <code>
        {touchpoint.file}:{touchpoint.line}
      </code>
      <pre>{touchpoint.snippet}</pre>
    </div>
  );
}
