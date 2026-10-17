/**
 * Real document chunking utilities.
 * Splits extracted document text into overlapping, sentence-aware chunks
 * so retrieval returns coherent passages instead of arbitrary slices.
 */

export interface TextChunk {
  content: string;
  index: number;
  pageNumber?: number;
  tokenCount: number;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 characters per token is the standard rough heuristic for English text
  return Math.max(1, Math.ceil(text.length / 4));
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(text: string): string[] {
  // Sentence-ish splitter that keeps bullet points and numbered clauses intact
  const parts = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])|\n{2,}/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

/**
 * Chunk text into ~maxChars windows with overlap, never cutting mid-sentence
 * when it can be avoided.
 */
export function chunkText(
  text: string,
  opts: { maxChars?: number; overlapChars?: number; pageNumber?: number; startIndex?: number } = {}
): TextChunk[] {
  const maxChars = opts.maxChars ?? 1200;
  const overlapChars = opts.overlapChars ?? 180;
  const clean = normalizeWhitespace(text);
  if (!clean) return [];

  const sentences = splitSentences(clean);
  const chunks: TextChunk[] = [];
  let buffer = "";
  let index = opts.startIndex ?? 0;

  const flush = () => {
    const content = buffer.trim();
    if (content.length < 40) return; // skip meaningless fragments
    chunks.push({
      content,
      index: index++,
      pageNumber: opts.pageNumber,
      tokenCount: estimateTokens(content),
    });
  };

  for (const sentence of sentences) {
    // A single enormous sentence (tables, OCR runs) gets hard-split
    if (sentence.length > maxChars) {
      if (buffer) {
        flush();
        buffer = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars - overlapChars) {
        buffer = sentence.slice(i, i + maxChars);
        flush();
      }
      buffer = "";
      continue;
    }

    if ((buffer + " " + sentence).trim().length > maxChars) {
      flush();
      // carry an overlap tail forward for context continuity
      const tail = buffer.slice(Math.max(0, buffer.length - overlapChars));
      buffer = (tail + " " + sentence).trim();
    } else {
      buffer = (buffer + " " + sentence).trim();
    }
  }

  if (buffer.trim()) flush();
  return chunks;
}

/** Build a compact keyword signature used by the lexical BM25 stage. */
export function deriveKeywords(text: string, max = 24): string {
  const stop = STOP_WORDS;
  const freq: Record<string, number> = {};
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));

  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
    .join(", ");
}

export const STOP_WORDS = new Set([
  "a","about","above","after","again","against","all","am","an","and","any","are","aren't","as","at","be","because",
  "been","before","being","below","between","both","but","by","can","can't","cannot","could","couldn't","did","didn't",
  "do","does","doesn't","doing","don't","down","during","each","few","for","from","further","had","hadn't","has",
  "hasn't","have","haven't","having","he","her","here","hers","herself","him","himself","his","how","i","if","in",
  "into","is","isn't","it","it's","its","itself","let's","me","more","most","my","myself","no","nor","not","of","off",
  "on","once","only","or","other","ought","our","ours","ourselves","out","over","own","same","she","should","so",
  "some","such","than","that","the","their","theirs","them","themselves","then","there","these","they","this","those",
  "through","to","too","under","until","up","very","was","wasn't","we","were","what","when","where","which","while",
  "who","whom","why","will","with","won't","would","you","your","yours","yourself","yourselves","please","tell",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}
