import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { evalDataset, evaluationRuns, evaluationResults, modelPrices } from "@/db/schema";
import { retrieveChunks } from "@/lib/retrieval";
import { buildMessages, localExtractiveAnswer, measureGroundedness } from "@/lib/answer";
import { runCompletion, resolveKey, MODEL_CATALOGUE } from "@/lib/provider";
import { estimateTokens, tokenize } from "@/lib/chunk";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");

    if (runId) {
      const run = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId));
      if (!run.length) return NextResponse.json({ error: "Run not found" }, { status: 404 });

      const results = await db
        .select()
        .from(evaluationResults)
        .where(eq(evaluationResults.runId, runId))
        .orderBy(desc(evaluationResults.createdAt));

      return NextResponse.json({ run: run[0], results });
    }

    const runs = await db.select().from(evaluationRuns).orderBy(desc(evaluationRuns.createdAt)).limit(20);
    const dataset = await db.select().from(evalDataset).limit(35);

    return NextResponse.json({ runs, datasetSize: dataset.length, datasetSample: dataset.slice(0, 5) });
  } catch (err: any) {
    console.error("Evaluation API error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Heuristic judge used when no provider key is configured. */
function heuristicJudge(question: string, answer: string, reference: string, contextText: string) {
  const ansTokens = new Set(tokenize(answer));
  const refTokens = tokenize(reference);
  const qTokens = tokenize(question);

  const refHits = refTokens.filter((t) => ansTokens.has(t)).length;
  const relevanceRef = refTokens.length ? refHits / refTokens.length : 0;
  const qHits = qTokens.filter((t) => ansTokens.has(t)).length;
  const relevanceQ = qTokens.length ? qHits / qTokens.length : 0;
  const relevance = Number(Math.min(1, relevanceRef * 0.7 + relevanceQ * 0.5).toFixed(3));

  const ctxTokens = new Set(tokenize(contextText));
  const precisionHits = [...ansTokens].filter((t) => ctxTokens.has(t)).length;
  const contextPrecision = Number(Math.min(1, ansTokens.size ? precisionHits / ansTokens.size : 0).toFixed(3));

  return { relevance, contextPrecision, judge: "heuristic-lexical" };
}

/** LLM-as-a-judge with a strict JSON contract (used when a key exists). */
async function llmJudge(
  modelId: string,
  question: string,
  answer: string,
  reference: string,
  contextText: string
): Promise<{ relevance: number; contextPrecision: number; groundedness: number; reasoning: string; judge: string } | null> {
  try {
    const completion = await runCompletion({
      modelId,
      temperature: 0,
      maxTokens: 350,
      timeoutMs: 25000,
      maxRetries: 1,
      messages: [
        {
          role: "system",
          content:
            "You are a strict RAG evaluation judge. Score the ANSWER against the QUESTION, REFERENCE and CONTEXT. " +
            'Respond with ONLY minified JSON: {"relevance":0-1,"context_precision":0-1,"groundedness":0-1,"hallucination":true|false,"reasoning":"one sentence"}',
        },
        {
          role: "user",
          content: `QUESTION: ${question}\n\nREFERENCE ANSWER: ${reference}\n\nCONTEXT:\n${contextText.slice(0, 6000)}\n\nANSWER:\n${answer}`,
        },
      ],
    });

    const match = completion.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      relevance: Number(parsed.relevance) || 0,
      contextPrecision: Number(parsed.context_precision) || 0,
      groundedness: Number(parsed.groundedness) || 0,
      reasoning: String(parsed.reasoning || "LLM judge returned no reasoning"),
      judge: `llm-as-judge:${modelId}`,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const modelId = body.model || "gpt-4o";
    const promptVersion = body.promptVersion || "v1.2-prod";
    const sampleLimit = Math.min(30, Math.max(3, body.sampleLimit || 12));

    const dataset = await db.select().from(evalDataset).limit(sampleLimit);
    if (!dataset.length) return NextResponse.json({ error: "Evaluation dataset is empty" }, { status: 400 });

    const modelDef = MODEL_CATALOGUE.find((m) => m.id === modelId) || MODEL_CATALOGUE[0];
    const hasKey = Boolean((await resolveKey(modelDef.provider)) || (await resolveKey("openrouter")));

    const priceRows = await db.select().from(modelPrices).where(eq(modelPrices.model, modelId));
    const price = priceRows[0] || { inputPricePer1m: 2.5, outputPricePer1m: 10 };

    const runId = `run_${Date.now()}_${modelId.replace(/[^a-z0-9]/gi, "")}`;

    let sumHit = 0;
    let sumRelevance = 0;
    let sumGrounded = 0;
    let sumPrecision = 0;
    let hallucinations = 0;
    let sumLatency = 0;
    let totalCost = 0;

    const results: any[] = [];

    for (const item of dataset) {
      const qStart = Date.now();

      // --- real retrieval ---
      const retrieval = await retrieveChunks(item.question, { k: 3, scope: "builtin" });
      const chunks = retrieval.chunks;
      const retrievedIds = chunks.map((c) => c.id);

      // --- recall@k against expected doc ids ---
      const expected = item.expectedDocIds || [];
      const matched = retrievedIds.filter((id) => expected.includes(id)).length;
      const hitRate = expected.length ? Number((matched / expected.length).toFixed(2)) : 1;

      // --- real generation ---
      const { messages, contextText } = buildMessages(item.question, chunks, [], "knowledge_base");
      let answer = "";
      let inTok = 0;
      let outTok = 0;

      if (hasKey) {
        try {
          const c = await runCompletion({ modelId, messages, temperature: 0.1, maxTokens: 600, timeoutMs: 28000, maxRetries: 1 });
          answer = c.text.trim();
          inTok = c.inputTokens || estimateTokens(contextText);
          outTok = c.outputTokens || estimateTokens(answer);
        } catch {
          /* fall through to extractive */
        }
      }
      if (!answer) {
        const local = localExtractiveAnswer(item.question, chunks);
        answer = local.text;
        inTok = estimateTokens(contextText + item.question);
        outTok = estimateTokens(answer);
      }

      const latency = Date.now() - qStart;

      // --- scoring: real groundedness + judge ---
      const grounding = measureGroundedness(answer, chunks);
      let relevance: number;
      let contextPrecision: number;
      let groundedness = grounding.score;
      let reasoning: string;
      let judge: string;

      const judged = hasKey ? await llmJudge(modelId, item.question, answer, item.referenceAnswer, contextText) : null;
      if (judged) {
        relevance = judged.relevance;
        contextPrecision = judged.contextPrecision;
        groundedness = Number(((judged.groundedness + grounding.score) / 2).toFixed(3));
        reasoning = judged.reasoning;
        judge = judged.judge;
      } else {
        const h = heuristicJudge(item.question, answer, item.referenceAnswer, contextText);
        relevance = h.relevance;
        contextPrecision = h.contextPrecision;
        reasoning = grounding.hallucinationRisk
          ? `Unsupported statements detected: ${grounding.unsupportedSentences[0]?.slice(0, 120) || "low lexical support"}`
          : `Answer supported by retrieved context (${(grounding.score * 100).toFixed(0)}% token support across ${grounding.checkedSentences} sentences).`;
        judge = h.judge;
      }

      const hallucination = grounding.hallucinationRisk || groundedness < 0.5;
      if (hallucination) hallucinations += 1;

      const cost = (inTok / 1_000_000) * price.inputPricePer1m + (outTok / 1_000_000) * price.outputPricePer1m;

      sumHit += hitRate;
      sumRelevance += relevance;
      sumGrounded += groundedness;
      sumPrecision += contextPrecision;
      sumLatency += latency;
      totalCost += cost;

      results.push({
        id: `eval_res_${Math.random().toString(36).slice(2, 9)}_${item.id}`,
        runId,
        questionId: item.id,
        requestId: null,
        question: item.question,
        generatedAnswer: answer,
        retrievedDocIds: retrievedIds,
        expectedDocIds: expected,
        scores: {
          hitRate,
          relevance,
          groundedness,
          contextPrecision,
          hallucination,
          reasoning: `[${judge}] ${reasoning}`,
        },
        createdAt: new Date(),
      });
    }

    const n = dataset.length;
    const scores = {
      retrievalRecall: Number((sumHit / n).toFixed(3)),
      answerRelevance: Number((sumRelevance / n).toFixed(3)),
      groundedness: Number((sumGrounded / n).toFixed(3)),
      contextPrecision: Number((sumPrecision / n).toFixed(3)),
      hallucinationRate: Number(((hallucinations / n) * 100).toFixed(1)),
      avgLatencyMs: Math.round(sumLatency / n),
      totalCostUsd: Number(totalCost.toFixed(5)),
    };

    await db.insert(evaluationRuns).values({
      id: runId,
      createdAt: new Date(),
      model: modelId,
      promptVersion: hasKey ? promptVersion : `${promptVersion} (extractive)`,
      datasetSize: n,
      scores,
      status: "completed",
    });

    for (const r of results) await db.insert(evaluationResults).values(r);

    // regression check vs previous baseline
    const previous = await db.select().from(evaluationRuns).orderBy(desc(evaluationRuns.createdAt)).limit(3);
    const baseline = previous.find((p) => p.id !== runId);
    const regressions: string[] = [];
    if (baseline?.scores) {
      const b = baseline.scores as any;
      if (scores.groundedness < b.groundedness - 0.05) regressions.push("groundedness");
      if (scores.answerRelevance < b.answerRelevance - 0.05) regressions.push("answer_relevance");
      if (scores.retrievalRecall < b.retrievalRecall - 0.05) regressions.push("retrieval_recall");
    }

    return NextResponse.json({
      success: true,
      runId,
      model: modelId,
      engine: hasKey ? "provider" : "local-extractive",
      judge: hasKey ? "llm-as-judge" : "heuristic-lexical",
      datasetSize: n,
      scores,
      regressions,
    });
  } catch (err: any) {
    console.error("Evaluation run failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
