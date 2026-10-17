import { pgTable, text, timestamp, integer, doublePrecision, jsonb, boolean, index, serial } from "drizzle-orm/pg-core";

// 1. Documents / chunks (built-in corpus + user-uploaded PDF chunks)
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("General"),
  content: text("content").notNull(),
  keywords: text("keywords").notNull(), // Comma-separated or tokenized
  source: text("source").notNull().default("builtin"), // 'builtin' | 'upload'
  uploadId: text("upload_id"), // FK-ish link to uploads.id for user files
  chunkIndex: integer("chunk_index").notNull().default(0),
  pageNumber: integer("page_number"),
  tokenCount: integer("token_count").notNull().default(0),
  embedding: jsonb("embedding").$type<number[]>(), // local hashed vector or provider embedding
  embeddingModel: text("embedding_model").notNull().default("local-hash-384"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("documents_source_idx").on(table.source),
  index("documents_upload_id_idx").on(table.uploadId),
]);

// 1b. Uploads (user PDF / text knowledge files)
export const uploads = pgTable("uploads", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  chunkCount: integer("chunk_count").notNull().default(0),
  charCount: integer("char_count").notNull().default(0),
  status: text("status").notNull().default("ready"), // 'processing' | 'ready' | 'failed'
  errorMessage: text("error_message"),
  parseMs: integer("parse_ms").notNull().default(0),
  embedMs: integer("embed_ms").notNull().default(0),
  embeddingModel: text("embedding_model").notNull().default("local-hash-384"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("uploads_created_at_idx").on(table.createdAt),
]);

// 2. Model Prices
export const modelPrices = pgTable("model_prices", {
  model: text("model").primaryKey(),
  displayName: text("display_name").notNull(),
  provider: text("provider").notNull(),
  inputPricePer1m: doublePrecision("input_price_per_1m").notNull(),
  outputPricePer1m: doublePrecision("output_price_per_1m").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 3. Requests (Root trace record)
export const requests = pgTable("requests", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  queryRedacted: text("query_redacted").notNull(),
  rawQuery: text("raw_query"),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull().default("v1.2-prod"),
  status: text("status").notNull(), // 'success' | 'error' | 'timeout'
  errorType: text("error_type"), // 'rate_limit' | 'context_length_exceeded' | 'upstream_timeout' | 'embedding_error' | null
  errorMessage: text("error_message"),
  latencyMs: integer("latency_ms").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  estimatedCostUsd: doublePrecision("estimated_cost_usd").notNull(),
  answer: text("answer"),
  retrievedDocIds: jsonb("retrieved_doc_ids").$type<number[]>().default([]),
  bottleneckStage: text("bottleneck_stage").notNull().default("llm_generation"), // query_processing | vector_search | retrieval | llm_generation | response
  sessionId: text("session_id"), // groups multi-turn conversations
  engine: text("engine").notNull().default("simulated"), // 'provider' | 'local-extractive' | 'simulated'
  provider: text("provider"), // openai | anthropic | groq | openrouter | local
  retrievalMode: text("retrieval_mode").notNull().default("auto"), // auto | knowledge_base | general
  groundedness: doublePrecision("groundedness"), // 0..1 real post-hoc support score
  retryCount: integer("retry_count").notNull().default(0),
  uploadId: text("upload_id"), // scoped-to-file conversations
}, (table) => [
  index("requests_created_at_idx").on(table.createdAt),
  index("requests_status_idx").on(table.status),
  index("requests_model_idx").on(table.model),
]);

// 4. Spans (OpenTelemetry style traces per request)
export const spans = pgTable("spans", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(), // query_processing | vector_search | retrieval | llm_generation | response
  startMs: integer("start_ms").notNull(),
  durationMs: integer("duration_ms").notNull(),
  attributes: jsonb("attributes").$type<Record<string, any>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("spans_request_id_idx").on(table.requestId),
  index("spans_stage_idx").on(table.stage),
]);

// 5. Eval Dataset (30 questions)
export const evalDataset = pgTable("eval_dataset", {
  id: serial("id").primaryKey(),
  category: text("category").notNull().default("General"),
  question: text("question").notNull(),
  referenceAnswer: text("reference_answer").notNull(),
  expectedDocIds: jsonb("expected_doc_ids").$type<number[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 6. Evaluation Runs
export const evaluationRuns = pgTable("evaluation_runs", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  datasetSize: integer("dataset_size").notNull().default(30),
  scores: jsonb("scores").$type<{
    retrievalRecall: number;
    answerRelevance: number;
    groundedness: number;
    contextPrecision: number;
    hallucinationRate: number;
    avgLatencyMs: number;
    totalCostUsd: number;
  }>().notNull(),
  status: text("status").notNull().default("completed"), // 'running' | 'completed' | 'failed'
}, (table) => [
  index("eval_runs_created_at_idx").on(table.createdAt),
  index("eval_runs_model_idx").on(table.model),
]);

// 7. Evaluation Results (per question in a run)
export const evaluationResults = pgTable("evaluation_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => evalDataset.id, { onDelete: "cascade" }),
  requestId: text("request_id"),
  question: text("question").notNull(),
  generatedAnswer: text("generated_answer").notNull(),
  retrievedDocIds: jsonb("retrieved_doc_ids").$type<number[]>().notNull().default([]),
  expectedDocIds: jsonb("expected_doc_ids").$type<number[]>().notNull().default([]),
  scores: jsonb("scores").$type<{
    hitRate: number;
    relevance: number;
    groundedness: number;
    contextPrecision: number;
    hallucination: boolean;
    reasoning: string;
  }>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("eval_results_run_id_idx").on(table.runId),
]);

// 8. Alert Rules / Thresholds
export const alertRules = pgTable("alert_rules", {
  id: text("id").primaryKey(),
  metric: text("metric").notNull(), // latency_p95 | error_rate | cost_hourly | quality_groundedness | hallucination_spike
  displayName: text("display_name").notNull(),
  threshold: doublePrecision("threshold").notNull(),
  comparison: text("comparison").notNull().default("gt"), // 'gt' | 'lt'
  unit: text("unit").notNull(), // 'ms' | '%' | '$'
  windowMinutes: integer("window_minutes").notNull().default(15),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(30),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 9. Alerts (trigger records)
export const alerts = pgTable("alerts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // 'latency_spike' | 'error_burst' | 'cost_anomaly' | 'quality_drop'
  severity: text("severity").notNull(), // 'critical' | 'warning' | 'info'
  metric: text("metric").notNull(),
  value: doublePrecision("value").notNull(),
  threshold: doublePrecision("threshold").notNull(),
  status: text("status").notNull().default("active"), // 'active' | 'resolved' | 'acknowledged'
  title: text("title").notNull(),
  message: text("message").notNull(),
  emailSent: boolean("email_sent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("alerts_created_at_idx").on(table.createdAt),
  index("alerts_status_idx").on(table.status),
]);

// 10. Platform Settings (Resend key, Lovable AI config, etc.)
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
