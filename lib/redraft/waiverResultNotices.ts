/**
 * "You got Puka Nacua" — a redraft waiver claim's result, told to the manager who made it (2026-11-15).
 *
 * 🛑 THE REDRAFT WAIVER RUN TOLD NOBODY. `processWaiverWindow` (lib/redraft/waiverEngine.ts) approved and
 * denied claims every hour and wrote a transaction row; a manager found out whether they won a player only
 * by opening their roster. The other waiver engine (lib/waiver-wire/run-hooks.ts) already sent
 * `waiver_claim_won` / `waiver_claim_lost`; this sends the same two types, in the same category
 * (`waiver_processing`), so one settings switch governs both engines and a phone shows the same button.
 *
 * Bell first: `waiver_processing` starts with email and push OFF (a waiver run can settle many claims a
 * week), so this reaches the phone or inbox only for someone who turned that on.
 *
 * ⚠ ONLY TO PEOPLE. A redraft roster's `ownerId` is an AppUser id only once a person holds the seat; open
 * seats carry `open-slot-*` / `orphan-*` / `roster:*` keys and are never notified.
 */

export type WaiverClaimForNotice = {
  id: string
  ownerId: string | null | undefined
  addPlayerName: string
  dropPlayerName?: string | null
  bidAmount?: number | null
}

export type WaiverResultForNotice = { claimId: string; status: 'approved' | 'denied'; reason?: string }

export type WaiverNotice = {
  userId: string
  claimId: string
  type: 'waiver_claim_won' | 'waiver_claim_lost'
  title: string
  body: string
}

export function isPersonOwnerId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.length > 0 && !/^(open-slot-|orphan-|roster:)/.test(id)
}

/** One notice per settled claim whose seat a person holds. Pure. */
export function waiverResultNotices(
  claims: readonly WaiverClaimForNotice[],
  results: readonly WaiverResultForNotice[],
): WaiverNotice[] {
  const byId = new Map(claims.map((c) => [c.id, c]))
  const out: WaiverNotice[] = []
  for (const r of results) {
    const c = byId.get(r.claimId)
    if (!c || !isPersonOwnerId(c.ownerId)) continue
    const player = c.addPlayerName?.trim() || 'the player you claimed'
    if (r.status === 'approved') {
      const bid = typeof c.bidAmount === 'number' && c.bidAmount > 0 ? ` for $${c.bidAmount} FAAB` : ''
      const drop = c.dropPlayerName?.trim() ? ` ${c.dropPlayerName.trim()} was dropped to make room.` : ''
      out.push({ userId: c.ownerId, claimId: c.id, type: 'waiver_claim_won', title: `You got ${player}`, body: `Your waiver claim${bid} went through.${drop}` })
    } else {
      const why = r.reason?.trim() ? ` ${r.reason.trim()}` : ''
      out.push({ userId: c.ownerId, claimId: c.id, type: 'waiver_claim_lost', title: `Waiver claim not awarded: ${player}`, body: `Your claim did not go through.${why}` })
    }
  }
  return out
}

/**
 * Send them. Fire-and-forget through a dynamic import, like the multi-team trade notices: the claims are
 * already settled when this runs, and a failed alert must never fail or slow the waiver run.
 */
export function sendWaiverResultNotices(leagueId: string, notices: readonly WaiverNotice[]): void {
  if (notices.length === 0) return
  try {
    void import('@/lib/notifications/NotificationDispatcher')
      .then(async ({ dispatchNotification }) => {
        for (const n of notices) {
          await dispatchNotification({
            userIds: [n.userId],
            category: 'waiver_processing',
            productType: 'app',
            type: n.type,
            title: n.title,
            body: n.body,
            actionHref: `/league/${encodeURIComponent(leagueId)}`,
            actionLabel: n.type === 'waiver_claim_won' ? 'View roster' : 'Review waivers',
            leagueId,
            severity: 'low',
            dedupePrefix: `redraft-waiver-result:${n.claimId}`,
            meta: { leagueId, claimId: n.claimId },
          }).catch(() => null)
        }
      })
      .catch(() => undefined)
  } catch {
    /* never reaches the waiver run */
  }
}
