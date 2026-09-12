import type { ScannedFile } from './types';

/**
 * Import graph construction.
 *
 * Resolution is deliberately conservative: an import that cannot be resolved to
 * a file inside the scanned root is dropped rather than guessed at. A wrong edge
 * invents a data path that does not exist, which is worse than missing one,
 * because the whole tool rests on being able to point at the line.
 */

const CANDIDATE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

/** Maps an alias prefix such as "@/" to a path prefix such as "src/". */
export type AliasMap = Map<string, string>;

export interface ModuleIndex {
  known: Set<string>;
  aliases: AliasMap;
  /** Names each module declares itself. */
  ownExports: Map<string, Set<string>>;
  /** `export { a } from './x'` — name to the module it came from. */
  namedReexports: Map<string, Map<string, string>>;
  /** `export * from './x'` — modules whose whole surface is re-exported. */
  starReexports: Map<string, string[]>;
}

/**
 * Strips comments from JSONC while respecting string literals.
 *
 * A regex cannot do this. A tsconfig contains `"@/*": ["./src/*"]` and
 * `"**‍/*.ts"`, so a naive block-comment pattern opens at the `/*` inside one
 * glob and closes at the `*‍/` inside another, silently deleting the paths
 * section in between. The parse then fails, every alias is lost, and a Next.js
 * project resolves to zero import edges.
 */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        out += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
    } else if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
    } else {
      out += char;
    }
  }

  // Trailing commas are legal in tsconfig and rejected by JSON.parse.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Reads path aliases out of the scanned project's own tsconfig.
 *
 * Without this, a Next.js codebase looks like a pile of disconnected files: it
 * imports almost everything through "@/", so every edge would be dropped and
 * the reachability analysis would find nothing at all.
 */
export function buildAliasMap(files: ScannedFile[]): AliasMap {
  const aliases: AliasMap = new Map();
  const config = files.find((file) => /(^|\/)tsconfig(\.\w+)?\.json$/.test(file.path));
  if (!config) return aliases;

  let paths: Record<string, string[]> | undefined;
  try {
    paths = JSON.parse(stripJsonComments(config.text))?.compilerOptions?.paths;
  } catch {
    return aliases;
  }
  if (!paths) return aliases;

  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets?.[0];
    if (!target) continue;
    aliases.set(pattern.replace(/\*$/, ''), target.replace(/^\.\//, '').replace(/\*$/, ''));
  }
  return aliases;
}

/** Collapses "." and ".." segments. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/** Tries the extensionless forms TypeScript accepts, in the order it does. */
function resolveCandidate(base: string, known: Set<string>): string | null {
  if (known.has(base)) return base;

  // An import may carry a .js extension that maps to a .ts source.
  const withoutExt = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  for (const ext of CANDIDATE_EXTENSIONS) {
    if (known.has(`${withoutExt}.${ext}`)) return `${withoutExt}.${ext}`;
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    if (known.has(`${withoutExt}/index.${ext}`)) return `${withoutExt}/index.${ext}`;
  }
  return null;
}

function resolveSpecifier(
  specifier: string,
  fromPath: string,
  known: Set<string>,
  aliases: AliasMap,
): string | null {
  if (specifier.startsWith('.')) {
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    return resolveCandidate(normalise(`${dir}/${specifier}`), known);
  }

  for (const [prefix, target] of aliases) {
    if (!specifier.startsWith(prefix)) continue;
    const hit = resolveCandidate(normalise(target + specifier.slice(prefix.length)), known);
    if (hit) return hit;
  }

  // Anything left is a package from node_modules, which is out of scope.
  return null;
}

// ------------------------------------------------------------------- exports

const OWN_EXPORT_PATTERNS = [
  /\bexport\s+(?:async\s+)?function\s+(\w+)/g,
  /\bexport\s+(?:const|let|var)\s+(\w+)/g,
  /\bexport\s+(?:abstract\s+)?class\s+(\w+)/g,
  /\bexport\s+(?:type|interface|enum)\s+(\w+)/g,
];

/** `export { a, b as c }` with no `from` clause. */
const LOCAL_EXPORT_BLOCK = /\bexport\s*\{([^}]*)\}\s*(?!\s*from)/g;
const NAMED_REEXPORT = /\bexport\s*\{([^}]*)\}\s*from\s*['"]([^'"\n]+)['"]/g;
const STAR_REEXPORT = /\bexport\s*\*\s*(?:as\s+\w+\s*)?from\s*['"]([^'"\n]+)['"]/g;

/** Turns "a, b as c" into the names visible to an importer: a and c. */
function exposedNames(clause: string): string[] {
  return clause
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const alias = /\bas\s+(\w+)$/.exec(part);
      return alias ? alias[1] : part.replace(/^type\s+/, '').trim();
    })
    .filter((name) => /^\w+$/.test(name));
}

