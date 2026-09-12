import type { Rule } from './types';

/**
 * Rule pack.
 *
 * A rule marks one line of code as a place where data enters, is persisted, or
 * leaves. Adding coverage means appending an object here; no other file changes.
 *
 * Keep patterns narrow. A pattern that also matches a comment or a documentation
 * string costs more than the coverage it buys, because one visible false positive
 * makes every other node on the map suspect.
 */

// --------------------------------------------------------------------- entry

const ENTRY_RULES: Rule[] = [
  {
    id: 'entry.http.body',
    kind: 'entry',
    label: 'request body',
    dataClasses: ['unknown'],
    // The bounded gap matters: request.clone().json() is the idiomatic form in
    // Next.js, and a pattern that insists on request.json() misses every one of
    // them. That single omission is what hid umami's entire ingest path.
    patterns: [
      /\b(request|req)\b.{0,24}\.(json|text|formData|arrayBuffer|blob)\s*\(/,
      /\breq\.body\b/,
    ],
    severity: 'info',
    explain:
      'Whatever a client sends arrives here. This is the boundary where untrusted, potentially personal data enters the system.',
  },
  {
    id: 'entry.http.query',
    kind: 'entry',
    label: 'query parameters',
    dataClasses: ['unknown'],
    // Not a bare /searchParams/: umami exports a zod schema by that name, and
    // matching it turned an import line in 76 files into a fake entry point.
    patterns: [
      /\b(url|nextUrl|request|req)\.searchParams\b/,
      /\bsearchParams\.(get|getAll|entries|forEach)\s*\(/,
      /\breq\.(query|params)\b/,
      /new\s+URL\s*\(\s*(request|req)\.url/,
    ],
    severity: 'info',
    explain:
      'Query parameters are personal data more often than people expect, and unlike a request body they end up in server access logs by default.',
  },
  {
    id: 'entry.http.headers',
    kind: 'entry',
    label: 'request headers',
    dataClasses: ['telemetry'],
    patterns: [
      /\b(request|req)\.headers\b/,
      /\bheaders\s*\(\s*\)\.get\s*\(/,
      /\b(x-forwarded-for|x-real-ip|user-agent)\b/i,
    ],
    severity: 'warn',
    explain:
      'Headers carry the client IP address and user agent. Both are personal data under GDPR even when no account exists, and they arrive on every single request whether the application wants them or not.',
  },
  {
    id: 'entry.browser.storage',
    kind: 'entry',
    label: 'browser storage read',
    jurisdiction: 'local',
    sovereignty: 'sovereign',
    dataClasses: ['unknown'],
    patterns: [/\b(localStorage|sessionStorage)\.getItem\s*\(/],
    severity: 'info',
    explain: 'Data the application previously left on the visitor device is read back here.',
  },
  {
    id: 'entry.secret.env',
    kind: 'entry',
    label: 'secret from environment',
    dataClasses: ['auth'],
    patterns: [/process\.env\.[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*/],
    severity: 'warn',
    explain:
      'A credential is read here. Follow where it goes: a secret that reaches a log line or an error report has effectively been published.',
  },
  {
    id: 'entry.file.read',
    kind: 'entry',
    label: 'file read',
    dataClasses: ['content'],
    patterns: [/\bfs\.(promises\.)?readFile(Sync)?\s*\(/, /\breadFile(Sync)?\s*\(/],
    severity: 'info',
    explain: 'Content is loaded from disk into the process here.',
  },
];

// --------------------------------------------------------------------- store

const STORE_RULES: Rule[] = [
  {
    id: 'store.prisma.write',
    kind: 'store',
    label: 'Prisma write',
    destination: 'Application database',
    jurisdiction: 'self-hosted',
    sovereignty: 'sovereign',
    dataClasses: ['unknown'],
    patterns: [/\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(\s*\{/],
    pathPattern: /(queries|models|repositor|prisma|db)/i,
    severity: 'info',
    explain: 'Data comes to rest here. Anything written is subject to retention and deletion duties.',
  },
  {
    id: 'store.sql.insert',
    kind: 'store',
    label: 'SQL write',
    destination: 'Application database',
    jurisdiction: 'self-hosted',
    sovereignty: 'sovereign',
    dataClasses: ['unknown'],
    patterns: [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i],
    severity: 'info',
    explain:
      'A raw SQL write. Raw statements are worth a second look because the columns are spelled out, which makes it easy to see exactly what is being kept.',
  },
  {
    id: 'store.columnar',
    kind: 'store',
    label: 'analytics store write',
    destination: 'ClickHouse',
    jurisdiction: 'self-hosted',
    sovereignty: 'sovereign',
    dataClasses: ['telemetry'],
    patterns: [/\bclickhouse\.(insert|insertMany)\s*\(/, /\binsert\s+into\s+\w+\s*\(/i],
    severity: 'info',
    explain:
      'A second storage backend alongside the primary database. Two backends means two retention policies and two places to look when a deletion request arrives, and the second one is routinely forgotten.',
  },
  {
    id: 'store.queue',
    kind: 'store',
    label: 'message queue write',
    destination: 'Kafka',
    jurisdiction: 'self-hosted',
    sovereignty: 'sovereign',
    dataClasses: ['unknown'],
    patterns: [/\bkafka\.(sendMessage|sendMessages|send)\s*\(/, /\bproducer\.send\s*\(/],
    severity: 'warn',
    explain:
      'A queue holds the payload until something consumes it, and its retention is configured on the broker rather than in this code. Whatever reaches here has left the reach of the application deletion path.',
  },
  {
    id: 'store.browser.storage',
    kind: 'store',
    label: 'browser storage write',
    destination: "Visitor's device",
    jurisdiction: 'local',
    sovereignty: 'sovereign',
    dataClasses: ['unknown'],
    patterns: [/\b(localStorage|sessionStorage)\.setItem\s*\(/],
    severity: 'info',
    explain:
      'Data is left on the visitor device. It survives the session and is readable by any script on the same origin.',
  },
  {
    id: 'store.file.write',
    kind: 'store',
    label: 'file write',
    destination: 'Local filesystem',
    jurisdiction: 'self-hosted',
    sovereignty: 'sovereign',
    dataClasses: ['content'],
    patterns: [/\bfs\.(promises\.)?writeFile(Sync)?\s*\(/, /\bcreateWriteStream\s*\(/],
    severity: 'info',
    explain: 'Data is written to disk, where it outlives the process and may not be covered by database backups or deletion routines.',
  },
  {
    id: 'store.redis',
    kind: 'store',
    label: 'cache write',
    destination: 'Redis',
    jurisdiction: 'self-hosted',
    sovereignty: 'sovereign',
    dataClasses: ['unknown'],
    // Not the import line. Importing a client says the dependency exists, which
    // package.json already said; only a call says data was written.
    patterns: [/\bredis(\.client)?\.(set|setex|setEx|hset|mset)\s*\(/],
    severity: 'info',
    explain:
      'Caches are easy to forget when honouring a deletion request, because they are rarely listed alongside the primary database.',
  },
];

// ----------------------------------------------------------------------- log

const LOG_RULES: Rule[] = [
  {
    id: 'log.console',
    kind: 'log',
    label: 'console output',
    destination: 'stdout',
    dataClasses: ['unknown'],
    patterns: [/\bconsole\.(log|info|warn|error|debug)\s*\(/],
    severity: 'warn',
    explain:
      'Logs are the most common accidental egress channel. Whatever is printed here is collected by whatever ships the logs, and that is usually a different system with a different retention policy.',
  },
  {
    id: 'log.logger',
    kind: 'log',
    label: 'structured log',
    destination: 'log pipeline',
    dataClasses: ['unknown'],
    patterns: [/\blog(ger)?\.(info|warn|error|debug|trace)\s*\(/, /from\s+['"](pino|winston|bunyan)['"]/],
    severity: 'warn',
    explain:
      'A structured logger usually ships off the machine. Treat every field written here as if it were sent to a third party, because it generally is.',
  },
];

// ---------------------------------------------------------------------- exit

const EXIT_RULES: Rule[] = [
  {
    id: 'exit.network.generic',
    kind: 'exit',
    label: 'outbound request',
    jurisdiction: 'unknown',
    sovereignty: 'delegated',
    dataClasses: ['unknown'],
    // The lookbehinds matter. umami wraps its Redis cache in a method called
    // fetch, so a bare /fetch\(/ reports the cache layer as a network egress
    // and drags a handful of invented paths along with it.
    patterns: [
      /(?<![\w.])(?<!async )(?<!function )fetch\s*\(/,
      /\baxios\.(get|post|put|patch|delete)\s*\(/,
      /\bgot\s*\(/,
    ],
    severity: 'warn',
    explain:
      'Data leaves the process here. Where it goes depends on the URL, which may be assembled at runtime and therefore invisible to a static scan.',
  },
  {
    id: 'exit.url.literal',
    kind: 'exit',
    label: 'hardcoded external host',
    jurisdiction: 'unknown',
    sovereignty: 'delegated',
    dataClasses: ['unknown'],
    // Destinations are usually declared far from the call that uses them. In
    // umami the telemetry pixel and the DuckDuckGo favicon endpoint both sit in
    // a constants file, so matching only at the call site finds neither, and
    // the favicon lookup quietly sends every referrer domain to a third party.
    patterns: [
      /['"`]https:\/\/(?!localhost|127\.|(?:www\.)?(?:w3|schema|json-schema)\.org)[a-z0-9-]+(\.[a-z0-9-]+)+/i,
    ],
    // Deliberately info. A named host is evidence of a destination, not proof
    // that data reaches it: the same constants file holds the documentation
    // link and the telemetry pixel, and nothing in the string distinguishes
    // them. Overstating this would undermine the findings that are certain.
    severity: 'info',
    explain:
      'A third-party host is named in the source. Whether data reaches it depends on the code path, but the destination is decided here, and hosts declared in a constants file are the ones most often forgotten.',
  },
];

// ------------------------------------------------- named third-party destinations

/**
 * These are still exits. The destination only adds a name and a jurisdiction to
 * something the generic network rule would catch anyway, so treat it as an
 * annotation rather than as the finding itself.
 */
const VENDOR_RULES: Rule[] = [
  {
    id: 'exit.vendor.google-analytics',
    kind: 'exit',
    label: 'analytics beacon',
    destination: 'Google Analytics',
    jurisdiction: 'us',
    sovereignty: 'exposed',
    dataClasses: ['telemetry', 'pii'],
    patterns: [/googletagmanager\.com\/gtag/, /google-analytics\.com/, /\bgtag\s*\(\s*['"]config['"]/],
    severity: 'critical',
    explain:
      'Google Analytics receives an identifier for every visitor along with their IP address. Under GDPR this is a transfer of personal data to the United States and needs a documented legal basis.',
  },
  {
    id: 'exit.vendor.segment',
    kind: 'exit',
    label: 'event stream fan-out',
    destination: 'Segment',
    jurisdiction: 'us',
    sovereignty: 'exposed',
    dataClasses: ['telemetry', 'pii'],
    patterns: [/cdn\.segment\.(com|io)/, /analytics\.(identify|track)\s*\(/],
    severity: 'critical',
    explain:
      'Segment is a broker: it forwards the same events to every downstream tool enabled in its dashboard. The code cannot tell you who ultimately receives the data.',
  },
  {
    id: 'exit.vendor.sentry',
    kind: 'exit',
    label: 'crash report',
    destination: 'Sentry',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['telemetry', 'pii'],
    patterns: [/from\s+['"]@sentry\//, /Sentry\.init\s*\(/, /ingest\.sentry\.io/],
    severity: 'warn',
    explain:
      'Crash reports routinely carry request bodies, headers and user ids. Sentry has an EU region and a self-hosted option; confirm which one the DSN points at.',
  },
  {
    id: 'exit.vendor.posthog',
    kind: 'exit',
    label: 'product events',
    destination: 'PostHog',
    jurisdiction: 'unknown',
    sovereignty: 'controlled',
    dataClasses: ['telemetry'],
    patterns: [/from\s+['"]posthog-(js|node)['"]/, /posthog\.(init|capture)\s*\(/],
    severity: 'info',
    explain:
      'PostHog can be self-hosted. Check the configured host: eu.posthog.com and the US cloud are the same import and completely different answers.',
  },
  {
    id: 'exit.vendor.openai',
    kind: 'exit',
    label: 'prompt',
    destination: 'OpenAI',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['content', 'pii'],
    patterns: [/from\s+['"]openai['"]/, /api\.openai\.com/],
    severity: 'critical',
    explain:
      'Whatever reaches this call is sent to OpenAI verbatim. If the product handles customer documents, this is a processor relationship that has to appear in the privacy notice.',
  },
  {
    id: 'exit.vendor.anthropic',
    kind: 'exit',
    label: 'prompt',
    destination: 'Anthropic',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['content', 'pii'],
    patterns: [/from\s+['"]@anthropic-ai\//, /api\.anthropic\.com/],
    severity: 'critical',
    explain: 'Same exposure as any hosted model provider: the prompt is the payload.',
  },
  {
    id: 'exit.vendor.mistral',
    kind: 'exit',
    label: 'prompt',
    destination: 'Mistral',
    jurisdiction: 'eu',
    sovereignty: 'delegated',
    dataClasses: ['content'],
    patterns: [/from\s+['"]@mistralai\//, /api\.mistral\.ai/],
    severity: 'warn',
    explain:
      'A French provider, so the prompt stays inside the EU. Worth naming explicitly, because using a hosted model does not have to mean a transfer to the United States.',
  },
  {
    id: 'exit.vendor.stripe',
    kind: 'exit',
    label: 'payment',
    destination: 'Stripe',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['payment', 'pii'],
    patterns: [/from\s+['"]@?stripe/, /js\.stripe\.com/],
    severity: 'warn',
    explain:
      'Delegating card data to Stripe is usually the right call, since it removes PCI scope from your own systems. Note it anyway, because billing records are personal data.',
  },
  {
    id: 'exit.vendor.google-fonts',
    kind: 'exit',
    label: 'visitor IP on page load',
    destination: 'Google Fonts',
    jurisdiction: 'us',
    sovereignty: 'exposed',
    dataClasses: ['telemetry'],
    patterns: [/fonts\.(googleapis|gstatic)\.com/],
    severity: 'warn',
    explain:
      'Loading fonts from Google sends each visitor IP address to Google before any consent banner appears. German courts have already ruled against this; self-hosting the font files removes the issue entirely.',
  },
  {
    id: 'exit.vendor.s3',
    kind: 'exit',
    label: 'object upload',
    destination: 'AWS S3',
    jurisdiction: 'us',
    sovereignty: 'controlled',
    dataClasses: ['content'],
    patterns: [/from\s+['"]@aws-sdk\/client-s3['"]/, /s3[.-][a-z0-9-]+\.amazonaws\.com/],
    severity: 'info',
    explain:
      'Object storage is controlled rather than sovereign: the region is yours to pick, the legal entity operating it is not.',
  },
];

export const RULES: Rule[] = [
  ...ENTRY_RULES,
  ...STORE_RULES,
  ...LOG_RULES,
  ...EXIT_RULES,
  ...VENDOR_RULES,
];
