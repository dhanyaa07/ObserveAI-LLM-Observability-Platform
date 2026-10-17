"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Bot,
  User,
  Shield,
  Clock,
  DollarSign,
  FileText,
  ChevronDown,
  ChevronUp,
  Upload,
  Trash2,
  Paperclip,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Cpu,
  Loader2,
  BarChart3,
  Repeat,
} from "lucide-react";
import { formatMs, formatCost } from "@/lib/utils";

interface SourceChunk {
  id: number;
  title: string;
  category: string;
  content: string;
  similarity: number;
  bm25: number;
  vector: number;
  source: string;
  pageNumber: number | null;
}

interface SpanInfo {
  stage: string;
  startMs: number;
  durationMs: number;
  attributes: Record<string, any>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  requestId?: string;
  engine?: string;
  provider?: string;
  mode?: string;
  redactedQuery?: string;
  sources?: SourceChunk[];
  spans?: SpanInfo[];
  metrics?: any;
  error?: string;
  pending?: boolean;
}

interface UploadFile {
  id: string;
  filename: string;
  pageCount: number;
  chunkCount: number;
  charCount: number;
  status: string;
}

const STAGE_COLORS: Record<string, string> = {
  query_processing: "bg-cyan-500",
  vector_search: "bg-amber-500",
  retrieval: "bg-blue-500",
  llm_generation: "bg-violet-500",
  response: "bg-emerald-500",
};