export function buildModuleIndex(files: ScannedFile[]): ModuleIndex {
  const known = new Set(files.map((file) => file.path));
  const aliases = buildAliasMap(files);

  const ownExports = new Map<string, Set<string>>();
  const namedReexports = new Map<string, Map<string, string>>();
  const starReexports = new Map<string, string[]>();

  for (const file of files) {
    const own = new Set<string>();
    for (const pattern of OWN_EXPORT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(file.text)) !== null) own.add(match[1]);
    }

    LOCAL_EXPORT_BLOCK.lastIndex = 0;
    let block: RegExpExecArray | null;
    while ((block = LOCAL_EXPORT_BLOCK.exec(file.text)) !== null) {
      for (const name of exposedNames(block[1])) own.add(name);
    }
    ownExports.set(file.path, own);

    const named = new Map<string, string>();
    NAMED_REEXPORT.lastIndex = 0;
    let reexport: RegExpExecArray | null;
    while ((reexport = NAMED_REEXPORT.exec(file.text)) !== null) {
      const target = resolveSpecifier(reexport[2], file.path, known, aliases);
      if (!target) continue;
      for (const name of exposedNames(reexport[1])) named.set(name, target);
    }
    if (named.size > 0) namedReexports.set(file.path, named);

    const stars: string[] = [];
    STAR_REEXPORT.lastIndex = 0;
    let star: RegExpExecArray | null;
    while ((star = STAR_REEXPORT.exec(file.text)) !== null) {
      const target = resolveSpecifier(star[1], file.path, known, aliases);
      if (target) stars.push(target);
    }
    if (stars.length > 0) starReexports.set(file.path, stars);
  }

  return { known, aliases, ownExports, namedReexports, starReexports };
}

/** Depth of barrel chasing. Barrels nest, but never this deeply in practice. */
const MAX_BARREL_DEPTH = 4;

/**
 * Follows a named import through re-export barrels to the file that actually
 * defines it.
 *
 * Without this, `import { saveEvent } from '@/queries/sql'` links the importer
 * to a barrel that re-exports a hundred other query functions, and the
 * reachability search then claims the caller reaches every database write in
 * the project. On umami that one shortcut manufactured more false paths than
 * the tool found real ones.
 */
function resolveThroughBarrel(
  moduleId: string,
  name: string,
  index: ModuleIndex,
  depth = 0,
): string | null {
  if (depth > MAX_BARREL_DEPTH) return null;
  if (index.ownExports.get(moduleId)?.has(name)) return moduleId;

  const named = index.namedReexports.get(moduleId)?.get(name);
  if (named) return resolveThroughBarrel(named, name, index, depth + 1) ?? named;

  for (const target of index.starReexports.get(moduleId) ?? []) {
    const hit = resolveThroughBarrel(target, name, index, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------------- imports

/** Captures the clause and the specifier, so named imports can be followed. */
const IMPORT_STATEMENT = /\bimport\s+([\s\S]{0,400}?)\s*from\s*['"]([^'"\n]+)['"]/g;
const BARE_PATTERNS = [
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

/** Local names introduced by an import clause, default and namespace included. */
function boundNames(clause: string): string[] {
  const names: string[] = [];

  const block = /\{([^}]*)\}/.exec(clause);
  if (block) names.push(...exposedNames(block[1]));

  const namespace = /\*\s+as\s+(\w+)/.exec(clause);
  if (namespace) names.push(namespace[1]);

  // Whatever sits before the first brace or star is the default binding.
  const head = clause.split(/[{*]/)[0].replace(/,\s*$/, '').trim();
  if (/^\w+$/.test(head)) names.push(head);

  return names;
}

/**
 * Whether a binding is used in a way that could move data.
 *
 * Calling it, or reaching into it, both count: `saveEvent(payload)` and
 * `prisma.client.user.create(...)` are equally real. Rendering it as a JSX tag
 * does not, and that single exclusion removes the bulk of the false paths in a
 * front end, where components import components that import components without
 * ever handing each other a payload.
 */
function isInvoked(name: string, text: string): boolean {
  return new RegExp(`\\b${name}\\s*[(.]`).test(text);
}

export interface ExtractedImports {
  imports: string[];
  flows: string[];
}

/**
 * Resolved module ids this file imports, and the subset data can travel along.
 *
 * Matched against the whole file rather than line by line. A multi-line import
 * puts the specifier on a closing line carrying no `import` keyword, and in a
 * TypeScript codebase that is most of them.
 */
export function extractImports(file: ScannedFile, index: ModuleIndex): ExtractedImports {
  const imports = new Set<string>();
  const flows = new Set<string>();

  const add = (id: string | null, carriesData: boolean) => {
    if (!id || id === file.path) return;
    imports.add(id);
    if (carriesData) flows.add(id);
  };

  IMPORT_STATEMENT.lastIndex = 0;
  let statement: RegExpExecArray | null;
  while ((statement = IMPORT_STATEMENT.exec(file.text)) !== null) {
    const [, clause, specifier] = statement;
    const target = resolveSpecifier(specifier, file.path, index.known, index.aliases);
    if (!target) continue;

    const block = /\{([^}]*)\}/.exec(clause);
    const isBarrel = index.namedReexports.has(target) || index.starReexports.has(target);

    // A default or namespace import gives no name to chase through a barrel, so
    // the module itself is the best available answer.
    if (!block || !isBarrel) {
      const used = boundNames(clause).some((name) => isInvoked(name, file.text));
      add(target, used);
      continue;
    }

    let resolvedAny = false;
    for (const name of exposedNames(block[1])) {
      const owner = resolveThroughBarrel(target, name, index);
      if (owner) {
        add(owner, isInvoked(name, file.text));
        resolvedAny = true;
      }
    }
    if (!resolvedAny) {
      add(target, boundNames(clause).some((name) => isInvoked(name, file.text)));
    }
  }

  // A side-effect import binds no name, so there is nothing to hand data to.
  for (const pattern of BARE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.text)) !== null) {
      add(resolveSpecifier(match[1], file.path, index.known, index.aliases), false);
    }
  }

  return { imports: [...imports], flows: [...flows] };
}
