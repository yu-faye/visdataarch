import { redactSnippet } from './redact';
import type { FlowEdge, ScannedFile } from './types';

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

/**
 * One tsconfig and the part of the tree it governs.
 *
 * A monorepo has a tsconfig per package, and they disagree. immich has ten, and
 * `server/tsconfig.json` maps `src/*` to its own `src`, which is `server/src`
 * from the root. Reading a single config, and reading its targets as if they
 * were rooted at the repository, left 1435 of immich's 1557 files with no
 * resolved imports at all and a map whose longest path was one hop.
 */
export interface AliasScope {
  /** Directory the config governs, '' at the root, otherwise ending in '/'. */
  dir: string;
  /** Prefix to prefix, both already rooted at the repository. */
  aliases: AliasMap;
  /** Where a bare specifier is looked up, when the config sets baseUrl. */
  baseUrl?: string;
}

export interface ModuleIndex {
  known: Set<string>;
  scopes: AliasScope[];
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
 * Reads path aliases out of every tsconfig in the project.
 *
 * Without this, a Next.js codebase looks like a pile of disconnected files: it
 * imports almost everything through "@/", so every edge would be dropped and
 * the reachability analysis would find nothing at all.
 *
 * Scopes come back most specific first, so a package config is consulted before
 * the one at the root and the two can disagree without either being wrong.
 */
export function buildAliasScopes(files: ScannedFile[]): AliasScope[] {
  const scopes: AliasScope[] = [];

  for (const file of files) {
    if (!/(^|\/)tsconfig(\.\w+)?\.json$/.test(file.path)) continue;

    let options: { paths?: Record<string, string[]>; baseUrl?: string } | undefined;
    try {
      options = JSON.parse(stripJsonComments(file.text))?.compilerOptions;
    } catch {
      continue;
    }
    if (!options) continue;

    // Targets in a tsconfig are relative to the file, not to the repository.
    const dir = file.path.includes('/') ? `${file.path.slice(0, file.path.lastIndexOf('/'))}/` : '';
    const rootedAt = (value: string) => normalise(dir + value.replace(/^\.\//, ''));

    const aliases: AliasMap = new Map();
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      const target = targets?.[0];
      if (!target) continue;
      aliases.set(pattern.replace(/\*$/, ''), `${rootedAt(target.replace(/\*$/, ''))}/`);
    }

    const baseUrl = options.baseUrl === undefined ? undefined : rootedAt(options.baseUrl);
    if (aliases.size === 0 && baseUrl === undefined) continue;

    scopes.push({ dir, aliases, baseUrl });
  }

  scopes.push(...svelteKitScopes(files));
  return scopes.sort((a, b) => b.dir.length - a.dir.length);
}

/**
 * SvelteKit's `$lib`, which no committed file declares.
 *
 * The config that defines it lives in `.svelte-kit/`, generated at build time
 * and gitignored, so a scan of the repository never sees it. The mapping is
 * fixed by the framework rather than chosen per project, which is what makes
 * assuming it safe. immich's web package alone imports through `$lib/` 2435
 * times, every one of them invisible without this.
 */
function svelteKitScopes(files: ScannedFile[]): AliasScope[] {
  return files
    .filter((file) => /(^|\/)svelte\.config\.[cm]?js$/.test(file.path))
    .map((file) => {
      const dir = file.path.includes('/') ? `${file.path.slice(0, file.path.lastIndexOf('/'))}/` : '';
      return { dir, aliases: new Map([['$lib/', `${dir}src/lib/`]]) };
    });
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
  scopes: AliasScope[],
): string | null {
  if (specifier.startsWith('.')) {
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    return resolveCandidate(normalise(`${dir}/${specifier}`), known);
  }

  for (const scope of scopes) {
    // A package config governs its own subtree and says nothing about the rest.
    if (scope.dir && !fromPath.startsWith(scope.dir)) continue;

    for (const [prefix, target] of scope.aliases) {
      if (!specifier.startsWith(prefix)) continue;
      const hit = resolveCandidate(normalise(target + specifier.slice(prefix.length)), known);
      if (hit) return hit;
    }

    // With a baseUrl set, a bare specifier is a path before it is a package.
    if (scope.baseUrl !== undefined) {
      const hit = resolveCandidate(normalise(`${scope.baseUrl}/${specifier}`), known);
      if (hit) return hit;
    }
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
  const scopes = buildAliasScopes(files);

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
      const target = resolveSpecifier(reexport[2], file.path, known, scopes);
      if (!target) continue;
      for (const name of exposedNames(reexport[1])) named.set(name, target);
    }
    if (named.size > 0) namedReexports.set(file.path, named);

    const stars: string[] = [];
    STAR_REEXPORT.lastIndex = 0;
    let star: RegExpExecArray | null;
    while ((star = STAR_REEXPORT.exec(file.text)) !== null) {
      const target = resolveSpecifier(star[1], file.path, known, scopes);
      if (target) stars.push(target);
    }
    if (stars.length > 0) starReexports.set(file.path, stars);
  }

  return { known, scopes, ownExports, namedReexports, starReexports };
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
  flows: FlowEdge[];
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
  const flows = new Map<string, Set<string>>();

  /** `carrying` holds the used bindings, so an empty list means no flow edge. */
  const add = (id: string | null, carrying: string[]) => {
    if (!id || id === file.path) return;
    imports.add(id);
    if (carrying.length === 0) return;

    const existing = flows.get(id);
    if (existing) for (const name of carrying) existing.add(name);
    else flows.set(id, new Set(carrying));
  };

  IMPORT_STATEMENT.lastIndex = 0;
  let statement: RegExpExecArray | null;
  while ((statement = IMPORT_STATEMENT.exec(file.text)) !== null) {
    const [, clause, specifier] = statement;
    const target = resolveSpecifier(specifier, file.path, index.known, index.scopes);
    if (!target) continue;

    const block = /\{([^}]*)\}/.exec(clause);
    const isBarrel = index.namedReexports.has(target) || index.starReexports.has(target);

    // A default or namespace import gives no name to chase through a barrel, so
    // the module itself is the best available answer.
    if (!block || !isBarrel) {
      add(target, boundNames(clause).filter((name) => isInvoked(name, file.text)));
      continue;
    }

    let resolvedAny = false;
    for (const name of exposedNames(block[1])) {
      const owner = resolveThroughBarrel(target, name, index);
      if (owner) {
        add(owner, isInvoked(name, file.text) ? [name] : []);
        resolvedAny = true;
      }
    }
    if (!resolvedAny) {
      add(target, boundNames(clause).filter((name) => isInvoked(name, file.text)));
    }
  }

