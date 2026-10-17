import { tokenize } from "./chunk";

/**
 * Embedding layer.
 *
 * - If an OpenAI-compatible embedding key is configured, we call the real
 *   embeddings endpoint (text-embedding-3-small, 1536 dims).
 * - Otherwise we fall back to a deterministic local hashed bag-of-words
 *   vector (384 dims) with sublinear TF weighting + L2 normalisation.
 *   This is a genuine vector space model: cosine similarity between these
 *   vectors is a meaningful lexical-semantic signal, it just does not carry
 *   pretrained world knowledge.
 */

export const LOCAL_EMBEDDING_DIMS = 384;
export const LOCAL_EMBEDDING_MODEL = "local-hash-384";
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

function hashToken(token: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < token.length; i++) {
    h = Math.imul(h ^ token.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic hashed TF vector with character-trigram smoothing. */
export function localEmbed(text: string): number[] {
  const vec = new Array(LOCAL_EMBEDDING_DIMS).fill(0);
  const tokens = tokenize(text);
  if (!tokens.length) return vec;

  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

  for (const [token, count] of Object.entries(tf)) {
    const weight = 1 + Math.log(count); // sublinear term frequency
    // unigram bucket
    vec[hashToken(token, 2166136261) % LOCAL_EMBEDDING_DIMS] += weight;
    // character trigram buckets -> robustness to morphology/typos
    for (let i = 0; i < token.length - 2; i++) {
      const tri = token.slice(i, i + 3);
      vec[hashToken(tri, 374761393) % LOCAL_EMBEDDING_DIMS] += weight * 0.35;
    }
  }

  // L2 normalise
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  provider: "openai" | "local";
}

/** Batch-embed texts, using a real provider when a key is available. */
export async function embedTexts(texts: string[], apiKey?: string, baseUrl?: string): Promise<EmbedResult> {
  const key = apiKey || process.env.OPENAI_API_KEY;

  if (key) {
    try {
      const url = `${baseUrl || "https://api.openai.com/v1"}/embeddings`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const json = await res.json();
        const vectors = (json.data || []).map((d: any) => d.embedding as number[]);
        if (vectors.length === texts.length) {
          return { vectors, model: OPENAI_EMBEDDING_MODEL, provider: "openai" };
        }
      }
    } catch {
      // fall through to local embeddings — never break ingestion on provider failure
    }
  }

  return {
    vectors: texts.map((t) => localEmbed(t)),
    model: LOCAL_EMBEDDING_MODEL,
    provider: "local",
  };
}
