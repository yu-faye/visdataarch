import { isIgnoredPath, isScannable } from './fileSource';
import type { FileCollection } from './fileSource';
import type { ScannedFile } from './types';

/**
 * Pulls a public GitHub repository into memory, in this tab.
 *
 * This is not an upload. The files travel GitHub → browser, never through a
 * server we run. Private repositories stay on the folder picker: GitHub will
 * not hand them over without a token, and asking for one would put us in the
 * middle of someone else's source.
 */

const FETCH_CONCURRENCY = 8;
const MAX_FILES = 1200;

export interface GithubTarget {
  owner: string;
  repo: string;
  ref?: string;
}

export interface GithubProgress {
  fetched: number;
  total: number;
  repo: string;
}

/** Accepts `owner/repo` or a github.com URL, including `/tree/<branch>`. */
export function parseGithubTarget(input: string): GithubTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const stripped = trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');

  const parts = stripped.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  if (!/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) return null;

  const owner = parts[0];
  const repo = parts[1];
  const ref = parts[2] === 'tree' && parts[3] ? parts[3] : undefined;
  return { owner, repo, ref };
}

interface GithubRepo {
  default_branch: string;
  private: boolean;
}

interface GithubTree {
  truncated: boolean;
  tree: { path: string; type: string; size?: number }[];
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });

  if (response.status === 403) {
    throw new Error('GitHub rate-limited this tab. Wait a minute, or scan a local folder.');
  }
  if (response.status === 404) {
    throw new Error('Repo not found, or it is private. Private code: Scan a folder.');
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

export async function readGithubRepo(
  input: string,
  onProgress?: (progress: GithubProgress) => void,
): Promise<FileCollection> {
  const target = parseGithubTarget(input);
  if (!target) {
    throw new Error('Need owner/repo, or a github.com URL.');
  }

  const repoUrl = `https://api.github.com/repos/${target.owner}/${target.repo}`;
  const meta = await githubJson<GithubRepo>(repoUrl);
  if (meta.private) {
    throw new Error('That repository is private. Scan a folder; nothing leaves this machine.');
  }

  const ref = target.ref ?? meta.default_branch;
  const tree = await githubJson<GithubTree>(
    `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );

  const candidates = tree.tree.filter((entry) => {
    if (entry.type !== 'blob') return false;
    if (isIgnoredPath(entry.path)) return false;
    return isScannable(entry.path, entry.size ?? 0);
  });

  const capped = candidates.slice(0, MAX_FILES);
  let skipped = candidates.length - capped.length;
  if (tree.truncated) skipped += 1;

  const files: ScannedFile[] = [];
  const rawBase = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${ref}`;
  let fetched = 0;

  await mapPool(capped, FETCH_CONCURRENCY, async (entry) => {
    const response = await fetch(`${rawBase}/${entry.path.split('/').map(encodeURIComponent).join('/')}`);
    if (!response.ok) {
      skipped += 1;
      return;
    }

    const text = await response.text();
    if (text.length > 512 * 1024) {
      skipped += 1;
      return;
    }

    files.push({ path: entry.path, text });
    fetched += 1;
    onProgress?.({
      fetched,
      total: capped.length,
      repo: `${target.owner}/${target.repo}`,
    });
  });

  if (files.length === 0) {
    throw new Error('No scannable source files in that repository.');
  }

  onProgress?.({
    fetched: files.length,
    total: capped.length,
    repo: `${target.owner}/${target.repo}`,
  });

  return { files, skippedCount: skipped, rootName: `${target.owner}/${target.repo}` };
}
