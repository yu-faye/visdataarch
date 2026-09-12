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
const MAX_EDGES = 12;

function rankPaths(paths: DataPath[], byId: Map<string, Touchpoint>): DataPath[] {
  // Logs belong in the panel. On the map they turn every real exit into a
  // vertical stack of console.log nodes, which is what the first screen
  // looked like: 227 routes, none of them the Google Fonts sentence.
  const drawable = paths.filter((path) => byId.get(path.sinkId)?.kind !== 'log');
  const pool = drawable.length > 0 ? drawable : paths;
  return [...pool].sort((a, b) => comparePaths(a, b, byId)).slice(0, MAX_EDGES);
}

/**
 * Ranked exits stay on the map. Finding-linked paths are added on top so a
 * vuln can always light up its flow, including the log routes we otherwise hide.
 */
function pathsForGraph(result: ScanResult): DataPath[] {
  const byId = new Map(result.touchpoints.map((tp) => [tp.id, tp]));
  const ranked = rankPaths(result.paths, byId);
  const keep = new Map(ranked.map((path) => [path.id, path]));
  const pathById = new Map(result.paths.map((path) => [path.id, path]));

  for (const finding of result.findings) {
    if (!finding.pathId) continue;
    const linked = pathById.get(finding.pathId);
    if (linked) keep.set(linked.id, linked);
  }

  return [...keep.values()];
}

function shortLabel(touchpoint: Touchpoint): string {
  const file = touchpoint.file.split('/').pop() ?? touchpoint.file;
  return `${touchpoint.label}\n${file}:${touchpoint.line}`;
}

interface GraphViewProps {
  result: ScanResult;
  focusPathId: string | null;
  focusNodeIds: string[];
  focusNonce: number;
  focusLabel: string | null;
  onSelectPath: (pathId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

export function GraphView({
  result,
  focusPathId,
  focusNodeIds,
  focusNonce,
  focusLabel,
  onSelectPath,
  onSelectNode,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const elements = useMemo(() => {
    const byId = new Map(result.touchpoints.map((tp) => [tp.id, tp]));
    const shown = pathsForGraph(result);
    const linked = new Set(
      result.findings.map((finding) => finding.pathId).filter((id): id is string => Boolean(id)),
    );

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
          vuln: linked.has(path.id) ? 1 : 0,
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
          selector: 'node.focused',
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
          selector: 'edge[vuln = 1]',
          style: { 'line-color': '#5c5c68', 'target-arrow-color': '#5c5c68' },
        },
        {
          selector: 'edge.focused',
          style: {
            width: 3.5,
            'line-color': '#e8e8ea',
            'target-arrow-color': '#e8e8ea',
            color: '#e8e8ea',
          },
        },
        {
          selector: '.dimmed',
          style: { opacity: 0.22 },
        },
      ],
      layout: { name: 'dagre', rankDir: 'LR', nodeSep: 26, rankSep: 190 } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    });

    cy.on('tap', 'edge', (event) => onSelectPath(event.target.id()));
    cy.on('tap', 'node', (event) => onSelectNode(event.target.id()));

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, onSelectPath, onSelectNode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().removeClass('focused dimmed');
    if (!focusPathId && focusNodeIds.length === 0) return;

    cy.elements().addClass('dimmed');

    const edge = focusPathId ? cy.getElementById(focusPathId) : cy.collection();
    if (edge.nonempty()) {
      edge.removeClass('dimmed').addClass('focused');
      edge.connectedNodes().removeClass('dimmed').addClass('focused');
    }

    for (const id of focusNodeIds) {
      const node = cy.getElementById(id);
      if (node.nonempty()) node.removeClass('dimmed').addClass('focused');
    }

    let target = edge;
    if (target.empty()) {
      target = cy.collection();
      for (const id of focusNodeIds) {
        target = target.union(cy.getElementById(id));
      }
    }
    if (target.nonempty()) {
      cy.animate({ center: { eles: target }, duration: 200 });
    }
  }, [focusPathId, focusNodeIds, focusNonce]);

  if (result.paths.length === 0) {
    return (
      <div className="graph empty">
        <p>No path from an entry point to a sink was found in this project.</p>
      </div>
    );
  }

  return (
    <div className="graph-wrap">
      <div className="graph" ref={containerRef} />
      {focusLabel && <p className="graph-caption">{focusLabel}</p>}
    </div>
  );
}
