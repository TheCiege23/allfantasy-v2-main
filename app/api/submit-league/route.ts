import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getResendClient } from "@/lib/resend-client";
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit";
import { getClientIp } from "@/lib/rate-limit";

/**
 * 🛑 THIS ROUTE IS PUBLIC AND SENDS MAIL FROM OUR DOMAIN TO AN ADDRESS THE CALLER TYPES.
 * Every caller-supplied value is escaped before it reaches HTML and stripped of line
 * breaks before it reaches a subject, or the form is a free branded phishing relay.
 * The per-recipient cap is what stops it being aimed at one victim's inbox.
 */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function subjectSafe(value: string): string {
  return String(value).replace(/[\r\n\t]+/g, " ").slice(0, 120);
}

const submissionSchema = z.object({
  leagueTypeName: z.string().min(1).max(200),
  tagline: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  sports: z.array(z.string()).min(1),
  recommendedSize: z.string().min(1),
  seasonFormat: z.string().min(1),
  draftType: z.string().min(1),
  winCondition: z.string().min(1),
  hasSpecialScoring: z.boolean(),
  scoringRules: z.string().max(2000).nullable().optional(),
  positionsImpacted: z.string().max(500).nullable().optional(),
  specialMechanics: z.array(z.string()).min(1),
  weeklyFlow: z.string().min(1).max(3000),
  edgeCases: z.string().max(2000).nullable().optional(),
  rosterSetup: z.string().max(500).nullable().optional(),
  waiverSystem: z.string().max(100).nullable().optional(),
  tradeRules: z.string().max(500).nullable().optional(),
  playoffSetup: z.string().max(500).nullable().optional(),
  commissionerTools: z.string().max(500).nullable().optional(),
  creditName: z.string().min(1).max(100),
  email: z.string().email().max(255),
  socialHandle: z.string().max(200).nullable().optional(),
  permissionConsent: z.literal(true),
  rightsConsent: z.literal(true),
  canContact: z.boolean().optional(),
});

type SubmissionData = z.infer<typeof submissionSchema>

function getConfirmationEmailHtml(data: {
  creditName: string;
  leagueTypeName: string;
  sports: string[];
  submittedAt: string;
}) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#0f172a; color:#e2e8f0; padding:20px;">
  <div style="max-width:600px; margin:0 auto; background:#111827; border-radius:14px; border:1px solid #334155; padding:24px;">
    <h2 style="margin:0 0 12px; color:#4ade80;">Submission Received \u2705</h2>
    <p>Hi ${esc(data.creditName)},</p>
    <p>Thanks for submitting your league idea to AllFantasy.</p>
    <p><strong>League:</strong> ${esc(data.leagueTypeName)}<br/><strong>Sports:</strong> ${esc(data.sports.join(", "))}<br/><strong>Submitted:</strong> ${esc(data.submittedAt)}</p>
    <p>Our team will review this and follow up if needed.</p>
  </div>
</body>
</html>
`;
}

function getAdminNotificationHtml(data: {
  leagueTypeName: string;
  creditName: string;
  email: string;
  sports: string[];
  hasSpecialScoring: boolean;
  permissionConsent: boolean;
  rightsConsent: boolean;
  canContact: boolean;
  documentMeta?: string | null;
}) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#0f172a; color:#e2e8f0; padding:20px;">
  <div style="max-width:620px; margin:0 auto; background:#111827; border-radius:14px; border:1px solid #334155; padding:24px;">
    <h2 style="margin:0 0 14px; color:#f8fafc;">New League Type Submission</h2>
    <p><strong>League Name:</strong> ${esc(data.leagueTypeName)}</p>
    <p><strong>Creator:</strong> ${esc(data.creditName)}</p>
    <p><strong>Email:</strong> ${esc(data.email)}</p>
    <p><strong>Sports:</strong> ${esc(data.sports.join(", "))}</p>
    <p><strong>Special Scoring:</strong> ${data.hasSpecialScoring ? "Yes" : "No"}</p>
    <p><strong>Permission:</strong> ${data.permissionConsent ? "Yes" : "No"} | <strong>Rights:</strong> ${data.rightsConsent ? "Yes" : "No"}</p>
    <p><strong>Can Contact:</strong> ${data.canContact ? "Yes" : "No"}</p>
    <p><strong>Attached document:</strong> ${esc(data.documentMeta || "None")}</p>
    <a href="https://allfantasy.ai/admin?tab=ideas" style="display:inline-block; margin-top:8px; background:#22d3ee; color:#001018; padding:10px 14px; border-radius:10px; text-decoration:none; font-weight:600;">Review in Admin Ideas</a>
  </div>
</body>
</html>
`;
}

