import { NextResponse } from "next/server"
import { z } from "zod"
import { captureLeagueSafeEmail } from "@/lib/leaguesafe/capture"
import {
  getLeagueSafeInboundConfig, InboundBodyTooLarge, readLeagueSafeRequestBody,
  verifyLeagueSafeSignature, LS_SIGNATURE_WINDOW_SECONDS,
} from "@/lib/leaguesafe/inbound-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const envelopeSchema = z.object({
  messageId: z.string().regex(/^[a-f0-9]{1,64}$/),
  receivedAt: z.string().datetime(),
  rawBody: z.string().min(1).refine((value) => !value.includes("\u0000")),
}).strict()

const respond = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const config = getLeagueSafeInboundConfig()
  if (!config) return respond({ error: "LeagueSafe inbound is not configured" }, 503)
  const timestamp = request.headers.get("x-ls-timestamp")
  const signature = request.headers.get("x-ls-signature")
  if (!timestamp || !/^\d{10}$/.test(timestamp) ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > LS_SIGNATURE_WINDOW_SECONDS ||
      !signature || !/^v1=[a-f0-9]{64}$/i.test(signature)) {
    console.warn("[leaguesafe] request_rejected", { reason: "unsigned_or_expired" })
    return respond({ error: "Invalid or expired signature" }, 401)
  }
  try {
    const body = await readLeagueSafeRequestBody(request)
    if (!verifyLeagueSafeSignature(body, timestamp, signature, config.secret)) {
      console.warn("[leaguesafe] request_rejected", { reason: "invalid_signature" })
      return respond({ error: "Invalid or expired signature" }, 401)
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return respond({ error: "Expected application/json" }, 415)
    }
    let decoded: unknown
    try { decoded = JSON.parse(body.toString("utf8")) }
    catch { return respond({ error: "Invalid JSON" }, 400) }
    const result = envelopeSchema.safeParse(decoded)
    if (!result.success) return respond({ error: "Invalid capture envelope" }, 400)
    const captured = await captureLeagueSafeEmail(result.data, config.domains)
    // Stored DKIM rejections are terminal receipts too; the admin can inspect them.
    return respond({ ok: true, stored: true, ...captured }, captured.duplicate ? 200 : 202)
  } catch (error) {
    if (error instanceof InboundBodyTooLarge) return respond({ error: "Email exceeds the 2 MiB request limit" }, 413)
    console.error("[leaguesafe] capture_failed")
    return respond({ error: "Capture failed; retry later" }, 500)
  }
}
