import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requests, spans, modelPrices } from "@/db/schema";
import { redactPII } from "@/lib/redact";
import { retrieveChunks } from "@/lib/retrieval";
import { buildMessages, localExtractiveAnswer, measureGroundedness } from "@/lib/answer";
import { runCompletion, LLMError, MODEL_CATALOGUE, ChatTurn, resolveKey } from "@/lib/provider";
import { estimateTokens } from "@/lib/chunk";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SpanRecord {
  stage: string;
  startMs: number;
  durationMs: number;
  attributes: Record<string, any>;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const collected: SpanRecord[] = [];

  const mark = () => Date.now() - t0;
  const pushSpan = (stage: string, startMs: number, attributes: Record<string, any>) => {
    collected.push({ stage, startMs, durationMs: Math.max(0, mark() - startMs), attributes });
  };

  let redactedQuery = "";
  let modelId = "gpt-4o";
  let mode: "auto" | "knowledge_base" | "general" = "auto";
  let sessionId: string | null = null;
  let uploadIds: string[] = [];

  try {
    const body = await req.json();
    const rawQuery: string = (body.query || "").toString();
    modelId = body.model || "gpt-4o";
    mode = body.mode || "auto";
    sessionId = body.sessionId || null;
    uploadIds = Array.isArray(body.uploadIds) ? body.uploadIds : [];
    const history: ChatTurn[] = Array.isArray(body.history) ? body.history : [];

    if (!rawQuery.trim()) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    /* ---------------- Span 1: query_processing (PII redaction) ---------------- */
    const s1 = mark();
    redactedQuery = redactPII(rawQuery);
    const piiRedacted = redactedQuery !== rawQuery;
    pushSpan("query_processing", s1, {
      pii_redacted: piiRedacted,
      query_chars: rawQuery.length,
      history_turns: history.length,
      mode,
      scoped_uploads: uploadIds.length,
    });

    /* ---------------- Span 2 + 3: vector_search & retrieval ---------------- */
    let chunks: any[] = [];
    let retrievalMeta: any = { corpusSize: 0, candidatesScored: 0, embeddingModel: "none", maxScore: 0 };

    if (mode !== "general") {
      const s2 = mark();
      const outcome = await retrieveChunks(redactedQuery, {
        k: 4,
        scope: uploadIds.length ? "upload" : "all",
        uploadIds: uploadIds.length ? uploadIds : undefined,
      });
      retrievalMeta = outcome;
      pushSpan("vector_search", s2, {
        corpus_chunks: outcome.corpusSize,
        candidates_scored: outcome.candidatesScored,
        embedding_model: outcome.embeddingModel,
        algorithm: "bm25 + cosine hybrid fusion",
        top_k: 4,
      });

      const s3 = mark();
      // Relevance gate: drop weak passages so the model is not polluted by noise
      const threshold = mode === "knowledge_base" ? 0.12 : 0.3;
      chunks = outcome.chunks.filter((c) => c.similarity >= threshold);
      pushSpan("retrieval", s3, {
        doc_ids: chunks.map((c) => c.id),
        similarity_scores: chunks.map((c) => c.similarity),
        titles: chunks.map((c) => c.title),
        sources: chunks.map((c) => c.source),
        relevance_gate: threshold,
        dropped: outcome.chunks.length - chunks.length,
      });
    }

    const effectiveMode: "auto" | "knowledge_base" | "general" =
      mode === "general" || chunks.length === 0 ? (mode === "knowledge_base" ? "knowledge_base" : "general") : mode;

    /* ---------------- Span 4: llm_generation ---------------- */
    const s4 = mark();
    const { messages, contextText } = buildMessages(redactedQuery, chunks, history, effectiveMode);

    let answerText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let engine: "provider" | "local-extractive" = "local-extractive";
    let providerName: string = "local";
    let providerModel = "extractive-ranker";
    let attempts = 1;
    let finishReason = "stop";
    let usageReported = false;
    let fallbackReason: string | null = null;

    const modelDef = MODEL_CATALOGUE.find((m) => m.id === modelId) || MODEL_CATALOGUE[0];
    const nativeKey = await resolveKey(modelDef.provider);
    const routerKey = await resolveKey("openrouter");
    const hasKey = Boolean(nativeKey || routerKey);

    if (hasKey) {
      try {
        const completion = await runCompletion({
          modelId,
          messages,
          temperature: 0.2,
          maxTokens: 900,
          timeoutMs: 30000,
          maxRetries: 2,
        });
        answerText = completion.text?.trim() || "";
        inputTokens = completion.inputTokens || estimateTokens(messages.map((m) => m.content).join(" "));
        outputTokens = completion.outputTokens || estimateTokens(answerText);
        engine = "provider";
        providerName = completion.provider;
        providerModel = completion.providerModel;
        attempts = completion.attempts;
        finishReason = completion.finishReason;
        usageReported = completion.usageReported;
      } catch (err: any) {
        // Provider failed -> log it as a real error span, then degrade gracefully
        const llmErr: LLMError = err instanceof LLMError ? err : new LLMError("upstream_error", err?.message || "unknown");
        fallbackReason = `${llmErr.type}: ${llmErr.message}`;

        if (mode === "general" || !chunks.length) {
          // Nothing to fall back on — record a hard error request and return 502
          pushSpan("llm_generation", s4, {
            model: modelId,
            provider: modelDef.provider,
            error: llmErr.message,
            error_type: llmErr.type,
            attempts: 3,
            retryable: llmErr.retryable,
          });
          await persist({
            requestId,
            sessionId,
            redactedQuery,
            rawQuery,
            modelId,
            status: llmErr.type === "upstream_timeout" ? "timeout" : "error",
            errorType: llmErr.type,
            errorMessage: llmErr.message,
            latencyMs: mark(),
            inputTokens: estimateTokens(messages.map((m) => m.content).join(" ")),
            outputTokens: 0,
            answer: null,
            chunks,
            engine: "provider",
            provider: modelDef.provider,
            mode: effectiveMode,
            groundedness: null,
            retryCount: 2,
            uploadId: uploadIds[0] || null,
            collected,
          });
          return NextResponse.json(
            { requestId, status: "error", errorType: llmErr.type, errorMessage: llmErr.message },
            { status: 502 }
          );
        }
      }
    } else {
      fallbackReason = "no_provider_key";
    }

    if (!answerText) {
      if (!chunks.length && !hasKey) {
        // Honest capability statement: open-domain answers need a generative model.
        answerText =
          `**Open-domain answering needs a generative model.**\n\n` +
          `This question doesn't match anything in the retrieval index, and no LLM provider key is configured, so I won't invent an answer.\n\n` +
          `Two ways forward:\n` +
          `- **Attach a PDF / TXT / MD file** (paperclip, or drag it in) — I'll parse, chunk, embed and answer from it immediately with citations.\n` +
          `- **Add a provider key** under *Alerts & Settings* (OpenAI, Anthropic, Groq or OpenRouter) to switch this assistant to live LLM generation for any question.\n\n` +
          `_Either way, this turn was still fully traced: spans, tokens, cost and latency are recorded in Overview and Traces._`;
      } else {
        const local = localExtractiveAnswer(redactedQuery, chunks);
        answerText = local.text;
      }
      engine = "local-extractive";
      providerName = "local";
      providerModel = "extractive-ranker-v1";
      inputTokens = estimateTokens(contextText + redactedQuery);
      outputTokens = estimateTokens(answerText);
    }

    pushSpan("llm_generation", s4, {
      engine,
      model: modelId,
      provider: providerName,
      provider_model: providerModel,
      attempts,
      retries: attempts - 1,
      finish_reason: finishReason,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      usage_reported_by_provider: usageReported,
      context_chars: contextText.length,
      fallback_reason: fallbackReason,
    });

    /* ---------------- Span 5: response (groundedness + cost) ---------------- */
    const s5 = mark();
    const grounding = chunks.length ? measureGroundedness(answerText, chunks) : null;

    const priceRows = await db.select().from(modelPrices).where(eq(modelPrices.model, modelId));
    const price = priceRows[0] || { inputPricePer1m: 2.5, outputPricePer1m: 10 };
    const costUsd = Number(
      ((inputTokens / 1_000_000) * price.inputPricePer1m + (outputTokens / 1_000_000) * price.outputPricePer1m).toFixed(6)
    );

    pushSpan("response", s5, {
      status: 200,
      groundedness: grounding?.score ?? null,
      hallucination_risk: grounding?.hallucinationRisk ?? false,
      unsupported_claims: grounding?.unsupportedSentences ?? [],
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: costUsd,
    });

    const totalLatency = mark();

    await persist({
      requestId,
      sessionId,
      redactedQuery,
      rawQuery,
      modelId,
      status: "success",
      errorType: null,
      errorMessage: null,
      latencyMs: totalLatency,
      inputTokens,
      outputTokens,
      answer: answerText,
      chunks,
      engine,
      provider: providerName,
      mode: effectiveMode,
      groundedness: grounding?.score ?? null,
      retryCount: attempts - 1,
      uploadId: uploadIds[0] || null,
      collected,
      costOverride: costUsd,
    });

    const bottleneck = collected.reduce((a, b) => (b.durationMs > a.durationMs ? b : a), collected[0]);

    return NextResponse.json({
      requestId,
      answer: answerText,
      sources: chunks,
      engine,
      provider: providerName,
      providerModel,
      mode: effectiveMode,
      fallbackReason,
      metrics: {
        latencyMs: totalLatency,
        inputTokens,
        outputTokens,
        estimatedCostUsd: costUsd,
        bottleneckStage: bottleneck?.stage || "llm_generation",
        retries: attempts - 1,
        groundedness: grounding?.score ?? null,
        hallucinationRisk: grounding?.hallucinationRisk ?? false,
        unsupportedClaims: grounding?.unsupportedSentences ?? [],
        corpusChunks: retrievalMeta.corpusSize,
        embeddingModel: retrievalMeta.embeddingModel,
      },
      spans: collected,
      redactedQuery,
    });
  } catch (err: any) {
    console.error("Chat pipeline error:", err);
    try {
      await persist({
        requestId,
        sessionId,
        redactedQuery: redactedQuery || "[unparsed]",
        rawQuery: null,
        modelId,
        status: "error",
        errorType: "pipeline_error",
        errorMessage: err?.message || "Unhandled pipeline failure",
        latencyMs: mark(),
        inputTokens: 0,
        outputTokens: 0,
        answer: null,
        chunks: [],
        engine: "provider",
        provider: "local",
        mode,
        groundedness: null,
        retryCount: 0,
        uploadId: null,
        collected,
      });
    } catch {}
    return NextResponse.json({ error: err?.message || "Pipeline failure" }, { status: 500 });
  }
}