export function ChatPlayground({ onNavigateToTrace }: { onNavigateToTrace?: (id: string) => void }) {
  const [sessionId] = useState(() => `sess_${Math.random().toString(36).slice(2, 10)}`);
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [mode, setMode] = useState<"auto" | "knowledge_base" | "general">("auto");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [scopedFileIds, setScopedFileIds] = useState<string[]>([]);
  const [corpus, setCorpus] = useState({ builtinChunks: 0, uploadedChunks: 0 });
  const [providerInfo, setProviderInfo] = useState<any>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "**ObserveAI Assistant is live.**\n\nAsk me anything — general questions, or questions about documents you upload. Drop a **PDF / TXT / MD** file here and it is parsed, chunked, embedded and indexed for retrieval in seconds.\n\nEvery turn emits real OpenTelemetry spans: redaction → hybrid retrieval → generation → groundedness scoring. Expand *Observability* under any answer to inspect the trace.",
    },
  ]);

  const refreshFiles = async () => {
    try {
      const res = await fetch("/api/upload");
      if (res.ok) {
        const json = await res.json();
        setFiles(json.uploads || []);
        setCorpus(json.corpus || { builtinChunks: 0, uploadedChunks: 0 });
      }
    } catch {}
  };

  useEffect(() => {
    refreshFiles();
    fetch("/api/providers")
      .then((r) => r.json())
      .then(setProviderInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  /* ---------------- Upload handling ---------------- */
  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    setUploadError(null);
    setUploading(true);

    for (const file of Array.from(fileList)) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const json = await res.json();

        if (!res.ok) {
          setUploadError(json.error || "Upload failed");
          continue;
        }

        await refreshFiles();
        setScopedFileIds((prev) => [...prev, json.upload.id]);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              `**${json.upload.filename} indexed.**\n\n` +
              `- Pages parsed: **${json.upload.pageCount}**\n` +
              `- Chunks created: **${json.upload.chunkCount}** (~1,200 chars, 180 char overlap)\n` +
              `- Characters extracted: **${json.upload.charCount.toLocaleString()}**\n` +
              `- Embeddings: **${json.upload.embeddingModel}** (${json.upload.embeddingProvider})\n` +
              `- Parse ${json.upload.parseMs}ms · Embed ${json.upload.embedMs}ms · Total ${json.upload.totalMs}ms\n\n` +
              `Retrieval is now scoped to this file. Ask away — or untick it below to search the whole corpus.`,
          },
        ]);
      } catch (e: any) {
        setUploadError(e?.message || "Upload failed");
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const deleteFile = async (id: string) => {
    await fetch(`/api/upload?id=${id}`, { method: "DELETE" });
    setScopedFileIds((prev) => prev.filter((f) => f !== id));
    refreshFiles();
  };

  /* ---------------- Chat send ---------------- */
  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || query).trim();
    if (!text || loading) return;

    const history = messages
      .filter((m) => !m.error && !m.pending)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!textToSend) setQuery("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: text,
          model,
          mode,
          sessionId,
          uploadIds: scopedFileIds,
          history,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `**Request failed — logged as telemetry, not a crash.**\n\n\`${data.errorType || "error"}\`: ${data.errorMessage || data.error}\n\nThe pipeline retried with exponential backoff before giving up. This failure now appears in Overview error-rate charts and the Traces view.`,
            error: data.errorType || "error",
            requestId: data.requestId,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer,
            requestId: data.requestId,
            engine: data.engine,
            provider: data.provider,
            mode: data.mode,
            redactedQuery: data.redactedQuery,
            sources: data.sources,
            spans: data.spans,
            metrics: data.metrics,
          },
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Network error contacting the pipeline: ${err.message}`, error: "network_error" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  const liveMode = providerInfo?.liveMode;

  return (
    <div
      className="flex h-screen"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {/* ---------------- Main chat column ---------------- */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header / controls */}
        <div className="border-b border-slate-800 bg-slate-950/90 px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 block uppercase tracking-wider">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="gpt-4o">GPT-4o · OpenAI</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet · Anthropic</option>
                <option value="llama-3-3-70b">Llama 3.3 70B · Groq</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-500 block uppercase tracking-wider">Retrieval scope</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as any)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="auto">Auto (RAG when relevant)</option>
                <option value="knowledge_base">Documents only</option>
                <option value="general">General chat (no retrieval)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-950/40 border border-cyan-800/40 text-cyan-300 text-[11px] mt-3.5">
              <Shield className="h-3.5 w-3.5" />
              <span>PII redacted before storage</span>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] mt-3.5 ${
              liveMode
                ? "bg-emerald-950/40 border-emerald-700/50 text-emerald-300"
                : "bg-amber-950/30 border-amber-700/40 text-amber-300"
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>{liveMode ? "Live provider generation" : "Extractive engine (no provider key)"}</span>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-5 relative">
          {dragOver && (
            <div className="absolute inset-4 z-10 rounded-2xl border-2 border-dashed border-indigo-500 bg-indigo-950/40 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <Upload className="h-8 w-8 text-indigo-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-indigo-200">Drop PDF / TXT / MD to index it</p>
              </div>
            </div>
          )}

          {messages.map((m, idx) => {
            const key = `${idx}`;
            return (
              <div key={idx} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="h-8 w-8 rounded-lg bg-indigo-600/25 border border-indigo-500/40 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-4 w-4 text-indigo-400" />
                  </div>
                )}

                <div
                  className={`max-w-3xl rounded-xl text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-none px-4 py-3"
                      : m.error
                      ? "bg-rose-950/40 border border-rose-800/60 text-rose-100 rounded-bl-none px-4 py-3"
                      : "bg-slate-900/90 border border-slate-800 text-slate-200 rounded-bl-none px-4 py-3"
                  }`}
                >
                  <MarkdownLite text={m.content} />

                  {/* Metrics chips */}
                  {m.metrics && (
                    <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <Chip icon={<Clock className="h-3 w-3 text-cyan-400" />} label={formatMs(m.metrics.latencyMs)} />
                      <Chip
                        icon={<Activity className="h-3 w-3 text-violet-400" />}
                        label={`${m.metrics.inputTokens + m.metrics.outputTokens} tok`}
                      />
                      <Chip icon={<DollarSign className="h-3 w-3 text-emerald-400" />} label={formatCost(m.metrics.estimatedCostUsd)} />
                      {m.metrics.groundedness !== null && m.metrics.groundedness !== undefined && (
                        <Chip
                          icon={
                            m.metrics.hallucinationRisk ? (
                              <AlertTriangle className="h-3 w-3 text-rose-400" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            )
                          }
                          label={`grounded ${(m.metrics.groundedness * 100).toFixed(0)}%`}
                        />
                      )}
                      {m.metrics.retries > 0 && (
                        <Chip icon={<Repeat className="h-3 w-3 text-amber-400" />} label={`${m.metrics.retries} retries`} />
                      )}
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                        {m.engine === "provider" ? `${m.provider}` : "extractive"}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400">{m.mode}</span>
                    </div>
                  )}

                  {/* Sources */}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-3">
                      <button
                        onClick={() => toggle(`src-${key}`)}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1.5"
                      >
                        <FileText className="h-3 w-3 text-indigo-400" />
                        Retrieved passages ({m.sources.length})
                        {expanded[`src-${key}`] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>

                      {expanded[`src-${key}`] && (
                        <div className="mt-2 space-y-1.5">
                          {m.sources.map((s, i) => (
                            <div key={s.id} className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[11px] font-medium text-slate-300 truncate">
                                  [{i + 1}] {s.title}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                                    {(s.similarity * 100).toFixed(0)}%
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                                    bm25 {s.bm25.toFixed(2)} · cos {s.vector.toFixed(2)}
                                  </span>
                                  {s.source === "upload" && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300">file</span>
                                  )}
                                </div>
                              </div>
                              <p className="text-[11px] text-slate-400 leading-relaxed">
                                {s.content.slice(0, 320)}
                                {s.content.length > 320 ? "…" : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Observability / span waterfall */}
                  {m.spans && m.spans.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => toggle(`obs-${key}`)}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1.5"
                      >
                        <BarChart3 className="h-3 w-3 text-amber-400" />
                        Observability · {m.spans.length} spans · bottleneck {m.metrics?.bottleneckStage}
                        {expanded[`obs-${key}`] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>

                      {expanded[`obs-${key}`] && (
                        <div className="mt-2 bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                          {m.spans.map((sp, i) => {
                            const total = Math.max(1, m.metrics?.latencyMs || 1);
                            return (
                              <div key={i}>
                                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                                  <span className="font-mono capitalize">{sp.stage.replace(/_/g, " ")}</span>
                                  <span className="font-mono">{formatMs(sp.durationMs)}</span>
                                </div>
                                <div className="h-2.5 w-full bg-slate-900 rounded relative overflow-hidden">
                                  <div
                                    className={`absolute top-0 bottom-0 rounded ${STAGE_COLORS[sp.stage] || "bg-indigo-500"}`}
                                    style={{
                                      left: `${(sp.startMs / total) * 100}%`,
                                      width: `${Math.max(2, (sp.durationMs / total) * 100)}%`,
                                    }}
                                  />
                                </div>
                                <div className="text-[9px] text-slate-600 font-mono truncate mt-0.5">
                                  {JSON.stringify(sp.attributes).slice(0, 150)}
                                </div>
                              </div>
                            );
                          })}

                          {m.metrics?.unsupportedClaims?.length > 0 && (
                            <div className="mt-2 p-2 rounded bg-rose-950/40 border border-rose-900 text-[10px] text-rose-200">
                              <span className="font-semibold">Unsupported claims flagged:</span>{" "}
                              {m.metrics.unsupportedClaims[0]}
                            </div>
                          )}

                          {m.requestId && (
                            <button
                              onClick={() => onNavigateToTrace?.(m.requestId!)}
                              className="w-full mt-1 text-[10px] font-semibold text-indigo-300 hover:text-indigo-200 bg-indigo-950/40 border border-indigo-800/60 rounded py-1.5"
                            >
                              Open full trace {m.requestId} →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {m.role === "user" && (
                  <div className="h-8 w-8 rounded-lg bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="h-4 w-4 text-slate-200" />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-3 items-center text-xs text-indigo-300">
              <div className="h-8 w-8 rounded-lg bg-indigo-600/25 border border-indigo-500/40 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />
              </div>
              <span>redaction → hybrid retrieval (BM25 + cosine) → generation → groundedness check…</span>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-800 bg-slate-950/90 px-6 py-4">
          {uploadError && (
            <div className="mb-2 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900 rounded px-3 py-2">
              {uploadError}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2 items-center"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Attach PDF / TXT / MD"
              className="h-11 w-11 shrink-0 rounded-xl bg-slate-900 border border-slate-700 hover:border-indigo-500 text-slate-300 flex items-center justify-center transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </button>

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                scopedFileIds.length
                  ? "Ask something about your uploaded document…"
                  : "Ask anything — or attach a PDF to ask about it"
              }
              className="flex-1 h-11 bg-slate-900 border border-slate-700 rounded-xl px-4 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          </form>
        </div>
      </div>

      {/* ---------------- Knowledge panel ---------------- */}
      <aside className="w-72 border-l border-slate-800 bg-slate-950 p-4 overflow-y-auto hidden xl:block">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2 mb-3">
          <Database className="h-3.5 w-3.5 text-indigo-400" />
          Retrieval Index
        </h3>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
            <div className="text-[10px] text-slate-500">Built-in</div>
            <div className="text-lg font-bold text-slate-100">{corpus.builtinChunks}</div>
            <div className="text-[10px] text-slate-500">chunks</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
            <div className="text-[10px] text-slate-500">Your files</div>
            <div className="text-lg font-bold text-cyan-300">{corpus.uploadedChunks}</div>
            <div className="text-[10px] text-slate-500">chunks</div>
          </div>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full mb-4 py-2.5 rounded-lg border-2 border-dashed border-slate-700 hover:border-indigo-500 text-[11px] text-slate-400 hover:text-indigo-300 transition-colors flex items-center justify-center gap-2"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload PDF / TXT / MD
        </button>

        <h4 className="text-[11px] font-semibold text-slate-400 mb-2">
          Uploaded files {files.length > 0 && `(${files.length})`}
        </h4>

        {files.length === 0 ? (
          <p className="text-[11px] text-slate-600 leading-relaxed">
            No files yet. Uploaded documents are parsed, chunked with overlap, embedded, and searched alongside the built-in
            policy corpus.
          </p>
        ) : (
          <div className="space-y-2">
            {files.map((f) => {
              const active = scopedFileIds.includes(f.id);
              return (
                <div
                  key={f.id}
                  className={`rounded-lg border p-2.5 transition-colors ${
                    active ? "bg-indigo-950/40 border-indigo-700/60" : "bg-slate-900 border-slate-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex items-start gap-2 cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) =>
                          setScopedFileIds((prev) =>
                            e.target.checked ? [...prev, f.id] : prev.filter((x) => x !== f.id)
                          )
                        }
                        className="mt-0.5 accent-indigo-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-medium text-slate-200 truncate">{f.filename}</span>
                        <span className="block text-[10px] text-slate-500">
                          {f.pageCount}p · {f.chunkCount} chunks
                        </span>
                      </span>
                    </label>
                    <button
                      onClick={() => deleteFile(f.id)}
                      className="text-slate-600 hover:text-rose-400 shrink-0"
                      title="Remove from index"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            {scopedFileIds.length > 0 && (
              <p className="text-[10px] text-indigo-400 leading-relaxed pt-1">
                Retrieval is scoped to {scopedFileIds.length} selected file(s). Untick all to search the full corpus.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-slate-800">
          <h4 className="text-[11px] font-semibold text-slate-400 mb-2">Generation engine</h4>
          <div className="space-y-1.5 text-[10px]">
            {providerInfo?.providers?.map((p: any) => (
              <div key={p.provider} className="flex items-center justify-between">
                <span className="text-slate-400 capitalize">{p.provider}</span>
                <span className={p.configured ? "text-emerald-400" : "text-slate-600"}>
                  {p.configured ? `live (${p.via})` : "no key"}
                </span>
              </div>
            ))}
          </div>
          {!liveMode && (
            <p className="text-[10px] text-slate-600 mt-2 leading-relaxed">
              Without a key, answers are produced by the local extractive ranker over real retrieved text — accurate and
              fully cited, just not generative. Add a key in Alerts &amp; Settings to switch to live LLM synthesis.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
      {icon}
      {label}
    </span>
  );
}

/** Minimal markdown renderer: bold, bullets, blockquote, headings. */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        const html = line
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
          .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 rounded bg-slate-800 text-cyan-300 text-[11px]">$1</code>')
          .replace(/_(.+?)_/g, '<em class="text-slate-400">$1</em>')
          .replace(/\[(\d+)\]/g, '<span class="text-indigo-400 font-medium">[$1]</span>');

        if (line.startsWith("> ")) {
          return (
            <blockquote
              key={i}
              className="border-l-2 border-slate-700 pl-3 text-slate-400 italic"
              dangerouslySetInnerHTML={{ __html: html.slice(2) }}
            />
          );
        }
        if (/^[-*•]\s/.test(line)) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-indigo-400 shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: html.replace(/^[-*•]\s/, "") }} />
            </div>
          );
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}
