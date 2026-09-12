import { useEffect, useMemo, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { comparePaths } from '../core/rank';
import type { DataPath, Finding, ScanResult, Severity, Touchpoint } from '../core/types';
import {
  EDGE_DASH_PATTERN,
  EDGE_UNCONFIRMED_OPACITY,
  EXIT_ROLE_SHORT,
  KIND_COLOR,
  SEVERITY_COLOR,
  SEVERITY_EDGE_WIDTH,
} from './theme';

cytoscape.use(dagre);

/**
 * Drawing every path produces a hairball. On a real codebase the scanner finds
 * hundreds, and the ones worth looking at are short paths into storage or out
 * over the network, not long chains that end at a log line.
 */
const MAX_EDGES = 12;

function rankPaths(paths: DataPath[], byId: Map<string, Touchpoint>): DataPath[] {
  // Logs belong in the panel. On the map they turn every real exit into a
  // vertical stack of console.log nodes, which is what the first screen
  // looked like: 227 routes, none of them the Google Fonts sentence.
  const drawable = paths.filter((path) => byId.get(path.sinkId)?.kind !== 'log');
  const pool = drawable.length > 0 ? drawable : paths;
  return [...pool].sort((a, b) => comparePaths(a, b, byId)).slice(0, MAX_EDGES);
}

function shortLabel(touchpoint: Touchpoint): string {
  const file = touchpoint.file.split('/').pop() ?? touchpoint.file;
  return `${touchpoint.label}\n${file}:${touchpoint.line}`;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

/**
 * The severity the panel reports for a route, so the map and the findings
 * list agree. A finding is minted once per pair of rules rather than once per
 * path, so most routes borrow the severity of the finding on their sink's
 * rule. A route with no finding behind it is informational by definition.
 */
function severityIndex(findings: Finding[]): {
  byPath: Map<string, Severity>;
  byRule: Map<string, Severity>;
} {
  const byPath = new Map<string, Severity>();
  const byRule = new Map<string, Severity>();
  for (const finding of findings) {
    if (finding.pathId && !byPath.has(finding.pathId)) byPath.set(finding.pathId, finding.severity);
    const current = byRule.get(finding.ruleId);
    if (!current || SEVERITY_RANK[finding.severity] < SEVERITY_RANK[current]) {
      byRule.set(finding.ruleId, finding.severity);
    }
  }
  return { byPath, byRule };
}

/**
 * Hop count, and for an exit the reason it is in the code. That second word is
 * the one that travels across repositories: "opt-in" and "on by default" are
 * different sentences even when the destination is the same.
 */
function edgeLabel(path: DataPath, sink: Touchpoint | undefined): string {
  const hops = path.hops.length - 1;
  const distance = hops === 0 ? 'same file' : `${hops} ${hops === 1 ? 'hop' : 'hops'}`;
  const role = sink?.kind === 'exit' && sink.role ? ` · ${EXIT_ROLE_SHORT[sink.role]}` : '';
  return distance + role;
}

interface GraphViewProps {
  result: ScanResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function GraphView({ result, selectedId, onSelect }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const elements = useMemo(() => {
    const byId = new Map(result.touchpoints.map((tp) => [tp.id, tp]));
    const shown = rankPaths(result.paths, byId);

    // Only touchpoints that take part in a drawn path. An unconnected entry is
    // a fact for the panel, not a floating dot on the map.
    const used = new Set<string>();
    for (const path of shown) {
      used.add(path.entryId);
      used.add(path.sinkId);
    }

    const nodes = [...used]
      .map((id) => byId.get(id))
      .filter((tp): tp is Touchpoint => Boolean(tp))
      .map((tp) => ({
        data: {
          id: tp.id,
          label: shortLabel(tp),
          color: KIND_COLOR[tp.kind],
          shape: tp.kind === 'store' ? 'round-rectangle' : 'ellipse',
        },
      }));

    // A solid line means every hop could be shown handing a value over. A
    // dashed one means only that the files are connected, which is a weaker
    // thing to say and should not look the same on the map. Colour and weight
    // come from the finding at the sink, never from the data classes seen near
    // either end: those are hints about a line, not a claim about the route.
    const { byPath, byRule } = severityIndex(result.findings);
    const edges = shown.map((path) => {
      const sink = byId.get(path.sinkId);
      const severity: Severity =
        byPath.get(path.id) ?? (sink ? byRule.get(sink.ruleId) : undefined) ?? 'info';
      return {
        data: {
          id: path.id,
          source: path.entryId,
          target: path.sinkId,
          label: edgeLabel(path, sink),
          color: SEVERITY_COLOR[severity],
          weight: SEVERITY_EDGE_WIDTH[severity],
          unconfirmed: path.carriesValue ? 0 : 1,
        },
      };
    });

    return [...nodes, ...edges];
  }, [result]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cy = cytoscape({
      container,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            shape: 'data(shape)' as cytoscape.Css.NodeShape,
            label: 'data(label)',
            color: '#e8e8ea',
            'font-size': 10,
            'font-family': 'ui-sans-serif, system-ui, sans-serif',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'text-wrap': 'wrap',
            width: 30,
            height: 30,
            'border-width': 0,
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': '#e8e8ea' },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(weight)',
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 9,
            color: '#71717a',
            'text-rotation': 'autorotate',
            'text-background-color': '#141417',
            'text-background-opacity': 1,
            'text-background-padding': '2px',
          },
        },
        {
          selector: 'edge[unconfirmed = 1]',
          style: {
            'line-style': 'dashed',
            'line-dash-pattern': EDGE_DASH_PATTERN,
            opacity: EDGE_UNCONFIRMED_OPACITY,
          },
        },
        {
          selector: 'edge:selected',
          style: { 'line-color': '#e8e8ea', 'target-arrow-color': '#e8e8ea', opacity: 1 },
        },
      ],
      layout: { name: 'dagre', rankDir: 'LR', nodeSep: 26, rankSep: 190 } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    });

    cy.on('tap', 'node, edge', (event) => onSelect(event.target.id()));
    cy.on('tap', (event) => {
      if (event.target === cy) onSelect(null);
    });

    // A map laid out while its container had no usable size (a background
    // tab, a pane still opening) is fitted to a zoom of nothing or not fitted
    // at all, and stays that way once the container appears. Fit it the first
    // time the container is usable, and otherwise leave the viewport alone so
    // a resize never fights the reader's own zoom.
    const usable = () => container.clientWidth > 80 && container.clientHeight > 80;
    let fitted = usable();
    const observer = new ResizeObserver(() => {
      cy.resize();
      if (!fitted && usable()) {
        fitted = true;
        cy.fit(undefined, 30);
      }
    });
    observer.observe(container);

    cyRef.current = cy;
    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, onSelect]);

  // Selection can also come from the findings panel, so mirror it onto the graph.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().unselect();
    if (!selectedId) return;

    const element = cy.getElementById(selectedId);
    if (element.nonempty()) {
      element.select();
      cy.animate({ center: { eles: element }, duration: 200 });
    }
  }, [selectedId]);

  if (result.paths.length === 0) {
    return (
      <div className="graph empty">
        <p>No path from an entry point to a sink was found in this project.</p>
      </div>
    );
  }

  return <div className="graph" ref={containerRef} />;
}
