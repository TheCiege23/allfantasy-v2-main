import { withApiUsage } from "@/lib/telemetry/usage";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isUndeliverableEmailDomain } from "@/lib/email/undeliverableDomains";
import { emailSchema, sanitizeString } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { getResendClient } from "@/lib/resend-client";
import { getEarlyAccessWelcomeEmailV2 } from "@/lib/email-templates/early-access-welcome";
import { getBaseUrl } from "@/lib/get-base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = (process.env.EARLY_ACCESS_SYNC_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const isAllowed = origin && allowed.includes(origin);

  if (!isAllowed || !origin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-early-access-sync-secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Handle a B2B demo request from the "AllFantasy for business" band.
 *
 * ⚠ FOLDED INTO THIS ROUTE RATHER THAN GIVEN ITS OWN. The repo is at Vercel's hard
 * 2048-route ceiling, and this is the closest existing match: public, unauthenticated,
 * rate-limited lead capture that stores a row and notifies us. It is a distinct branch
 * with its own table, not a reuse of the waitlist row — see BusinessDemoRequest for why.
 *
 * ⚠ THE EMAIL IS SENT EVEN IF THE INSERT FAILS, AND THE ORDER MATTERS. A demo request
 * is a person with buying intent who now believes we have heard them; the unacceptable
 * outcome is silence. So a database failure degrades to "email only" instead of a 500,
 * and the caller is told the truth in `stored` / `notified`. It only errors when BOTH
 * paths failed, because only then has the lead genuinely been lost.
 */
async function handleBusinessDemo(
  request: NextRequest,
  body: Record<string, unknown> | null,
  ctx: { ip: string; userAgent?: string; referrer?: string; corsHeaders: Record<string, string> }
) {
  const { userAgent, referrer, corsHeaders } = ctx;

  const parsed = emailSchema.safeParse({ email: body?.email });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Enter a valid work email." },
      { status: 400, headers: corsHeaders }
    );
  }

  const email = sanitizeString(parsed.data.email).toLowerCase();
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? sanitizeString(v).slice(0, max) : null;

  const company = str(body?.company, 120);
  const name = str(body?.name, 100);
  const useCase = str(body?.useCase, 2000);
  const referrerPage = str(body?.referrer, 500);

  let stored = false;
  let storeError: string | null = null;
  let rowId: string | null = null;

  try {
    const row = await prisma.businessDemoRequest.create({
      data: {
        email,
        company,
        name,
        useCase,
        source: "allfantasy.ai",
        referrer: referrerPage,
        utmSource: str(body?.utm_source, 200),
        utmMedium: str(body?.utm_medium, 200),
        utmCampaign: str(body?.utm_campaign, 200),
        utmContent: str(body?.utm_content, 200),
        utmTerm: str(body?.utm_term, 200),
      },
      select: { id: true },
    });
    stored = true;
    rowId = row.id;
  } catch (e) {
    // Swallowed on purpose — the notification below is what actually reaches a
    // human, and it must go out regardless. P2021 (table missing, i.e. migration
    // not yet applied) lands here too.
    storeError = getErrorMessage(e);
    console.error("[B2B] Failed to store demo request:", storeError);
  }

  let notified = false;
  try {
    const { client, fromEmail } = getResendClient();
    const from =
      fromEmail.trim() && !fromEmail.toLowerCase().includes("@gmail.com")
        ? fromEmail
        : "AllFantasy <noreply@allfantasy.ai>";

    await client.emails.send({
      from,
      to: "allfantasysportsapp@gmail.com",
      // Reply goes to the buyer, not to us — otherwise answering a lead means
      // copying an address out of the body by hand.
      replyTo: email,
      subject: `Demo request — ${company || email}`,
      html: `<div style="font-family:sans-serif;padding:20px;">
<h2 style="margin:0 0 12px;">New demo request</h2>
${name ? `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` : ""}
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
${company ? `<p><strong>Company:</strong> ${escapeHtml(company)}</p>` : ""}
${useCase ? `<p><strong>What they'd build:</strong><br>${escapeHtml(useCase).replace(/\n/g, "<br>")}</p>` : ""}
${referrerPage ? `<p><strong>Referrer:</strong> ${escapeHtml(referrerPage)}</p>` : ""}
${
  stored
    ? ""
    : `<p style="color:#b00;"><strong>⚠ NOT SAVED TO THE DATABASE.</strong> This email is the only
       record of this lead — ${escapeHtml(storeError || "unknown error")}</p>`
}
<p style="color:#888;font-size:12px;">Received ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>
</div>`,
      text: `New demo request\nEmail: ${email}\nCompany: ${company || "—"}\n\n${useCase || ""}${
        stored ? "" : `\n\n*** NOT SAVED TO DATABASE — this email is the only record. ***`
      }`,
    });
    notified = true;

    if (rowId) {
      // Records that a human was actually told. A row with notifiedAt still NULL
      // is a lead nobody has seen, which is the state worth alerting on.
      await prisma.businessDemoRequest
        .update({ where: { id: rowId }, data: { notifiedAt: new Date() } })
        .catch(() => {});
    }
  } catch (e) {
    console.error("[B2B] Failed to notify on demo request:", getErrorMessage(e));
  }

  await prisma.analyticsEvent
    .create({
      data: {
        event: "signup",
        toolKey: "business_demo_request",
        path: "/api/early-access",
        userAgent,
        referrer,
        meta: { email, company, stored, notified, storeError },
      },
    })
    .catch(() => {});

  if (!stored && !notified) {
    // Both paths failed, so the request really is gone. Say so, rather than
    // showing a success state to someone we can no longer contact.
    return NextResponse.json(
      { error: "We could not record your request. Please email allfantasysportsapp@gmail.com." },
      { status: 500, headers: corsHeaders }
    );
  }

  return NextResponse.json({ ok: true, stored, notified }, { headers: corsHeaders });
}

export const POST = withApiUsage({
  endpoint: "/api/early-access",
  tool: "EarlyAccess",
})(async (request: NextRequest) => {
  const ip = getIp(request);
  const userAgent = request.headers.get("user-agent") || undefined;
  const referrer = request.headers.get("referer") || undefined;
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const syncSecretHeader = request.headers.get("x-early-access-sync-secret");
  const syncSecretEnv = (process.env.EARLY_ACCESS_SYNC_SECRET || "").trim();
  const isSyncAttempt = Boolean(syncSecretHeader);
  const isValidSync = isSyncAttempt && syncSecretEnv && syncSecretHeader === syncSecretEnv;

  try {
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: corsHeaders }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | {
          email?: string;
          name?: string;
          source?: string;
          utm_source?: string;
          utm_medium?: string;
          utm_campaign?: string;
          utm_content?: string;
          utm_term?: string;
          referrer?: string;
          suppressEmail?: boolean;
          kind?: string;
          company?: string;
          useCase?: string;
        }
      | null;

    // B2B demo requests share this route's rate limit, CORS and telemetry but
    // nothing else — different table, different notification, different response.
    if (body?.kind === "business-demo") {
      return await handleBusinessDemo(request, body as Record<string, unknown>, {
        ip,
        userAgent,
        referrer,
        corsHeaders,
      });
    }

    const result = emailSchema.safeParse({ email: body?.email });
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0]?.message || "Invalid email" },
        { status: 400, headers: corsHeaders }
      );
    }

    const email = sanitizeString(result.data.email).toLowerCase();
    const signupName =
      typeof body?.name === "string"
        ? sanitizeString(body.name).slice(0, 100)
        : null;

    const incomingSourceRaw =
      typeof body?.source === "string" ? body.source : undefined;
    const source = sanitizeString(incomingSourceRaw || "allfantasy.ai");

    const utmSource =
      typeof body?.utm_source === "string"
        ? sanitizeString(body.utm_source)
        : null;
    const utmMedium =
      typeof body?.utm_medium === "string"
        ? sanitizeString(body.utm_medium)
        : null;
    const utmCampaign =
      typeof body?.utm_campaign === "string"
        ? sanitizeString(body.utm_campaign)
        : null;
    const utmContent =
      typeof body?.utm_content === "string"
        ? sanitizeString(body.utm_content)
        : null;
    const utmTerm =
      typeof body?.utm_term === "string"
        ? sanitizeString(body.utm_term)
        : null;
    const pageReferrer =
      typeof body?.referrer === "string"
        ? sanitizeString(body.referrer)
        : null;

    const suppressEmail =
      body?.suppressEmail === true ||
      (isValidSync && source === "allfantasysportsapp.net");

    const effectiveSource = isValidSync ? source : "allfantasy.ai";

    if (isSyncAttempt && !isValidSync) {
      await prisma.analyticsEvent.create({
        data: {
          event: "tool_use",
          toolKey: "early_access_sync_rejected",
          path: "/api/early-access",
          userAgent,
          referrer,
          meta: {
            email,
            ip,
            origin: origin || null,
            reason: !syncSecretEnv
              ? "missing_server_secret"
              : "invalid_header_secret",
          },
        },
      });

      return NextResponse.json(
        { error: "Unauthorized sync request." },
        { status: 401, headers: corsHeaders }
      );
    }

    const existing = await prisma.earlyAccessSignup.findUnique({
      where: { email },
      select: { email: true, createdAt: true },
    });

    if (existing) {
      await prisma.analyticsEvent.create({
        data: {
          event: "signup",
          path: "/api/early-access",
          userAgent,
          referrer,
          toolKey: isValidSync ? "early_access_sync" : "early_access_signup",
          meta: {
            email,
            ip,
            alreadyExists: true,
            source: effectiveSource,
          },
        },
      });

      return NextResponse.json(
        { ok: true, alreadyExists: true, emailSent: false },
        { headers: corsHeaders }
      );
    }

    /*
     * ⚠ SAME RESERVED-DOMAIN GUARD AS THE REGISTER MIRROR. This endpoint is
     * public and e2e suites post to it directly, so it is the other way test
     * addresses reach the marketing list. Answered as a normal success, with the
     * same body the real path returns, so a test asserting a 200 still passes —
     * the row simply is not written.
     *
     * Returning here also skips the owner-notification email below, which is
     * the point: every e2e signup currently mails
     * allfantasysportsapp@gmail.com a "New Early Access Signup" alert for an
     * address that does not exist.
     */
    if (isUndeliverableEmailDomain(email)) {
      return NextResponse.json(
        { ok: true, alreadyExists: false, emailSent: false },
        { headers: corsHeaders }
      );
    }

    await prisma.earlyAccessSignup.create({
      data: {
        email,
        name: signupName,
        source: effectiveSource,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        referrer: pageReferrer,
      },
    });

    await prisma.analyticsEvent.create({
      data: {
        event: "signup",
        path: "/api/early-access",
        userAgent,
        referrer,
        toolKey: isValidSync ? "early_access_sync" : "early_access_signup",
        meta: {
          email,
          ip,
          alreadyExists: false,
          source: effectiveSource,
          suppressEmail,
          origin: origin || null,
        },
      },
    });

    try {
      const adSource = utmSource
        ? utmSource.toLowerCase().includes("meta") ||
          utmSource.toLowerCase().includes("facebook") ||
          utmSource.toLowerCase().includes("instagram")
          ? "Meta"
          : utmSource.toLowerCase().includes("google")
          ? "Google"
          : utmSource
        : "Direct";

      const { client: notifClient, fromEmail: notifFrom } = getResendClient();
      const notifFromAddr =
        notifFrom.trim() && !notifFrom.toLowerCase().includes("@gmail.com")
          ? notifFrom
          : "AllFantasy <noreply@allfantasy.ai>";

      await notifClient.emails.send({
        from: notifFromAddr,
        to: "allfantasysportsapp@gmail.com",
        subject: `New Early Access Signup - ${adSource}`,
        html: `<div style="font-family:sans-serif;padding:20px;">
<h2 style="margin:0 0 12px;">New Early Access Signup</h2>
${signupName ? `<p><strong>Name:</strong> ${escapeHtml(signupName)}</p>` : ""}
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Ad Source:</strong> ${escapeHtml(adSource)}</p>
${utmCampaign ? `<p><strong>Campaign:</strong> ${escapeHtml(utmCampaign)}</p>` : ""}
${utmMedium ? `<p><strong>Medium:</strong> ${escapeHtml(utmMedium)}</p>` : ""}
${utmContent ? `<p><strong>Content:</strong> ${escapeHtml(utmContent)}</p>` : ""}
${pageReferrer ? `<p><strong>Referrer:</strong> ${escapeHtml(pageReferrer)}</p>` : ""}
<p><strong>Source Site:</strong> ${escapeHtml(effectiveSource)}</p>
<p style="color:#888;font-size:12px;">Signed up at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>
</div>`,
        text: `New Early Access Signup\nEmail: ${email}\nAd Source: ${adSource}\nSource Site: ${effectiveSource}`,
      });
    } catch (notifError) {
      console.error(`[EMAIL] Failed to send admin notification for ${email}:`, notifError);
    }

    let emailSent = false;
    let emailErrorMsg: string | null = null;

    if (!suppressEmail) {
      try {
        const { client, fromEmail } = getResendClient();

        const baseUrl = getBaseUrl();
        const { subject, html, text } = getEarlyAccessWelcomeEmailV2({
          email,
          baseUrl,
        });

        const from =
          fromEmail.trim() && !fromEmail.toLowerCase().includes("@gmail.com")
            ? fromEmail
            : "AllFantasy <noreply@allfantasy.ai>";

        const resp = await client.emails.send({
          from,
          to: email,
          subject,
          html,
          text,
        });

        if ("error" in resp && resp.error) {
          throw new Error(resp.error.message || "Resend send error");
        }

        emailSent = true;

        await prisma.analyticsEvent.create({
          data: {
            event: "tool_use",
            toolKey: "early_access_welcome_email_sent",
            path: "/api/early-access",
            userAgent,
            referrer,
            meta: {
              email,
              from,
              effectiveSource,
              referrer: pageReferrer,
            },
          },
        });
      } catch (emailError) {
        emailErrorMsg = getErrorMessage(emailError);

        await prisma.analyticsEvent.create({
          data: {
            event: "tool_use",
            toolKey: "early_access_welcome_email_failed",
            path: "/api/early-access",
            userAgent,
            referrer,
            meta: {
              email,
              error: emailErrorMsg,
            },
          },
        });
      }
    } else {
      await prisma.analyticsEvent.create({
        data: {
          event: "tool_use",
          toolKey: "early_access_welcome_email_suppressed",
          path: "/api/early-access",
          userAgent,
          referrer,
          meta: {
            email,
            source: effectiveSource,
            reason: "legacy_sync_or_requested",
          },
        },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        alreadyExists: false,
        emailSent,
        ...(process.env.NODE_ENV !== "production" && emailErrorMsg
          ? { emailError: emailErrorMsg }
          : {}),
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Early access error:", error);

    try {
      await prisma.analyticsEvent.create({
        data: {
          event: "tool_use",
          toolKey: "early_access_signup_failed",
          path: "/api/early-access",
          userAgent,
          referrer,
          meta: { ip, error: getErrorMessage(error) },
        },
      });
    } catch {}

    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500, headers: corsHeaders }
    );
  }
});