import { useCallback, useRef, useState } from 'react';
import { pickDirectory, readFileList, supportsDirectoryPicker } from './core/fileSource';
import { scan } from './core/scanner';
import { SAMPLE_RESULT } from './core/fixtures';
import type { ScanResult } from './core/types';
import { GraphView } from './ui/GraphView';
import { SovereigntyPanel } from './ui/SovereigntyPanel';

export default function App() {
  const [result, setResult] = useState<ScanResult>(SAMPLE_RESULT);
  const [isSample, setIsSample] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((next: ScanResult) => {
    setResult(next);
    setIsSample(false);
    setSelectedId(null);
  }, []);

  const handlePick = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const collection = await pickDirectory();
      apply(scan(collection.files, collection.rootName, collection.skippedCount));
    } catch (cause) {
      // An aborted picker is a normal user action, not a failure worth reporting.
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>visdataarch</h1>
          <p>Every place your project hands data to someone else.</p>
        </div>

        <div className="actions">
          {supportsDirectoryPicker() ? (
            <button type="button" className="primary" onClick={handlePick} disabled={busy}>
              {busy ? 'Reading…' : 'Scan a folder'}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? 'Reading…' : 'Scan a folder'}
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            hidden
            // Non-standard but the only way to read a folder outside Chromium.
            {...{ webkitdirectory: '', directory: '' }}
            onChange={(event) => void handleFileList(event.target.files)}
          />
          <span className="privacy-note">Runs entirely in this tab. No upload, no server.</span>
        </div>
      </header>

      {isSample && (
        <div className="banner">
          Showing a sample project, <strong>{SAMPLE_RESULT.rootName}</strong>. Scan a folder to map
          your own.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      <main className="layout">
        <GraphView result={result} selectedId={selectedId} onSelect={setSelectedId} />
        <SovereigntyPanel result={result} selectedId={selectedId} onSelect={setSelectedId} />
      </main>
    </div>
  );
}
