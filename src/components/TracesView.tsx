"use client";

import React, { useState, useEffect } from "react";
import {
  GitFork,
  Search,
  Filter,
  Layers,
  Clock,
  Coins,
  AlertCircle,
  CheckCircle,
  HelpCircle,
  Shield,
  ArrowRight,
  PieChart as PieIcon,
} from "lucide-react";
import { formatMs, formatCost } from "@/lib/utils";

export function TracesView({ initialTraceId }: { initialTraceId?: string }) {
  const [traces, setTraces] = useState<any[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<any>(null);
  const [traceSpans, setTraceSpans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [minLatency, setMinLatency] = useState("");
  const [bottleneckPercentages, setBottleneckPercentages] = useState<any[]>([]);
  const [stageAverages, setStageAverages] = useState<any[]>([]);

  const fetchTraces = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        status: statusFilter,
        model: modelFilter,
        limit: "60",
      });
      if (minLatency) queryParams.set("minLatency", minLatency);

      const res = await fetch(`/api/traces?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setTraces(json.traces || []);
        setBottleneckPercentages(json.bottleneckPercentages || []);
        setStageAverages(json.stageAverages || []);

        // If initial trace requested or none selected, pick the first
        if (initialTraceId) {
          loadTraceDetail(initialTraceId);
        } else if (json.traces?.length > 0 && !selectedTrace) {
          loadTraceDetail(json.traces[0].id);
        }
      }
    } catch (e) {
      console.error("Error fetching traces:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadTraceDetail = async (id: string) => {
    try {
      setLoadingDetail(true);
      const res = await fetch(`/api/traces?id=${id}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedTrace(json.request);
        setTraceSpans(json.spans || []);
      }
    } catch (e) {
      console.error("Error loading trace detail:", e);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    fetchTraces();
  }, [statusFilter, modelFilter, minLatency]);

  const getStageColor = (stage: string) => {
    switch (stage) {
      case "query_processing":
        return "bg-cyan-500 text-cyan-200 border-cyan-400";
      case "vector_search":
        return "bg-amber-500 text-amber-200 border-amber-400";
      case "retrieval":
        return "bg-blue-500 text-blue-200 border-blue-400";
      case "llm_generation":
        return "bg-violet-500 text-violet-200 border-violet-400";
      case "response":
        return "bg-emerald-500 text-emerald-200 border-emerald-400";
      default:
        return "bg-indigo-500 text-indigo-200 border-indigo-400";
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <GitFork className="h-6 w-6 text-indigo-400" />
            <span>OpenTelemetry Traces & Spans</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            End-to-end waterfall span execution, root-cause bottleneck isolation & chunk citation debugging.
          </p>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="timeout">Timeout</option>
          </select>

          {/* Model Filter */}
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Models</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
            <option value="llama-3-3-70b">Llama 3.3 70B</option>
          </select>

          {/* Min Latency */}
          <select
            value={minLatency}
            onChange={(e) => setMinLatency(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Any Latency</option>
            <option value="500">&gt; 500ms</option>
            <option value="1000">&gt; 1,000ms (Slow)</option>
            <option value="2000">&gt; 2,000ms (Degraded)</option>
          </select>
        </div>
      </div>

      {/* Root-Cause Bottleneck Analysis Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <PieIcon className="h-4 w-4 text-indigo-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Root-Cause Bottleneck Distribution (% of Requests &gt; 1,000ms)
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">Automated Stage Attribution</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {bottleneckPercentages.map((bp) => (
            <div key={bp.stage} className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium capitalize text-slate-400">
                  {bp.stage.replace("_", " ")}
                </span>
                <span className="text-[10px] text-slate-500">{bp.count} reqs</span>
              </div>
              <div className="text-lg font-bold text-white">{bp.percentage}%</div>
              {/* Progress bar */}
              <div className="w-full h-1.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                <div
                  className={`h-full ${
                    bp.stage === "vector_search"
                      ? "bg-amber-400"
                      : bp.stage === "llm_generation"
                      ? "bg-violet-400"
                      : "bg-indigo-400"
                  }`}
                  style={{ width: `${Math.min(100, bp.percentage)}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Split: Trace List (Left) & Waterfall Trace Detail (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[580px]">
        {/* Left: Request List (4 cols) */}
        <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">Recent Ingested Traces</span>
            <span className="text-[11px] text-slate-400">{traces.length} available</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {traces.map((t) => {
              const isSelected = selectedTrace?.id === t.id;
              const isSlow = t.latencyMs > 1000;
              return (
                <div
                  key={t.id}
                  onClick={() => loadTraceDetail(t.id)}
                  className={`p-3.5 cursor-pointer transition-colors ${
                    isSelected ? "bg-indigo-950/40 border-l-4 border-indigo-500" : "hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[10px] text-slate-400">{t.id}</span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        t.status === "success"
                          ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800"
                          : "bg-rose-950/60 text-rose-400 border border-rose-800"
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-slate-200 line-clamp-1 mb-2">
                    {t.queryRedacted}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="text-slate-400">{t.model}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {t.bottleneckStage}
                      </span>
                      <span className={`font-mono font-medium ${isSlow ? "text-amber-400" : "text-cyan-400"}`}>
                        {formatMs(t.latencyMs)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Detailed Trace Waterfall & Inspection (7 cols) */}
        <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between overflow-y-auto">
          {selectedTrace ? (
            <div className="space-y-6">
              {/* Trace Summary Bar */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white">Trace: {selectedTrace.id}</h2>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {selectedTrace.promptVersion}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Recorded {new Date(selectedTrace.createdAt).toLocaleTimeString()} · Bottleneck:{" "}
                    <span className="text-amber-300 font-semibold">{selectedTrace.bottleneckStage}</span>
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Total Latency</div>
                    <div className="text-base font-bold font-mono text-cyan-400">
                      {formatMs(selectedTrace.latencyMs)}
                    </div>
                  </div>
                  <div className="text-right pl-3 border-l border-slate-800">
                    <div className="text-xs text-slate-400">Cost</div>
                    <div className="text-base font-bold font-mono text-emerald-400">
                      {formatCost(selectedTrace.estimatedCostUsd)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Waterfall Gantt Chart */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  <span>OpenTelemetry Span Waterfall</span>
                </h3>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-3">
                  {traceSpans.map((sp) => {
                    const totalDur = Math.max(1, selectedTrace.latencyMs);
                    const leftPct = (sp.startMs / totalDur) * 100;
                    const widthPct = Math.max(3, (sp.durationMs / totalDur) * 100);

                    return (
                      <div key={sp.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-slate-300 capitalize flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                sp.stage === "vector_search"
                                  ? "bg-amber-400"
                                  : sp.stage === "llm_generation"
                                  ? "bg-violet-400"
                                  : "bg-cyan-400"
                              }`}
                            ></span>
                            {sp.stage.replace("_", " ")}
                          </span>
                          <span className="font-mono text-slate-400">{formatMs(sp.durationMs)}</span>
                        </div>

                        {/* Gantt Bar Track */}
                        <div className="w-full h-4 bg-slate-900 rounded-md relative overflow-hidden">
                          <div
                            className={`absolute top-0 bottom-0 rounded-md opacity-90 transition-all ${
                              sp.stage === "vector_search"
                                ? "bg-amber-500"
                                : sp.stage === "llm_generation"
                                ? "bg-violet-500"
                                : sp.stage === "query_processing"
                                ? "bg-cyan-500"
                                : sp.stage === "retrieval"
                                ? "bg-blue-500"
                                : "bg-emerald-500"
                            }`}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                            }}
                          ></div>
                        </div>

                        {/* Attributes preview */}
                        {sp.attributes && Object.keys(sp.attributes).length > 0 && (
                          <div className="text-[10px] text-slate-500 font-mono truncate">
                            Attrs: {JSON.stringify(sp.attributes)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Redacted Prompt & Answer Comparison */}
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Redacted Query Prompt
                  </span>
                  <p className="text-xs text-slate-200">{selectedTrace.queryRedacted}</p>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Synthesized Model Response
                  </span>
                  <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">
                    {selectedTrace.answer || (
                      <span className="text-rose-400">
                        Request failed with error: {selectedTrace.errorMessage || "Upstream pipeline error"}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Token & Pricing Metrics */}
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span>Input: {selectedTrace.inputTokens} tokens</span>
                <span>Output: {selectedTrace.outputTokens} tokens</span>
                <span>Total Tokens: {selectedTrace.inputTokens + selectedTrace.outputTokens}</span>
                <span className="font-mono text-emerald-400">
                  Cost: {formatCost(selectedTrace.estimatedCostUsd)}
                </span>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              Select a trace from the left panel to inspect waterfall spans and attributes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
