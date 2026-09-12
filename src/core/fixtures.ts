import { scan } from './scanner';
import type { ScanResult, ScannedFile } from './types';

/**
 * A synthetic project, built to contain the cases that actually broke the
 * scanner on a real codebase rather than the ones it already handled.
 *
 * Every awkward shape here was found the hard way while running against umami:
 * a request parser that hands data back to its callers instead of receiving it,
 * a barrel that re-exports a hundred query functions, imports written through a
 * tsconfig path alias, and a database call buried two files below the route.
 *
 * The fixture is produced by running the real scanner over fake source files
 * rather than by hand-writing a ScanResult, so the UI can never be built
 * against a shape the scanner does not emit.
 */
const FAKE_PROJECT: ScannedFile[] = [
  {
    path: 'tsconfig.json',
    text: JSON.stringify(
      { compilerOptions: { paths: { '@/*': ['./src/*'] } }, include: ['**/*.ts'] },
      null,
      2,
    ),
  },
  {
    // The entry point lives here, not in the route handlers. Data flows out of
    // this file to everything that imports it.
    path: 'src/lib/request.ts',
    text: [
      'export async function parseRequest(request: Request) {',
      '  const url = new URL(request.url);',
      '  const body = await request.clone().json();',
      '  const ip = request.headers.get("x-forwarded-for");',
      '  return { url, body, ip };',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/queries/index.ts',
    text: ["export * from './saveDocument';", "export * from './getDocument';"].join('\n'),
  },
  {
    path: 'src/queries/saveDocument.ts',
    text: [
      "import prisma from '@/lib/prisma';",
      '',
      'export async function saveDocument(email: string, content: string) {',
      '  await prisma.document.create({ data: { email, content } });',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/queries/getDocument.ts',
    text: [
      "import prisma from '@/lib/prisma';",
      '',
      'export async function getDocument(id: string) {',
      '  return prisma.document.findUnique({ where: { id } });',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/lib/prisma.ts',
    text: ["import { PrismaClient } from '@prisma/client';", 'export default new PrismaClient();'].join(
      '\n',
    ),
  },
  {
    path: 'src/lib/ai.ts',
    text: [
      "import OpenAI from 'openai';",
      '',
      'const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });',
      '',
      'export async function summarise(patientNote: string) {',
      '  return client.responses.create({ model: "gpt-4.1", input: patientNote });',
      '}',
    ].join('\n'),
  },
  {
    // Imports the parser by name and the query through a barrel: the two shapes
    // that have to resolve correctly or the path disappears.
    path: 'src/app/api/upload/route.ts',
    text: [
      "import { parseRequest } from '@/lib/request';",
      "import { saveDocument } from '@/queries';",
      '',
      'export async function POST(request: Request) {',
      '  const { body } = await parseRequest(request);',
      '  await saveDocument(body.email, body.content);',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/app/api/summarise/route.ts',
    text: [
      "import { parseRequest } from '@/lib/request';",
      "import { summarise } from '@/lib/ai';",
      '',
      'export async function POST(request: Request) {',
      '  const { body } = await parseRequest(request);',
      '  const result = await summarise(body.patientNote);',
      '  console.log("summarised", body.email);',
      '  return Response.json(result);',
      '}',
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
];

export const SAMPLE_RESULT: ScanResult = scan(FAKE_PROJECT, 'acme-health-portal', 214);

/** Rendered before the user has scanned anything. The UI must handle this. */
export const EMPTY_RESULT: ScanResult = scan([], 'no project scanned yet', 0);
