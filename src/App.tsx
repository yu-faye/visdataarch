import { useCallback, useEffect, useRef, useState } from 'react';
import { pickDirectory, readFileList, supportsDirectoryPicker } from './core/fileSource';
import { readGithubRepo } from './core/githubSource';
import { scan } from './core/scanner';
import type { ScanResult } from './core/types';
import { GALLERY } from './gallery/catalog';
import { downloadMapPng } from './ui/exportPng';
import { GraphView, type GraphViewHandle } from './ui/GraphView';
import { SovereigntyPanel } from './ui/SovereigntyPanel';

const GITHUB_PARAM = 'github';
let autoStarted = false;

/**
 * The selected touchpoint or path lives in the URL hash, so a finding can be
 * sent as a link and lands selected on load. Ids contain '/' and ':', both
 * legal in a fragment, so they are kept readable rather than percent-encoded.
 */
function readHash(): string | null {
  const raw = window.location.hash.slice(1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function encodeHash(id: string): string {
  return encodeURIComponent(id).replace(/%2F/g, '/').replace(/%3A/g, ':');
}

function hasId(result: ScanResult, id: string): boolean {
  return (
    result.touchpoints.some((tp) => tp.id === id) || result.paths.some((path) => path.id === id)
  );
}

export default function App() {
  const [result, setResult] = useState<ScanResult>(GALLERY[0].result);
  const [activeId, setActiveId] = useState<string | null>(GALLERY[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Reading…');
  const [error, setError] = useState<string | null>(null);
  const [githubInput, setGithubInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const graphRef = useRef<GraphViewHandle>(null);
  // The hash the page was opened with, waiting for the first result that contains it.
  const pendingHash = useRef<string | null>(readHash());

  const apply = useCallback((next: ScanResult, galleryId: string | null = null) => {
    setResult(next);
    setActiveId(galleryId);
    const wanted = pendingHash.current;
    pendingHash.current = null;
    setSelectedId(wanted && hasId(next, wanted) ? wanted : null);
  }, []);

  const handleGithub = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;

      setError(null);
      setBusy(true);
      setBusyLabel('Talking to GitHub…');
      try {
        const collection = await readGithubRepo(value, (progress) => {
          setBusyLabel(`Pulling ${progress.fetched}/${progress.total}…`);
        });
        setBusyLabel('Scanning…');
        apply(scan(collection.files, collection.rootName, collection.skippedCount));
        const params = new URLSearchParams(window.location.search);
        params.set(GITHUB_PARAM, collection.rootName);
        const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
        window.history.replaceState(null, '', next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not read that repository.');
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    if (autoStarted) return;
    const preset = new URLSearchParams(window.location.search).get(GITHUB_PARAM);
    if (!preset) return;
    autoStarted = true;
    setGithubInput(preset);
    void handleGithub(preset);
  }, [handleGithub]);

  // Select a linked id wherever it lives: in the result on screen, or in one
  // of the gallery scans, which is then shown first. False when nothing has it.
  const reveal = useCallback(
    (id: string): boolean => {
      if (hasId(result, id)) {
        setSelectedId(id);
        return true;
      }
      const owner = GALLERY.find((entry) => hasId(entry.result, id));
      if (!owner) return false;
      apply(owner.result, owner.id);
      setSelectedId(id);
      return true;
    },
    [result, apply],
  );

  // The hash the page opened with. When the URL names a GitHub repository the
  // hash waits for that scan instead, and apply() consumes it.
  useEffect(() => {
    const wanted = pendingHash.current;
    if (!wanted) return;
    if (new URLSearchParams(window.location.search).get(GITHUB_PARAM)) return;
    pendingHash.current = null;
    reveal(wanted);
  }, [reveal]);

  // Mirror the selection into the URL without adding history entries. A hash
  // that has not found its result yet is left alone rather than wiped.
  useEffect(() => {
    if (!selectedId && pendingHash.current) return;
    const hash = selectedId ? `#${encodeHash(selectedId)}` : '';
    const next = `${window.location.pathname}${window.location.search}${hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, '', next);
  }, [selectedId]);

  // Pasting a link into an open tab should behave like clicking the node.
  useEffect(() => {
    const onHashChange = () => {
      const id = readHash();
      if (!id || !reveal(id)) setSelectedId(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [reveal]);

  const handlePick = useCallback(async () => {
    setError(null);
    setBusy(true);
    setBusyLabel('Reading…');
    try {
      const collection = await pickDirectory();
      apply(scan(collection.files, collection.rootName, collection.skippedCount));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Could not read that folder.');
      }
    } finally {
      setBusy(false);
    }
  }, [apply]);

  const handleFileList = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      setError(null);
      setBusy(true);
      setBusyLabel('Reading…');
      try {
        const collection = await readFileList(list);
        apply(scan(collection.files, collection.rootName, collection.skippedCount));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not read those files.');
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const handleExport = useCallback(async () => {
    const png = graphRef.current?.toPng({ full: true, scale: 2, bg: '#141417' });
    if (!png) return;
    setError(null);
    try {
      await downloadMapPng(png, result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export the map.');
    }
  }, [result]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>visdataarch</h1>
          <p>Where data enters your code, and everywhere it can reach from there.</p>
        </div>

        <form
          className="actions"
          onSubmit={(event) => {
            event.preventDefault();
            void handleGithub(githubInput);
          }}
        >
          <input
            className="github-input"
            type="text"
            value={githubInput}
            onChange={(event) => setGithubInput(event.target.value)}
            placeholder="owner/repo or github.com URL"
            aria-label="Public GitHub repository"
            disabled={busy}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button type="submit" className="primary" disabled={busy || !githubInput.trim()}>
            {busy ? busyLabel : 'Scan GitHub'}
          </button>
          {supportsDirectoryPicker() ? (
            <button type="button" className="ghost" onClick={handlePick} disabled={busy}>
              Folder
            </button>
          ) : (
            <button
              type="button"
              className="ghost"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Folder
            </button>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => void handleExport()}
            disabled={busy || result.paths.length === 0}
          >
            Export PNG
          </button>
          <input
            ref={inputRef}
            type="file"
            hidden
            {...{ webkitdirectory: '', directory: '' }}
            onChange={(event) => void handleFileList(event.target.files)}
          />
          <span className="privacy-note">
            Public GitHub is pulled in this tab from GitHub, not through us. Private code: Folder.
          </span>
        </form>
      </header>

      <div className="gallery" role="list">
        {GALLERY.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="listitem"
            className={activeId === entry.id ? 'gallery-card active' : 'gallery-card'}
            disabled={busy}
            onClick={() => apply(entry.result, entry.id)}
          >
            <strong>{entry.repo}</strong>
            <span>{entry.sentence}</span>
          </button>
        ))}
      </div>
      {error && <div className="banner error">{error}</div>}

      <main className="layout">
        <GraphView ref={graphRef} result={result} selectedId={selectedId} onSelect={setSelectedId} />
        <SovereigntyPanel result={result} selectedId={selectedId} onSelect={setSelectedId} />
      </main>
    </div>
  );
}
