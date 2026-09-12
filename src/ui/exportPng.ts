import type { ScanResult, Severity } from '../core/types';
import {
  EDGE_DASH_PATTERN,
  EDGE_UNCONFIRMED_OPACITY,
  KIND_COLOR,
  KIND_LABEL,
  KIND_ORDER,
  SEVERITY_COLOR,
  SEVERITY_EDGE_WIDTH,
  SEVERITY_LABEL,
  SEVERITY_ORDER_UI,
} from './theme';

/** Mirrors the custom properties in styles.css; the canvas cannot read CSS variables. */
const BG = '#141417';
const TEXT = '#e8e8ea';
const MUTED = '#8b8b95';
const BORDER = '#2c2c33';
const FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

/** Everything is drawn at 2x so the file survives being pasted into a slide. */
export const EXPORT_SCALE = 2;
const S = EXPORT_SCALE;
const PAD = 40 * S;
const MIN_WIDTH = 1100 * S;

export interface RenderedPng {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not rasterise the graph.'));
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG.'))), 'image/png');
  });
}

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** e.g. acme-health-portal-2026-09-12.png */
export function pngFilename(rootName: string, date = new Date()): string {
  const slug = rootName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  return `${slug}-${isoDate(date)}.png`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * The same words the panel opens with, so the file carries the claim the map
 * illustrates. Two lines: the number, then what the number means.
 */
export function headlineLines(result: ScanResult): { lead: string; rest: string } {
  const { stats } = result;
  return {
    lead: `${stats.connectedEntries} of ${stats.entries} entry ${plural(stats.entries, 'point', 'points')}`,
    rest:
      `${plural(stats.connectedEntries, 'has', 'have')} a path to somewhere data is stored, logged or sent out. ` +
      `${stats.exitsDefault} ${plural(stats.exitsDefault, 'exit fires', 'exits fire')} on a default install, ` +
      `${stats.exitsOptIn} only if an operator turns them on, ` +
      `${stats.exitsProduct} ${plural(stats.exitsProduct, 'is', 'are')} the product talking to the world on purpose.`,
  };
}

/**
 * Composites the headline, the graph and the legend into one image. The
 * graph alone loses its meaning the moment it leaves the app, so the file
 * carries the same words and the same legend the panel shows.
 */
export async function renderMapPng(graphDataUrl: string, result: ScanResult): Promise<RenderedPng> {
  const graph = await loadImage(graphDataUrl);
  const summary = headlineLines(result);

  // Measure the longest text line first so a wordy headline never runs off
  // the right edge of a narrow graph.
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('Canvas is not available in this browser.');
  measure.font = `400 ${18 * S}px ${FONT}`;
  const restWidth = measure.measureText(summary.rest).width;

  const width = Math.ceil(Math.max(graph.width, MIN_WIDTH, restWidth) + PAD * 2);
  const headerBottom = PAD + 92 * S;
  const graphTop = headerBottom + 24 * S;
  const legendTop = graphTop + graph.height + 28 * S;
  const edgeLegendTop = legendTop + 30 * S;
  const footerTop = edgeLegendTop + 34 * S;
  const height = footerTop + 24 * S + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  // Headline, the largest text in the image as it is in the panel.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = TEXT;
  ctx.font = `650 ${40 * S}px ${FONT}`;
  ctx.fillText(summary.lead, PAD, PAD + 40 * S);
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${18 * S}px ${FONT}`;
  ctx.fillText(summary.rest, PAD, PAD + 72 * S);

  ctx.fillStyle = BORDER;
  ctx.fillRect(PAD, headerBottom, width - PAD * 2, S);

  ctx.drawImage(graph, Math.round((width - graph.width) / 2), graphTop);

  // Legend row one: one swatch per touchpoint kind, in the panel's order.
  let x = PAD;
  const swatch = 12 * S;
  ctx.font = `600 ${14 * S}px ${FONT}`;
  for (const kind of KIND_ORDER) {
    ctx.fillStyle = KIND_COLOR[kind];
    ctx.fillRect(x, legendTop, swatch, swatch);
    ctx.fillStyle = TEXT;
    const label = KIND_LABEL[kind];
    ctx.fillText(label, x + swatch + 8 * S, legendTop + swatch - 1 * S);
    x += swatch + 8 * S + ctx.measureText(label).width + 28 * S;
  }

  // Legend row two: edges. Colour and weight follow the finding at the far
  // end of the route; dashed means the scanner could not confirm every hop.
  x = PAD;
  const sample = 34 * S;
  const midY = edgeLegendTop + swatch / 2;
  ctx.lineCap = 'round';
  const edgeSample = (label: string, color: string, weight: number, dashed: boolean, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = weight * S;
    ctx.setLineDash(dashed ? EDGE_DASH_PATTERN.map((n) => n * S) : []);
    ctx.beginPath();
    ctx.moveTo(x, midY);
    ctx.lineTo(x + sample, midY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = TEXT;
    ctx.fillText(label, x + sample + 8 * S, edgeLegendTop + swatch - 1 * S);
    x += sample + 8 * S + ctx.measureText(label).width + 28 * S;
  };
  for (const severity of SEVERITY_ORDER_UI as Severity[]) {
    edgeSample(SEVERITY_LABEL[severity], SEVERITY_COLOR[severity], SEVERITY_EDGE_WIDTH[severity], false);
  }
  edgeSample('hop not confirmed', SEVERITY_COLOR.info, SEVERITY_EDGE_WIDTH.info, true, EDGE_UNCONFIRMED_OPACITY);

  ctx.fillStyle = MUTED;
  ctx.font = `400 ${12 * S}px ${FONT}`;
  ctx.fillText(
    `${result.rootName} · ${result.fileCount} files read in the browser, nothing uploaded · visdataarch`,
    PAD,
    footerTop + 12 * S,
  );

  return { blob: await toBlob(canvas), filename: pngFilename(result.rootName), width, height };
}

export async function downloadMapPng(graphDataUrl: string, result: ScanResult): Promise<void> {
  const { blob, filename } = await renderMapPng(graphDataUrl, result);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
