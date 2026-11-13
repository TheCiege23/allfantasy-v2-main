/**
 * Response + rate-limit helpers shared by every /api/demo/* route.
 */
import 'server-only'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { clientIpFromHeaders } from '@/lib/http/clientIp'
import { demoJsonBody, getDemoContext, type DemoContext } from './service'
import type { DemoUnavailable } from './types'

export const DEMO_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  // Anonymized, but still per-moment league data: never let a shared cache hold it.
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'X-AF-Demo': '1',
}

export function demoUnavailableResponse(u: DemoUnavailable): NextResponse {
  return new NextResponse(JSON.stringify(u), { status: u.reason === 'error' ? 503 : 404, headers: DEMO_RESPONSE_HEADERS })
}

/** Serialize through the redactor's final wall. A blocked body becomes a 503, never the body. */
export function demoResponse(ctx: DemoContext, body: unknown, status = 200): NextResponse {
  const out = demoJsonBody(ctx, body)
  if (!out.ok) {
    return new NextResponse(JSON.stringify({ demo: true, available: false, reason: 'error' }), { status: 503, headers: DEMO_RESPONSE_HEADERS })
  }
  return new NextResponse(out.text, { status, headers: DEMO_RESPONSE_HEADERS })
}

export function demoError(status: number, error: string): NextResponse {
  return new NextResponse(JSON.stringify({ demo: true, error }), { status, headers: DEMO_RESPONSE_HEADERS })
}

/** Per-IP limiter. Returns a 429 response when over the limit, else null. */
export function demoRateLimit(req: Request, bucket: string, max: number, windowMs: number): NextResponse | null {
  const ip = clientIpFromHeaders(req.headers) ?? 'unknown'
  const r = rateLimit(`demo:${bucket}:${ip}`, max, windowMs)
  if (r.success) return null
  return new NextResponse(JSON.stringify({ demo: true, error: 'Too many requests — try again in a minute.' }), {
    status: 429,
    headers: { ...DEMO_RESPONSE_HEADERS, 'Retry-After': String(Math.ceil(windowMs / 1000)) },
  })
}

export async function withDemoContext(fn: (ctx: DemoContext) => Promise<NextResponse> | NextResponse): Promise<NextResponse> {
  const ctx = await getDemoContext()
  if (!('view' in ctx)) return demoUnavailableResponse(ctx)
  return fn(ctx)
}

/** Every demo write is refused with the same answer. */
export function demoReadOnlyResponse(): NextResponse {
  return demoError(405, 'The demo league is read-only.')
}
