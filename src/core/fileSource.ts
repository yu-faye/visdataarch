import type { ScannedFile } from './types';

/**
 * Reads a local folder inside the browser.
 *
 * Nothing here performs a network request, and that is the point: the tool
 * argues for data sovereignty, so it must not ship the user's source code to a
 * server in order to make that argument.
 */

export const IGNORED_DIRS = new Set([
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
  // Data movement in a test is not data movement in the product, and test files
  // are dense with exactly the patterns the rules look for.
  '__tests__',
  '__mocks__',
  'tests',
  'test',
  'e2e',
  // Documentation is not the product. On immich a drawio architecture diagram
  // under docs/ produced fourteen Google Fonts exits, all of them the font
  // used to render the picture.
  'docs',
  'documentation',
  // Build and release tooling does not run on the adopter's server. On
  // uptime-kuma the strongest paths were extra/release scripts.
  'scripts',
  // Pre-scanned payloads. Left in the corpus they match their own stored
  // snippets and the project's boundary becomes a copy of three other repos.
  'gallery',
]);

const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'cs',
  'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml',
  'html', 'css', 'scss', 'sql', 'sh', 'tf', 'dockerfile',
]);

/** Beyond this a file is almost certainly generated or minified. */
const MAX_FILE_BYTES = 512 * 1024;

const IGNORED_FILENAMES =
  /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|changelog(\.\w+)?)$/i;

const TEST_FILENAME = /\.(test|spec)\.[cm]?[jt]sx?$/;
const DIAGRAM_FILENAME = /\.drawio(\.xml)?$/i;
/** Release helpers that sit outside a `scripts/` directory. */
const IGNORED_PATH_PREFIX = /(^|\/)extra(\/|$)/;

export interface FileCollection {
  files: ScannedFile[];
  skippedCount: number;
  rootName: string;
}

export function isScannable(path: string, size: number): boolean {
  const name = path.split('/').pop() ?? '';
  if (IGNORED_FILENAMES.test(name)) return false;
  if (TEST_FILENAME.test(name)) return false;
  if (DIAGRAM_FILENAME.test(name)) return false;
  if (size > MAX_FILE_BYTES) return false;

  if (name.toLowerCase() === 'dockerfile') return true;
  if (name.startsWith('.env')) return true;

  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return TEXT_EXTENSIONS.has(ext);
}

export function isIgnoredPath(path: string): boolean {
  if (path.split('/').some((segment) => IGNORED_DIRS.has(segment))) return true;
  return IGNORED_PATH_PREFIX.test(path);
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
