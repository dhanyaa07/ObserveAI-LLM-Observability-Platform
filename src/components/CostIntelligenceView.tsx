"use client";

import React, { useState, useEffect } from "react";
import {
  CircleDollarSign,
  TrendingDown,
  Sparkles,
  Sliders,
  AlertTriangle,
  Zap,
  ArrowRight,
  Lightbulb,
  CheckCircle,
} from "lucide-react";
import { formatCost } from "@/lib/utils";

export function CostIntelligenceView() {
  const [compressionPct, setCompressionPct] = useState(25);
  const [targetModel, setTargetModel] = useState("llama-3-3-70b");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchCostData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/intelligence?compression=${compressionPct}&targetModel=${targetModel}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Cost data error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCostData();
  }, [compressionPct, targetModel]);

  const projections = data?.costProjections || {
    currentMonthlySpend: 0,
    switchedMonthlySpend: 0,
    modelSwitchSavings: 0,
    promptCompressionSavings: 0,
    totalMaxSavings: 0,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-slate-800">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <CircleDollarSign className="h-6 w-6 text-emerald-400" />
          <span>Cost Optimization & AI Intelligence</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Predictive monthly savings models, prompt compression simulator, and auto-generated actionable recommendations.
        </p>
      </div>

      {/* Recommendations Panel (Auto-generated Plain-Language Insights) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Automated Intelligence Recommendations
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data?.recommendations?.map((rec: any) => (
            <div
              key={rec.id}
              className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-slate-800 text-indigo-300">
                    {rec.category}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      rec.severity === "critical"
                        ? "bg-rose-950 text-rose-300 border border-rose-800"
                        : rec.severity === "high"
                        ? "bg-amber-950 text-amber-300 border border-amber-800"
                        : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                    }`}
                  >
                    {rec.severity}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-white mb-1">{rec.headline}</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">{rec.description}</p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-emerald-400 font-medium">
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {rec.impact}
                </span>
                <span className="text-slate-500 text-[11px]">Actionable</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Savings Simulator */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Sliders className="h-4 w-4 text-indigo-400" />
            <span>Interactive Token & Model Savings Simulator</span>
          </h2>
          <p className="text-xs text-slate-400">
            Model switching and context pruning sliders calculate projected monthly enterprise reductions.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Controls */}
          <div className="space-y-4 md:col-span-1 bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Target Cheaper Model
              </label>
              <select
                value={targetModel}
                onChange={(e) => setTargetModel(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
              >
                <option value="llama-3-3-70b">Llama 3.3 70B Instruct ($0.59 / $0.79 per 1M)</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet ($3.00 / $15.00 per 1M)</option>
                <option value="gpt-4o">GPT-4o ($2.50 / $10.00 per 1M)</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="font-semibold text-slate-300">Prompt / Context Compression</span>
                <span className="font-mono text-cyan-400 font-bold">{compressionPct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="60"
                step="5"
                value={compressionPct}
                onChange={(e) => setCompressionPct(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <span className="text-[10px] text-slate-500 block mt-1">
                Removes boilerplate headers and stop words via semantic deduplication
              </span>
            </div>
          </div>

          {/* Savings Cards */}
          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div>
                <span className="text-xs text-slate-400 block mb-1">Current Projected Spend</span>
                <div className="text-2xl font-bold font-mono text-white">
                  {formatCost(projections.currentMonthlySpend)}
                  <span className="text-xs text-slate-500 font-normal"> / mo</span>
                </div>
              </div>
              <span className="text-[11px] text-slate-500 mt-3">Baseline token run-rate</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div>
                <span className="text-xs text-slate-400 block mb-1">Model Switch Savings</span>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {formatCost(projections.modelSwitchSavings)}
                  <span className="text-xs text-slate-500 font-normal"> / mo</span>
                </div>
              </div>
              <span className="text-[11px] text-emerald-500/80 mt-3">Via {targetModel}</span>
            </div>

            <div className="bg-indigo-950/40 p-4 rounded-xl border border-indigo-500/40 flex flex-col justify-between">
              <div>
                <span className="text-xs text-indigo-300 block mb-1">Total Max Savings</span>
                <div className="text-2xl font-bold font-mono text-indigo-300">
                  {formatCost(projections.totalMaxSavings)}
                  <span className="text-xs text-indigo-400 font-normal"> / mo</span>
                </div>
              </div>
              <span className="text-[11px] text-indigo-300/80 mt-3">Model Switch + Pruning</span>
            </div>
          </div>
        </div>
      </div>

      {/* Failure Pattern Analysis & Expensive Queries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Failure Pattern Analysis */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <span>Recurring Failure Patterns</span>
            </h3>
            <span className="text-xs text-slate-400">Grouped by Type & Stage</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2 font-medium">Error Type</th>
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 font-medium">Stage</th>
                  <th className="pb-2 font-medium text-right">Occurrences</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {data?.failurePatterns?.map((fp: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-800/40">
                    <td className="py-2.5 font-mono text-rose-300">{fp.errorType}</td>
                    <td className="py-2.5 text-slate-400">{fp.model}</td>
                    <td className="py-2.5 text-slate-300">{fp.stage}</td>
                    <td className="py-2.5 text-right font-mono font-bold text-rose-400">
                      {fp.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Expensive Prompts */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <CircleDollarSign className="h-4 w-4 text-emerald-400" />
              <span>Ranked Expensive Prompts</span>
            </h3>
            <span className="text-xs text-slate-400">Token Cost</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2 font-medium">Query</th>
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 font-medium text-right">Tokens</th>
                  <th className="pb-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {data?.rankedExpensiveQueries?.map((rq: any) => (
                  <tr key={rq.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 max-w-[200px] truncate text-slate-200">{rq.query}</td>
                    <td className="py-2.5 text-slate-400">{rq.model}</td>
                    <td className="py-2.5 text-right font-mono text-slate-300">
                      {rq.inputTokens + rq.outputTokens}
                    </td>
                    <td className="py-2.5 text-right font-mono font-bold text-emerald-400">
                      {formatCost(rq.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
