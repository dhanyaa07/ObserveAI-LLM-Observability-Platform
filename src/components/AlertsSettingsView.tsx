"use client";

import React, { useState, useEffect } from "react";
import {
  SlidersHorizontal,
  Bell,
  Mail,
  Shield,
  Save,
  CheckCircle,
  AlertOctagon,
  RefreshCw,
  Send,
  Edit2,
} from "lucide-react";
import { formatMs, formatCost } from "@/lib/utils";

export function AlertsSettingsView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  // Resend API Key input
  const [resendApiKey, setResendApiKey] = useState("");
  const [showKeySaved, setShowKeySaved] = useState(false);

  // Price table edit state
  const [editingPrices, setEditingPrices] = useState<Record<string, { in: number; out: number }>>({});

  // LLM provider credential state
  const [providers, setProviders] = useState<any>(null);
  const [providerKeyDrafts, setProviderKeyDrafts] = useState<Record<string, string>>({});
  const [providerMessage, setProviderMessage] = useState<string | null>(null);

  const fetchProviders = async () => {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) setProviders(await res.json());
    } catch {}
  };

  const handleSaveProviderKey = async (provider: string) => {
    try {
      const res = await fetch("/api/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: providerKeyDrafts[provider] || "" }),
      });
      const json = await res.json();
      setProviderMessage(json.message || json.error);
      setProviderKeyDrafts({ ...providerKeyDrafts, [provider]: "" });
      await fetchProviders();
      setTimeout(() => setProviderMessage(null), 5000);
    } catch (e: any) {
      setProviderMessage(e.message);
    }
  };

  const fetchAlertsData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/alerts");
      if (res.ok) {
        const json = await res.json();
        setData(json);

        // Preload pricing
        const priceMap: Record<string, { in: number; out: number }> = {};
        for (const p of json.modelPrices || []) {
          priceMap[p.model] = { in: p.inputPricePer1m, out: p.outputPricePer1m };
        }
        setEditingPrices(priceMap);
      }
    } catch (e) {
      console.error("Alerts data error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlertsData();
    fetchProviders();
  }, []);

  const handleUpdateRule = async (rule: any, newThreshold: number, newCooldown: number, enabled: boolean) => {
    try {
      setSaving(true);
      const res = await fetch("/api/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_rule",
          id: rule.id,
          threshold: newThreshold,
          cooldownMinutes: newCooldown,
          enabled,
        }),
      });
      if (res.ok) {
        await fetchAlertsData();
      }
    } catch (e) {
      console.error("Rule update error:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePrice = async (model: string) => {
    try {
      const price = editingPrices[model];
      if (!price) return;
      await fetch("/api/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_price",
          model,
          inputPricePer1m: price.in,
          outputPricePer1m: price.out,
        }),
      });
      await fetchAlertsData();
    } catch (e) {
      console.error("Price save error:", e);
    }
  };

  const handleAlertStatus = async (alertId: string, newStatus: string) => {
    try {
      await fetch("/api/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_alert_status",
          id: alertId,
          status: newStatus,
        }),
      });
      await fetchAlertsData();
    } catch (e) {
      console.error("Alert status error:", e);
    }
  };

  const handleSendTestEmail = async () => {
    setTestEmailLoading(true);
    setEmailStatus(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sendTestEmail: true,
          targetEmail: "security-ops@observeai.internal",
        }),
      });
      const resData = await res.json();
      setEmailStatus(resData.message);
    } catch (e: any) {
      setEmailStatus(`Failed to send: ${e.message}`);
    } finally {
      setTestEmailLoading(false);
    }
  };

  const handleSaveResendKey = async () => {
    if (!resendApiKey) return;
    try {
      await fetch("/api/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_resend_key",
          apiKey: resendApiKey,
        }),
      });
      setShowKeySaved(true);
      setTimeout(() => setShowKeySaved(false), 3000);
      await fetchAlertsData();
    } catch (e) {
      console.error("Resend save error:", e);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-slate-800">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <SlidersHorizontal className="h-6 w-6 text-indigo-400" />
          <span>Alert Rules, Thresholds & Model Pricing</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Configurable EWMA rolling windows, anomaly detection thresholds, Resend email dispatch & model unit economics.
        </p>
      </div>

      {/* Active & Recent Incidents Feed */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Active & Recent Incident Alerts
            </h2>
          </div>
          <span className="text-xs text-slate-400">Deduped with Cooldown Protection</span>
        </div>

        <div className="space-y-3">
          {data?.alerts?.map((alt: any) => {
            const isResolved = alt.status === "resolved";
            const isCritical = alt.severity === "critical";

            return (
              <div
                key={alt.id}
                className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
                  isResolved
                    ? "bg-slate-950/60 border-slate-800 text-slate-400"
                    : isCritical
                    ? "bg-rose-950/30 border-rose-800/60 text-slate-200"
                    : "bg-amber-950/30 border-amber-800/60 text-slate-200"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        isCritical
                          ? "bg-rose-950 text-rose-300 border border-rose-800"
                          : "bg-amber-950 text-amber-300 border border-amber-800"
                      }`}
                    >
                      {alt.severity}
                    </span>
                    <span className="text-xs font-bold text-white">{alt.title}</span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {new Date(alt.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{alt.message}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      isResolved ? "bg-slate-800 text-slate-400" : "bg-emerald-950 text-emerald-400"
                    }`}
                  >
                    {alt.status}
                  </span>

                  {!isResolved ? (
                    <button
                      onClick={() => handleAlertStatus(alt.id, "resolved")}
                      className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                    >
                      Resolve
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAlertStatus(alt.id, "active")}
                      className="px-3 py-1 rounded bg-slate-900 text-slate-500 hover:text-slate-300 text-xs font-medium"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Editable Alert Rules & Thresholds */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Metric Alert Threshold Rules
          </h2>
          <span className="text-xs text-slate-500">Auto-saved to database</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-2 font-medium">Alert Rule</th>
                <th className="pb-2 font-medium">Window</th>
                <th className="pb-2 font-medium">Cooldown</th>
                <th className="pb-2 font-medium">Threshold</th>
                <th className="pb-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data?.rules?.map((rule: any) => (
                <tr key={rule.id} className="hover:bg-slate-800/40">
                  <td className="py-3">
                    <span className="font-semibold text-white block">{rule.displayName}</span>
                    <span className="text-[11px] text-slate-500 font-mono">{rule.metric}</span>
                  </td>
                  <td className="py-3 text-slate-400">{rule.windowMinutes}m rolling</td>
                  <td className="py-3 text-slate-400">{rule.cooldownMinutes}m cooldown</td>
                  <td className="py-3">
                    <div className="flex items-center gap-1.5 font-mono">
                      <span>{rule.comparison === "gt" ? ">" : "<"}</span>
                      <input
                        type="number"
                        defaultValue={rule.threshold}
                        onBlur={(e) =>
                          handleUpdateRule(rule, Number(e.target.value), rule.cooldownMinutes, rule.enabled)
                        }
                        className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono"
                      />
                      <span className="text-slate-500">{rule.unit}</span>
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() =>
                        handleUpdateRule(rule, rule.threshold, rule.cooldownMinutes, !rule.enabled)
                      }
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                        rule.enabled
                          ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      {rule.enabled ? "Active" : "Disabled"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* LLM Provider Keys */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-400" />
              LLM Provider Credentials
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Keys are stored server-side and never sent to the browser. With no key the assistant uses the local
              extractive engine over real retrieved text.
            </p>
          </div>
          <span
            className={`text-[10px] font-semibold px-2 py-1 rounded ${
              providers?.liveMode
                ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                : "bg-amber-950 text-amber-300 border border-amber-800"
            }`}
          >
            {providers?.liveMode ? "Live generation enabled" : "Extractive fallback mode"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {providers?.providers?.map((p: any) => (
            <div key={p.provider} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-white capitalize">{p.provider}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    p.configured ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {p.configured ? `configured · ${p.via}` : "not configured"}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono mb-2">
                env: {p.envVar} · models: {p.models.join(", ") || "any (router)"}
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={p.configured ? "replace key…" : "paste API key"}
                  value={providerKeyDrafts[p.provider] || ""}
                  onChange={(e) => setProviderKeyDrafts({ ...providerKeyDrafts, [p.provider]: e.target.value })}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => handleSaveProviderKey(p.provider)}
                  className="px-2.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium"
                >
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>

        {providerMessage && (
          <div className="text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded px-3 py-2">
            {providerMessage}
          </div>
        )}
      </div>

      {/* Model Prices Table (Editable) & Resend Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Editable Model Prices Table */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Model Pricing Table (Per 1M Tokens)</h3>
            <span className="text-xs text-slate-400">Editable</span>
          </div>

          <div className="space-y-3">
            {data?.modelPrices?.map((mp: any) => {
              const current = editingPrices[mp.model] || {
                in: mp.inputPricePer1m,
                out: mp.outputPricePer1m,
              };

              return (
                <div key={mp.model} className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-semibold text-white text-xs block">{mp.displayName}</span>
                    <span className="text-[11px] text-slate-500 font-mono">{mp.model}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Input / 1M</span>
                      <input
                        type="number"
                        step="0.01"
                        value={current.in}
                        onChange={(e) =>
                          setEditingPrices({
                            ...editingPrices,
                            [mp.model]: { ...current, in: Number(e.target.value) },
                          })
                        }
                        className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Output / 1M</span>
                      <input
                        type="number"
                        step="0.01"
                        value={current.out}
                        onChange={(e) =>
                          setEditingPrices({
                            ...editingPrices,
                            [mp.model]: { ...current, out: Number(e.target.value) },
                          })
                        }
                        className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                    <button
                      onClick={() => handleSavePrice(mp.model)}
                      className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs mt-3.5 transition-colors"
                      title="Save model rate"
                    >
                      <Save className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resend Email Dispatch Configuration */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Mail className="h-4 w-4 text-cyan-400" />
              <span>Resend Email Dispatch Alerts</span>
            </h3>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                data?.hasResendKey
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : "bg-amber-950 text-amber-300 border border-amber-800"
              }`}
            >
              {data?.hasResendKey ? "Configured" : "Dashboard Only (No Key)"}
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            When configured, critical SEV-1 anomalies trigger direct email notifications. If unconfigured, alerts are safely logged and viewable in this console.
          </p>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Resend API Key (Optional Secret)
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={resendApiKey}
                  onChange={(e) => setResendApiKey(e.target.value)}
                  placeholder="re_xxxxxxxxxxxxxx"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleSaveResendKey}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                >
                  Save Key
                </button>
              </div>
              {showKeySaved && (
                <span className="text-[11px] text-emerald-400 block mt-1">
                  Resend API key updated successfully!
                </span>
              )}
            </div>

            <div className="pt-2">
              <button
                onClick={handleSendTestEmail}
                disabled={testEmailLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-300 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{testEmailLoading ? "Dispatched..." : "Send Test Incident Email"}</span>
              </button>

              {emailStatus && (
                <div className="mt-2 p-2.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-300">
                  {emailStatus}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
