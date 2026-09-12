import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pickDirectory, readFileList, supportsDirectoryPicker } from './core/fileSource';
import { readGithubRepo } from './core/githubSource';
import { scan } from './core/scanner';
import type { ScanResult } from './core/types';
import { GALLERY } from './gallery/catalog';
import { GraphView } from './ui/GraphView';
import { SovereigntyPanel } from './ui/SovereigntyPanel';
import { flowCaption, pickLeadVuln, vulnForNode, vulnForPath, vulnsFromScan } from './ui/vuln';

const GITHUB_PARAM = 'github';
let autoStarted = false;

export default function App() {
  const [result, setResult] = useState<ScanResult>(GALLERY[0].result);
  const [activeId, setActiveId] = useState<string | null>(GALLERY[0].id);
  const [selectedVulnId, setSelectedVulnId] = useState<string | null>(
    () => pickLeadVuln(vulnsFromScan(GALLERY[0].result))?.id ?? null,
  );
  const [focusNonce, setFocusNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Reading…');
  const [error, setError] = useState<string | null>(null);
  const [githubInput, setGithubInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const vulns = useMemo(() => vulnsFromScan(result), [result]);
  const selected = useMemo(
    () => vulns.find((vuln) => vuln.id === selectedVulnId) ?? null,
    [vulns, selectedVulnId],
  );
  const activeEntry = GALLERY.find((entry) => entry.id === activeId);

  const apply = useCallback((next: ScanResult, galleryId: string | null = null) => {
    setResult(next);
    setActiveId(galleryId);
    setSelectedVulnId(pickLeadVuln(vulnsFromScan(next))?.id ?? null);
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
        const next = `${window.location.pathname}?${params.toString()}`;
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

  useEffect(() => {
    if (selectedVulnId) return;
    setSelectedVulnId(pickLeadVuln(vulns)?.id ?? null);
  }, [selectedVulnId, vulns]);

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

  const handleSelectPath = useCallback(
    (pathId: string) => {
      const match = vulnForPath(vulns, pathId);
      if (match) setSelectedVulnId(match.id);
    },
    [vulns],
  );

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      const match = vulnForNode(vulns, nodeId);
      if (match) setSelectedVulnId(match.id);
    },
    [vulns],
  );

  const focusNodeIds = useMemo(() => {
    if (!selected) return [];
    return [selected.flow?.entry.id, selected.flow?.sink.id, selected.touchpoint?.id].filter(
      (id): id is string => Boolean(id),
    );
  }, [selected]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>visdataarch</h1>
          <p>Data in, and everywhere it can reach.</p>
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
          <input
            ref={inputRef}
            type="file"
            hidden
            {...{ webkitdirectory: '', directory: '' }}
            onChange={(event) => void handleFileList(event.target.files)}
          />
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
            title={entry.sentence}
          >
            <strong>{entry.repo}</strong>
          </button>
        ))}
      </div>
      {error && <div className="banner error">{error}</div>}

      <main className="layout">
        <GraphView
          result={result}
          focusPathId={selected?.flow?.pathId ?? null}
          focusNodeIds={focusNodeIds}
          focusNonce={focusNonce}
          focusLabel={flowCaption(selected)}
          onSelectPath={handleSelectPath}
          onSelectNode={handleSelectNode}
        />
        <SovereigntyPanel
          result={result}
          lead={activeEntry?.sentence}
          vulns={vulns}
          selectedVulnId={selectedVulnId}
          onSelectVuln={setSelectedVulnId}
          onShowFlow={() => setFocusNonce((n) => n + 1)}
        />
      </main>
    </div>
  );
}
