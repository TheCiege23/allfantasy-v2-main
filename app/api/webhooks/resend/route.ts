/**
 * Resend webhook receiver — email delivery events
 *
 * Resend delivers webhooks via Svix. Each delivery includes three signature headers:
 *   svix-id        — unique message ID (our idempotency key)
 *   svix-timestamp — Unix seconds; we reject payloads older than 5 minutes
 *   svix-signature — space-separated list of "v1,<base64sig>" signatures
 *
 * Signature algorithm (no external library required — Node crypto built-in):
 *   signedContent  = `${svixId}.${svixTimestamp}.${rawBody}`
 *   key            = base64Decode(RESEND_WEBHOOK_SECRET.replace("whsec_", ""))
 *   expectedSig    = HMAC-SHA256(signedContent, key) → base64
 *   match any "v1,<sig>" in svix-signature where sig === expectedSig
 *
 * Events handled:
 *   email.sent, email.delivered                 → logged only
 *   email.bounced, email.complained,
 *   email.failed, email.delivery_delayed        → logged + persisted to resend_email_events
 *
 * PII policy:
 *   - Recipient emails are masked in logs (first char + domain TLD only)
 *   - Recipient (to/from) fields are stripped from the stored payload
 *   - Secrets/tokens are never logged
 */

import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyResendSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): boolean {
  // Timestamp tolerance: reject events older or newer than 5 minutes
  const ts = parseInt(svixTimestamp, 10)
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    console.warn("[webhooks/resend] Rejected: timestamp out of tolerance")
    return false
  }

  // Decode the webhook secret (strip "whsec_" prefix, then base64-decode)
  const secretBase64 = secret.startsWith("whsec_") ? secret.slice(6) : secret
  let keyBytes: Buffer
  try {
    keyBytes = Buffer.from(secretBase64, "base64")
  } catch {
    console.error("[webhooks/resend] Webhook secret is not valid base64")
    return false
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const expectedSigB64 = createHmac("sha256", keyBytes)
    .update(signedContent, "utf8")
    .digest("base64")
  const expectedBuf = Buffer.from(expectedSigB64)

  // svix-signature may contain multiple signatures separated by spaces:
  //   "v1,aGVsbG8= v1,d29ybGQ="
  for (const part of svixSignature.split(" ")) {
    const comma = part.indexOf(",")
    if (comma < 0) continue
    const version = part.slice(0, comma)
    const sigB64 = part.slice(comma + 1)
    if (version !== "v1" || !sigB64) continue

    const sigBuf = Buffer.from(sigB64) // safe even if not valid base64
    if (expectedBuf.length !== sigBuf.length) continue // timingSafeEqual requires same length

    try {
      if (timingSafeEqual(expectedBuf, sigBuf)) return true
    } catch {
      // Shouldn't happen after the length check, but be defensive
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function maskEmail(addr: string | undefined): string {
  if (!addr || typeof addr !== "string") return "[none]"
  const at = addr.indexOf("@")
  if (at <= 0) return "[masked]"
  const domain = addr.slice(at + 1)
  const lastDot = domain.lastIndexOf(".")
  const tld = lastDot >= 0 ? domain.slice(lastDot) : ""
  return `${addr.slice(0, 1)}***@***${tld}`
}

// ---------------------------------------------------------------------------
// Payload sanitisation — strip PII before storage
// ---------------------------------------------------------------------------

function sanitizePayload(data: Record<string, unknown>): Record<string, unknown> {
  // Remove recipient and sender email addresses from stored payload.
  // Keep diagnostic fields: bounce/complaint/delay reason, timestamps, tags.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { to: _to, from: _from, ...rest } = data as Record<string, unknown>
  return rest
}

// ---------------------------------------------------------------------------
// Event dispatch
// ---------------------------------------------------------------------------

// Events that warrant durable storage (actionable delivery failures)
const DURABLE_EVENTS = new Set([
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.delivery_delayed",
])

type ResendWebhookPayload = {
  type?: string
  created_at?: string
  data?: Record<string, unknown>
}

async function handleEvent(
  eventType: string,
  data: Record<string, unknown>,
  svixId: string
): Promise<void> {
  const messageId =
    typeof data.email_id === "string" ? data.email_id : ""

  const recipients: string[] = Array.isArray(data.to)
    ? (data.to as string[]).filter((x): x is string => typeof x === "string")
    : []
  const masked = maskEmail(recipients[0])

  console.log(
    `[webhooks/resend] type=${eventType} messageId=${messageId || "(none)"} to=${masked}`
  )

  /*
   * ⚠ SUPPRESSION HAPPENS HERE, WHILE WE STILL HOLD THE ADDRESS. The stored
   * payload deliberately strips recipients (PII policy) — which previously
   * meant bounce data could never feed the send path, and known-dead
   * addresses were mailed forever. Instead of persisting the address, act on
   * it now: a hard bounce or complaint flips the EmailPreference row to
   * fully unsubscribed, which the trade blast and marketing paths honor.
   */
  if (eventType === "email.bounced" || eventType === "email.complained") {
    for (const addr of recipients) {
      await prisma.emailPreference
        .upsert({
          where: { email: addr },
          create: {
            email: addr,
            productUpdates: false,
            tradeAlerts: false,
            weeklyDigest: false,
            unsubscribedAt: new Date(),
          },
          update: {
            productUpdates: false,
            tradeAlerts: false,
            weeklyDigest: false,
            unsubscribedAt: new Date(),
          },
        })
        .catch((err: unknown) => {
          console.error(
            `[webhooks/resend] Failed to suppress ${maskEmail(addr)} after ${eventType}:`,
            err instanceof Error ? err.message : String(err)
          )
        })
    }
  }

  if (!DURABLE_EVENTS.has(eventType)) {
    // Informational events (sent/delivered) — log only, no DB write needed
    return
  }

  if (!svixId || !messageId) {
    console.warn(
      `[webhooks/resend] Skipping persistence for ${eventType}: missing svixId or messageId`
    )
    return
  }

  const sanitized = sanitizePayload(data)

  try {
    await (prisma as any).resendEmailEvent.upsert({
      where: { svixId },
      // If the same svix delivery arrives twice, ignore the duplicate
      update: {},
      create: {
        svixId,
        messageId,
        eventType,
        payload: sanitized,
      },
    })
    console.log(
      `[webhooks/resend] Persisted ${eventType} for messageId=${messageId}`
    )
  } catch (err) {
    // Log but do not re-throw — returning 200 tells Resend not to retry.
    // If the table doesn't exist yet (migration pending), events are still
    // logged above; they become durable once the migration is applied.
    console.error(
      `[webhooks/resend] Failed to persist ${eventType} for messageId=${messageId}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? ""

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // Missing secret in production is a misconfiguration — return 500 so
      // Resend keeps retrying until we fix the env var.
      console.error("[webhooks/resend] RESEND_WEBHOOK_SECRET is not configured")
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 500 }
      )
    }
    // In development/test, proceed without signature verification and log a warning.
    console.warn(
      "[webhooks/resend] RESEND_WEBHOOK_SECRET not set — skipping signature check (dev mode)"
    )
  }

  // Read the raw body BEFORE any JSON parsing so the signature covers
  // exactly the same bytes Resend signed.
  const rawBody = await req.text()

  if (secret) {
    const svixId = req.headers.get("svix-id") ?? ""
    const svixTimestamp = req.headers.get("svix-timestamp") ?? ""
    const svixSignature = req.headers.get("svix-signature") ?? ""

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.warn("[webhooks/resend] Missing Svix headers")
      return NextResponse.json({ error: "Missing webhook headers" }, { status: 400 })
    }

    const valid = verifyResendSignature(
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      secret
    )
    if (!valid) {
      console.warn(
        `[webhooks/resend] Signature verification failed (svix-id=${svixId})`
      )
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }
  }

  let payload: ResendWebhookPayload
  try {
    payload = JSON.parse(rawBody) as ResendWebhookPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const eventType =
    typeof payload.type === "string" && payload.type.length > 0
      ? payload.type
      : "unknown"

  const data: Record<string, unknown> =
    payload.data != null && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {}

  const svixIdForStorage = req.headers.get("svix-id") ?? ""

  // Unknown event types: log + 200 (don't 400 — that would cause Resend to retry forever)
  const KNOWN_EVENTS = new Set([
    "email.sent",
    "email.delivered",
    "email.bounced",
    "email.complained",
    "email.delivery_delayed",
    "email.failed",
  ])

  if (!KNOWN_EVENTS.has(eventType)) {
    console.log(`[webhooks/resend] Unrecognised event type: ${eventType} — ignoring`)
    return NextResponse.json({ ok: true })
  }

  await handleEvent(eventType, data, svixIdForStorage)

  return NextResponse.json({ ok: true })
}
