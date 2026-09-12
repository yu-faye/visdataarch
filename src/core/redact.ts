/**
 * The contract says a snippet never includes secrets. The gallery commit
 * broke that: Excalidraw's `.env.production` carries a Firebase web key, the
 * scanner copied two hundred characters of that line into JSON, and GitHub
 * flagged the copy as a Google API key.
 *
 * These patterns are deliberately specific. A broader "looks like a secret"
 * filter would blank half the interesting lines and hide the finding.
 */
const SECRET_SHAPES: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /https:\/\/[0-9a-f]+@sentry\.io\/\d+/gi,
  /ghp_[0-9A-Za-z]{20,}/g,
  /github_pat_[0-9A-Za-z_]{20,}/g,
  /sk-[0-9A-Za-z]{20,}/g,
];

export function redactSnippet(text: string): string {
  let out = text;
  for (const pattern of SECRET_SHAPES) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, '[redacted]');
  }
  return out;
}
