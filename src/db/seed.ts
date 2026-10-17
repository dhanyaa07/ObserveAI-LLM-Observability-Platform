import { db } from "./index";
import { documents, modelPrices, evalDataset, alertRules, requests, spans, evaluationRuns, evaluationResults, alerts } from "./schema";
import { sql } from "drizzle-orm";
import { embedTexts } from "@/lib/embeddings";

export const SAMPLE_DOCUMENTS = [
  {
    title: "HR Policy: Remote Work & Core Hours",
    category: "HR Policy",
    content: "ObserveCorp operates under a flexible-first hybrid work model. All full-time employees are expected to be available for collaboration during core synchronous hours: 10:00 AM to 3:00 PM in their designated team time zone. Remote stipends of $500 are provided upon onboarding for home office equipment. Working outside the primary country of employment is permitted for up to 30 consecutive business days per calendar year with prior manager approval.",
    keywords: "remote work, core hours, stipend, home office, working abroad, hybrid policy, synchronous hours",
  },
  {
    title: "HR Policy: Paid Time Off (PTO) & Sick Leave",
    category: "HR Policy",
    content: "Full-time exempt employees receive 25 days of accrued PTO annually, accruing on a monthly basis. Up to 5 unused PTO days can be rolled over into the next calendar year, expiring on March 31st. Employees receive 10 dedicated paid sick days per year, separate from PTO. Bereavement leave grants up to 5 paid days for immediate family members.",
    keywords: "pto, vacation, sick leave, paid time off, rollover, bereavement, leave policy",
  },
  {
    title: "HR Policy: Parental & Family Care Leave",
    category: "HR Policy",
    content: "ObserveCorp offers 16 weeks of fully paid parental leave for all new parents (birthing, non-birthing, adoptive, or foster parents) after 6 months of continuous service. Parental leave must be taken within the first 12 months following birth or placement. Additionally, employees can take up to 4 weeks of paid family caregiver leave for ill immediate family members.",
    keywords: "parental leave, maternity, paternity, adoption, foster, family care leave, caregiver",
  },
  {
    title: "HR Policy: Learning & Professional Development",
    category: "HR Policy",
    content: "Every employee receives an annual $2,000 Professional Development Budget. Eligible expenses include industry conferences, books, certification exams (AWS, GCP, CISA), and online course subscriptions (Coursera, O'Reilly). Budgets do not roll over across fiscal years and require manager pre-approval via the Workday portal.",
    keywords: "learning budget, education, training, conference, certification, professional development, stipend",
  },
  {
    title: "IT Policy: Device Security & Password Management",
    category: "IT Security",
    content: "All corporate access requires 1Password for password storage and Okta Multi-Factor Authentication (MFA) with FIDO2 hardware keys or Okta FastPass. Passwords must contain at least 16 characters and pass entropy checks. Company-issued MacBooks and ThinkPads are managed via Jamf Pro or Microsoft Intune and must maintain FileVault disk encryption at all times.",
    keywords: "password, mfa, okta, 1password, encryption, jamf, filevault, laptop security, fido2",
  },
  {
    title: "IT Policy: Bring Your Own Device (BYOD) & Mobile Access",
    category: "IT Security",
    content: "Employees may access Slack, Google Workspace, and Jira from personal mobile devices provided they enroll in the ObserveCorp MDM container. Personal devices must enforce a 6-digit biometric PIN, run updated OS versions (no rooted/jailbroken devices), and permit remote wipe of company data upon offboarding.",
    keywords: "byod, mobile, personal phone, mdm, remote wipe, slack mobile, security requirements",
  },
  {
    title: "IT Policy: Cloud Infrastructure & SSH Key Management",
    category: "IT Infrastructure",
    content: "Direct SSH access to production AWS/GCP instances via static keys is strictly prohibited. Engineers must connect via Teleport zero-trust access with short-lived certificates tied to Okta SSO groups. Production database access requires an approved break-glass ticket via PagerDuty with automatic 2-hour session expiration and session recording.",
    keywords: "ssh, cloud, aws, gcp, teleport, zero trust, production access, break-glass, pagerduty",
  },
  {
    title: "IT Policy: Generative AI & Sensitive Data Handling",
    category: "IT & AI Policy",
    content: "ObserveCorp employees may only use enterprise-approved LLM tools (such as ObserveAI sandbox, GitHub Copilot Enterprise, and ChatGPT Enterprise). Inputting customer PII, unreleased financial data, or production secrets into unvetted public AI platforms is a critical compliance violation. All prompts are subject to automated DLP redaction.",
    keywords: "generative ai, chatgpt, llm, pii, dlp, copilot, data privacy, secrets, compliance",
  },
  {
    title: "Product Architecture: RAG Pipeline Design",
    category: "Product & Engineering",
    content: "ObserveAI's RAG architecture consists of 5 modular pipeline stages: 1) Query Processing (PII redaction, query rewriting), 2) Vector Search (HNSW index semantic retrieval), 3) Context Reranking & Retrieval (cross-encoder top-k selection), 4) LLM Generation (streaming completion with prompt template v1/v2), and 5) Response Post-Processing (groundedness check & citation formatting).",
    keywords: "rag pipeline, vector search, hnsw, reranking, llm generation, query processing, architecture",
  },
  {
    title: "Product Architecture: LLM Observability & OpenTelemetry Spans",
    category: "Product & Engineering",
    content: "Telemetry is collected through OpenTelemetry-compatible spans emitted at each stage boundary. Each span records start_ms, duration_ms, token counts, model parameters, retrieved chunk IDs, and similarity scores. Slow requests exceeding 1,500ms are flagged for bottleneck analysis to identify whether vector search latency or LLM token time dominates.",
    keywords: "opentelemetry, tracing, spans, telemetry, latency, bottleneck analysis, tokens, metrics",
  },
  {
    title: "Product Architecture: LLM-as-a-Judge Evaluation Framework",
    category: "Product & Engineering",
    content: "Quality evaluation uses synthetic and golden eval datasets to compute 4 core metrics: Retrieval Recall@k, Answer Relevance (0-1), Groundedness/Faithfulness (0-1), and Context Precision. Hallucination detection flags when the generated answer makes claims absent from the retrieved chunk corpus with an automated reasoning audit.",
    keywords: "llm as judge, evaluation, groundedness, hallucination, answer relevance, context precision, recall",
  },
  {
    title: "Engineering Policy: Production Deployment & Canary Releases",
    category: "Product & Engineering",
    content: "Deployments follow a 3-tier canary roll-out: 5% of production traffic for 15 minutes, 25% for 30 minutes, followed by 100% rollout. Automated rollbacks trigger if error rates exceed 1.0% or p95 latency degrades by more than 25% compared to the 24-hour moving average.",
    keywords: "canary release, deployment, rollback, error budget, production release, p95 latency",
  },
  {
    title: "Finance & Expense Policy: Meals, Travel & Per Diem",
    category: "Finance",
    content: "Business travel expenses require manager pre-approval for flights exceeding $500. Flights under 6 hours must be booked in Economy or Premium Economy. A daily meal per diem of $85 is permitted for domestic travel ($115 international). Receipts are mandatory for all transactions over $25 submitted via Expensify within 30 days.",
    keywords: "travel policy, expenses, per diem, flights, expensify, meals, hotel booking",
  },
  {
    title: "Security & Compliance: Incident Response Severity Levels",
    category: "IT Security",
    content: "Incidents are classified into SEV-1 (Critical outage or customer data breach; 15-minute response SLA), SEV-2 (Degraded core service functionality; 1-hour SLA), SEV-3 (Minor non-customer-facing issue; 4-hour SLA), and SEV-4 (Low impact bug; next business day). Post-mortems are mandatory within 72 hours for SEV-1 and SEV-2 incidents.",
    keywords: "incident response, sev-1, sev-2, sla, post-mortem, security incident, on-call",
  },
  {
    title: "Product Architecture: Cost Optimization & Caching Strategies",
    category: "Product & Engineering",
    content: "ObserveAI employs semantic caching via Redis vector embeddings. Cached queries with cosine similarity > 0.94 bypass LLM generation, reducing p95 latency to < 80ms and cutting monthly token spend by an estimated 38%. Prompt compression algorithms remove stop words and boilerplate from context before feeding models.",
    keywords: "semantic cache, cost optimization, prompt compression, redis, token spend, caching",
  },
];

