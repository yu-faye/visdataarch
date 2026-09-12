import { useEffect, useMemo, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { comparePaths } from '../core/rank';
import type { DataPath, ScanResult, Touchpoint } from '../core/types';
import { KIND_COLOR } from './theme';

cytoscape.use(dagre);

/**
 * Drawing every path produces a hairball. On a real codebase the scanner finds
 * hundreds, and the ones worth looking at are short paths into storage or out
 * over the network, not long chains that end at a log line.
 */
const MAX_EDGES = 60;

function rankPaths(paths: DataPath[], byId: Map<string, Touchpoint>): DataPath[] {
  return [...paths].sort((a, b) => comparePaths(a, b, byId)).slice(0, MAX_EDGES);
}

function shortLabel(touchpoint: Touchpoint): string {
  const file = touchpoint.file.split('/').pop() ?? touchpoint.file;
  return `${touchpoint.label}\n${file}:${touchpoint.line}`;
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
    // thing to say and should not look the same on the map.
    const edges = shown.map((path) => {
      const hops = path.hops.length - 1;
      return {
        data: {
          id: path.id,
          source: path.entryId,
          target: path.sinkId,
          label: hops === 0 ? 'same file' : `${hops} ${hops === 1 ? 'hop' : 'hops'}`,
          weight: path.carriesValue ? 2.5 : 1.2,
          unconfirmed: path.carriesValue ? 0 : 1,
        },
      };
    });

    return [...nodes, ...edges];
  }, [result]);

  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
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
            'line-color': '#3d3d46',
            'target-arrow-color': '#3d3d46',
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
          style: { 'line-style': 'dashed', 'line-dash-pattern': [5, 4] },
        },
        {
          selector: 'edge:selected',
          style: { 'line-color': '#e8e8ea', 'target-arrow-color': '#e8e8ea' },
        },
      ],
      layout: { name: 'dagre', rankDir: 'LR', nodeSep: 26, rankSep: 190 } as cytoscape.LayoutOptions,
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
