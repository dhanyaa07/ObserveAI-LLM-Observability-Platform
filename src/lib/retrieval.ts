import { db } from "@/db";
import { documents } from "@/db/schema";
import { and, eq, inArray, or, isNull } from "drizzle-orm";
import { tokenize } from "./chunk";
import { cosineSimilarity, embedTexts, localEmbed } from "./embeddings";

export interface RetrievedChunk {
  id: number;
  title: string;
  category: string;
  content: string;
  similarity: number;   // final hybrid score 0..1
  bm25: number;         // lexical component
  vector: number;       // dense component
  source: string;       // 'builtin' | 'upload'
  uploadId: string | null;
  chunkIndex: number;
  pageNumber: number | null;
}

export interface RetrievalOptions {
  k?: number;
  /** 'all' searches everything, 'builtin' only the policy corpus, 'upload' only user files */
  scope?: "all" | "builtin" | "upload";
  /** limit search to specific uploaded files */
  uploadIds?: string[];
  apiKey?: string;
}

export interface RetrievalOutcome {
  chunks: RetrievedChunk[];
  corpusSize: number;
  candidatesScored: number;
  embeddingModel: string;
  maxScore: number;
}

/**
 * Hybrid retrieval: Okapi BM25 lexical scoring fused with dense cosine
 * similarity over stored chunk embeddings (reciprocal-style weighted fusion).
 * This runs over the real corpus — built-in policies plus any uploaded PDFs.
 */
export async function retrieveChunks(
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievalOutcome> {
  const k = options.k ?? 4;
  const scope = options.scope ?? "all";

  // ---- Load candidate corpus (scoped) ----
  let rows;
  if (options.uploadIds?.length) {
    rows = await db.select().from(documents).where(inArray(documents.uploadId, options.uploadIds));
  } else if (scope === "builtin") {
    rows = await db.select().from(documents).where(eq(documents.source, "builtin"));
  } else if (scope === "upload") {
    rows = await db.select().from(documents).where(eq(documents.source, "upload"));
  } else {
    rows = await db.select().from(documents);
  }

  if (!rows.length) {
    return { chunks: [], corpusSize: 0, candidatesScored: 0, embeddingModel: "none", maxScore: 0 };
  }

  const queryTokens = tokenize(query);

  // ---- Stage 1: Okapi BM25 ----
  const k1 = 1.5;
  const b = 0.75;
  const docTokens = rows.map((r) => tokenize(`${r.title} ${r.keywords} ${r.content}`));
  const docLengths = docTokens.map((t) => t.length);
  const avgDocLen = docLengths.reduce((a, c) => a + c, 0) / (rows.length || 1);

  // document frequency per query term
  const df: Record<string, number> = {};
  for (const term of new Set(queryTokens)) {
    df[term] = docTokens.reduce((acc, toks) => acc + (toks.includes(term) ? 1 : 0), 0);
  }

  const bm25Scores = rows.map((_, i) => {
    const toks = docTokens[i];
    const len = docLengths[i] || 1;
    let score = 0;
    for (const term of new Set(queryTokens)) {
      const f = toks.reduce((acc, t) => acc + (t === term ? 1 : 0), 0);
      if (!f) continue;
      const n = df[term] || 0;
      const idf = Math.log(1 + (rows.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avgDocLen))));
    }
    // small boost when the query matches the chunk/document title
    const titleTokens = tokenize(rows[i].title);
    const titleHits = queryTokens.filter((t) => titleTokens.includes(t)).length;
    return score + titleHits * 0.8;
  });

  const maxBm25 = Math.max(...bm25Scores, 0.0001);

  // ---- Stage 2: Dense vector cosine ----
  // Use the same embedding family the chunks were stored with.
  const storedModel = rows.find((r) => r.embedding && r.embedding.length)?.embeddingModel || "local-hash-384";
  let queryVector: number[];
  let embeddingModel = storedModel;

  if (storedModel.startsWith("text-embedding")) {
    const res = await embedTexts([query], options.apiKey);
    queryVector = res.vectors[0];
    embeddingModel = res.model;
  } else {
    queryVector = localEmbed(query);
    embeddingModel = "local-hash-384";
  }

  const vectorScores = rows.map((r) => {
    const emb = r.embedding && r.embedding.length ? r.embedding : localEmbed(`${r.title} ${r.content}`);
    return Math.max(0, cosineSimilarity(queryVector, emb));
  });
  const maxVector = Math.max(...vectorScores, 0.0001);

  // ---- Stage 3: Weighted score fusion + normalisation ----
  const scored = rows.map((r, i) => {
    const lex = bm25Scores[i] / maxBm25;       // 0..1
    const dense = vectorScores[i] / maxVector; // 0..1
    const fused = 0.55 * lex + 0.45 * dense;
    return {
      id: r.id,
      title: r.title,
      category: r.category,
      content: r.content,
      similarity: Number(fused.toFixed(4)),
      bm25: Number(bm25Scores[i].toFixed(4)),
      vector: Number(vectorScores[i].toFixed(4)),
      source: r.source,
      uploadId: r.uploadId,
      chunkIndex: r.chunkIndex,
      pageNumber: r.pageNumber,
      rawBm25: bm25Scores[i],
    };
  });

  scored.sort((a, b2) => b2.similarity - a.similarity);

  // Drop chunks with effectively zero lexical AND dense signal
  const meaningful = scored.filter((s) => s.rawBm25 > 0 || s.vector > 0.12);
  const top = (meaningful.length ? meaningful : scored).slice(0, k).map(({ rawBm25, ...rest }) => rest);

  return {
    chunks: top,
    corpusSize: rows.length,
    candidatesScored: scored.length,
    embeddingModel,
    maxScore: top[0]?.similarity ?? 0,
  };
}

/** Backwards-compatible helper used by the evaluation harness. */
export async function retrieveTopKDocuments(query: string, k = 3): Promise<RetrievedChunk[]> {
  const res = await retrieveChunks(query, { k, scope: "builtin" });
  return res.chunks;
}
