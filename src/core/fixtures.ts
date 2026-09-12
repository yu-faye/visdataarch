import { scan } from './scanner';
import type { ScanResult, ScannedFile } from './types';

/**
 * A synthetic project that trips a representative spread of rules.
 *
 * The fixture is produced by running the real scanner over fake source files
 * rather than by hand-writing a ScanResult. That way the UI can never be built
 * against a shape the scanner does not actually emit.
 */
const FAKE_PROJECT: ScannedFile[] = [
  {
    path: 'src/main.tsx',
    text: [
      "import * as Sentry from '@sentry/react';",
      "import posthog from 'posthog-js';",
      '',
      "Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN });",
      "posthog.init(import.meta.env.VITE_POSTHOG_KEY, { api_host: 'https://eu.posthog.com' });",
    ].join('\n'),
  },
  {
    path: 'index.html',
    text: [
      '<!doctype html>',
      '<html>',
      '  <head>',
      '    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />',
      '    <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>',
      '  </head>',
      '</html>',
    ].join('\n'),
  },
  {
    path: 'server/billing.ts',
    text: [
      "import Stripe from 'stripe';",
      '',
      'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);',
      'export async function charge(customerId: string, amount: number) {',
      '  return stripe.paymentIntents.create({ customer: customerId, amount, currency: "eur" });',
      '}',
    ].join('\n'),
  },
  {
    path: 'server/summarise.ts',
    text: [
      "import OpenAI from 'openai';",
      '',
      'const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });',
      'export async function summarise(patientNote: string) {',
      '  return client.responses.create({ model: "gpt-4.1", input: patientNote });',
      '}',
    ].join('\n'),
  },
  {
    path: 'server/db.ts',
    text: [
      "import { Pool } from 'pg';",
      '',
      'export const pool = new Pool({ connectionString: process.env.DATABASE_URL });',
    ].join('\n'),
  },
  {
    path: '.env.example',
    text: [
      'DATABASE_URL=postgresql://localhost:5432/acme',
      'OPENAI_API_KEY=',
      'STRIPE_SECRET_KEY=',
    ].join('\n'),
  },
];

export const SAMPLE_RESULT: ScanResult = scan(FAKE_PROJECT, 'acme-health-portal', 214);

/** Rendered before the user has scanned anything. The UI must handle this. */
export const EMPTY_RESULT: ScanResult = scan([], 'no project scanned yet', 0);
