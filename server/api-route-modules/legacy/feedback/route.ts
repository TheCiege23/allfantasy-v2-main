import { withApiUsage } from "@/lib/telemetry/usage"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getResendClient } from "@/lib/resend-client";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { SUPPORT_WIDGET_TOOL } from "@/lib/support/support-widget";

const feedbackSchema = z.object({
  feedbackType: z.string().min(1),
  tool: z.string().min(1),
  feedbackText: z.string().min(1).max(5000),
  stepsToReproduce: z.string().max(2000).nullable().optional(),
  pageUrl: z.string().max(500).nullable().optional(),
  rating: z.number().min(1).max(5).nullable().optional(),
  importance: z.string().max(50).nullable().optional(),
  wasLoggedIn: z.boolean().nullable().optional(),
  device: z.string().max(50).nullable().optional(),
  browser: z.string().max(50).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  canContact: z.boolean().optional(),
  userId: z.string().max(100).nullable().optional(),
  sleeperUsername: z.string().max(100).nullable().optional(),
  screenshotUrl: z.string().max(500).nullable().optional(),
  screenshotMeta: z.string().max(500).nullable().optional(),
});

async function runAiTriage(feedback: {
  feedbackType: string;
  tool: string;
  feedbackText: string;
  stepsToReproduce: string | null;
}) {
  try {
    const openai = getOpenAIRouteClient()
    
    const prompt = `You are an AI assistant helping triage bug reports and feedback for a fantasy sports application called AllFantasy. Analyze the following feedback and provide a structured triage.

Feedback Type: ${feedback.feedbackType}
Tool/Area: ${feedback.tool}
User Description: ${feedback.feedbackText}
${feedback.stepsToReproduce ? `Steps to Reproduce: ${feedback.stepsToReproduce}` : ""}

Please provide:
1. A brief summary (1-2 sentences max)
2. Category (one of: UI, Auth, API, Data, Performance, UX, Feature, Other)
3. Severity (one of: Low, Medium, High, Critical)
4. Clean reproduction steps (if applicable, reformat user's steps into clear numbered steps)
5. Suspected cause (brief, if determinable)
6. Suggested fix (brief, if applicable)

Respond in JSON format:
{
  "summary": "...",
  "category": "...",
  "severity": "...",
  "reproSteps": "...",
  "suspectedCause": "...",
  "suggestedFix": "..."
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content);
  } catch (err) {
    console.error("AI triage error:", err);
    return null;
  }
}

function getAdminNotificationEmailHtml(data: {
  id: string;
  feedbackType: string;
  tool: string;
  feedbackText: string;
  screenshotUrl: string | null;
  email: string | null;
  sleeperUsername: string | null;
  pageUrl: string | null;
  aiTriage: {
    summary: string;
    category: string;
    severity: string;
    reproSteps: string;
    suspectedCause: string;
    suggestedFix: string;
  } | null;
}) {
  const severityColor = data.aiTriage?.severity === "Critical" ? "#ef4444" :
    data.aiTriage?.severity === "High" ? "#f97316" :
    data.aiTriage?.severity === "Medium" ? "#eab308" : "#22c55e";

  const severityEmoji = data.aiTriage?.severity === "Critical" ? "🚨" :
    data.aiTriage?.severity === "High" ? "⚠️" :
    data.aiTriage?.severity === "Medium" ? "📋" : "ℹ️";

  const typeLabel = {
    like: "👍 Positive Feedback",
    bug: "🐞 Bug Report",
    feature: "💡 Feature Request",
    confusing: "😕 UX Issue",
    wrong: "⚠️ Something Wrong",
    general: "💬 General Feedback",
    support: "🛟 Support Message",
  }[data.feedbackType] || data.feedbackType;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; padding: 32px; border: 1px solid #334155; }
    .header { text-align: center; margin-bottom: 24px; }
    .logo { font-size: 24px; font-weight: bold; background: linear-gradient(90deg, #22d3ee, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .severity-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }
    .info-box { background: rgba(0, 0, 0, 0.3); border-radius: 12px; padding: 16px; margin: 16px 0; }
    .info-row { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #94a3b8; font-size: 12px; text-transform: uppercase; }
    .info-value { color: #f1f5f9; margin-top: 4px; }
    .ai-box { background: rgba(168, 85, 247, 0.1); border-left: 3px solid #a855f7; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0; }
    .cta { display: block; text-align: center; background: linear-gradient(90deg, #22d3ee, #a855f7); color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: 600; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">AllFantasy Admin</div>
      <h2 style="margin: 8px 0; color: #f1f5f9;">${severityEmoji} New ${typeLabel}</h2>
      <div class="severity-badge" style="background: ${severityColor}20; color: ${severityColor};">
        ${data.aiTriage?.severity || "Unknown"} Severity
      </div>
    </div>
    
    <div class="info-box">
      <div class="info-row">
        <div class="info-label">Tool / Area</div>
        <div class="info-value">${data.tool}</div>
      </div>
      ${data.pageUrl ? `
      <div class="info-row">
        <div class="info-label">Page URL</div>
        <div class="info-value" style="font-size: 12px; word-break: break-all;">${data.pageUrl}</div>
      </div>
      ` : ""}
      <div class="info-row">
        <div class="info-label">User</div>
        <div class="info-value">${data.sleeperUsername || data.email || "Anonymous"}</div>
      </div>
    </div>

    <div class="info-box">
      <div class="info-label">User Description</div>
      <div class="info-value" style="margin-top: 8px; white-space: pre-wrap;">${data.feedbackText}</div>
    </div>

    ${data.screenshotUrl ? `
    <div class="info-box">
      <div class="info-label">Screenshot</div>
      <div class="info-value" style="margin-top: 8px;">
        <a href="https://allfantasy.ai${data.screenshotUrl}" style="color: #22d3ee;">View Screenshot</a>
      </div>
    </div>
    ` : ""}

    ${data.aiTriage ? `
    <div class="ai-box">
      <div style="color: #a855f7; font-weight: 600; margin-bottom: 12px;">🤖 AI Triage Summary</div>
      
      <div style="margin-bottom: 12px;">
        <div class="info-label">Summary</div>
        <div class="info-value">${data.aiTriage.summary}</div>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        <div>
          <div class="info-label">Category</div>
          <div class="info-value">${data.aiTriage.category}</div>
        </div>
        <div>
          <div class="info-label">Severity</div>
          <div class="info-value" style="color: ${severityColor};">${data.aiTriage.severity}</div>
        </div>
      </div>

      ${data.aiTriage.reproSteps ? `
      <div style="margin-bottom: 12px;">
        <div class="info-label">Reproduction Steps</div>
        <div class="info-value" style="white-space: pre-wrap;">${data.aiTriage.reproSteps}</div>
      </div>
      ` : ""}

      ${data.aiTriage.suspectedCause ? `
      <div style="margin-bottom: 12px;">
        <div class="info-label">Suspected Cause</div>
        <div class="info-value">${data.aiTriage.suspectedCause}</div>
      </div>
      ` : ""}

      ${data.aiTriage.suggestedFix ? `
      <div>
        <div class="info-label">Suggested Fix</div>
        <div class="info-value">${data.aiTriage.suggestedFix}</div>
      </div>
      ` : ""}
    </div>
    ` : ""}
    
    <a href="https://allfantasy.ai/admin?tab=feedback" class="cta">Open in Admin → Issue #${data.id.slice(-6)}</a>
  </div>
</body>
</html>
`;
}

function getConfirmationEmailHtml(feedbackType: string, tool: string) {
  const typeLabel = {
    like: "positive feedback",
    bug: "bug report",
    feature: "feature request",
    confusing: "UX feedback",
    wrong: "issue report",
    general: "feedback",
    support: "a message",
  }[feedbackType] || "feedback";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; padding: 32px; border: 1px solid #334155; }
    .header { text-align: center; margin-bottom: 24px; }
    .logo { font-size: 28px; font-weight: bold; background: linear-gradient(90deg, #22d3ee, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .check { display: inline-block; width: 64px; height: 64px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 50%; line-height: 64px; text-align: center; font-size: 32px; margin: 16px 0; }
    .message { color: #f1f5f9; font-size: 16px; line-height: 1.6; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">AllFantasy.ai</div>
    </div>
    
    <div style="text-align: center;">
      <div class="check">✓</div>
      <h2 style="margin: 8px 0; color: #4ade80;">Thanks for your feedback!</h2>
    </div>
    
    <div class="message">
      ${
        tool === SUPPORT_WIDGET_TOOL
          ? `<p>Thanks for reaching out — we got your message and it's been sent directly to the AllFantasy team.</p>
      <p>We'll follow up at this address soon.</p>`
          : `<p>Thanks for sharing ${typeLabel} about the <strong>${tool}</strong> tool. We've received it and it's been sent directly to the AllFantasy team.</p>
      <p>If we need clarification and you opted into follow-up, we'll reach out.</p>`
      }
      <p>We appreciate you helping us improve the platform.</p>
    </div>
    
    <div class="footer">
      <p style="color: #22d3ee;">– AllFantasy Team</p>
    </div>
  </div>
</body>
</html>
`;
}

export const POST = withApiUsage({ endpoint: "/api/legacy/feedback", tool: "LegacyFeedback" })(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = feedbackSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      return NextResponse.json(
        { error: firstError?.message || "Invalid feedback data" },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // This endpoint was previously ungated while writing a DB row, optionally calling OpenAI
    // (real cost), and sending up to two emails — so it was usable as a spam/cost amplifier.
    // Keyed on submitter + IP like app/api/user/contact/email/route.ts. 5 per 10 minutes is
    // generous enough that someone legitimately sending a second message is never blocked.
    const ip = getClientIp(request);
    const rateLimitSubject = data.userId || data.email || "anon";
    const rl = rateLimit(`legacy-feedback:${rateLimitSubject}:${ip}`, 5, 10 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many messages sent. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const feedback = await prisma.legacyFeedback.create({
      data: {
        feedbackType: data.feedbackType,
        tool: data.tool,
        feedbackText: data.feedbackText,
        stepsToReproduce: data.stepsToReproduce || null,
        pageUrl: data.pageUrl || null,
        rating: data.rating || null,
        importance: data.importance || null,
        wasLoggedIn: data.wasLoggedIn ?? null,
        device: data.device || null,
        browser: data.browser || null,
        email: data.email || null,
        canContact: data.canContact || false,
        userId: data.userId || null,
        sleeperUsername: data.sleeperUsername || null,
        screenshotUrl: data.screenshotUrl || null,
        screenshotMeta: data.screenshotMeta || null,
        status: "new",
      },
    });

    const isBugOrIssue = data.feedbackType === "bug" || data.feedbackType === "wrong";
    let aiTriage = null;

    if (isBugOrIssue) {
      aiTriage = await runAiTriage({
        feedbackType: data.feedbackType,
        tool: data.tool,
        feedbackText: data.feedbackText,
        stepsToReproduce: data.stepsToReproduce || null,
      });

      if (aiTriage) {
        await prisma.legacyFeedback.update({
          where: { id: feedback.id },
          data: {
            aiSummary: aiTriage.summary || null,
            aiCategory: aiTriage.category || null,
            aiSeverity: aiTriage.severity || null,
            aiReproSteps: aiTriage.reproSteps || null,
            aiSuspectedCause: aiTriage.suspectedCause || null,
            aiSuggestedFix: aiTriage.suggestedFix || null,
            aiTriagedAt: new Date(),
            priority: aiTriage.severity === "Critical" ? "p0" :
              aiTriage.severity === "High" ? "p1" :
              aiTriage.severity === "Medium" ? "p2" : "p3",
          },
        });
      }
    }

    try {
      const { client, fromEmail } = await getResendClient();

      if (data.email) {
        await client.emails.send({
          from: fromEmail,
          to: data.email,
          subject: "Thanks for your AllFantasy feedback!",
          html: getConfirmationEmailHtml(data.feedbackType, data.tool),
        });
      }

      const adminEmails = (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      if (adminEmails.length > 0 && (isBugOrIssue || data.importance === "blocking")) {
        const severityLabel = aiTriage?.severity || "Unknown";
        const shortTitle = (aiTriage?.summary || data.feedbackText).slice(0, 50);
        
        await client.emails.send({
          from: fromEmail,
          to: adminEmails,
          subject: `🐞 New Bug Report (${severityLabel}) — ${shortTitle}`,
          html: getAdminNotificationEmailHtml({
            id: feedback.id,
            feedbackType: data.feedbackType,
            tool: data.tool,
            feedbackText: data.feedbackText,
            screenshotUrl: data.screenshotUrl || null,
            email: data.email || null,
            sleeperUsername: data.sleeperUsername || null,
            pageUrl: data.pageUrl || null,
            aiTriage,
          }),
        });
      }
    } catch (emailErr) {
      console.error("Failed to send feedback emails:", emailErr);
    }

    // ── Support widget: a direct-contact channel, so it ALWAYS notifies ──────────────────
    // The per-tool block above only emails on `isBugOrIssue || importance === "blocking"`, which
    // means praise ("like") never reaches anyone. That gating is left untouched for the existing
    // widgets; support-widget submissions instead notify unconditionally — every time, regardless
    // of feedbackType or AI-triaged severity. That is the entire point of a direct line.
    //
    // Sent in its OWN try/catch: the block above shares one, so a throw while sending the user
    // confirmation (e.g. a bad recipient) would previously skip the notification entirely.
    //
    // Recipients come from SUPPORT_NOTIFICATION_EMAILS, deliberately NOT ADMIN_EMAILS. The latter
    // is a security allowlist, not a mailing list: it also grants /admin access (lib/auth/admin.ts)
    // and token-spend / entitlement bypass (lib/tokens/TokenSpendService.ts,
    // lib/subscription/entitlement-middleware.ts), so adding an address there just to receive
    // support mail would silently escalate that account's privileges.
    if (data.tool === SUPPORT_WIDGET_TOOL) {
      const supportEmails = (process.env.SUPPORT_NOTIFICATION_EMAILS || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      if (supportEmails.length === 0) {
        // Loud, because the message is now only visible in the admin dashboard.
        console.error(
          "[feedback] SUPPORT_NOTIFICATION_EMAILS is not set — support message stored but NOT emailed:",
          feedback.id
        );
      } else {
        try {
          const { client, fromEmail } = await getResendClient();
          const shortTitle = data.feedbackText.slice(0, 60);
          await client.emails.send({
            from: fromEmail,
            to: supportEmails,
            subject: `🛟 Support message — ${shortTitle}`,
            html: getAdminNotificationEmailHtml({
              id: feedback.id,
              feedbackType: data.feedbackType,
              tool: data.tool,
              feedbackText: data.feedbackText,
              screenshotUrl: data.screenshotUrl || null,
              email: data.email || null,
              sleeperUsername: data.sleeperUsername || null,
              pageUrl: data.pageUrl || null,
              aiTriage,
            }),
          });
        } catch (supportErr) {
          console.error("[feedback] Failed to send support notification:", supportErr);
        }
      }
    }

    return NextResponse.json({ success: true, id: feedback.id });
  } catch (err) {
    console.error("Feedback submission error:", err);
    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 }
    );
  }
})
