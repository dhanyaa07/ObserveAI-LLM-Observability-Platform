import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requests, spans, modelPrices } from "@/db/schema";
import { SAMPLE_DOCUMENTS } from "@/db/seed";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(25, Math.max(1, body.count || 8)); // Generate batch of requests

    const models = ["gpt-4o", "claude-3-5-sonnet", "llama-3-3-70b"];
    const promptVersions = ["v1.2-prod", "v1.1-legacy", "v2.0-experimental"];
    const testQueries = [
      "Can employees rollover accrued vacation days past December 31?",
      "How do I submit an Expensify receipt for dinner while traveling?",
      "What are the security steps for personal iPhones using Slack?",
      "How does the canary release threshold monitor p95 latency?",
      "What is the maximum remote work stipend for monitors and keyboards?",
      "What is the SLA required when resolving a critical SEV-1 outage?",
      "Can I use AWS credits from my personal learning budget?",
      "What is the Teleport zero-trust policy for production database sessions?",
    ];

    const generatedIds: string[] = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const reqId = `req_live_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString().slice(-4)}`;
      const query = testQueries[Math.floor(Math.random() * testQueries.length)];
      const model = models[Math.floor(Math.random() * models.length)];
      const promptVersion = promptVersions[Math.floor(Math.random() * promptVersions.length)];

      // Inject simulated latency or failure occasionally
      const isSlow = Math.random() < 0.25;
      const isFailure = Math.random() < 0.15;

      const qpMs = 12 + Math.floor(Math.random() * 15);
      const vsMs = isSlow ? 1450 + Math.floor(Math.random() * 800) : 40 + Math.floor(Math.random() * 50);
      const retMs = 20 + Math.floor(Math.random() * 25);
      const llmMs = isFailure ? 850 : (model === "llama-3-3-70b" ? 220 : 540) + Math.floor(Math.random() * 200);
      const respMs = 12;

      const totalLatency = qpMs + vsMs + retMs + llmMs + respMs;
      const status = isFailure ? "error" : "success";
      const errorType = isFailure ? (Math.random() < 0.5 ? "upstream_timeout" : "rate_limit") : null;
      const errorMessage = isFailure ? (errorType === "upstream_timeout" ? "Upstream timeout after 15000ms" : "Rate limit 429: quota exceeded") : null;

      const inTokens = 350 + Math.floor(Math.random() * 250);
      const outTokens = isFailure ? 0 : 180 + Math.floor(Math.random() * 120);

      // Price calculation
      const pricePer1m = model === "gpt-4o" ? { in: 2.5, out: 10.0 } : (model === "claude-3-5-sonnet" ? { in: 3.0, out: 15.0 } : { in: 0.59, out: 0.79 });
      const cost = Number(((inTokens / 1_000_000) * pricePer1m.in + (outTokens / 1_000_000) * pricePer1m.out).toFixed(6));

      // Bottleneck stage
      const stageMap: Record<string, number> = {
        query_processing: qpMs,
        vector_search: vsMs,
        retrieval: retMs,
        llm_generation: llmMs,
        response: respMs,
      };
      let bottleneck = "llm_generation";
      let maxMs = 0;
      for (const [s, d] of Object.entries(stageMap)) {
        if (d > maxMs) {
          maxMs = d;
          bottleneck = s;
        }
      }

      await db.insert(requests).values({
        id: reqId,
        createdAt: new Date(),
        queryRedacted: query,
        rawQuery: query,
        model,
        promptVersion,
        status,
        errorType,
        errorMessage,
        latencyMs: totalLatency,
        inputTokens: inTokens,
        outputTokens: outTokens,
        estimatedCostUsd: cost,
        answer: status === "success" ? `Observed enterprise policy result for "${query}". Compliant with corporate policy standards.` : null,
        retrievedDocIds: [1, 2],
        bottleneckStage: bottleneck,
      });

      // Insert Spans
      let curStart = 0;
      const spanDefs = [
        { name: "query_processing", dur: qpMs, attrs: { query_len: query.length } },
        { name: "vector_search", dur: vsMs, attrs: { top_k: 3, index: "hnsw" } },
        { name: "retrieval", dur: retMs, attrs: { docs: [1, 2], score: 0.92 } },
        { name: "llm_generation", dur: llmMs, attrs: { model, promptVersion, error: errorType } },
        { name: "response", dur: respMs, attrs: { status } },
      ];

      for (const sp of spanDefs) {
        await db.insert(spans).values({
          id: `span_${Math.random().toString(36).substring(2, 9)}`,
          requestId: reqId,
          stage: sp.name,
          startMs: curStart,
          durationMs: sp.dur,
          attributes: sp.attrs,
          createdAt: new Date(),
        });
        curStart += sp.dur;
      }

      generatedIds.push(reqId);
    }

    return NextResponse.json({
      success: true,
      message: `Generated ${count} simulated RAG requests with live telemetry.`,
      generatedIds,
    });
  } catch (err: any) {
    console.error("Traffic generator error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
