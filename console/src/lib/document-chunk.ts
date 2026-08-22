// Client-safe, dependency-free chunking for the documentation RAG library.
// Pure functions only — safe to unit-test and to import from the browser.

export type DraftChunk = {
  content: string;
  section: string | null;
  page: number | null;
  anchor: string;
};

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

/** Strips HTML tags/scripts down to readable plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Detects whether the given text looks like HTML. */
export function looksLikeHtml(text: string): boolean {
  return /<\s*(html|body|div|p|table|span|h[1-6])[\s>]/i.test(text.slice(0, 2000));
}

/** Slugifies a heading/anchor label into a stable, URL-safe id. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

type Line = { text: string; heading: string | null; page: number | null };

/** Splits raw text into lines, tracking the nearest markdown heading and page marker. */
function annotateLines(text: string): Line[] {
  const lines = text.split(/\r?\n/);
  let heading: string | null = null;
  let page: number | null = null;
  const result: Line[] = [];
  for (const raw of lines) {
    const headingMatch = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    const pageMatch = raw.match(/^\s*(?:page|p\.?)\s+(\d+)\s*$/i) ?? raw.match(/\f/);
    if (headingMatch) {
      heading = headingMatch[2]?.trim() ?? null;
    }
    if (pageMatch) {
      const captured = "1" in pageMatch && pageMatch[1] ? Number(pageMatch[1]) : null;
      if (captured && Number.isFinite(captured)) page = captured;
    }
    result.push({ text: raw, heading, page });
  }
  return result;
}

/**
 * Splits text into ~CHUNK_SIZE character chunks with overlap, carrying the
 * nearest markdown heading into `section` and any "Page N" marker into `page`.
 * Chunk boundaries prefer paragraph breaks over hard character cuts.
 */
export function chunkText(rawText: string): DraftChunk[] {
  const text = looksLikeHtml(rawText) ? stripHtml(rawText) : rawText.trim();
  if (!text) return [];

  const lines = annotateLines(text);
  const full = lines.map((line) => line.text).join("\n");

  // Precompute, for each character offset, which line index it falls in.
  const lineStarts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.text.length + 1;
  }

  function lineIndexForOffset(offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  const chunks: DraftChunk[] = [];
  let start = 0;
  const usedAnchors = new Set<string>();

  while (start < full.length) {
    let end = Math.min(start + CHUNK_SIZE, full.length);
    if (end < full.length) {
      const breakPoint = full.lastIndexOf("\n\n", end);
      if (breakPoint > start + CHUNK_SIZE * 0.4) end = breakPoint;
    }
    const content = full.slice(start, end).trim();
    if (content) {
      const lineIndex = lineIndexForOffset(start);
      const line = lines[Math.min(lineIndex, lines.length - 1)];
      const section = line?.heading ?? null;
      const page = line?.page ?? null;
      const base = slugify(section ?? content.slice(0, 40));
      let anchor = base;
      let suffix = 2;
      while (usedAnchors.has(anchor)) {
        anchor = `${base}-${suffix}`;
        suffix += 1;
      }
      usedAnchors.add(anchor);
      chunks.push({ content, section, page, anchor });
    }
    if (end >= full.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}
