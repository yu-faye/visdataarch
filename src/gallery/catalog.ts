import type { ScanResult } from '../core/types';
import excalidraw from './excalidraw.json';
import umami from './umami.json';
import uptimeKuma from './uptime-kuma.json';

export interface GalleryEntry {
  id: string;
  repo: string;
  /** One sentence we already checked against the source. Not a path title. */
  sentence: string;
  result: ScanResult;
}

export const GALLERY: GalleryEntry[] = [
  {
    id: 'excalidraw',
    repo: 'excalidraw/excalidraw',
    sentence:
      'The hosted app preconnects to Google Fonts. The library you self-host does not.',
    result: excalidraw as ScanResult,
  },
  {
    id: 'umami',
    repo: 'umami-software/umami',
    sentence:
      'Referrer domains can go to DuckDuckGo through the favicon host in constants.',
    result: umami as ScanResult,
  },
  {
    id: 'uptime-kuma',
    repo: 'louislam/uptime-kuma',
    sentence:
      'No default phone-home. Outbound calls are optional notification providers.',
    result: uptimeKuma as ScanResult,
  },
];