  // A side-effect import binds no name, so there is nothing to hand data to.
  for (const pattern of BARE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.text)) !== null) {
      add(resolveSpecifier(match[1], file.path, index.known, index.scopes), []);
    }
  }

  return {
    imports: [...imports],
    flows: [...flows].map(([to, symbols]) => ({ to, symbols: [...symbols] })),
  };
}

// ------------------------------------------------------------------ evidence

/** How far a call can be wrapped over following lines before we stop looking. */
const CALL_WINDOW = 3;
const MAX_EVIDENCE_SNIPPET = 160;

export interface PassSite {
  symbol: string;
  line: number;
  snippet: string;
}

/**
 * A call that takes something with it. `saveEvent(payload)` qualifies;
 * `getConfig()` does not, because a call with no argument hands over nothing.
 * The member form covers clients reached through an object, as in
 * `prisma.client.websiteEvent.create({ data })`.
 */
const argumentPattern = (name: string) =>
  new RegExp(`\\b${name}\\b[\\w.]*\\s*\\(\\s*[^)\\s]`);

/**
 * A call whose result is kept. This is the shape that matters when the data
 * travels against the import: a route handler imports the request parser, so
 * the payload arrives by being returned, not by being passed in.
 */
const returnPattern = (name: string) =>
  new RegExp(`(?:[=:]\\s*|\\breturn\\s+)(?:await\\s+)?\\b${name}\\s*\\(`);

/**
 * The first place one of `symbols` is seen handing a value over, or null.
 *
 * Matching runs over a short window rather than a single line, because a
 * formatter puts the arguments of any call worth looking at on the lines below
 * it. The name itself still has to appear on the reported line, so the line
 * number points at the call and not at whatever follows it.
 */
export function findPass(
  text: string,
  symbols: string[],
  direction: 'argument' | 'return',
): PassSite | null {
  if (symbols.length === 0) return null;

  const lines = text.split('\n');
  const build = direction === 'argument' ? argumentPattern : returnPattern;
  const patterns = symbols.map((symbol) => ({ symbol, pattern: build(symbol) }));

  for (let i = 0; i < lines.length; i += 1) {
    const window = lines.slice(i, i + CALL_WINDOW).join('\n');

    for (const { symbol, pattern } of patterns) {
      const match = pattern.exec(window);
      // The match may run into the following lines, since that is where a
      // formatter puts the arguments, but it has to begin on the line being
      // reported. Otherwise an import statement mentioning the symbol takes
      // credit for a call underneath it, and the line number stops being
      // something the reader can check.
      if (!match || match.index >= lines[i].length) continue;

      return {
        symbol,
        line: i + 1,
        snippet: redactSnippet(lines[i].trim().slice(0, MAX_EVIDENCE_SNIPPET)),
      };
    }
  }

  return null;
}
