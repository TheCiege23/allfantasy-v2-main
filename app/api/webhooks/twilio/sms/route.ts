import { NextResponse, type NextRequest } from 'next/server'
import twilio from 'twilio'

import { prisma } from '@/lib/prisma'
import { getBaseUrl } from '@/lib/get-base-url'
import { signedUrlCandidates, twimlResponse } from '@/lib/sms/inboundSms'
import { handleInboundSms } from '@/lib/sms/inboundSmsHandler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Twilio "A message comes in" webhook (2026-11-15). Point the AllFantasy number's — or its Messaging
 * Service's — incoming-message webhook here, as an HTTP POST:
 *   https://allfantasy.ai/api/webhooks/twilio/sms
 *
 * 🛑 EVERY REQUEST MUST CARRY A VALID `X-Twilio-Signature`. It is an HMAC of the URL and the form fields
 * under the account's Auth Token, so nobody else can post a fake STOP to switch a member's texts off, or a
 * START to switch them back on. Without `TWILIO_AUTH_TOKEN` there is no way to check it, so the route
 * refuses everything (503) rather than trusting the caller. An API key cannot verify it; only the Auth
 * Token can.
 *
 * Never logs the number or the message.
 */
function xml(body: string, status = 200): NextResponse {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  if (!authToken) {
    console.error('[sms-inbound] TWILIO_AUTH_TOKEN is not set, so incoming texts cannot be verified; refusing')
    return new NextResponse('Not configured', { status: 503 })
  }

  const raw = await req.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v

  const signature = req.headers.get('x-twilio-signature') ?? ''
  const url = new URL(req.url)
  const candidates = signedUrlCandidates({
    configured: process.env.TWILIO_INBOUND_WEBHOOK_URL,
    forwardedHost: req.headers.get('x-forwarded-host'),
    host: req.headers.get('host'),
    forwardedProto: req.headers.get('x-forwarded-proto'),
    appBaseUrl: getBaseUrl(),
    pathAndQuery: `${url.pathname}${url.search}`,
  })
  const verified = signature !== '' && candidates.some((u) => twilio.validateRequest(authToken, signature, u, params))
  if (!verified) {
    console.warn('[sms-inbound] refused a request whose Twilio signature did not verify', { tried: candidates.length })
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const result = await handleInboundSms(
      { from: params.From ?? '', body: params.Body ?? '', optOutType: params.OptOutType ?? null },
      { db: prisma, baseUrl: getBaseUrl() },
    )
    return xml(twimlResponse(result.reply))
  } catch (err) {
    // Answer Twilio with an empty response either way: a 500 makes it retry and fire its error alerts.
    console.error('[sms-inbound] failed to handle an incoming text', err instanceof Error ? err.message : 'unknown')
    return xml(twimlResponse(null))
  }
}
