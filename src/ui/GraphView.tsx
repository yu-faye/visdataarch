import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { ScanResult } from '../core/types';
import { SOVEREIGNTY_COLOR } from './theme';

cytoscape.use(dagre);

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
            label: flow.label,
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
            width: 1.5,
            'line-color': '#4a4a52',
            'target-arrow-color': '#4a4a52',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
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