async function parseSubmissionRequest(request: NextRequest): Promise<{ payload: SubmissionData | null; error?: string; documentMeta?: string | null }> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const leagueTypeName = String(form.get("leagueTypeName") || "").trim();
    const description = String(form.get("description") || "").trim();
    const scoringRules = String(form.get("scoringRules") || "").trim();
    const rulesSettings = String(form.get("rulesSettings") || "").trim();
    const draftType = String(form.get("draftType") || "snake").trim();
    const sport = String(form.get("sport") || "NFL").trim();
    const creditName = String(form.get("creditName") || "").trim();
    const email = String(form.get("email") || "").trim();
    const teamSize = String(form.get("teamSize") || "12").trim();

    const document = form.get("document") as File | null;
    const documentMeta = document && document.size > 0
      ? `${document.name} (${document.type || "unknown"}, ${Math.round(document.size / 1024)}KB)`
      : null;

    const payloadCandidate: SubmissionData = {
      leagueTypeName,
      tagline: `${sport} ${draftType} custom format`,
      description,
      sports: [sport],
      recommendedSize: teamSize || "12",
      seasonFormat: "Regular Season + Playoffs",
      draftType: draftType || "snake",
      winCondition: "Most points and playoff wins based on submitted rules",
      hasSpecialScoring: Boolean(scoringRules),
      scoringRules: scoringRules || null,
      positionsImpacted: null,
      specialMechanics: ["Legacy user-submitted format"],
      weeklyFlow: rulesSettings || description,
      edgeCases: null,
      rosterSetup: rulesSettings ? rulesSettings.slice(0, 450) : null,
      waiverSystem: null,
      tradeRules: null,
      playoffSetup: null,
      commissionerTools: documentMeta ? `Attached document: ${documentMeta}` : null,
      creditName,
      email,
      socialHandle: null,
      permissionConsent: true,
      rightsConsent: true,
      canContact: true,
    };

    const parsed = submissionSchema.safeParse(payloadCandidate);
    if (!parsed.success) {
      return { payload: null, error: parsed.error.errors[0]?.message || "Invalid submission data", documentMeta };
    }
    return { payload: parsed.data, documentMeta };
  }

  const body = await request.json();
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return { payload: null, error: parsed.error.errors[0]?.message || "Invalid submission data", documentMeta: null };
  }
  return { payload: parsed.data, documentMeta: null };
}

export const POST = withApiUsage({ endpoint: "/api/submit-league", tool: "SubmitLeague" })(async (request: NextRequest) => {
  try {
    const { payload, error, documentMeta } = await parseSubmissionRequest(request);

    if (!payload) {
      return NextResponse.json({ error: error || "Invalid submission data" }, { status: 400 });
    }

    const data = payload;

    const ipLimit = await consumeSharedRateLimit(`submit-league:ip:${getClientIp(request)}`, 5, 60 * 60);
    const recipientLimit = await consumeSharedRateLimit(
      `submit-league:to:${data.email.toLowerCase()}`,
      3,
      24 * 60 * 60,
    );
    if (!ipLimit.success || !recipientLimit.success) {
      return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429 });
    }

    const submission = await prisma.leagueTypeSubmission.create({
      data: {
        leagueTypeName: data.leagueTypeName,
        tagline: data.tagline,
        description: data.description,
        sports: data.sports,
        recommendedSize: data.recommendedSize,
        seasonFormat: data.seasonFormat,
        draftType: data.draftType,
        winCondition: data.winCondition,
        hasSpecialScoring: data.hasSpecialScoring,
        scoringRules: data.scoringRules || null,
        positionsImpacted: data.positionsImpacted || null,
        specialMechanics: data.specialMechanics,
        weeklyFlow: data.weeklyFlow,
        edgeCases: data.edgeCases || null,
        rosterSetup: data.rosterSetup || null,
        waiverSystem: data.waiverSystem || null,
        tradeRules: data.tradeRules || null,
        playoffSetup: data.playoffSetup || null,
        commissionerTools: data.commissionerTools || null,
        creditName: data.creditName,
        email: data.email.toLowerCase(),
        socialHandle: data.socialHandle || null,
        permissionConsent: data.permissionConsent,
        rightsConsent: data.rightsConsent,
        canContact: data.canContact || false,
        status: "received",
      },
    });

    try {
      const { client, fromEmail } = await getResendClient();
      const submittedAt = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      await client.emails.send({
        from: fromEmail,
        to: data.email,
        subject: `We received your AllFantasy league idea: ${subjectSafe(data.leagueTypeName)}`,
        html: getConfirmationEmailHtml({
          creditName: data.creditName,
          leagueTypeName: data.leagueTypeName,
          sports: data.sports,
          submittedAt,
        }),
      });

      const adminEmails = (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      if (adminEmails.length > 0) {
        await client.emails.send({
          from: fromEmail,
          to: adminEmails,
          subject: `New League Type Submission: ${subjectSafe(data.leagueTypeName)}`,
          html: getAdminNotificationHtml({
            leagueTypeName: data.leagueTypeName,
            creditName: data.creditName,
            email: data.email,
            sports: data.sports,
            hasSpecialScoring: data.hasSpecialScoring,
            permissionConsent: data.permissionConsent,
            rightsConsent: data.rightsConsent,
            canContact: data.canContact || false,
            documentMeta,
          }),
        });
      }
    } catch (emailErr) {
      console.error("Failed to send league submission emails:", emailErr);
    }

    return NextResponse.json({ success: true, id: submission.id });
  } catch (err) {
    console.error("League submission error:", err);
    return NextResponse.json({ error: "Failed to submit league idea" }, { status: 500 });
  }
})
