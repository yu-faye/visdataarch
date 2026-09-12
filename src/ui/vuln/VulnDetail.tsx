import type { Touchpoint } from '../../core/types';
import {
  DATA_CLASS_LABEL,
  JURISDICTION_LABEL,
  KIND_COLOR,
  KIND_LABEL,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
} from '../theme';
import { hopLabel, proofLabel, type Vuln, type VulnFlow } from './model';

interface VulnDetailProps {
  vuln: Vuln | null;
  onShowFlow: () => void;
}

export function VulnDetail({ vuln, onShowFlow }: VulnDetailProps) {
  if (!vuln) {
    return (
      <section className="vuln-detail empty">
        <p className="muted">Pick a finding. The related flow lights up on the map.</p>
      </section>
    );
  }

  return (
    <section className="vuln-detail" aria-live="polite">
      <header className="vuln-detail-head">
        <span className="severity-chip" style={{ color: SEVERITY_COLOR[vuln.severity] }}>
          {SEVERITY_LABEL[vuln.severity]}
        </span>
        <h3>{vuln.lead}</h3>
      </header>
      <p className="vuln-detail-body">{vuln.detail}</p>
      {vuln.flow ? (
        <>
          <FlowStrip flow={vuln.flow} />
          <button type="button" className="primary show-flow" onClick={onShowFlow}>
            Show this flow
          </button>
        </>
      ) : (
        vuln.touchpoint && <TouchEvidence touchpoint={vuln.touchpoint} />
      )}
    </section>
  );
}

function FlowStrip({ flow }: { flow: VulnFlow }) {
  const classes = [...new Set([...flow.entry.dataClasses, ...flow.sink.dataClasses])].filter(
    (cls) => cls !== 'unknown',
  );

  return (
    <div className="flow-strip">
      <p className="flow-strip-meta">
        {hopLabel(flow)} · {proofLabel(flow)}
        {flow.sink.jurisdiction && ` · ${JURISDICTION_LABEL[flow.sink.jurisdiction]}`}
        {classes.length > 0 && ` · ${classes.map((cls) => DATA_CLASS_LABEL[cls]).join(', ')}`}
      </p>
      <ol className="flow-steps">
        <li>
          <TouchEvidence touchpoint={flow.entry} />
        </li>
        {flow.evidence.map((hop, index) => (
          <li key={`${hop.from}->${hop.to}`} className="flow-hop">
            {hop.kind === 'none'
              ? `Hop ${index + 1}: files meet, no hand-off line found`
              : `Hop ${index + 1}: ${hop.kind}${hop.symbol ? ` \`${hop.symbol}\`` : ''}`}
            {hop.file && hop.line ? (
              <code>
                {hop.file}:{hop.line}
              </code>
            ) : null}
            {hop.snippet && <pre>{hop.snippet}</pre>}
          </li>
        ))}
        <li>
          <TouchEvidence touchpoint={flow.sink} />
        </li>
      </ol>
    </div>
  );
}

function TouchEvidence({ touchpoint }: { touchpoint: Touchpoint }) {
  return (
    <div className="evidence">
      <div className="evidence-head">
        <span className="swatch" style={{ background: KIND_COLOR[touchpoint.kind] }} />
        <strong>
          {KIND_LABEL[touchpoint.kind]}
          {touchpoint.destination ? ` · ${touchpoint.destination}` : ` · ${touchpoint.label}`}
        </strong>
      </div>
      <code>
        {touchpoint.file}:{touchpoint.line}
      </code>
      <pre>{touchpoint.snippet}</pre>
    </div>
  );
}