export const MODEL_PRICES_SEED = [
  {
    model: "gpt-4o",
    displayName: "GPT-4o (Omni)",
    provider: "OpenAI",
    inputPricePer1m: 2.50,
    outputPricePer1m: 10.00,
  },
  {
    model: "claude-3-5-sonnet",
    displayName: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    inputPricePer1m: 3.00,
    outputPricePer1m: 15.00,
  },
  {
    model: "llama-3-3-70b",
    displayName: "Llama 3.3 70B Instruct",
    provider: "Meta / Groq",
    inputPricePer1m: 0.59,
    outputPricePer1m: 0.79,
  },
];

export const EVAL_DATASET_SEED = [
  {
    category: "HR",
    question: "What are the core synchronous hours required for remote employees at ObserveCorp?",
    referenceAnswer: "Core synchronous hours are 10:00 AM to 3:00 PM in the employee's designated team time zone.",
    expectedDocIds: [1],
  },
  {
    category: "HR",
    question: "How much is the onboarding remote work stipend and what is it for?",
    referenceAnswer: "The onboarding remote stipend is $500, provided for home office equipment.",
    expectedDocIds: [1],
  },
  {
    category: "HR",
    question: "Can an employee work abroad, and if so, for how many days per year?",
    referenceAnswer: "Yes, employees may work outside their country of employment for up to 30 consecutive business days per calendar year with prior manager approval.",
    expectedDocIds: [1],
  },
  {
    category: "HR",
    question: "How many days of paid time off (PTO) do full-time employees receive annually?",
    referenceAnswer: "Full-time exempt employees receive 25 days of accrued PTO annually.",
    expectedDocIds: [2],
  },
  {
    category: "HR",
    question: "How many unused PTO days can be rolled over, and when do they expire?",
    referenceAnswer: "Up to 5 unused PTO days can be rolled over into the next calendar year, expiring on March 31st.",
    expectedDocIds: [2],
  },
  {
    category: "HR",
    question: "What is the paid parental leave policy at ObserveCorp?",
    referenceAnswer: "ObserveCorp offers 16 weeks of fully paid parental leave for all new parents after 6 months of continuous service, to be taken within 12 months.",
    expectedDocIds: [3],
  },
  {
    category: "HR",
    question: "How much paid family caregiver leave is available for employees caring for ill family?",
    referenceAnswer: "Employees can take up to 4 weeks of paid family caregiver leave for ill immediate family members.",
    expectedDocIds: [3],
  },
  {
    category: "HR",
    question: "What is the annual learning and professional development budget per employee?",
    referenceAnswer: "Every employee receives an annual $2,000 Professional Development Budget for conferences, books, certification exams, and courses.",
    expectedDocIds: [4],
  },
  {
    category: "Security",
    question: "What password manager and MFA requirements are enforced for corporate access?",
    referenceAnswer: "ObserveCorp requires 1Password for password storage and Okta Multi-Factor Authentication (MFA) with FIDO2 hardware keys or Okta FastPass.",
    expectedDocIds: [5],
  },
  {
    category: "Security",
    question: "What are the rules for accessing Slack and Jira on a personal mobile phone?",
    referenceAnswer: "Personal mobile access requires enrolling in the MDM container, a 6-digit biometric PIN, an updated OS without root/jailbreak, and permission for remote wipe.",
    expectedDocIds: [6],
  },
  {
    category: "Security",
    question: "How are engineers permitted to access production AWS and GCP instances?",
    referenceAnswer: "Direct static SSH is prohibited. Engineers must use Teleport zero-trust access with short-lived certificates tied to Okta SSO groups.",
    expectedDocIds: [7],
  },
  {
    category: "Security",
    question: "What is the policy regarding inputting company data into public AI platforms like ChatGPT?",
    referenceAnswer: "Only enterprise-approved LLM tools may be used. Inputting customer PII or production secrets into unvetted public AI platforms is a critical compliance violation.",
    expectedDocIds: [8],
  },
  {
    category: "Architecture",
    question: "What are the 5 modular stages of ObserveAI's RAG pipeline?",
    referenceAnswer: "The 5 stages are: Query Processing, Vector Search, Context Reranking & Retrieval, LLM Generation, and Response Post-Processing.",
    expectedDocIds: [9],
  },
  {
    category: "Architecture",
    question: "At what latency threshold are requests flagged for bottleneck analysis?",
    referenceAnswer: "Slow requests exceeding 1,500ms are flagged for bottleneck analysis to identify which stage dominates total latency.",
    expectedDocIds: [10],
  },
  {
    category: "Architecture",
    question: "What 4 core metrics does the LLM-as-a-judge evaluation framework calculate?",
    referenceAnswer: "The framework computes Retrieval Recall@k, Answer Relevance (0-1), Groundedness/Faithfulness (0-1), and Context Precision.",
    expectedDocIds: [11],
  },
  {
    category: "Engineering",
    question: "What is the 3-tier canary roll-out schedule for production deployments?",
    referenceAnswer: "Canary roll-out stages are 5% of traffic for 15 minutes, 25% for 30 minutes, and then 100% full rollout.",
    expectedDocIds: [12],
  },
  {
    category: "Engineering",
    question: "What metrics trigger an automated rollback during a canary deployment?",
    referenceAnswer: "Automated rollbacks trigger if error rates exceed 1.0% or p95 latency degrades by more than 25% compared to the 24-hour moving average.",
    expectedDocIds: [12],
  },
  {
    category: "Finance",
    question: "What is the daily meal per diem for domestic and international business travel?",
    referenceAnswer: "The daily meal per diem is $85 for domestic travel and $115 for international travel.",
    expectedDocIds: [13],
  },
  {
    category: "Finance",
    question: "What receipt threshold and deadline apply to expense reports submitted via Expensify?",
    referenceAnswer: "Receipts are mandatory for all transactions over $25, and reports must be submitted within 30 days.",
    expectedDocIds: [13],
  },
  {
    category: "Security",
    question: "What is the response SLA for a SEV-1 critical outage or security breach?",
    referenceAnswer: "SEV-1 incidents have a 15-minute response SLA, with a mandatory post-mortem within 72 hours.",
    expectedDocIds: [14],
  },
  {
    category: "Architecture",
    question: "How does ObserveAI's semantic caching reduce latency and token spend?",
    referenceAnswer: "Cached queries with cosine similarity > 0.94 bypass LLM generation, reducing p95 latency to < 80ms and cutting monthly token spend by ~38%.",
    expectedDocIds: [15],
  },
  {
    category: "HR",
    question: "How many paid sick days do employees get each year?",
    referenceAnswer: "Employees receive 10 dedicated paid sick days per year, separate from their 25 PTO days.",
    expectedDocIds: [2],
  },
  {
    category: "Security",
    question: "How long can a break-glass production database session last before auto-expiring?",
    referenceAnswer: "Break-glass database sessions have an automatic 2-hour session expiration with session recording.",
    expectedDocIds: [7],
  },
  {
    category: "HR",
    question: "Does unused learning budget roll over to the following fiscal year?",
    referenceAnswer: "No, the $2,000 professional development budget does not roll over across fiscal years.",
    expectedDocIds: [4],
  },
  {
    category: "Engineering",
    question: "What disk encryption is mandatory on ObserveCorp company laptops?",
    referenceAnswer: "FileVault disk encryption must be maintained at all times on managed company MacBooks and ThinkPads.",
    expectedDocIds: [5],
  },
  {
    category: "Security",
    question: "What is the incident response SLA for a SEV-2 degraded service issue?",
    referenceAnswer: "SEV-2 incidents have a 1-hour response SLA.",
    expectedDocIds: [14],
  },
  {
    category: "HR",
    question: "How many paid days of bereavement leave are granted for immediate family members?",
    referenceAnswer: "Bereavement leave grants up to 5 paid days for immediate family members.",
    expectedDocIds: [2],
  },
  {
    category: "Architecture",
    question: "What OpenTelemetry span attributes are recorded during RAG request execution?",
    referenceAnswer: "Spans record start_ms, duration_ms, token counts, model parameters, retrieved chunk IDs, and similarity scores.",
    expectedDocIds: [10],
  },
  {
    category: "Architecture",
    question: "What technique does ObserveAI use to prevent context overflow before calling the LLM?",
    referenceAnswer: "Prompt compression algorithms remove stop words and boilerplate from context before feeding models.",
    expectedDocIds: [15],
  },
  {
    category: "Security",
    question: "What minimum password length is required by ObserveCorp IT policy?",
    referenceAnswer: "Passwords must contain at least 16 characters and pass entropy checks.",
    expectedDocIds: [5],
  },
];

