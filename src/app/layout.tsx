import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ObserveAI — Enterprise LLM Observability & Reliability Platform",
  description: "Next-generation OpenTelemetry RAG tracing, real-time latency quantiles, automated LLM-as-judge quality evaluations, and cost optimization.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