/** Persists the request row + every span. Never throws into the request path. */
async function persist(p: {
  requestId: string;
  sessionId: string | null;
  redactedQuery: string;
  rawQuery: string | null;
  modelId: string;
  status: string;
  errorType: string | null;
  errorMessage: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  answer: string | null;
  chunks: any[];
  engine: string;
  provider: string;
  mode: string;
  groundedness: number | null;
  retryCount: number;
  uploadId: string | null;
  collected: SpanRecord[];
  costOverride?: number;
}) {
  try {
    let cost = p.costOverride;
    if (cost === undefined) {
      const rows = await db.select().from(modelPrices).where(eq(modelPrices.model, p.modelId));
      const price = rows[0] || { inputPricePer1m: 2.5, outputPricePer1m: 10 };
      cost = Number(
        ((p.inputTokens / 1_000_000) * price.inputPricePer1m + (p.outputTokens / 1_000_000) * price.outputPricePer1m).toFixed(6)
      );
    }

    const bottleneck = p.collected.length
      ? p.collected.reduce((a, b) => (b.durationMs > a.durationMs ? b : a)).stage
      : "llm_generation";

    await db.insert(requests).values({
      id: p.requestId,
      createdAt: new Date(),
      queryRedacted: p.redactedQuery,
      rawQuery: p.rawQuery,
      model: p.modelId,
      promptVersion: "chat-v2",
      status: p.status,
      errorType: p.errorType,
      errorMessage: p.errorMessage,
      latencyMs: p.latencyMs,
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      estimatedCostUsd: cost,
      answer: p.answer,
      retrievedDocIds: p.chunks.map((c) => c.id),
      bottleneckStage: bottleneck,
      sessionId: p.sessionId,
      engine: p.engine,
      provider: p.provider,
      retrievalMode: p.mode,
      groundedness: p.groundedness,
      retryCount: p.retryCount,
      uploadId: p.uploadId,
    });

    if (p.collected.length) {
      await db.insert(spans).values(
        p.collected.map((s) => ({
          id: `span_${Math.random().toString(36).slice(2, 11)}`,
          requestId: p.requestId,
          stage: s.stage,
          startMs: s.startMs,
          durationMs: s.durationMs,
          attributes: s.attributes,
          createdAt: new Date(),
        }))
      );
    }
  } catch (e) {
    console.error("Telemetry persistence failed:", e);
  }
}