export const ALERT_RULES_SEED = [
  {
    id: "rule_latency_p95",
    metric: "latency_p95",
    displayName: "P95 Latency Spike",
    threshold: 1800,
    comparison: "gt",
    unit: "ms",
    windowMinutes: 15,
    cooldownMinutes: 30,
    enabled: true,
  },
  {
    id: "rule_error_rate",
    metric: "error_rate",
    displayName: "Error Rate Burst",
    threshold: 4.5,
    comparison: "gt",
    unit: "%",
    windowMinutes: 15,
    cooldownMinutes: 30,
    enabled: true,
  },
  {
    id: "rule_hourly_cost",
    metric: "cost_hourly",
    displayName: "Hourly Cost Anomaly",
    threshold: 1.50,
    comparison: "gt",
    unit: "$",
    windowMinutes: 60,
    cooldownMinutes: 60,
    enabled: true,
  },
  {
    id: "rule_groundedness_drop",
    metric: "quality_groundedness",
    displayName: "Groundedness / Quality Drop",
    threshold: 0.82,
    comparison: "lt",
    unit: "score",
    windowMinutes: 60,
    cooldownMinutes: 60,
    enabled: true,
  },
  {
    id: "rule_hallucination_spike",
    metric: "hallucination_rate",
    displayName: "Hallucination Rate Spike",
    threshold: 12.0,
    comparison: "gt",
    unit: "%",
    windowMinutes: 60,
    cooldownMinutes: 60,
    enabled: true,
  },
];

