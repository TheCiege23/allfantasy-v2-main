import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { summarizeCspReports, type CspViolationSummary } from '@/lib/security/cspReportOnly'

/**
 * Sink for the Report-Only Content-Security-Policy (lib/security/cspReportOnly.ts).
 *
 * Browsers POST here without credentials, so there is no auth and no origin check —
 * anyone can send anything, and the handler is built for that:
 * - the body is capped and parsed defensively; garbage yields nothing
 * - each report is reduced to directive + blocked origin + page path (no query
 *   strings, which can carry tokens)
 * - one log line per distinct violation per window per process, with a hard cap,
 *   so a noisy extension or a spammer cannot flood the logs
 * - always 204: a browser does nothing useful with an error, and a status that
 *   varies with input would tell a prober what got through
 *
 * Nothing is written to the database. Read the results in the web service's logs by
 * searching for `[csp-report]`.
 */

const MAX_BODY_BYTES = 16 * 1024
const WINDOW_MS = 60 * 60 * 1000
const MAX_DISTINCT_PER_WINDOW = 500

let windowStartedAt = 0
const seen = new Map<string, number>()

function noContent() {
  return new NextResponse(null, { status: 204 })
}

function keyOf(v: CspViolationSummary): string {
  return `${v.directive}|${v.blocked}|${v.page}|${v.source ?? ''}`
}

function record(v: CspViolationSummary, now: number): boolean {
  if (now - windowStartedAt > WINDOW_MS) {
    windowStartedAt = now
    seen.clear()
  }
  const key = keyOf(v)
  const count = seen.get(key)
  if (count !== undefined) {
    seen.set(key, count + 1)
    return false
  }
  if (seen.size >= MAX_DISTINCT_PER_WINDOW) return false
  seen.set(key, 1)
  return true
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`csp-report:${getClientIp(req)}`, 30, 60_000).success) return noContent()

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return noContent()

  let text: string
  try {
    text = await req.text()
  } catch {
    return noContent()
  }
  if (text.length === 0 || text.length > MAX_BODY_BYTES) return noContent()

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return noContent()
  }

  const now = Date.now()
  for (const violation of summarizeCspReports(payload)) {
    if (record(violation, now)) console.warn('[csp-report]', JSON.stringify(violation))
  }
  return noContent()
}
