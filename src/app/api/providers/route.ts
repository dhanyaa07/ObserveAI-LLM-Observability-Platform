import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { providerStatus, settingKeyFor, ProviderId, MODEL_CATALOGUE } from "@/lib/provider";
import { eq } from "drizzle-orm";

/** Returns which providers are configured — never returns the key itself. */
export async function GET() {
  const status = await providerStatus();
  const anyConfigured = status.some((s) => s.configured);
  return NextResponse.json({
    providers: status,
    models: MODEL_CATALOGUE.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      contextWindow: m.contextWindow,
      available: status.find((s) => s.provider === m.provider)?.configured || status.find((s) => s.provider === "openrouter")?.configured || false,
    })),
    liveMode: anyConfigured,
    engine: anyConfigured ? "provider" : "local-extractive",
  });
}

/** Saves a provider key server-side (platform_settings). Never echoed back. */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const provider = body.provider as ProviderId;
    const apiKey = (body.apiKey || "").toString().trim();

    const valid: ProviderId[] = ["openai", "anthropic", "groq", "openrouter"];
    if (!valid.includes(provider)) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    const key = settingKeyFor(provider);

    if (!apiKey) {
      await db.delete(platformSettings).where(eq(platformSettings.key, key));
      return NextResponse.json({ success: true, message: `${provider} key removed` });
    }

    await db
      .insert(platformSettings)
      .values({ key, value: apiKey, updatedAt: new Date() })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: apiKey, updatedAt: new Date() } });

    return NextResponse.json({ success: true, message: `${provider} key saved — live generation enabled` });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
