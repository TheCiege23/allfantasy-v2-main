import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRosterGrade } from '@/lib/core-app/rosterGrade'
import { myRosterCandidates } from '@/lib/core-app/myRoster'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import { deriveLeagueFormat } from '@/lib/league-runtime/leagueFormat'
import type { GroundedSlice, GroundingGap } from './packet'

/**
 * R3.3 (2.2) — "Where am I weak?", answered in VALUE terms rather than weekly projection terms.
 *
 * ── 🛑 THIS IS A BRIDGE, NOT NEW MATH — THE SAME PLAYBOOK AS R2 ────────────────────────────────
 * `getRosterGrade` (`lib/core-app/rosterGrade.ts`) already ranks every position against the REST
 * OF THIS LEAGUE'S rosters, using real market values (`buildValueLedger`), not an absolute
 * baseline. That is a materially better "replacement level" than a global constant: a 12-team
 * superflex dynasty and a 10-team redraft do not sit on the same value axis, and grading against a
 * global average would call a strong redraft roster thin because dynasty prices dominate the
 * market data — exactly the trap that module's own header names. Building a second, cruder
 * implementation here would be the rival-to-working-code mistake this codebase has already made
 * and corrected more than once.
 *
 * ⚠ NOT THE SAME SIGNAL AS `weaknessSignals` (`lib/chimmy-context/intel/rosterWeakness.ts`). That
 * one compares THIS WEEK'S point projections against a static per-position constant
 * (`positionProjectionFallback`: QB=17, RB=12, ...) — a weekly-lineup signal. This one compares
 * market VALUE against the rest of the league — a trade/roster-construction signal. Both are real
 * and both already render; they answer different questions and neither substitutes for the other.
 *
 * ── 🛑 FLATTENED FOR THE SERIALIZER, ON PURPOSE ─────────────────────────────────────────────────
 * `RosterGrade.strongest`/`.weakest` are nested `PositionStrength` objects, and `renderObject()` in
 * `serialize.ts` is deliberately non-recursive — descending into nested objects is what makes an
 * unbounded prompt dump possible again, which is the exact bug R1/R3 already fixed once for this
 * packet. So this producer flattens the two nested objects into prefixed primitive fields
 * (`weakestPosition`, `weakestRank`, ...) rather than growing the serializer a second special-case
 * branch. Every other rich slice in this packet (`DecisionFact` via `isDecisionFact`,
 * `RosterPlayerLite`) follows the same rule: the PRODUCER shapes for the renderer, not the reverse.
 */

export interface RosterValueGradeFact {
  rank: number
  outOf: number
  value: number
  median: number
  pricedPlayers: number
  totalPlayers: number
  /** Whether totals were repriced under this league's own scoring, or are raw market prices. */
  leagueScored: boolean
  weakestPosition: string | null
  weakestValue: number | null
  weakestRank: number | null
  weakestOutOf: number | null
  strongestPosition: string | null
  strongestValue: number | null
  strongestRank: number | null
  strongestOutOf: number | null
}

export interface RosterValueGradeSliceArgs {
  userId?: string | null
  leagueId?: string | null
}

function absent(gap: GroundingGap): GroundedSlice<RosterValueGradeFact> {
  return { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap }
}

export async function loadRosterValueGradeSlice(
  args: RosterValueGradeSliceArgs,
): Promise<GroundedSlice<RosterValueGradeFact>> {
  const userId = args.userId ?? null
  const leagueId = args.leagueId ?? null
  if (!userId || !leagueId) {
    return absent({
      reason: 'not_requested',
      detail: 'A roster value grade needs both a signed-in user and a league.',
      remedy: 'Ask about a specific league while signed in.',
    })
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { starters: true, settings: true, leagueType: true, isDynasty: true },
    })
    if (!league) {
      return absent({
        reason: 'not_synced',
        detail: 'This league is not known.',
        remedy: 'Import the league first.',
      })
    }

    /*
     * ⚠ ABSENCE IS NOT A HARD FAILURE. `myRosterCandidates` always includes `userId` itself as a
     * fallback candidate, so a member with no `LeagueTeam` claim row still has one candidate to try
     * — `getRosterGrade` returns null (handled below) if nothing matches, which is the correct
     * place for that failure to surface rather than duplicating the check here.
     */
    const myTeamRow = await prisma.leagueTeam.findFirst({
      where: { leagueId, claimedByUserId: userId },
      select: { platformUserId: true, externalId: true },
    })

    const candidates = myRosterCandidates(
      { platformUserId: myTeamRow?.platformUserId ?? null, externalId: myTeamRow?.externalId ?? null },
      userId,
    )
    const scoringSettings = extractScoringSettings(league.settings)
    const projectionWeek = await latestProjectionWeek()

    const grade = await getRosterGrade({
      leagueId,
      myPlatformUserIds: candidates,
      isDynasty: deriveLeagueFormat(league) === 'dynasty',
      starters: league.starters,
      scoringSettings,
      projectionWeek,
    })

    if (!grade) {
      return absent({
        reason: 'not_computed',
        detail: 'No roster value grade could be assembled — your roster may not be claimed here yet, or nothing on it carries a market value.',
        remedy: 'Claim your team, and it fills once rostered players carry a market value.',
      })
    }

    return {
      present: true,
      value: {
        rank: grade.rank,
        outOf: grade.outOf,
        value: grade.value,
        median: grade.median,
        pricedPlayers: grade.pricedPlayers,
        totalPlayers: grade.totalPlayers,
        leagueScored: grade.basis.leagueScored,
        weakestPosition: grade.weakest?.position ?? null,
        weakestValue: grade.weakest?.value ?? null,
        weakestRank: grade.weakest?.rank ?? null,
        weakestOutOf: grade.weakest?.outOf ?? null,
        strongestPosition: grade.strongest?.position ?? null,
        strongestValue: grade.strongest?.value ?? null,
        strongestRank: grade.strongest?.rank ?? null,
        strongestOutOf: grade.strongest?.outOf ?? null,
      },
      // League-value grades are computed for this request from live snapshots, not served from a
      // store entry — the same reasoning idpKickerValues already carries.
      servedFrom: 'live',
      asOf: grade.basis.capturedAt,
      confidence: null,
      conclusive: { ok: true },
      gap: null,
    }
  } catch (err) {
    return absent({
      reason: 'not_computed',
      detail: `Roster value grading failed: ${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}`,
      remedy: 'It runs again on the next request.',
    })
  }
}
