/**
 * Joins the anonymous pre-auth campaign journey to the account it produced.
 *
 * Before sign-in, funnel events are recorded against the server-set `af_anon_id`
 * (AnalyticsEvent.sessionId) with no userId. This writes the one row that ties that
 * anonymous id to the real user, so admin campaign reporting can attribute a confirmed
 * account back to the tracked link that earned it.
 *
 * Nothing here trusts client input: the anon id and both touches are read from httpOnly
 * cookies set server-side in middleware, and the userId comes from the authenticated
 * session (NextAuth's signIn event). Attribution is never an authorization input.
 */
import { prisma } from "@/lib/prisma"

import { touchToMeta } from "@/lib/analytics/attribution"
import { readAttributionState } from "@/lib/analytics/attributionCookies"

/** Distinct, greppable event name — this is the join row admin reporting looks for. */
export const ATTRIBUTION_LINK_EVENT = "auth.attribution_linked"

export type LinkAttributionResult =
  | { status: "linked" }
  | { status: "skipped"; reason: "no_anon_id" | "already_linked" }
  | { status: "failed" }

/**
 * Records the anon→user link exactly once per (userId, anonId) pair.
 *
 * `signIn` fires on EVERY login, so writing unconditionally would inflate the campaign
 * funnel with one duplicate per session. Scoping idempotency to the pair — rather than to
 * the user alone — is deliberate: a genuinely new device is a new anonymous journey and
 * SHOULD produce a second link row, while repeat logins on the same device produce none.
 *
 * Best-effort by contract: every failure path returns rather than throws, because this
 * runs inside the auth sign-in event and must never block a login.
 */
export async function linkAttributionToUser(input: {
  userId: string
  getCookie: (name: string) => string | undefined
}): Promise<LinkAttributionResult> {
  try {
    const { anonId, firstTouch, latestTouch } = readAttributionState(input.getCookie)

    // No anonymous id means no journey to join. Recording a row anyway would
    // manufacture an unattributed "link" that looks like real campaign data.
    if (!anonId) return { status: "skipped", reason: "no_anon_id" }

    const existing = await prisma.analyticsEvent.findFirst({
      where: { event: ATTRIBUTION_LINK_EVENT, userId: input.userId, sessionId: anonId },
      select: { id: true },
    })
    if (existing) return { status: "skipped", reason: "already_linked" }

    await prisma.analyticsEvent.create({
      data: {
        event: ATTRIBUTION_LINK_EVENT,
        userId: input.userId,
        sessionId: anonId,
        meta: {
          ...(firstTouch ? touchToMeta(firstTouch, "first") : {}),
          ...(latestTouch ? touchToMeta(latestTouch, "latest") : {}),
          // Distinguishes "signed up with no campaign" from "signed up, campaign unknown
          // because the cookie was cleared" — the two mean very different things when
          // reading a campaign's conversion count.
          has_attribution: Boolean(firstTouch || latestTouch),
        },
      },
    })

    return { status: "linked" }
  } catch {
    return { status: "failed" }
  }
}
