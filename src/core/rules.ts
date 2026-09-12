import type { Rule } from './types';

/**
 * Rule pack.
 *
 * Adding coverage means appending an object here. No other file needs to change.
 * Keep patterns narrow enough that a comment mentioning a vendor does not
 * trigger a false positive: prefer import paths, SDK constructors and hostnames
 * over bare brand names.
 */
export const RULES: Rule[] = [
  // ---------------------------------------------------------------- analytics
  {
    id: 'analytics.google',
    vendor: 'Google Analytics',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'exposed',
    dataClasses: ['telemetry', 'pii'],
    patterns: [
      /googletagmanager\.com\/gtag/,
      /google-analytics\.com/,
      /\bgtag\s*\(\s*['"]config['"]/,
    ],
    flowLabel: 'page views, device fingerprint',
    severity: 'critical',
    explain:
      'Google Analytics receives an identifier for every visitor along with their IP address. Under GDPR this is a transfer of personal data to the United States and needs a documented legal basis.',
  },
  {
    id: 'analytics.mixpanel',
    vendor: 'Mixpanel',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['telemetry', 'pii'],
    patterns: [/from\s+['"]mixpanel(-browser)?['"]/, /mixpanel\.(init|identify|track)\s*\(/],
    flowLabel: 'product events, user ids',
    severity: 'warn',
    explain:
      'Mixpanel stores behavioural events keyed to a user id. Whether this is personal data depends on what you put in the event properties.',
  },
  {
    id: 'analytics.posthog',
    vendor: 'PostHog',
    kind: 'thirdParty',
    jurisdiction: 'unknown',
    sovereignty: 'controlled',
    dataClasses: ['telemetry'],
    patterns: [/from\s+['"]posthog-(js|node)['"]/, /posthog\.(init|capture)\s*\(/],
    flowLabel: 'product events',
    severity: 'info',
    explain:
      'PostHog can be self-hosted. Check the configured host: if it points at eu.posthog.com or your own domain, the sovereignty picture is very different from the US cloud.',
  },
  {
    id: 'analytics.segment',
    vendor: 'Segment',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'exposed',
    dataClasses: ['telemetry', 'pii'],
    patterns: [/cdn\.segment\.(com|io)/, /analytics\.(identify|track)\s*\(/],
    flowLabel: 'event stream fan-out',
    severity: 'critical',
    explain:
      'Segment is a broker: it forwards the same events to every downstream tool you enable in its dashboard. The code cannot tell you who ultimately receives the data.',
  },

  // -------------------------------------------------------------- error / APM
  {
    id: 'observability.sentry',
    vendor: 'Sentry',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['telemetry', 'pii'],
    patterns: [/from\s+['"]@sentry\//, /Sentry\.init\s*\(/, /ingest\.sentry\.io/],
    flowLabel: 'stack traces, request context',
    severity: 'warn',
    explain:
      'Crash reports routinely carry request bodies, headers and user ids. Sentry has an EU region and a self-hosted option; confirm which one the DSN points at.',
  },
  {
    id: 'observability.datadog',
    vendor: 'Datadog',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['telemetry'],
    patterns: [/from\s+['"]@datadog\//, /datadoghq\.(com|eu)/],
    flowLabel: 'logs, traces, metrics',
    severity: 'warn',
    explain:
      'Application logs are the most common accidental channel for personal data. Anything written to a log line leaves your infrastructure.',
  },

  // ----------------------------------------------------------------- AI / LLM
  {
    id: 'ai.openai',
    vendor: 'OpenAI',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['content', 'pii'],
    patterns: [/from\s+['"]openai['"]/, /api\.openai\.com/, /OPENAI_API_KEY/],
    flowLabel: 'prompts, user content',
    severity: 'critical',
    explain:
      'Whatever the user types into the feature reaches OpenAI verbatim. If the product handles customer documents, this is a processor relationship that has to appear in the privacy notice.',
  },
  {
    id: 'ai.anthropic',
    vendor: 'Anthropic',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['content', 'pii'],
    patterns: [/from\s+['"]@anthropic-ai\//, /api\.anthropic\.com/, /ANTHROPIC_API_KEY/],
    flowLabel: 'prompts, user content',
    severity: 'critical',
    explain:
      'Same exposure as any hosted model provider: the prompt is the payload. Check whether prompts are logged on your side as well.',
  },

  // ------------------------------------------------------- backend / database
  {
    id: 'backend.firebase',
    vendor: 'Firebase',
    kind: 'store',
    jurisdiction: 'us',
    sovereignty: 'exposed',
    dataClasses: ['pii', 'auth', 'content'],
    patterns: [/from\s+['"]firebase\//, /initializeApp\s*\(/, /firebaseio\.com/],
    flowLabel: 'primary datastore',
    severity: 'critical',
    explain:
      'Firebase holds the application state itself, not just a copy. Migrating away later is a rewrite, so this is the single most consequential sovereignty decision in the stack.',
  },
  {
    id: 'backend.supabase',
    vendor: 'Supabase',
    kind: 'store',
    jurisdiction: 'unknown',
    sovereignty: 'controlled',
    dataClasses: ['pii', 'auth', 'content'],
    patterns: [/from\s+['"]@supabase\//, /supabase\.co/, /SUPABASE_URL/],
    flowLabel: 'primary datastore',
    severity: 'warn',
    explain:
      'Supabase is Postgres, so the data is portable and the region is selectable. Record which region the project actually runs in.',
  },
  {
    id: 'backend.postgres',
    vendor: 'PostgreSQL',
    kind: 'store',
    jurisdiction: 'self-hosted',
    sovereignty: 'sovereign',
    dataClasses: ['pii', 'content'],
    patterns: [/postgres(ql)?:\/\//, /from\s+['"](pg|postgres)['"]/, /DATABASE_URL/],
    flowLabel: 'primary datastore',
    severity: 'info',
    explain:
      'A database you run yourself. Sovereign as long as the host and the backups are also yours, which is worth verifying separately.',
  },
  {
    id: 'backend.s3',
    vendor: 'AWS S3',
    kind: 'store',
    jurisdiction: 'us',
    sovereignty: 'controlled',
    dataClasses: ['content'],
    patterns: [/from\s+['"]@aws-sdk\/client-s3['"]/, /s3[.-][a-z0-9-]+\.amazonaws\.com/],
    flowLabel: 'file storage',
    severity: 'info',
    explain:
      'Object storage is controlled rather than sovereign: the region is yours to pick, the legal entity operating it is not.',
  },

  // --------------------------------------------------------------- payment
  {
    id: 'payment.stripe',
    vendor: 'Stripe',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['payment', 'pii'],
    patterns: [/from\s+['"]@?stripe/, /js\.stripe\.com/, /STRIPE_SECRET_KEY/],
    flowLabel: 'card payments, billing identity',
    severity: 'warn',
    explain:
      'Delegating card data to Stripe is usually the right call: it removes PCI scope from your own systems. Note it anyway, because billing records are personal data.',
  },

  // --------------------------------------------------------------- identity
  {
    id: 'auth.auth0',
    vendor: 'Auth0',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'delegated',
    dataClasses: ['auth', 'pii'],
    patterns: [/from\s+['"]@auth0\//, /\.auth0\.com/],
    flowLabel: 'credentials, session identity',
    severity: 'warn',
    explain:
      'The identity provider is the chokepoint for every user in the system. Losing access to it is an outage you cannot route around.',
  },

  // ----------------------------------------------------------------- assets
  {
    id: 'assets.google-fonts',
    vendor: 'Google Fonts',
    kind: 'thirdParty',
    jurisdiction: 'us',
    sovereignty: 'exposed',
    dataClasses: ['telemetry'],
    patterns: [/fonts\.(googleapis|gstatic)\.com/],
    flowLabel: 'visitor IP on every page load',
    severity: 'warn',
    explain:
      'Loading fonts from Google sends each visitor IP address to Google before any consent banner appears. German courts have already ruled against this; self-hosting the font files removes the issue entirely.',
  },
];
