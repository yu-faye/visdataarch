import type { ScannedFile } from './types';

/**
 * Reads a local folder inside the browser.
 *
 * Nothing here performs a network request, and that is the point: the tool
 * argues for data sovereignty, so it must not ship the user's source code to a
 * server in order to make that argument.
 */

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  'vendor',
  'target',
  'coverage',
  '.turbo',
  '.cache',
]);

const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'cs',
  'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml',
  'html', 'css', 'scss', 'sql', 'sh', 'tf', 'dockerfile',
]);

/** Beyond this a file is almost certainly generated or minified. */
const MAX_FILE_BYTES = 512 * 1024;

const IGNORED_FILENAMES = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock)$/;

export interface FileCollection {
  files: ScannedFile[];
  skippedCount: number;
  rootName: string;
}

function isScannable(path: string, size: number): boolean {
  const name = path.split('/').pop() ?? '';
  if (IGNORED_FILENAMES.test(name)) return false;
  if (size > MAX_FILE_BYTES) return false;

  if (name.toLowerCase() === 'dockerfile') return true;
  if (name.startsWith('.env')) return true;

  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return TEXT_EXTENSIONS.has(ext);
}

function isIgnoredPath(path: string): boolean {
  return path.split('/').some((segment) => IGNORED_DIRS.has(segment));
}

/** Feature detection for the File System Access API. */
export function supportsDirectoryPicker(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

type DirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

async function walk(
  dir: DirectoryHandle,
  prefix: string,
  out: ScannedFile[],
  counters: { skipped: number },
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') {
      if (IGNORED_DIRS.has(name)) continue;
      await walk(handle as DirectoryHandle, `${prefix}${name}/`, out, counters);
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    const path = `${prefix}${name}`;
    if (!isScannable(path, file.size)) {
      counters.skipped += 1;
      continue;
    }
    out.push({ path, text: await file.text() });
  }
}

/** Native folder picker. Requires a user gesture; Chromium only. */
export async function pickDirectory(): Promise<FileCollection> {
  const picker = (window as unknown as {
    showDirectoryPicker: () => Promise<DirectoryHandle>;
  }).showDirectoryPicker;

  const root = await picker();
  const files: ScannedFile[] = [];
  const counters = { skipped: 0 };
  await walk(root, '', files, counters);

  return { files, skippedCount: counters.skipped, rootName: root.name };
}

/** Fallback path for Firefox and Safari, via <input webkitdirectory>. */
export async function readFileList(list: FileList): Promise<FileCollection> {
  const files: ScannedFile[] = [];
  let skipped = 0;
  let rootName = 'project';

  for (const file of Array.from(list)) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const segments = relative.split('/');
    if (segments.length > 1) rootName = segments[0];

    const path = segments.slice(1).join('/') || file.name;
    if (isIgnoredPath(relative) || !isScannable(path, file.size)) {
      skipped += 1;
      continue;
    }
    files.push({ path, text: await file.text() });
  }

  return { files, skippedCount: skipped, rootName };
}