// Master Seeding Function
export async function seedInitialData() {
  // Check if documents already exist
  const existingDocs = await db.select({ count: sql<number>`count(*)` }).from(documents);
  const docCount = Number(existingDocs[0]?.count || 0);

  if (docCount === 0) {
    console.log("Seeding built-in documents with real embeddings...");
    const embedded = await embedTexts(SAMPLE_DOCUMENTS.map((d) => `${d.title}\n${d.content}`));
    for (let i = 0; i < SAMPLE_DOCUMENTS.length; i++) {
      const doc = SAMPLE_DOCUMENTS[i];
      await db.insert(documents).values({
        ...doc,
        source: "builtin",
        chunkIndex: 0,
        tokenCount: Math.ceil(doc.content.length / 4),
        embedding: embedded.vectors[i],
        embeddingModel: embedded.model,
      });
    }
  }

  // Backfill embeddings for any document chunk missing a vector
  const missingEmbeddings = await db
    .select()
    .from(documents)
    .where(sql`${documents.embedding} is null`)
    .limit(200);

  if (missingEmbeddings.length) {
    console.log(`Backfilling ${missingEmbeddings.length} chunk embeddings...`);
    const res = await embedTexts(missingEmbeddings.map((d) => `${d.title}\n${d.content}`));
    for (let i = 0; i < missingEmbeddings.length; i++) {
      await db
        .update(documents)
        .set({ embedding: res.vectors[i], embeddingModel: res.model })
        .where(sql`${documents.id} = ${missingEmbeddings[i].id}`);
    }
  }

  // Seed model prices
  for (const mp of MODEL_PRICES_SEED) {
    await db.insert(modelPrices).values(mp).onConflictDoUpdate({
      target: modelPrices.model,
      set: {
        displayName: mp.displayName,
        provider: mp.provider,
        inputPricePer1m: mp.inputPricePer1m,
        outputPricePer1m: mp.outputPricePer1m,
      },
    });
  }

  // Seed alert rules
  for (const rule of ALERT_RULES_SEED) {
    await db.insert(alertRules).values(rule).onConflictDoNothing();
  }

  // Seed eval dataset if empty
  const existingEval = await db.select({ count: sql<number>`count(*)` }).from(evalDataset);
  if (Number(existingEval[0]?.count || 0) === 0) {
    console.log("Seeding eval dataset...");
    for (const item of EVAL_DATASET_SEED) {
      await db.insert(evalDataset).values(item);
    }
  }

  // Seed realistic historical requests (350+ requests spanning the last 24-48 hours)
  const existingReqs = await db.select({ count: sql<number>`count(*)` }).from(requests);
  if (Number(existingReqs[0]?.count || 0) < 50) {
    console.log("Generating 350 seeded historical telemetry requests with incidents...");
    await generateHistoricalRequests();
  }

  // Seed historical evaluation runs if empty
  const existingRuns = await db.select({ count: sql<number>`count(*)` }).from(evaluationRuns);
  if (Number(existingRuns[0]?.count || 0) === 0) {
    console.log("Generating seeded evaluation runs...");
    await generateHistoricalEvalRuns();
  }

  // Seed initial alerts
  const existingAlerts = await db.select({ count: sql<number>`count(*)` }).from(alerts);
  if (Number(existingAlerts[0]?.count || 0) === 0) {
    console.log("Generating seeded alerts...");
    await generateHistoricalAlerts();
  }
}

