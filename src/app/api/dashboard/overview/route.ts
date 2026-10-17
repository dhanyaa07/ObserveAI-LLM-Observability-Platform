import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requests } from "@/db/schema";
import { desc, gte } from "drizzle-orm";

/**
 * Time-range configuration.
 * Bucket width is chosen so that recent, low-volume live traffic stays
 * visible instead of being diluted into a huge bucket.
 */
const RANGES: Record<string, { minutes: number; buckets: number }> = {
  "15m": { minutes: 15, buckets: 30 },   // 30s buckets
  "1h": { minutes: 60, buckets: 30 },    // 2m buckets
  "24h": { minutes: 1440, buckets: 48 }, // 30m buckets
  "7d": { minutes: 10080, buckets: 56 }, // 3h buckets
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const timeRange = searchParams.get("timeRange") || "1h";
    const cfg = RANGES[timeRange] || RANGES["1h"];

    const now = Date.now();
    const windowMs = cfg.minutes * 60 * 1000;
    const sinceDate = new Date(now - windowMs);

    const reqList = await db
      .select()
      .from(requests)
      .where(gte(requests.createdAt, sinceDate))
      .orderBy(desc(requests.createdAt));

    /* ---------------- KPIs ---------------- */
    const totalRequests = reqList.length;
    const errorCount = reqList.filter((r) => r.status !== "success").length;
    const errorRate = totalRequests ? Number(((errorCount / totalRequests) * 100).toFixed(2)) : 0;

    const latencies = reqList.map((r) => r.latencyMs).sort((a, b) => a - b);
    const totalLatency = latencies.reduce((a, c) => a + c, 0);
    const avgLatency = totalRequests ? Math.round(totalLatency / totalRequests) : 0;
    const p95Latency = latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
      : 0;
    const totalCost = reqList.reduce((a, c) => a + c.estimatedCostUsd, 0);

    // Throughput measured against the real window length, not a derived guess.
    const requestsPerMin = Number((totalRequests / cfg.minutes).toFixed(2));

    // Live (real chat) traffic vs seeded/simulated demo traffic
    const liveRequests = reqList.filter((r) => r.engine && r.engine !== "simulated").length;
    const lastRequest = reqList[0] || null;

    /* ---------------- Time-series buckets ----------------
     * Buckets are aligned so the FINAL bucket ends exactly at `now`,
     * guaranteeing a request made one second ago lands in the last bucket.
     * Raw epoch ms is returned so the browser can label in LOCAL time —
     * formatting server-side produced UTC labels that did not match the
     * user's wall clock.
     */
    const bucketMs = windowMs / cfg.buckets;
    const series = [];

    for (let i = 0; i < cfg.buckets; i++) {
      const start = now - windowMs + i * bucketMs;
      const end = start + bucketMs;
      const isLast = i === cfg.buckets - 1;

      const items = reqList.filter((r) => {
        const t = r.createdAt.getTime();
        return t >= start && (isLast ? t <= end + 1000 : t < end);
      });

      const n = items.length;
      const errs = items.filter((r) => r.status !== "success").length;
      const lats = items.map((r) => r.latencyMs).sort((a, b) => a - b);
      const cost = items.reduce((a, c) => a + c.estimatedCostUsd, 0);

      series.push({
        ts: Math.round(start),
        tsEnd: Math.round(end),
        reqCount: n,
        // null (not 0) when there is no sample: an empty bucket means
        // "no data", not "zero latency". Recharts renders a gap.
        latencyAvg: n ? Math.round(lats.reduce((a, c) => a + c, 0) / n) : null,
        latencyP95: n ? lats[Math.min(n - 1, Math.floor(n * 0.95))] : null,
        errorRate: n ? Number(((errs / n) * 100).toFixed(1)) : null,
        rpm: Number((n / (bucketMs / 60000)).toFixed(2)),
        cost: Number(cost.toFixed(6)),
        live: items.filter((r) => r.engine && r.engine !== "simulated").length,
      });
    }

    /* ---------------- Tables ---------------- */
    const slowestRequests = [...reqList]
      .sort((a, b) => b.latencyMs - a.latencyMs)
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        query: r.queryRedacted,
        model: r.model,
        latencyMs: r.latencyMs,
        bottleneck: r.bottleneckStage,
        status: r.status,
      }));

    const mostExpensiveRequests = [...reqList]
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        query: r.queryRedacted,
        model: r.model,
        tokens: r.inputTokens + r.outputTokens,
        costUsd: r.estimatedCostUsd,
        status: r.status,
      }));

    const bottleneckDistribution: Record<string, number> = {};
    for (const r of reqList.filter((x) => x.latencyMs > 1000)) {
      bottleneckDistribution[r.bottleneckStage] = (bottleneckDistribution[r.bottleneckStage] || 0) + 1;
    }

    return NextResponse.json({
      kpis: {
        totalRequests,
        avgLatency,
        p95Latency,
        errorRate,
        totalCost: Number(totalCost.toFixed(4)),
        requestsPerMin,
        liveRequests,
      },
      timeSeries: series,
      bucketSeconds: Math.round(bucketMs / 1000),
      windowMinutes: cfg.minutes,
      lastRequest: lastRequest
        ? {
            id: lastRequest.id,
            at: lastRequest.createdAt.getTime(),
            engine: lastRequest.engine,
            latencyMs: lastRequest.latencyMs,
            status: lastRequest.status,
            query: lastRequest.queryRedacted,
          }
        : null,
      slowestRequests,
      mostExpensiveRequests,
      bottleneckDistribution,
      monitoringActive: true,
      serverNow: now,
    });
  } catch (error: any) {
    console.error("Dashboard metrics error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
