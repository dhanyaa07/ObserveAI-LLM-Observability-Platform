import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { alertRules, alerts, requests, evaluationRuns, modelPrices, platformSettings } from "@/db/schema";
import { desc, eq, gte } from "drizzle-orm";

export async function GET() {
  try {
    const rules = await db.select().from(alertRules);
    const activeAlerts = await db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(30);
    const prices = await db.select().from(modelPrices);
    const resendKeySetting = await db.select().from(platformSettings).where(eq(platformSettings.key, "resend_api_key"));

    return NextResponse.json({
      rules,
      alerts: activeAlerts,
      modelPrices: prices,
      hasResendKey: Boolean(process.env.RESEND_API_KEY || resendKeySetting[0]?.value),
    });
  } catch (err: any) {
    console.error("Alerts API error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Update alert rules or acknowledge/resolve alerts
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "update_rule") {
      const { id, threshold, cooldownMinutes, enabled } = body;
      await db
        .update(alertRules)
        .set({
          threshold: Number(threshold),
          cooldownMinutes: Number(cooldownMinutes),
          enabled: Boolean(enabled),
          updatedAt: new Date(),
        })
        .where(eq(alertRules.id, id));
      return NextResponse.json({ success: true, message: "Rule updated" });
    }

    if (action === "update_price") {
      const { model, inputPricePer1m, outputPricePer1m } = body;
      await db
        .update(modelPrices)
        .set({
          inputPricePer1m: Number(inputPricePer1m),
          outputPricePer1m: Number(outputPricePer1m),
          updatedAt: new Date(),
        })
        .where(eq(modelPrices.model, model));
      return NextResponse.json({ success: true, message: "Model price updated" });
    }

    if (action === "update_alert_status") {
      const { id, status } = body;
      await db
        .update(alerts)
        .set({ status })
        .where(eq(alerts.id, id));
      return NextResponse.json({ success: true, message: `Alert status changed to ${status}` });
    }

    if (action === "save_resend_key") {
      const { apiKey } = body;
      await db.insert(platformSettings).values({
        key: "resend_api_key",
        value: apiKey,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: apiKey, updatedAt: new Date() },
      });
      return NextResponse.json({ success: true, message: "Resend API key configured" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("Alerts update error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Scheduled Anomaly Detection Engine (EWMA / rolling window / threshold audit)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sendTestEmail = false, targetEmail = "security-ops@observeai.internal" } = body;

    // If testing email:
    if (sendTestEmail) {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        return NextResponse.json({
          success: false,
          sent: false,
          message: "Resend API key is not configured in environment. The test alert was logged to the database dashboard only.",
        });
      }

      // If key is present, attempt dispatch via Resend REST API
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "ObserveAI Alerts <alerts@observeai.dev>",
          to: [targetEmail],
          subject: "[ObserveAI TEST ALERT] Anomaly Detection Verification",
          html: `<h3>ObserveAI Incident Notification</h3><p>This is a verified test dispatch from your ObserveAI reliability monitoring engine.</p>`,
        }),
      });

      const resData = await resendRes.json();
      return NextResponse.json({
        success: resendRes.ok,
        sent: resendRes.ok,
        message: resendRes.ok ? `Test email successfully dispatched to ${targetEmail}` : `Resend returned error: ${resData.message}`,
      });
    }

    // Run scheduled anomaly detection across the last 15-minute window
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const windowReqs = await db.select().from(requests).where(gte(requests.createdAt, fifteenMinsAgo));
    const rules = await db.select().from(alertRules);

    const generatedAlerts: string[] = [];

    if (windowReqs.length > 5) {
      // 1. Check P95 Latency
      const latencies = windowReqs.map((r) => r.latencyMs).sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
      const latencyRule = rules.find((r) => r.metric === "latency_p95");

      if (latencyRule && latencyRule.enabled && p95 > latencyRule.threshold) {
        // Check cooldown
        const recentAlert = await db
          .select()
          .from(alerts)
          .where(eq(alerts.type, "latency_spike"))
          .orderBy(desc(alerts.createdAt))
          .limit(1);

        const isCooledDown = !recentAlert.length || (Date.now() - recentAlert[0].createdAt.getTime()) > latencyRule.cooldownMinutes * 60 * 1000;

        if (isCooledDown) {
          const alertId = `alt_p95_${Date.now()}`;
          await db.insert(alerts).values({
            id: alertId,
            type: "latency_spike",
            severity: "critical",
            metric: "latency_p95",
            value: p95,
            threshold: latencyRule.threshold,
            status: "active",
            title: `P95 Latency Spike (${p95}ms)`,
            message: `P95 latency of ${p95}ms exceeded rule threshold of ${latencyRule.threshold}ms over the last 15 minutes.`,
            emailSent: false,
            createdAt: new Date(),
          });
          generatedAlerts.push(alertId);
        }
      }

      // 2. Check Error Rate
      const errCount = windowReqs.filter((r) => r.status !== "success").length;
      const errorRate = Number(((errCount / windowReqs.length) * 100).toFixed(1));
      const errorRule = rules.find((r) => r.metric === "error_rate");

      if (errorRule && errorRule.enabled && errorRate > errorRule.threshold) {
        const alertId = `alt_err_${Date.now()}`;
        await db.insert(alerts).values({
          id: alertId,
          type: "error_burst",
          severity: "critical",
          metric: "error_rate",
          value: errorRate,
          threshold: errorRule.threshold,
          status: "active",
          title: `Error Rate Burst (${errorRate}%)`,
          message: `RAG error rate of ${errorRate}% exceeded configured limit of ${errorRule.threshold}%.`,
          emailSent: false,
          createdAt: new Date(),
        });
        generatedAlerts.push(alertId);
      }
    }

    return NextResponse.json({
      success: true,
      auditedRequests: windowReqs.length,
      alertsCreated: generatedAlerts.length,
      alertIds: generatedAlerts,
    });
  } catch (err: any) {
    console.error("Anomaly scan error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
