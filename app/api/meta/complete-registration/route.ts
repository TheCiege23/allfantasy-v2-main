import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from "next/server";
import { trackMetaServerEvent } from "@/lib/meta-capi";
import { prisma } from "@/lib/prisma";
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit";

/** How recently the early-access signup must have happened for its conversion to be reported. */
const SIGNUP_FRESHNESS_MS = 15 * 60 * 1000;

/*
 * 🛑 A CompleteRegistration CONVERSION CANNOT BE TAKEN BACK — it trains Meta's ad optimiser.
 * This route was public and reported whatever the caller sent, so anyone could pump fake
 * signups (with arbitrary custom_data and a test_event_code) into the optimiser. It now
 * reports only a REAL early-access signup — a row for this email created in the last few
 * minutes — at most once per email, and never with caller-supplied custom_data or a
 * test code in production.
 */
export const POST = withApiUsage({ endpoint: "/api/meta/complete-registration", tool: "MetaCompleteRegistration" })(async (req: Request) => {
  try {
    const body = await req.json();
    const {
      event_id,
      email,
      phone,
      fbp,
      fbc,
      test_event_code: rawTestEventCode,
      source_url,
    } = body ?? {};
    const test_event_code = process.env.NODE_ENV === "production" ? undefined : rawTestEventCode;

    if (!event_id || typeof event_id !== "string" || event_id.length > 100) {
      return NextResponse.json({ ok: false, error: "Missing event_id" }, { status: 400 });
    }

    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || normalizedEmail.length > 255) {
      return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });
    }

    const signup = await prisma.earlyAccessSignup.findUnique({
      where: { email: normalizedEmail },
      select: { createdAt: true },
    });
    if (!signup || Date.now() - signup.createdAt.getTime() > SIGNUP_FRESHNESS_MS) {
      // Not an error the visitor can act on, and not worth telling a prober which emails exist.
      return NextResponse.json({ ok: true, skipped: true });
    }

    const once = await consumeSharedRateLimit(`meta-complete-registration:${normalizedEmail}`, 1, 24 * 60 * 60);
    if (!once.success) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const result = await trackMetaServerEvent({
      eventName: "CompleteRegistration",
      eventId: event_id,
      email: normalizedEmail,
      phone,
      eventSourceUrl: source_url,
      fbp,
      fbc,
      customData: {
        content_name: "Account signup",
        content_category: "Registration",
      },
      testEventCode: typeof test_event_code === "string" ? test_event_code : null,
      request: req,
      source: "complete_registration_endpoint",
    });

    if (!result.capi.success) {
      console.error("Meta CAPI error:", result.capi.error);
      return NextResponse.json({ ok: false, error: result.capi.error, meta: result.capi.meta }, { status: 500 });
    }

    console.log("Meta CAPI CompleteRegistration sent:", event_id);
    return NextResponse.json({ ok: true, meta: result.capi.meta });
  } catch (e: any) {
    console.error("Meta CAPI error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
})
