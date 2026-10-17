import { RetrievedChunk } from "./retrieval";
import { tokenize } from "./chunk";
import { ChatTurn } from "./provider";

/* ------------------------------------------------------------------ *
 * Prompt construction for real provider calls
 * ------------------------------------------------------------------ */

export function buildMessages(
  query: string,
  chunks: RetrievedChunk[],
  history: ChatTurn[],
  mode: "auto" | "knowledge_base" | "general"
): { messages: ChatTurn[]; contextText: string } {
  const contextText = chunks
    .map((c, i) => `[${i + 1}] ${c.title}${c.pageNumber ? ` (p.${c.pageNumber})` : ""}\n${c.content}`)
    .join("\n\n---\n\n");

  const grounded = chunks.length > 0 && mode !== "general";

  const system = grounded
    ? [
        "You are ObserveAI Assistant, a retrieval-augmented enterprise assistant.",
        "Answer the user's question using the CONTEXT passages below as your primary source of truth.",
        "Cite the passages you rely on inline using bracketed numbers like [1], [2].",
        "If the context only partially answers the question, say what is supported and clearly mark the rest as outside the provided documents.",
        "If the context is irrelevant, say so and answer from general knowledge while stating that it is not from the documents.",
        "Be concise, factual, and use markdown bullets for multi-part answers.",
        "",
        "CONTEXT:",
        contextText,
      ].join("\n")
    : [
        "You are ObserveAI Assistant, a helpful, accurate general-purpose assistant.",
        "Answer clearly and concisely using markdown when it improves readability.",
        "If you are unsure about a fact, say so rather than inventing details.",
      ].join("\n");

  const messages: ChatTurn[] = [{ role: "system", content: system }];
  for (const h of history.slice(-6)) {
    if (h.role === "user" || h.role === "assistant") messages.push(h);
  }
  messages.push({ role: "user", content: query });

  return { messages, contextText };
}

/* ------------------------------------------------------------------ *
 * Local extractive engine (works with zero API keys)
 * ------------------------------------------------------------------ */

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9"'(\[•\-])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
}

const QUESTION_HINTS: Array<{ re: RegExp; bonus: RegExp }> = [
  { re: /how (much|many)|number|count|amount|cost|price|budget|days?|weeks?|hours?|%/i, bonus: /\d/ },
  { re: /when|date|deadline|timeline|expire/i, bonus: /\b(\d{1,2}|january|february|march|april|may|june|july|august|september|october|november|december|day|week|month|year|annual|quarter)\b/i },
  { re: /who|team|owner|responsible|approv/i, bonus: /\b(manager|team|lead|owner|director|hr|it|admin|approv)/i },
  { re: /where|location|office|region/i, bonus: /\b(office|region|country|location|site|remote)\b/i },
  { re: /how (do|can|to)|process|steps?|procedure/i, bonus: /\b(must|should|require|submit|request|follow|step|first|then|via)\b/i },
];

export interface LocalAnswer {
  text: string;
  supportSentences: number;
  bestScore: number;
}

/**
 * Builds an answer by ranking and stitching the most query-relevant sentences
 * out of the retrieved passages. Purely extractive, so everything it says is
 * traceable back to the source document — it is the honest fallback when no
 * generative provider key is configured.
 */
