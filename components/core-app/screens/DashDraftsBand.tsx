import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-drafts.css'
import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'
import { DashDraftsBandView } from '@/components/core-app/screens/DashDraftsBandView'

/**
 * Drafts on the clock — the band that LEADS the /core home whenever the
 * account has a live draft. Fed by getDraftHqAll, the cross-league aggregator
 * (three set-based queries no matter how many leagues), never the per-league
 * loader in a loop.
 *
 * Render-nothing rules, all deliberate:
 *  - null data (the read failed)  → nothing. A home that cannot read drafts
 *    must not claim there are none — and must not lead with an error card
 *    on the one screen everyone lands on.
 *  - zero live-phase rows         → nothing. Upcoming and finished drafts
 *    have their own home in Draft HQ; this band exists only for "a draft is
 *    running RIGHT NOW", and an empty urgency band is noise.
 *
 * Honesty rules:
 *  - The status chip shows the ROW'S raw status, not a flattened "LIVE".
 *    getDraftHqAll's live bucket deliberately includes `paused` — a paused
 *    draft in a band that says LIVE would be a confident lie, so the chip
 *    says PAUSED.
 *  - pickExpiresAt absent renders "no pick timer reported", never an
 *    invented countdown. Present, it renders a COARSE server paint (minutes,
 *    like the first-kickoff band's static countdown) — no client ticking.
 *  - yourSlot is shown only when the aggregator resolved your team into the
 *    slot order. "Whose pick it is" is NOT rendered at all: the aggregator
 *    does not compute it, and deriving it from picksMade % teamCount would
 *    be snake-draft math applied to drafts that may not be snakes.
 *
 * A separate component beside Dash3ATriage/Dash34Carryover/DashUserOs because
 * Dashboard3A.tsx carries another session's in-flight work and is not edited.
 */

const VISIBLE_CAP = 4

/** Milliseconds left on the pick clock at `now` — the view words it (coarse, server paint only). */
function pickClockMs(row: DraftHqAllRow, now: Date): number | null {
  if (!row.pickExpiresAt) return null
  const t = new Date(row.pickExpiresAt).getTime()
  if (Number.isNaN(t)) return null
  return t - now.getTime()
}

export function DashDraftsBand({ data, now }: { data: DraftHqAllData | null; now: Date }) {
  if (!data) return null
  const live = data.rows.filter((r) => r.phase === 'live')
  if (live.length === 0) return null

  const visible = live.slice(0, VISIBLE_CAP)
  const overflow = live.length - visible.length

  /*
   * ⚠ THE WORDS ARE SAID IN THE CLIENT (2026-10-04). This band decides what to say — which drafts are
   * live, and each pick clock against the server's `now` — and DashDraftsBandView says it in the
   * reader's language. Only the fields each card shows cross the boundary.
   */
  return (
    <DashDraftsBandView
      liveCount={live.length}
      visible={visible.map((row) => ({
        leagueId: row.leagueId,
        leagueName: row.leagueName,
        imageUrl: row.imageUrl,
        rawStatus: row.rawStatus,
        yourSlot: row.yourSlot,
        picksMade: row.picksMade,
        clockMs: pickClockMs(row, now),
      }))}
      overflow={overflow}
    />
  )
}
