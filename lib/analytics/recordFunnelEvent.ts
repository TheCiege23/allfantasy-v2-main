/**
 * Server-side emitter for acquisition-funnel events, with campaign attribution attached.
 *
 * One emitter for every funnel stage so campaign context is attached identically at each
 * one. If each call site read cookies itself, stages would drift and a campaign's
 * stage-to-stage conversion rate would compare differently-derived numbers.
 *
 * First-party and server-emitted by design: these stages decide revenue attribution, and
 * a client beacon can be blocked, replayed, or forged. Attribution is read from the
 * httpOnly cookies set in middleware; userId is always supplied by the caller from an
 * authenticated/just-committed server context, never from a request body.
 */
import { prisma } from "@/lib/prisma"

import { touchToMeta } from "@/lib/analytics/attribution"
import { readAttributionState } from "@/lib/analytics/attributionCookies"
import { ANALYTICS_TOOL_PRODUCT } from "@/lib/analytics/eventNames"

export type RecordFunnelEventArgs = {
  event: string
  /** Null only for genuinely pre-account stages. A stage that implies an account must pass one. */
  userId: string | null
  getCookie: (name: string) => string | undefined
  /** Stage-specific context (provider, outcome, league counts). Never secrets or raw query strings. */
  meta?: Record<string, string | number | boolean | null>
}

/**
 * Best-effort by contract: returns rather than throws on every path, because these calls
 * sit inside signup, import, and dashboard flows that must not fail because analytics did.
 */
export async function recordFunnelEvent(args: RecordFunnelEventArgs): Promise<boolean> {
  try {
    const { anonId, firstTouch, latestTouch } = readAttributionState(args.getCookie)

    await prisma.analyticsEvent.create({
      data: {
        event: args.event,
        toolKey: ANALYTICS_TOOL_PRODUCT,
        userId: args.userId,
        // Correlates this stage back to the anonymous pre-auth journey. Absent when the
        // visitor blocked cookies — recorded as null rather than a synthesized id, so a
        // missing correlation is visible instead of looking like a distinct visitor.
        sessionId: anonId,
        meta: {
          ...(args.meta ?? {}),
          ...(firstTouch ? touchToMeta(firstTouch, "first") : {}),
          ...(latestTouch ? touchToMeta(latestTouch, "latest") : {}),
          // Distinguishes "no campaign" from "campaign unknown". Without this, a stage with
          // cleared cookies is indistinguishable from genuine direct traffic, which would
          // silently inflate direct and understate every campaign.
          has_attribution: Boolean(firstTouch || latestTouch),
        },
      },
    })
    return true
  } catch (error) {
    console.warn("[analytics] recordFunnelEvent failed", args.event, error)
    return false
  }
}
