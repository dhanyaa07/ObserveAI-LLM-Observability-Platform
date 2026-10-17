"use client";

import React from "react";
import {
  LayoutDashboard,
  MessageSquareCode,
  GitFork,
  Award,
  CircleDollarSign,
  SlidersHorizontal,
  Activity,
  ShieldCheck,
  Zap,
} from "lucide-react";

export type NavTab = "overview" | "chat" | "traces" | "evaluations" | "cost" | "alerts";

interface SidebarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeAlertCount?: number;
}

export function Sidebar({ currentTab, onTabChange, activeAlertCount = 0 }: SidebarProps) {
  const navItems = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "chat", label: "Assistant & Docs", icon: MessageSquareCode, badge: "Live" },
    { id: "traces", label: "Traces & Spans", icon: GitFork },
    { id: "evaluations", label: "Evaluations (LLM-Judge)", icon: Award },
    { id: "cost", label: "Cost & Intelligence", icon: CircleDollarSign },
    { id: "alerts", label: "Alerts & Settings", icon: SlidersHorizontal, badgeCount: activeAlertCount },
  ];

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col justify-between h-screen sticky top-0 select-none z-20">
      <div>
        {/* Brand Header */}
        <div className="h-16 flex items-center px-6 border-b border-slate-800/80 gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-cyan-500 via-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-base tracking-tight text-white">ObserveAI</span>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                Enterprise
              </span>
            </div>
            <p className="text-[11px] text-slate-400">RAG Reliability & Telemetry</p>
          </div>
        </div>

        {/* Live Status indicator */}
        <div className="mx-4 my-4 p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/25 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-medium text-emerald-300">Telemetry Active</span>
          </div>
          <span className="text-[10px] text-slate-400">OpenTelemetry</span>
        </div>

        {/* Navigation Items */}
        <nav className="px-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id as NavTab)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-900/60"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    {item.badge}
                  </span>
                )}
                {item.badgeCount && item.badgeCount > 0 ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    {item.badgeCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer System Meta */}
      <div className="p-4 border-t border-slate-800/80 text-xs text-slate-400 bg-slate-950/40">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
            <span>DLP / Redaction</span>
          </span>
          <span className="text-[10px] text-emerald-400 font-medium">PII Scrubbed</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>PostgreSQL + Drizzle</span>
          <span>OpenTelemetry 1.28</span>
        </div>
      </div>
    </aside>
  );
}
