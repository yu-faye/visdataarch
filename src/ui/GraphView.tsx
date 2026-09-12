import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { DataClass, DataFlow, ScanResult, Severity } from '../core/types';
import {
  DATA_CLASS_COLOR,
  DATA_CLASS_LABEL,
  DATA_CLASS_ORDER,
  SEVERITY_EDGE_WIDTH,
  SOVEREIGNTY_COLOR,
} from './theme';

cytoscape.use(dagre);

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

/** The worst finding attached to a flow; flows without a finding are informational. */
function flowSeverity(flow: DataFlow, result: ScanResult): Severity {
  let worst: Severity = 'info';
  for (const finding of result.findings) {
    if (finding.flowId !== flow.id) continue;
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[worst]) worst = finding.severity;
  }
  return worst;
}

function dominantClass(classes: DataClass[]): DataClass {
  return DATA_CLASS_ORDER.find((cls) => classes.includes(cls)) ?? 'unknown';
}

/** Two lines: what the flow is, then what it carries, so a screenshot needs no legend. */
function edgeLabel(flow: DataFlow): string {
  const classes = flow.dataClasses.map((cls) => DATA_CLASS_LABEL[cls]).join(', ');
  return `${flow.label}\n${classes}`;
}

interface GraphViewProps {
  result: ScanResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function GraphView({ result, selectedId, onSelect }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...result.nodes.map((node) => ({
          data: {
            id: node.id,
            label: node.label,
            color: SOVEREIGNTY_COLOR[node.sovereignty],
            shape: node.kind === 'store' ? 'round-rectangle' : 'ellipse',
          },
        })),
        ...result.flows.map((flow) => ({
          data: {
            id: flow.id,
            source: flow.source,
            target: flow.target,
            label: edgeLabel(flow),
            width: SEVERITY_EDGE_WIDTH[flowSeverity(flow, result)],
            color: DATA_CLASS_COLOR[dominantClass(flow.dataClasses)],
            lineStyle: flow.encrypted === 'unknown' ? 'dashed' : 'solid',
          },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            shape: 'data(shape)' as cytoscape.Css.NodeShape,
            label: 'data(label)',
            color: '#e8e8ea',
            'font-size': 12,
            'font-family': 'ui-sans-serif, system-ui, sans-serif',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            width: 42,
            height: 42,
            'border-width': 0,
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 4, 'border-color': '#e8e8ea' },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': 'data(color)',
            'line-style': 'data(lineStyle)' as cytoscape.Css.LineStyle,
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'text-wrap': 'wrap',
            'text-max-width': '160px',
            'font-size': 10,
            color: '#8b8b95',
            'text-rotation': 'autorotate',
            'text-background-color': '#141417',
            'text-background-opacity': 1,
            'text-background-padding': '2px',
          },
        },
        {
          selector: 'edge:selected',
          style: { 'line-color': '#e8e8ea', 'target-arrow-color': '#e8e8ea', width: 2.5 },
        },
      ],
      layout: { name: 'dagre', rankDir: 'LR', nodeSep: 46, rankSep: 150 } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    });

    cy.on('tap', 'node, edge', (event) => onSelect(event.target.id()));
    cy.on('tap', (event) => {
      if (event.target === cy) onSelect(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [result, onSelect]);

  // Selection can also come from the findings panel, so mirror it back onto the graph.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().unselect();
    if (selectedId) cy.getElementById(selectedId).select();
  }, [selectedId]);

  return <div className="graph" ref={containerRef} />;
}
