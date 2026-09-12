# visdataarch

Scan a codebase and trace every path from a point where data enters to a point
where it is stored, logged or sent out.

The scan runs entirely inside the browser tab. No file is uploaded, no server is
involved. A tool that argues for data sovereignty should not require you to hand
over your source code in order to make the argument.

![the map](docs/screenshot.png)

## Run it

```bash
npm install
npm run dev                              # the app, at localhost:5173
npm run scan -- ~/scan-targets/umami     # the same scanner, on the command line
```

The app renders a sample project on load, so there is something to look at
before scanning anything. "Scan a folder" reads a real directory: Chromium uses
the File System Access API, other browsers fall back to a directory `<input>`.

The command line harness exists because iterating on rules through a file picker
is unbearable. It runs the identical pure scanner, plus two debugging views:

```bash
npm run scan -- <dir> --module src/lib/request.ts   # what was found in one file
npm run scan -- <dir> --paths api/send              # every path through a file
```

## What it claims, and what it does not

Every statement the tool makes is derived from the source in front of it and can
be traced to a file and a line. It reports that a request body read in one file
can reach a database write three files away, and it can show you the chain.

It does not know which region your database runs in, whether a contract exists,
or how long anything is retained. Vendor jurisdiction, where shown, is an
annotation on a destination the code names out loud, never the finding itself.
The output is a list to verify, not a compliance report.

## How it fits together

```
src/core/types.ts       the contract between the two halves. Freeze it early.
src/core/rules.ts       touchpoint detectors, one object per pattern. Pure data.
src/core/imports.ts     import graph: alias resolution and barrel chasing
src/core/scanner.ts     pure function: ScannedFile[] -> ScanResult
src/core/fileSource.ts  browser-side directory reading
src/core/fixtures.ts    a synthetic project run through the real scanner
src/ui/theme.ts         shared visual language: colours, labels, wording
src/ui/GraphView.tsx    Cytoscape graph of entry points and what they reach
src/ui/SovereigntyPanel.tsx  headline number, findings, evidence, legend
```

`ScanResult` is the only thing crossing between `core/` and `ui/`. As long as
both sides respect it, the scanner and the visualisation can be built at the
same time without blocking each other.

## The two ideas the analysis rests on

**A touchpoint** is one line that does something to data: `entry` if data
arrives from outside, `store` if it comes to rest, `exit` if it leaves over the
network or to disk, `log` if it is printed. Logs are separated from exits on
purpose, because writing to stdout is the most common accidental egress channel
and burying it among deliberate network calls hides the interesting part.

**A path** is a route from an entry touchpoint to a sink, over the import graph.
Most files on the way are plumbing, so the graph collapses them into a hop count
and keeps the chain available underneath.

Import direction is not data direction. When a file imports a helper and hands
data to it, the two agree. When a file imports a helper and gets data back, they
do not, and real codebases funnel every request through exactly that kind of
helper. Following imports alone reported zero paths across 127 route handlers on
the first real run, so a module holding an entry touchpoint also flows to
whoever imports it. That reversal is limited to entry modules: reverse every
edge and the graph becomes undirected, at which point everything reaches
everything and the tool knows nothing.

## Adding a rule

Append one object to the relevant pack in [src/core/rules.ts](src/core/rules.ts).
Nothing else changes: the scanner picks it up, a touchpoint appears, paths
through it are computed, a finding appears in the panel.

```ts
{
  id: 'store.mongo.write',
  kind: 'store',
  label: 'Mongo write',
  destination: 'MongoDB',
  jurisdiction: 'unknown',
  sovereignty: 'controlled',
  dataClasses: ['unknown'],
  patterns: [/\.(insertOne|insertMany|updateOne|replaceOne)\s*\(/],
  severity: 'info',
  explain: 'Documents are persisted here.',
}
```

Keep patterns narrow, and check them against a real repository before committing.
Three of the four hardest bugs so far were false positives that looked perfectly
reasonable in isolation: a bare `searchParams` pattern matched a zod schema of
that name in 76 files, and a barrel of a hundred query functions made every
caller appear to reach every database write in the project.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). The Vite `base` is
relative, so the same build works locally and from the Pages sub-path.