async function generateHistoricalRequests() {
  const models = ["gpt-4o", "claude-3-5-sonnet", "llama-3-3-70b"];
  const promptVersions = ["v1.2-prod", "v1.1-legacy", "v2.0-experimental"];
  const stages = ["query_processing", "vector_search", "retrieval", "llm_generation", "response"];
  
  const sampleQueries = [
    "What are the core hours for remote employees in UTC-5?",
    "How do I request an equipment stipend for my home monitor?",
    "What is the maximum PTO rollover policy into Q1?",
    "Can I work remotely from Spain for 3 weeks this summer?",
    "How does Teleport zero trust replace static SSH keys in prod?",
    "What is the daily per diem for an on-site client visit in Chicago?",
    "How do I report a SEV-1 incident if Okta SSO is down?",
    "What is our policy on using personal iPads for Slack and Gmail?",
    "Can I spend my learning budget on an AWS Solutions Architect certificate?",
    "Explain the RAG pipeline stages and OpenTelemetry span structure.",
    "What causes high latency in the vector search HNSW index?",
    "What is the canary deployment policy before 100% rollout?",
    "Who approves break-glass production database access tickets?",
    "How many weeks of paid leave do adoptive parents receive?",
    "What password requirements must 1Password enforce?",
  ];

  const now = Date.now();
  const totalCount = 380;

  for (let i = 0; i < totalCount; i++) {
    // Spread requests over the last 36 hours
    const minutesAgo = (totalCount - i) * 5 + Math.floor(Math.random() * 5);
    const reqTimestamp = new Date(now - minutesAgo * 60 * 1000);
    const reqId = `req_${Math.random().toString(36).substring(2, 10)}_${i}`;

    // Select model with weighted distribution (GPT-4o: 50%, Sonnet: 30%, Llama: 20%)
    const modelRand = Math.random();
    const model = modelRand < 0.5 ? "gpt-4o" : (modelRand < 0.8 ? "claude-3-5-sonnet" : "llama-3-3-70b");
    const promptVersion = i % 10 === 0 ? "v2.0-experimental" : (i % 6 === 0 ? "v1.1-legacy" : "v1.2-prod");
    const query = sampleQueries[i % sampleQueries.length];

    // Injected Incidents:
    // Incident 1: Latency spike between 180 and 220 iterations ago
    const isLatencySpike = i >= 180 && i <= 215;
    // Incident 2: Error burst between 90 and 110 iterations ago
    const isErrorBurst = i >= 95 && i <= 112;
    // Incident 3: Cost spike with very long prompt between 280 and 310
    const isCostSpike = i >= 280 && i <= 305;

    let status = "success";
    let errorType: string | null = null;
    let errorMessage: string | null = null;

    if (isErrorBurst && Math.random() < 0.65) {
      status = Math.random() < 0.5 ? "error" : "timeout";
      errorType = status === "timeout" ? "upstream_timeout" : (Math.random() < 0.5 ? "rate_limit" : "context_length_exceeded");
      errorMessage = errorType === "upstream_timeout" ? "Upstream provider read timeout after 15000ms" : (errorType === "rate_limit" ? "Rate limit reached: 429 Too Many Requests" : "Context token limit exceeded");
    } else if (Math.random() < 0.02) {
      // Base normal error rate ~2%
      status = "error";
      errorType = "upstream_timeout";
      errorMessage = "Gateway timeout connecting to upstream model API";
    }

    // Determine latency per stage
    let queryProcMs = Math.floor(15 + Math.random() * 20);
    let vectorSearchMs = Math.floor(35 + Math.random() * 45);
    let retrievalMs = Math.floor(20 + Math.random() * 30);
    let llmGenMs = model === "gpt-4o" ? Math.floor(450 + Math.random() * 400) : (model === "claude-3-5-sonnet" ? Math.floor(550 + Math.random() * 500) : Math.floor(220 + Math.random() * 250));
    let responseMs = Math.floor(10 + Math.random() * 15);

    if (isLatencySpike) {
      // Spike caused specifically by vector_search degrading due to unindexed vector scan
      vectorSearchMs += Math.floor(1400 + Math.random() * 1600);
      llmGenMs += Math.floor(300 + Math.random() * 400);
    }

    let inputTokens = isCostSpike ? Math.floor(4500 + Math.random() * 3500) : Math.floor(320 + Math.random() * 380);
    let outputTokens = status === "success" ? Math.floor(180 + Math.random() * 260) : 0;

    const totalLatency = queryProcMs + vectorSearchMs + retrievalMs + llmGenMs + responseMs;

    // Bottleneck stage calculation
    const stageDurations: Record<string, number> = {
      query_processing: queryProcMs,
      vector_search: vectorSearchMs,
      retrieval: retrievalMs,
      llm_generation: llmGenMs,
      response: responseMs,
    };
    let bottleneck = "llm_generation";
    let maxDur = 0;
    for (const [s, d] of Object.entries(stageDurations)) {
      if (d > maxDur) {
        maxDur = d;
        bottleneck = s;
      }
    }

    // Cost calculation
    const priceTable: Record<string, { in: number; out: number }> = {
      "gpt-4o": { in: 2.50, out: 10.00 },
      "claude-3-5-sonnet": { in: 3.00, out: 15.00 },
      "llama-3-3-70b": { in: 0.59, out: 0.79 },
    };
    const p = priceTable[model] || { in: 2.0, out: 8.0 };
    const costUsd = Number(((inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out).toFixed(6));

    const retrievedDocIds = [((i % 15) + 1), (((i + 2) % 15) + 1)];
    const simulatedAnswer = status === "success" 
      ? `Based on ObserveCorp policies, here is the verified guidance: ${query.includes("PTO") ? "You receive 25 days PTO annually with 5 days rollover." : query.includes("remote") ? "Core hours are 10 AM to 3 PM with a $500 home office stipend." : "Please refer to section 4 of the official policy handbook."}`
      : null;

    // Insert Request
    await db.insert(requests).values({
      id: reqId,
      createdAt: reqTimestamp,
      queryRedacted: query,
      rawQuery: query,
      model,
      promptVersion,
      status,
      errorType,
      errorMessage,
      latencyMs: totalLatency,
      inputTokens,
      outputTokens,
      estimatedCostUsd: costUsd,
      answer: simulatedAnswer,
      retrievedDocIds,
      bottleneckStage: bottleneck,
    });

    // Insert Spans
    let currentStart = 0;
    const spanStages = [
      { name: "query_processing", dur: queryProcMs, attrs: { step: "pii_redaction", tokens_in: inputTokens } },
      { name: "vector_search", dur: vectorSearchMs, attrs: { top_k: 5, index_type: "hnsw", similarity_metric: "cosine" } },
      { name: "retrieval", dur: retrievalMs, attrs: { docs_retrieved: retrievedDocIds, scores: [0.89, 0.81] } },
      { name: "llm_generation", dur: llmGenMs, attrs: { model, prompt_version: promptVersion, tokens_out: outputTokens } },
      { name: "response", dur: responseMs, attrs: { status, cached: false } },
    ];

    for (const span of spanStages) {
      await db.insert(spans).values({
        id: `span_${Math.random().toString(36).substring(2, 10)}`,
        requestId: reqId,
        stage: span.name,
        startMs: currentStart,
        durationMs: span.dur,
        attributes: span.attrs,
        createdAt: reqTimestamp,
      });
      currentStart += span.dur;
    }
  }
}

async function generateHistoricalEvalRuns() {
  const models = ["gpt-4o", "claude-3-5-sonnet", "llama-3-3-70b"];
  const now = Date.now();

  const evalConfigs = [
    { model: "gpt-4o", version: "v1.2-prod", daysAgo: 3, scores: { retrievalRecall: 0.96, answerRelevance: 0.94, groundedness: 0.95, contextPrecision: 0.92, hallucinationRate: 2.1, avgLatencyMs: 680, totalCostUsd: 0.142 } },
    { model: "claude-3-5-sonnet", version: "v1.2-prod", daysAgo: 2, scores: { retrievalRecall: 0.97, answerRelevance: 0.96, groundedness: 0.97, contextPrecision: 0.94, hallucinationRate: 1.4, avgLatencyMs: 740, totalCostUsd: 0.185 } },
    { model: "llama-3-3-70b", version: "v1.2-prod", daysAgo: 1, scores: { retrievalRecall: 0.91, answerRelevance: 0.89, groundedness: 0.88, contextPrecision: 0.86, hallucinationRate: 6.8, avgLatencyMs: 380, totalCostUsd: 0.024 } },
    // Incident 4: Drop in quality scores run (v2.0-experimental with degraded prompt)
    { model: "gpt-4o", version: "v2.0-experimental", daysAgo: 0.2, scores: { retrievalRecall: 0.95, answerRelevance: 0.81, groundedness: 0.74, contextPrecision: 0.79, hallucinationRate: 14.8, avgLatencyMs: 650, totalCostUsd: 0.138 } },
  ];

  const evalDocs = await db.select().from(evalDataset).limit(30);

  for (let i = 0; i < evalConfigs.length; i++) {
    const config = evalConfigs[i];
    const runId = `run_${Math.random().toString(36).substring(2, 9)}_${i}`;
    const runTime = new Date(now - config.daysAgo * 24 * 60 * 60 * 1000);

    await db.insert(evaluationRuns).values({
      id: runId,
      createdAt: runTime,
      model: config.model,
      promptVersion: config.version,
      datasetSize: evalDocs.length || 30,
      scores: config.scores,
      status: "completed",
    });

    // Populate question-level results for the latest runs
    for (let qIdx = 0; qIdx < evalDocs.length; qIdx++) {
      const q = evalDocs[qIdx];
      const isHallucinating = config.scores.hallucinationRate > 10 && (qIdx % 4 === 0);
      const hitRate = Math.min(1.0, 0.9 + Math.random() * 0.1);
      const relScore = Number((config.scores.answerRelevance + (Math.random() * 0.1 - 0.05)).toFixed(2));
      const groundScore = isHallucinating ? 0.52 : Number((config.scores.groundedness + (Math.random() * 0.08 - 0.04)).toFixed(2));

      await db.insert(evaluationResults).values({
        id: `eval_res_${Math.random().toString(36).substring(2, 9)}_${qIdx}`,
        runId,
        questionId: q.id,
        question: q.question,
        generatedAnswer: `Evaluation response generated by ${config.model}: ${q.referenceAnswer}`,
        retrievedDocIds: q.expectedDocIds,
        expectedDocIds: q.expectedDocIds,
        scores: {
          hitRate,
          relevance: relScore,
          groundedness: groundScore,
          contextPrecision: Number((config.scores.contextPrecision + (Math.random() * 0.06 - 0.03)).toFixed(2)),
          hallucination: isHallucinating,
          reasoning: isHallucinating 
            ? "Generated claims regarding policy exclusions were not grounded in the retrieved policy chunks."
            : "All factual statements correspond directly to retrieved reference context without contradictions.",
        },
        createdAt: runTime,
      });
    }
  }
}

async function generateHistoricalAlerts() {
  const now = Date.now();
  const seededAlerts = [
    {
      id: "alt_p95_spike_1",
      type: "latency_spike",
      severity: "critical",
      metric: "latency_p95",
      value: 2680.0,
      threshold: 1800.0,
      status: "active",
      title: "P95 Latency Exceeded 1,800ms",
      message: "P95 latency breached threshold reaching 2,680ms. Bottleneck analysis indicates 76% of latency spent in 'vector_search' stage during HNSW recalculation.",
      emailSent: false,
      createdAt: new Date(now - 45 * 60 * 1000), // 45 mins ago
    },
    {
      id: "alt_error_burst_1",
      type: "error_burst",
      severity: "critical",
      metric: "error_rate",
      value: 6.8,
      threshold: 4.5,
      status: "resolved",
      title: "Upstream Error Burst (429 & Timeouts)",
      message: "Upstream provider rate limit reached 6.8% of requests. Automatic retry and fallbacks restored error rate below 1.2%.",
      emailSent: false,
      createdAt: new Date(now - 14 * 60 * 60 * 1000), // 14 hours ago
    },
    {
      id: "alt_quality_drop_1",
      type: "quality_drop",
      severity: "warning",
      metric: "quality_groundedness",
      value: 0.74,
      threshold: 0.82,
      status: "active",
      title: "Groundedness Score Dropped on Prompt v2.0-experimental",
      message: "Groundedness score plunged to 0.74 (threshold 0.82) with hallucination rate elevated to 14.8% on v2.0-experimental prompt template.",
      emailSent: false,
      createdAt: new Date(now - 2 * 60 * 60 * 1000), // 2 hours ago
    },
    {
      id: "alt_cost_anomaly_1",
      type: "cost_anomaly",
      severity: "warning",
      metric: "cost_hourly",
      value: 1.84,
      threshold: 1.50,
      status: "resolved",
      title: "Hourly Spend Anomaly Detected",
      message: "Hourly token cost peaked at $1.84/hr driven by uncompressed context chunks averaging 6,800 tokens.",
      emailSent: false,
      createdAt: new Date(now - 26 * 60 * 60 * 1000), // 26 hours ago
    },
  ];

  for (const alt of seededAlerts) {
    await db.insert(alerts).values(alt).onConflictDoNothing();
  }
}
