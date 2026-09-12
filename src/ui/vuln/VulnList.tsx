import { SEVERITY_COLOR, SEVERITY_LABEL } from '../theme';
import { hopLabel, proofLabel, type Vuln } from './model';

interface VulnListProps {
  vulns: Vuln[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function VulnList({ vulns, selectedId, onSelect }: VulnListProps) {
  if (vulns.length === 0) {
    return (
      <p className="muted">
        Nothing detected. Either the project is unusually clean, or the rules do not yet
        cover the way it is written.
      </p>
    );
  }

  return (
    <ul className="vuln-list">
      {vulns.map((vuln) => {
        const selected = vuln.id === selectedId;
        return (
          <li key={vuln.id}>
            <button
              type="button"
              className={selected ? 'vuln-row selected' : 'vuln-row'}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(vuln.id)}
              style={{ borderLeftColor: SEVERITY_COLOR[vuln.severity] }}
            >
              <span className="vuln-row-top">
                <span className="severity-chip" style={{ color: SEVERITY_COLOR[vuln.severity] }}>
                  {SEVERITY_LABEL[vuln.severity]}
                </span>
                {vuln.flow ? (
                  <span className="vuln-flow-mark">On a flow</span>
                ) : (
                  <span className="vuln-flow-mark muted-mark">No path yet</span>
                )}
              </span>
              <strong className="vuln-lead">{vuln.lead}</strong>
              {vuln.flow && (
                <span className="vuln-meta">
                  {hopLabel(vuln.flow)} · {proofLabel(vuln.flow)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
