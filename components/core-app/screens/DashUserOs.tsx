import '@/components/core-app/af-core.css'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'
import { DashUserOsView } from '@/components/core-app/screens/DashUserOsView'

/**
 * P4-5 — the /core home's Decision OS companion slot: the deterministic User OS
 * card (resolveUserOsSnapshot — team health, activity summary, league trend)
 * for the ONE league that most needs the user right now. The first surface on
 * /core that reads decision-os at all. Deterministic only: no AI pipeline, no
 * spend, no trigger.
 *
 * A separate component file, mounted from app/core/(shell)/[[...screen]]/page.tsx
 * beside Dash3ATriage/Dash34Carryover, because Dashboard3A.tsx carries another
 * session's in-flight work and is not edited.
 *
 * Render-nothing rules, all deliberate:
 *  - null snapshot (the read failed)          → nothing, not an error card.
 *  - available: false (pipeline degraded)     → nothing. UserOsCard's own
 *    loading/unavailable states describe a client fetch that will retry; a
 *    server render never will, so showing them here would be a promise the
 *    page cannot keep.
 *  - zero events AND no trend                 → nothing. For a league the event
 *    store has never seen, "Inactive · 0 trades" is a claim about the MANAGER
 *    when the truth is a coverage gap — the honest render is absence.
 *
 * The card body is the SAME presentational component the league Decide surface
 * uses (UserOsCard is props-only — no fetch, no state), so the two surfaces
 * cannot drift.
 */
export function DashUserOs({
  snapshot,
  leagueId,
  leagueName,
}: {
  snapshot: UserOsSnapshot | null
  leagueId: string | null
  leagueName: string | null
}) {
  if (!snapshot || !snapshot.available || !leagueId) return null

  const a = snapshot.activitySummary
  /*
   * ⚠ THE OR LET A VERDICT THROUGH ON NO EVIDENCE. `leagueTrend.available`
   * alone satisfied the old gate, so a league with all four counts at zero
   * still rendered — and the card's participation chip then reads "Inactive"
   * with a warning triangle. That is a claim about the MANAGER built from a
   * coverage gap: the event store is nearly empty in production, so zero
   * events overwhelmingly means "we have not ingested your activity", not
   * "you did nothing". This component's own header names that exact failure.
   *
   * The trend is context for activity, never a substitute for it. At least one
   * real event must exist before this screen says anything about how someone
   * plays.
   */
  const holdsRealActivity =
    a.tradeEventCount > 0 ||
    a.waiverEventCount > 0 ||
    a.lineupEventCount > 0 ||
    a.draftEventCount > 0
  if (!holdsRealActivity) return null

  // The header and the card are said in the reader's language by the client view (2026-10-04).
  return <DashUserOsView snapshot={snapshot} leagueId={leagueId} leagueName={leagueName} />
}
