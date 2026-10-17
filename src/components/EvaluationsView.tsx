"use client";

import React, { useState, useEffect } from "react";
import {
  Award,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

export function EvaluationsView({ onNavigateToTrace }: { onNavigateToTrace?: (traceId: string) => void }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [runResults, setRunResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningEval, setRunningEval] = useState(false);

  // Model & Prompt Picker for comparison or trigger
  const [evalModel, setEvalModel] = useState("gpt-4o");
  const [evalPromptVersion, setEvalPromptVersion] = useState("v1.2-prod");

  // Comparison State (Config A vs Config B)
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");

  const fetchEvalHistory = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/evaluations");
      if (res.ok) {
        const json = await res.json();
        setRuns(json.runs || []);
        if (json.runs?.length > 0 && !selectedRun) {
          loadRunDetails(json.runs[0].id);
          if (json.runs.length > 1) {
            setCompareA(json.runs[0].id);
            setCompareB(json.runs[1].id);
          }
        }
      }
    } catch (e) {
      console.error("Eval fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadRunDetails = async (runId: string) => {
    try {
      const res = await fetch(`/api/evaluations?runId=${runId}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedRun(json.run);
        setRunResults(json.results || []);
      }
    } catch (e) {
      console.error("Run detail fetch error:", e);
    }
  };

  useEffect(() => {
    fetchEvalHistory();
  }, []);

  const handleRunEvaluation = async () => {
    setRunningEval(true);
    try {
      const res = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: evalModel,
          promptVersion: evalPromptVersion,
          sampleLimit: 12,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        await fetchEvalHistory();
        loadRunDetails(json.runId);
      }
    } catch (e) {
      console.error("Evaluation execution error:", e);
    } finally {
      setRunningEval(false);
    }
  };

  // Prepare chart data across past evaluation runs
  const historyChartData = [...runs].reverse().map((r, i) => ({
    name: `Run #${i + 1} (${r.model.slice(0, 5)})`,
    groundedness: Number(((r.scores?.groundedness || 0) * 100).toFixed(1)),
    relevance: Number(((r.scores?.answerRelevance || 0) * 100).toFixed(1)),
    recall: Number(((r.scores?.retrievalRecall || 0) * 100).toFixed(1)),
    hallucination: Number((r.scores?.hallucinationRate || 0).toFixed(1)),
  }));

  const runAObj = runs.find((r) => r.id === compareA);
  const runBObj = runs.find((r) => r.id === compareB);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Award className="h-6 w-6 text-indigo-400" />
            <span>LLM-as-a-Judge Quality Evaluations</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Golden dataset benchmark (30 questions): Retrieval Recall@k, Groundedness/Faithfulness, Context Precision & Hallucination detection.
          </p>
        </div>

        {/* Trigger Evaluation Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={evalModel}
            onChange={(e) => setEvalModel(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="gpt-4o">GPT-4o (Omni)</option>
            <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
            <option value="llama-3-3-70b">Llama 3.3 70B Instruct</option>
          </select>

          <select
            value={evalPromptVersion}
            onChange={(e) => setEvalPromptVersion(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="v1.2-prod">v1.2-prod (Baseline)</option>
            <option value="v2.0-experimental">v2.0-experimental (Candidate)</option>
            <option value="v1.1-legacy">v1.1-legacy</option>
          </select>

          <button
            onClick={handleRunEvaluation}
            disabled={runningEval}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 disabled:opacity-50 transition-all"
          >
            <Play className={`h-3.5 w-3.5 ${runningEval ? "animate-spin" : ""}`} />
            <span>{runningEval ? "Scoring Dataset..." : "Replay Eval Dataset"}</span>
          </button>
        </div>
      </div>

      {/* Regression Check Alert Banner */}
      <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 text-indigo-400" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-white">Automated Regression Check (Drop Threshold: &gt; 5%)</h4>
            <p className="text-[11px] text-slate-400">
              Evaluates latest run against golden baseline. Flags any regression in groundedness or spike in hallucination.
            </p>
          </div>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-medium">
          Regression Baseline: Stable
        </span>
      </div>

      {/* Metrics History Trend Chart */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Evaluation Metric Scores Across Runs</h3>
            <p className="text-xs text-slate-400">Groundedness, Answer Relevance, Retrieval Hit Rate (%)</p>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} tickLine={false} domain={[50, 100]} unit="%" />
              <Tooltip
                contentStyle={{ backgroundColor: "#020617", borderColor: "#334155", borderRadius: "8px", fontSize: "12px" }}
              />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Line type="monotone" dataKey="groundedness" stroke="#10b981" strokeWidth={2.5} name="Groundedness %" />
              <Line type="monotone" dataKey="relevance" stroke="#6366f1" strokeWidth={2.5} name="Answer Relevance %" />
              <Line type="monotone" dataKey="recall" stroke="#06b6d4" strokeWidth={2} name="Recall@k %" />
              <Line type="monotone" dataKey="hallucination" stroke="#f43f5e" strokeWidth={2} name="Hallucination %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Side-by-Side Model/Prompt Config Comparison */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Side-by-Side Model & Prompt Comparison</h3>
            <p className="text-xs text-slate-400">Pick two runs to inspect quality, latency, and cost trade-offs</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Config A */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-400">Config A (Baseline)</span>
              <select
                value={compareA}
                onChange={(e) => setCompareA(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded px-2 py-1"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.model} ({r.promptVersion})
                  </option>
                ))}
              </select>
            </div>
            {runAObj && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-900 p-2 rounded">
                  <span className="text-slate-500 block">Groundedness</span>
                  <span className="font-bold text-emerald-400 font-mono">
                    {((runAObj.scores?.groundedness || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="bg-slate-900 p-2 rounded">
                  <span className="text-slate-500 block">Relevance</span>
                  <span className="font-bold text-indigo-400 font-mono">
                    {((runAObj.scores?.answerRelevance || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="bg-slate-900 p-2 rounded">
                  <span className="text-slate-500 block">Hallucination Rate</span>
                  <span className="font-bold text-rose-400 font-mono">
                    {(runAObj.scores?.hallucinationRate || 0)}%
                  </span>
                </div>
                <div className="bg-slate-900 p-2 rounded">
                  <span className="text-slate-500 block">Avg Latency</span>
                  <span className="font-bold text-cyan-400 font-mono">
                    {runAObj.scores?.avgLatencyMs}ms
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Config B */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-violet-400">Config B (Candidate)</span>
              <select
                value={compareB}
                onChange={(e) => setCompareB(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded px-2 py-1"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.model} ({r.promptVersion})
                  </option>
                ))}
              </select>
            </div>
            {runBObj && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-900 p-2 rounded">
                  <span className="text-slate-500 block">Groundedness</span>
                  <span className="font-bold text-emerald-400 font-mono">
                    {((runBObj.scores?.groundedness || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="bg-slate-900 p-2 rounded">
                  <span className="text-slate-500 block">Relevance</span>
                  <span className="font-bold text-indigo-400 font-mono">
                    {((runBObj.scores?.answerRelevance || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="bg-slate-900 p-2 rounded">
                  <span className="text-slate-500 block">Hallucination Rate</span>
                  <span className="font-bold text-rose-400 font-mono">
                    {(runBObj.scores?.hallucinationRate || 0)}%
                  </span>
                </div>
                <div className="bg-slate-900 p-2 rounded">
                  <span className="text-slate-500 block">Avg Latency</span>
                  <span className="font-bold text-cyan-400 font-mono">
                    {runBObj.scores?.avgLatencyMs}ms
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Question-Level Results Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Per-Question Evaluation Audit ({selectedRun?.model} · {selectedRun?.promptVersion})
            </h3>
            <p className="text-xs text-slate-400">
              Low-scoring results flagged for debugging with link to execution traces.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-2 font-medium">Question</th>
                <th className="pb-2 font-medium">Hit Rate</th>
                <th className="pb-2 font-medium">Groundedness</th>
                <th className="pb-2 font-medium">Hallucination</th>
                <th className="pb-2 font-medium">Reasoning / Audit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {runResults.map((res) => {
                const isLow = res.scores?.groundedness < 0.8;
                return (
                  <tr key={res.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 max-w-xs pr-4 text-slate-200 font-medium">
                      {res.question}
                    </td>
                    <td className="py-2.5 font-mono text-cyan-400">
                      {(res.scores?.hitRate * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 font-mono font-semibold">
                      <span className={isLow ? "text-rose-400" : "text-emerald-400"}>
                        {(res.scores?.groundedness * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-2.5">
                      {res.scores?.hallucination ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 border border-rose-800">
                          Detected
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400">
                          Grounded
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-slate-400 text-[11px] max-w-sm">
                      {res.scores?.reasoning}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
