"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Activity,
  Clock,
  AlertOctagon,
  Coins,
  TrendingUp,
  RefreshCw,
  Zap,
  CheckCircle2,
  Radio,
} from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatMs, formatCost } from "@/lib/utils";

/** Format an epoch ms in the BROWSER's local timezone. */
function fmtLocal(ts: number, range: string) {
  const d = new Date(ts);
  if (range === "7d") {
    return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  if (range === "15m") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function relativeTime(ts: number) {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function OverviewDashboard({ onNavigateToTrace }: { onNavigateToTrace?: (id: string) => void }) {
  // Default to 1h: 24h buckets were wide enough to hide brand-new traffic.
  const [timeRange, setTimeRange] = useState("1h");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any>(null);
  const [trafficGenerating, setTrafficGenerating] = useState(false);
  const [trafficMessage, setTrafficMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const fetchOverview = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch(`/api/dashboard/overview?timeRange=${timeRange}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error("Overview fetch error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timeRange]);

  // Fetch on mount + range change, poll while auto-refresh is on,
  // and refetch instantly whenever the tab regains focus (so a question
  // asked in Chat shows up the moment you come back here).
  useEffect(() => {
    fetchOverview();
    const onFocus = () => fetchOverview();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [fetchOverview]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchOverview, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchOverview]);

  // keeps the "x ago" label ticking
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const handleGenerateTraffic = async () => {
    setTrafficGenerating(true);
    setTrafficMessage(null);
    try {
      await fetch("/api/traffic/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 12 }),
      });
      setTrafficMessage("Fired 12 simulated requests with injected latency and errors.");
      await fetchOverview();
    } catch (e: any) {
      setTrafficMessage(`Traffic error: ${e.message}`);
    } finally {
      setTrafficGenerating(false);
      setTimeout(() => setTrafficMessage(null), 4000);
    }
  };

  const kpis = data?.kpis || {
    totalRequests: 0,
    avgLatency: 0,
    p95Latency: 0,
    errorRate: 0,
    totalCost: 0,
    requestsPerMin: 0,
    liveRequests: 0,
  };

  // Labels are computed HERE, in the browser, so they match the user's clock.
  const chartData = useMemo(
    () =>
      (data?.timeSeries || []).map((b: any) => ({
        ...b,
        time: fmtLocal(b.ts, timeRange),
      })),
    [data, timeRange]
  );

  const hasAnyData = chartData.some((b: any) => b.reqCount > 0);
  const bucketLabel =
    data?.bucketSeconds >= 3600
      ? `${Math.round(data.bucketSeconds / 3600)}h`
      : data?.bucketSeconds >= 60
      ? `${Math.round(data.bucketSeconds / 60)}m`
      : `${data?.bucketSeconds ?? 0}s`;

  const tooltipStyle = {
    backgroundColor: "#020617",
    borderColor: "#334155",
    borderRadius: "8px",
    fontSize: "12px",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-white">Observability &amp; Health</h1>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Monitoring Active
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {data?.windowMinutes ? `Last ${timeRange}` : "Loading"} · {bucketLabel} buckets · times shown in your local
            timezone
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs font-medium">
            {["15m", "1h", "24h", "7d"].map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  timeRange === r ? "bg-indigo-600 text-white font-semibold" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            onClick={fetchOverview}
            title="Refresh now"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-600 text-xs font-medium"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-indigo-400" : ""}`} />
            Refresh
          </button>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              autoRefresh
                ? "bg-slate-900 border-indigo-500/50 text-indigo-300"
                : "bg-slate-900/60 border-slate-800 text-slate-500"
            }`}
          >
            <Radio className={`h-3.5 w-3.5 ${autoRefresh ? "text-indigo-400" : ""}`} />
            Auto {autoRefresh ? "5s" : "off"}
          </button>

          <button
            onClick={handleGenerateTraffic}
            disabled={trafficGenerating}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-medium disabled:opacity-50"
          >
            <Zap className={`h-3.5 w-3.5 ${trafficGenerating ? "animate-bounce" : ""}`} />
            {trafficGenerating ? "Injecting…" : "Generate Demo Traffic"}
          </button>
        </div>
      </div>

      {/* Last-request confirmation strip */}
      {data?.lastRequest && (
        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-xs flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-slate-400 shrink-0">Most recent request</span>
            <span className="text-slate-200 font-medium truncate">{data.lastRequest.query}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              {data.lastRequest.engine}
            </span>
            <span className="font-mono text-cyan-400">{formatMs(data.lastRequest.latencyMs)}</span>
            <span className="text-slate-400 font-mono">
              {new Date(data.lastRequest.at).toLocaleTimeString()} ({relativeTime(data.lastRequest.at)})
            </span>
            <button
              onClick={() => onNavigateToTrace?.(data.lastRequest.id)}
              className="text-indigo-400 hover:text-indigo-300 font-medium"
            >
              trace →
            </button>
          </div>
        </div>
      )}

      {trafficMessage && (
        <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-500/40 text-xs text-indigo-300 flex items-center justify-between">
          <span>{trafficMessage}</span>
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label="Total Requests"
          icon={<Activity className="h-4 w-4 text-indigo-400" />}
          value={kpis.totalRequests.toLocaleString()}
          sub={`${kpis.liveRequests} from live chat`}
        />
        <Kpi
          label="Avg Latency"
          icon={<Clock className="h-4 w-4 text-cyan-400" />}
          value={formatMs(kpis.avgLatency)}
          valueClass="text-cyan-400"
          sub="End-to-end pipeline"
        />
        <Kpi
          label="P95 Latency"
          icon={<TrendingUp className="h-4 w-4 text-amber-400" />}
          value={formatMs(kpis.p95Latency)}
          valueClass={kpis.p95Latency > 1500 ? "text-amber-400" : "text-white"}
          sub="Target < 1,800ms"
        />
        <Kpi
          label="Error Rate"
          icon={<AlertOctagon className="h-4 w-4 text-rose-400" />}
          value={`${kpis.errorRate}%`}
          valueClass={kpis.errorRate > 3 ? "text-rose-400" : "text-emerald-400"}
          sub="Timeouts & 429s"
        />
        <Kpi
          label="Estimated Cost"
          icon={<Coins className="h-4 w-4 text-emerald-400" />}
          value={formatCost(kpis.totalCost)}
          valueClass="text-emerald-400"
          sub="From model_prices"
        />
        <Kpi
          label="Throughput"
          icon={<Zap className="h-4 w-4 text-violet-400" />}
          value={`${kpis.requestsPerMin}`}
          valueClass="text-violet-300"
          sub="requests / min"
        />
      </div>

      {!loading && !hasAnyData && (
        <div className="p-6 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 text-center">
          <p className="text-sm text-slate-300 font-medium">No requests in the last {timeRange}</p>
          <p className="text-xs text-slate-500 mt-1">
            Ask a question in <span className="text-indigo-400">Assistant &amp; Docs</span>, hit{" "}
            <span className="text-indigo-400">Generate Demo Traffic</span>, or widen the time range to see seeded
            history.
          </p>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Latency Trend (Avg vs P95)"
          subtitle="Gaps mean no traffic in that bucket — not zero latency"
          legend={
            <>
              <Legend color="bg-cyan-400" label="Avg" />
              <Legend color="bg-amber-400" label="P95" />
            </>
          }
        >
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="p95Grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="avgGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={28} />
            <YAxis stroke="#64748b" fontSize={10} tickLine={false} unit="ms" />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="latencyP95"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#p95Grad)"
              name="P95 (ms)"
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="latencyAvg"
              stroke="#06b6d4"
              strokeWidth={2}
              fill="url(#avgGrad)"
              name="Avg (ms)"
              connectNulls={false}
            />
          </AreaChart>
        </ChartCard>

        <ChartCard
          title="Request Volume & RPM"
          subtitle={`Each bar = ${bucketLabel} bucket · live chat traffic highlighted`}
          legend={
            <>
              <Legend color="bg-indigo-500" label="Simulated" />
              <Legend color="bg-emerald-400" label="Live chat" />
            </>
          }
        >
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={28} />
            <YAxis stroke="#64748b" fontSize={10} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="reqCount" stackId="v" fill="#6366f1" radius={[0, 0, 0, 0]} name="Requests" />
            <Bar dataKey="live" stackId="l" fill="#34d399" radius={[3, 3, 0, 0]} name="Live chat" />
          </BarChart>
        </ChartCard>

        <ChartCard title="Error Rate Over Time (%)" subtitle="Injected error bursts and upstream timeouts">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={28} />
            <YAxis stroke="#64748b" fontSize={10} tickLine={false} unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey="errorRate"
              stroke="#f43f5e"
              strokeWidth={2.5}
              dot={{ r: 2 }}
              name="Error rate %"
              connectNulls={false}
            />
          </LineChart>
        </ChartCard>

        <ChartCard title="Cost Over Time ($)" subtitle="Token spend per bucket across all models">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={28} />
            <YAxis stroke="#64748b" fontSize={10} tickLine={false} unit="$" />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => `$${Number(v).toFixed(5)}`} />
            <Area type="monotone" dataKey="cost" stroke="#10b981" strokeWidth={2} fill="url(#costGrad)" name="Spend" />
          </AreaChart>
        </ChartCard>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TableCard
          title="Slowest Requests"
          icon={<Clock className="h-4 w-4 text-amber-400" />}
          headers={["Query", "Model", "Bottleneck", "Latency"]}
          rows={data?.slowestRequests || []}
          empty="No requests in this window"
          render={(r: any) => (
            <tr
              key={r.id}
              onClick={() => onNavigateToTrace?.(r.id)}
              className="hover:bg-slate-800/50 cursor-pointer group"
            >
              <td className="py-2.5 max-w-[200px] truncate text-slate-200 group-hover:text-indigo-300">{r.query}</td>
              <td className="py-2.5 text-slate-400">{r.model}</td>
              <td className="py-2.5">
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-amber-300">{r.bottleneck}</span>
              </td>
              <td className="py-2.5 text-right font-mono font-semibold text-amber-400">{formatMs(r.latencyMs)}</td>
            </tr>
          )}
        />

        <TableCard
          title="Most Expensive Requests"
          icon={<Coins className="h-4 w-4 text-emerald-400" />}
          headers={["Query", "Model", "Tokens", "Cost"]}
          rows={data?.mostExpensiveRequests || []}
          empty="No requests in this window"
          render={(r: any) => (
            <tr
              key={r.id}
              onClick={() => onNavigateToTrace?.(r.id)}
              className="hover:bg-slate-800/50 cursor-pointer group"
            >
              <td className="py-2.5 max-w-[200px] truncate text-slate-200 group-hover:text-emerald-300">{r.query}</td>
              <td className="py-2.5 text-slate-400">{r.model}</td>
              <td className="py-2.5 text-right font-mono text-slate-300">{r.tokens}</td>
              <td className="py-2.5 text-right font-mono font-semibold text-emerald-400">{formatCost(r.costUsd)}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

/* ---------------- small presentational helpers ---------------- */

function Kpi({
  label,
  icon,
  value,
  sub,
  valueClass = "text-white",
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between text-slate-400 mb-2">
        <span className="text-xs font-medium">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold tracking-tight ${valueClass}`}>{value}</div>
      <div className="text-[11px] text-slate-400 mt-1">{sub}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function ChartCard({
  title,
  subtitle,
  legend,
  children,
}: {
  title: string;
  subtitle: string;
  legend?: React.ReactNode;
  children: React.ReactElement;
}) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        {legend && <div className="flex items-center gap-3 text-xs shrink-0">{legend}</div>}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TableCard({
  title,
  icon,
  headers,
  rows,
  render,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  headers: string[];
  rows: any[];
  render: (r: any) => React.ReactNode;
  empty: string;
}) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <span className="text-xs text-slate-400">Top 5</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                {headers.map((h, i) => (
                  <th key={h} className={`pb-2 font-medium ${i >= 2 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">{rows.map(render)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
