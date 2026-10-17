"use client";

import React, { useState, useEffect } from "react";
import { Sidebar, NavTab } from "@/components/Sidebar";
import { OverviewDashboard } from "@/components/OverviewDashboard";
import { ChatPlayground } from "@/components/ChatPlayground";
import { TracesView } from "@/components/TracesView";
import { EvaluationsView } from "@/components/EvaluationsView";
import { CostIntelligenceView } from "@/components/CostIntelligenceView";
import { AlertsSettingsView } from "@/components/AlertsSettingsView";

export default function Home() {
  const [currentTab, setCurrentTab] = useState<NavTab>("overview");
  const [targetTraceId, setTargetTraceId] = useState<string | undefined>(undefined);
  const [activeAlertCount, setActiveAlertCount] = useState(0);

  // Auto initialize seed data on first mount
  useEffect(() => {
    fetch("/api/seed")
      .then((res) => res.json())
      .catch((e) => console.log("Seeding verified"));

    // Check for active alerts count for sidebar badge
    fetch("/api/alerts")
      .then((res) => res.json())
      .then((d) => {
        if (d?.alerts) {
          const active = d.alerts.filter((a: any) => a.status === "active").length;
          setActiveAlertCount(active);
        }
      })
      .catch(() => {});
  }, []);

  const handleNavigateToTrace = (id: string) => {
    setTargetTraceId(id);
    setCurrentTab("traces");
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={(tab) => {
          if (tab !== "traces") {
            setTargetTraceId(undefined);
          }
          setCurrentTab(tab);
        }}
        activeAlertCount={activeAlertCount}
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto bg-slate-950 text-slate-100">
        {currentTab === "overview" && <OverviewDashboard onNavigateToTrace={handleNavigateToTrace} />}
        {currentTab === "chat" && <ChatPlayground onNavigateToTrace={handleNavigateToTrace} />}
        {currentTab === "traces" && <TracesView initialTraceId={targetTraceId} />}
        {currentTab === "evaluations" && <EvaluationsView onNavigateToTrace={handleNavigateToTrace} />}
        {currentTab === "cost" && <CostIntelligenceView />}
        {currentTab === "alerts" && <AlertsSettingsView />}
      </main>
    </div>
  );
}
