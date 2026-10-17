import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { inArray } from "drizzle-orm";

/**
 * Real LLM provider layer.
 *
 * Keys are resolved server-side only, from environment variables first and
 * then from the `platform_settings` table (set via Alerts & Settings UI).
 * They are NEVER returned to the browser — only a boolean "configured" flag.
 *
 * Every call is wrapped with: hard timeout (AbortController), bounded
 * exponential-backoff retries, and structured error classification so that
 * failures become telemetry instead of crashes.
 */

export type ProviderId = "openai" | "anthropic" | "groq" | "openrouter";

export interface ModelDef {
  id: string;             // our canonical model id (matches model_prices.model)
  label: string;
  provider: ProviderId;
  providerModel: string;  // id used by the upstream API
  contextWindow: number;
}

export const MODEL_CATALOGUE: ModelDef[] = [
  { id: "gpt-4o", label: "GPT-4o (Omni)", provider: "openai", providerModel: "gpt-4o", contextWindow: 128000 },
  { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", provider: "anthropic", providerModel: "claude-3-5-sonnet-latest", contextWindow: 200000 },
  { id: "llama-3-3-70b", label: "Llama 3.3 70B Instruct", provider: "groq", providerModel: "llama-3.3-70b-versatile", contextWindow: 128000 },
];

const ENV_KEYS: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const SETTING_KEYS: Record<ProviderId, string> = {
  openai: "openai_api_key",
  anthropic: "anthropic_api_key",
  groq: "groq_api_key",
  openrouter: "openrouter_api_key",
};

export async function getStoredKeys(): Promise<Partial<Record<ProviderId, string>>> {
  const rows = await db
    .select()
    .from(platformSettings)
    .where(inArray(platformSettings.key, Object.values(SETTING_KEYS)));

  const out: Partial<Record<ProviderId, string>> = {};
  for (const [provider, settingKey] of Object.entries(SETTING_KEYS) as [ProviderId, string][]) {
    const row = rows.find((r) => r.key === settingKey);
    if (row?.value) out[provider] = row.value;
  }
  return out;
}

export async function resolveKey(provider: ProviderId): Promise<string | undefined> {
  const envKey = process.env[ENV_KEYS[provider]];
  if (envKey) return envKey;
  const stored = await getStoredKeys();
  return stored[provider];
}

export function settingKeyFor(provider: ProviderId): string {
  return SETTING_KEYS[provider];
}

export async function providerStatus() {
  const stored = await getStoredKeys();
  return (Object.keys(ENV_KEYS) as ProviderId[]).map((p) => ({
    provider: p,
    configured: Boolean(process.env[ENV_KEYS[p]] || stored[p]),
    via: process.env[ENV_KEYS[p]] ? "environment" : stored[p] ? "settings" : null,
    envVar: ENV_KEYS[p],
    models: MODEL_CATALOGUE.filter((m) => m.provider === p).map((m) => m.id),
  }));
}

export type LLMErrorType =
  | "rate_limit"
  | "context_length_exceeded"
  | "upstream_timeout"
  | "auth_error"
  | "upstream_error"
  | "network_error"
  | "no_provider_key";

export class LLMError extends Error {
  type: LLMErrorType;
  status?: number;
  retryable: boolean;
  constructor(type: LLMErrorType, message: string, status?: number) {
    super(message);
    this.type = type;
    this.status = status;
    this.retryable = type === "rate_limit" || type === "upstream_timeout" || type === "network_error" || (status ? status >= 500 : false);
  }
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: ProviderId;
  providerModel: string;
  finishReason: string;
  attempts: number;
  usageReported: boolean;
}

function classify(status: number, body: string): LLMError {
  const lower = (body || "").toLowerCase();
  if (status === 401 || status === 403) return new LLMError("auth_error", `Provider rejected credentials (${status})`, status);
  if (status === 429) return new LLMError("rate_limit", `Provider rate limit reached (429)`, status);
  if (lower.includes("context") && (lower.includes("length") || lower.includes("window") || lower.includes("maximum")))
    return new LLMError("context_length_exceeded", "Prompt exceeded the model context window", status);
  return new LLMError("upstream_error", `Provider returned ${status}: ${body.slice(0, 220)}`, status);
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  provider: ProviderId,
  model: ModelDef,
  messages: ChatTurn[],
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.providerModel,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw classify(res.status, body);
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      provider,
      providerModel: model.providerModel,
      finishReason: choice?.finish_reason ?? "stop",
      attempts: 1,
      usageReported: Boolean(json.usage),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(
  apiKey: string,
  model: ModelDef,
  messages: ChatTurn[],
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.providerModel,
        system: system || undefined,
        messages: convo,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw classify(res.status, body);
    }

    const json = await res.json();
    const text = (json.content || []).map((c: any) => c.text || "").join("");
    return {
      text,
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      provider: "anthropic",
      providerModel: model.providerModel,
      finishReason: json.stop_reason ?? "end_turn",
      attempts: 1,
      usageReported: Boolean(json.usage),
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface CompletionOptions {
  modelId: string;
  messages: ChatTurn[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Execute a chat completion with timeout + exponential backoff retries.
 * Throws a typed LLMError that callers turn into telemetry.
 */
export async function runCompletion(opts: CompletionOptions): Promise<CompletionResult> {
  const model = MODEL_CATALOGUE.find((m) => m.id === opts.modelId) || MODEL_CATALOGUE[0];
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 900;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxRetries = opts.maxRetries ?? 2;

  // Prefer the model's native provider; fall back to OpenRouter if that is the configured one.
  let provider: ProviderId = model.provider;
  let apiKey = await resolveKey(provider);
  let effectiveModel = model;

  if (!apiKey) {
    const orKey = await resolveKey("openrouter");
    if (orKey) {
      provider = "openrouter";
      apiKey = orKey;
      const orNames: Record<string, string> = {
        "gpt-4o": "openai/gpt-4o",
        "claude-3-5-sonnet": "anthropic/claude-3.5-sonnet",
        "llama-3-3-70b": "meta-llama/llama-3.3-70b-instruct",
      };
      effectiveModel = { ...model, provider: "openrouter", providerModel: orNames[model.id] || model.providerModel };
    }
  }

  if (!apiKey) {
    throw new LLMError("no_provider_key", `No API key configured for ${model.provider}. Set ${ENV_KEYS[model.provider]} or save a key in Alerts & Settings.`);
  }

  let lastError: LLMError | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      let result: CompletionResult;
      if (provider === "anthropic") {
        result = await callAnthropic(apiKey, effectiveModel, opts.messages, temperature, maxTokens, timeoutMs);
      } else {
        const baseUrl =
          provider === "groq"
            ? "https://api.groq.com/openai/v1"
            : provider === "openrouter"
            ? "https://openrouter.ai/api/v1"
            : "https://api.openai.com/v1";
        result = await callOpenAICompatible(baseUrl, apiKey, provider, effectiveModel, opts.messages, temperature, maxTokens, timeoutMs);
      }
      return { ...result, attempts: attempt };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        lastError = new LLMError("upstream_timeout", `Upstream provider timed out after ${timeoutMs}ms`);
      } else if (err instanceof LLMError) {
        lastError = err;
      } else {
        lastError = new LLMError("network_error", err?.message || "Network failure contacting provider");
      }

      if (!lastError.retryable || attempt > maxRetries) break;
      // exponential backoff with jitter: 400ms, 900ms ...
      const backoff = 400 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 150);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError ?? new LLMError("upstream_error", "Unknown provider failure");
}
