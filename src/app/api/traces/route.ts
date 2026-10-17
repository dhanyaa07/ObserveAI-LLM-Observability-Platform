import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requests, spans } from "@/db/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // Detail view for a single request with full OpenTelemetry waterfall spans
    if (id) {
      const reqList = await db.select().from(requests).where(eq(requests.id, id));
      if (!reqList || reqList.length === 0) {
        return NextResponse.json({ error: "Trace not found" }, { status: 404 });
      }

      const requestData = reqList[0];
      const requestSpans = await db
        .select()
        .from(spans)
        .where(eq(spans.requestId, id))
        .orderBy(spans.startMs);

      return NextResponse.json({
        request: requestData,
        spans: requestSpans,
      });
    }

    // Filterable list view
    const status = searchParams.get("status"); // success, error, timeout
    const model = searchParams.get("model");
    const minLatency = searchParams.get("minLatency");
    const maxLatency = searchParams.get("maxLatency");
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "50", 10));

    let query = db.select().from(requests);

    // Fetch and filter
    const allRequests = await query.orderBy(desc(requests.createdAt)).limit(200);

    let filtered = allRequests;
    if (status && status !== "all") {
      filtered = filtered.filter((r) => r.status === status);
    }
    if (model && model !== "all") {
      filtered = filtered.filter((r) => r.model === model);
    }
    if (minLatency) {
      filtered = filtered.filter((r) => r.latencyMs >= parseInt(minLatency, 10));
    }
    if (maxLatency) {
      filtered = filtered.filter((r) => r.latencyMs <= parseInt(maxLatency, 10));
    }

    const paged = filtered.slice(0, limit);

    // Root-cause analytics: % of slow requests by bottleneck stage
    const slowRequests = allRequests.filter((r) => r.latencyMs > 1000);
    const bottleneckStats: Record<string, number> = {
      vector_search: 0,
      llm_generation: 0,
      retrieval: 0,
      query_processing: 0,
      response: 0,
    };
    for (const r of slowRequests) {
      if (bottleneckStats[r.bottleneckStage] !== undefined) {
        bottleneckStats[r.bottleneckStage] += 1;
      }
    }

    const totalSlow = slowRequests.length || 1;
    const bottleneckPercentages = Object.entries(bottleneckStats).map(([stage, count]) => ({
      stage,
      count,
      percentage: Number(((count / totalSlow) * 100).toFixed(1)),
    }));

    // Calculate stage average durations across recent requests
    const recentSpans = await db.select().from(spans).limit(500);
    const stageAverages: Record<string, { total: number; count: number }> = {};
    for (const sp of recentSpans) {
      if (!stageAverages[sp.stage]) {
        stageAverages[sp.stage] = { total: 0, count: 0 };
      }
      stageAverages[sp.stage].total += sp.durationMs;
      stageAverages[sp.stage].count += 1;
    }

    const stageAvgList = Object.entries(stageAverages).map(([stage, data]) => ({
      stage,
      avgMs: Math.round(data.total / (data.count || 1)),
      sampleCount: data.count,
    }));

    return NextResponse.json({
      traces: paged,
      totalCount: filtered.length,
      bottleneckPercentages,
      stageAverages: stageAvgList,
      slowThresholdMs: 1000,
    });
  } catch (err: any) {
    console.error("Traces API error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