export function localExtractiveAnswer(query: string, chunks: RetrievedChunk[]): LocalAnswer {
  if (!chunks.length) {
    return {
      text:
        "I could not find anything relevant in the indexed knowledge base for that question.\n\n" +
        "Upload a PDF or text file in this chat to add it to the retrieval index, switch the scope to **General**, or configure an LLM provider key under **Alerts & Settings** to enable open-domain answers.",
      supportSentences: 0,
      bestScore: 0,
    };
  }

  const qTokens = new Set(tokenize(query));
  const hint = QUESTION_HINTS.find((h) => h.re.test(query));

  type Scored = { sentence: string; score: number; chunkIdx: number; order: number };
  const scored: Scored[] = [];

  chunks.forEach((chunk, ci) => {
    const sentences = splitSentences(chunk.content);
    sentences.forEach((sentence, si) => {
      const sTokens = tokenize(sentence);
      if (!sTokens.length) return;
      const uniq = new Set(sTokens);
      let overlap = 0;
      for (const t of qTokens) if (uniq.has(t)) overlap += 1;

      const coverage = qTokens.size ? overlap / qTokens.size : 0;
      const density = overlap / Math.sqrt(sTokens.length);
      const positionPrior = 1 / (1 + si * 0.12);
      const chunkPrior = chunk.similarity;
      const hintBonus = hint && hint.bonus.test(sentence) ? 0.35 : 0;

      const score = coverage * 1.6 + density * 0.9 + chunkPrior * 0.8 + positionPrior * 0.2 + hintBonus;
      scored.push({ sentence, score, chunkIdx: ci, order: ci * 1000 + si });
    });
  });

  scored.sort((a, b) => b.score - a.score);

  // de-duplicate near-identical sentences
  const picked: Scored[] = [];
  for (const cand of scored) {
    if (picked.length >= 5) break;
    const candTokens = new Set(tokenize(cand.sentence));
    const dup = picked.some((p) => {
      const pTokens = new Set(tokenize(p.sentence));
      let inter = 0;
      for (const t of candTokens) if (pTokens.has(t)) inter += 1;
      return inter / Math.max(1, Math.min(candTokens.size, pTokens.size)) > 0.72;
    });
    if (!dup) picked.push(cand);
  }

  const bestScore = picked[0]?.score ?? 0;

  if (!picked.length || bestScore < 0.55) {
    const top = chunks[0];
    return {
      text:
        `I did not find a confident answer to that in the indexed documents. The closest passage is **${top.title}**` +
        `${top.pageNumber ? ` (page ${top.pageNumber})` : ""}:\n\n> ${top.content.slice(0, 420)}${top.content.length > 420 ? "…" : ""}\n\n` +
        `Try rephrasing with terms used in the document, or configure an LLM provider key to enable full generative synthesis.`,
      supportSentences: 0,
      bestScore,
    };
  }

  // keep only sentences close to the best score, then restore document order
  const chosen = picked
    .filter((p) => p.score >= Math.max(0.55, bestScore * 0.5))
    .slice(0, 4)
    .sort((a, b) => a.order - b.order);

  const lines = chosen.map((c) => `- ${c.sentence.replace(/\s+/g, " ").trim()} [${c.chunkIdx + 1}]`);
  const usedChunks = new Set(chosen.map((c) => c.chunkIdx));
  const sourceList = chunks
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => usedChunks.has(i))
    .map(({ c, i }) => `[${i + 1}] ${c.title} · match ${(c.similarity * 100).toFixed(0)}%`)
    .join("\n");

  const text =
    `Here is what the indexed documents state regarding your question:\n\n${lines.join("\n")}\n\n**Sources**\n${sourceList}\n\n` +
    `_Extractive engine: every sentence above is quoted verbatim from the retrieved passages. Configure an LLM provider key in Alerts & Settings for full generative synthesis._`;

  return { text, supportSentences: chosen.length, bestScore };
}

/* ------------------------------------------------------------------ *
 * Real post-hoc groundedness / hallucination measurement
 * ------------------------------------------------------------------ */

export interface GroundednessReport {
  score: number;              // 0..1 mean sentence support
  unsupportedSentences: string[];
  checkedSentences: number;
  hallucinationRisk: boolean;
}

/**
 * Measures how much of the generated answer is lexically supported by the
 * retrieved context. Each answer sentence is scored by the share of its
 * content tokens that appear in the context; the mean is the groundedness.
 */
export function measureGroundedness(answer: string, chunks: RetrievedChunk[]): GroundednessReport {
  const contextTokens = new Set(tokenize(chunks.map((c) => c.content).join(" ")));
  if (!contextTokens.size) {
    return { score: 0, unsupportedSentences: [], checkedSentences: 0, hallucinationRisk: false };
  }

  // Only factual answer content is scored — citation scaffolding, source
  // listings and engine disclaimers are presentation, not claims.
  const SCAFFOLDING = [
    /^here is what the indexed documents state/i,
    /^\*\*sources\*\*/i,
    /^\[\d+\]/,
    /^_/,
    /^i did not find/i,
    /^i could not find/i,
    /extractive engine:/i,
    /provider key/i,
  ];

  const sentences = answer
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.replace(/^[-*•]\s+/, "").replace(/\s*\[\d+\]\s*$/, "").trim())
    .filter((s) => s.length > 30 && !SCAFFOLDING.some((re) => re.test(s)));

  if (!sentences.length) {
    return { score: 1, unsupportedSentences: [], checkedSentences: 0, hallucinationRisk: false };
  }

  const unsupported: string[] = [];
  let total = 0;

  for (const s of sentences) {
    const toks = tokenize(s);
    if (!toks.length) continue;
    let hits = 0;
    for (const t of toks) if (contextTokens.has(t)) hits += 1;
    const support = hits / toks.length;
    total += support;
    if (support < 0.45) unsupported.push(s.slice(0, 160));
  }

  const score = Number((total / sentences.length).toFixed(3));
  return {
    score,
    unsupportedSentences: unsupported.slice(0, 3),
    checkedSentences: sentences.length,
    hallucinationRisk: score < 0.5 && chunks.length > 0,
  };
}
