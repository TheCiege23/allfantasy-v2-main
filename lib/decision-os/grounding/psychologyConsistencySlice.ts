import 'server-only'

import { prisma } from '@/lib/prisma'
import { rollUpManagerAcrossLeagues } from '@/lib/psychological-profiles/CrossLeagueRollup'
import { rollUpManagerAcrossSports } from '@/lib/psychological-profiles/CrossSportRollup'
import type { GroundedSlice, GroundingGap } from './packet'

/**
 * R4b.5 — cross-league and cross-sport psychology, SELF ONLY, in the packet.
 *
 * ── 🛑 WHY THIS DOES NOT GO THROUGH `psychology-os`'S CACHED FEED ───────────────────────────────
 * `psychologyProfileSource` is league-scoped and 12h-cached because the base profile read is the
 * SAME for every viewer of that league. This is not: "how consistent am I across MY leagues" is a
 * different answer for every account, so caching it per-league (or per-subject) would either leak
 * one viewer's cross-league read to another or almost never hit. `lib/decision-os/psychology-os/
 * index.ts`'s own header already states this rule for exactly this reason — derived at read, never
 * cached, matching the R2 decision-bridge shape rather than the OsFeed shape.
 *
 * ── SELF ONLY, ON PURPOSE (P5's other half — "opponents" — is deliberately NOT built here) ──────
 * `rollUpManagerAcrossLeagues` already supports grading another manager when the caller can see
 * them (`canSeeOthers`), but that is a request-scoped "tell me about MY RIVAL" question with its
 * own entitlement check, not an ambient league-wide fact. The existing REST route
 * (`app/api/leagues/[leagueId]/psychological-profiles/handler.ts`) already serves that case. This
 * slice answers the question that IS ambient and always free: how consistent is the VIEWER
 * themselves, across every league and sport they play.
 */

export interface PsychologyConsistencyFact {
  crossLeagueObserved: number
  crossLeagueWithoutProfile: number
  crossLeagueConsistentLabels: string[]
  crossLeagueCaveat: string | null
  crossSportObserved: number
  crossSportWithoutProfile: number
  crossSportConsistentLabels: string[]
  crossSportSpecificLabels: string[]
  crossSportCaveat: string | null
}

export interface PsychologyConsistencySliceArgs {
  userId?: string | null
  leagueId?: string | null
}

function absent(gap: GroundingGap): GroundedSlice<PsychologyConsistencyFact> {
  return { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap }
}

export async function loadPsychologyConsistencySlice(
  args: PsychologyConsistencySliceArgs,
): Promise<GroundedSlice<PsychologyConsistencyFact>> {
  const userId = args.userId ?? null
  if (!userId || !args.leagueId) {
    return absent({
      reason: 'not_requested',
      detail: 'Cross-league and cross-sport psychology need a signed-in user in a league.',
      remedy: 'Ask about a specific league while signed in.',
    })
  }

  try {
    /*
     * ⚠ NOT ANCHORED TO THE CURRENT LEAGUE. A `platformUserId` is constant across every league on
     * the same platform (one Sleeper account, one id), so resolving it from ANY of the caller's
     * claimed teams is more robust than requiring THIS league specifically to carry it — a data
     * gap on one league's row should not silently disable a read every OTHER league could answer.
     */
    const ownTeams = await prisma.leagueTeam.findMany({
      where: { claimedByUserId: userId, platformUserId: { not: null } },
      select: { platformUserId: true },
      take: 1,
    })
    const ownPlatformUserId = ownTeams[0]?.platformUserId ?? null

    const [crossLeague, crossSport] = await Promise.all([
      ownPlatformUserId
        ? rollUpManagerAcrossLeagues({ viewerUserId: userId, subjectPlatformUserId: ownPlatformUserId, canSeeOthers: false })
        : null,
      rollUpManagerAcrossSports({ userId }),
    ])

    if (!crossLeague && crossSport.sportsObserved === 0 && crossSport.sportsWithoutProfile === 0) {
      return absent({
        reason: 'not_computed',
        detail: 'No claimed team with a known platform identity was found for this user.',
        remedy: 'Claim your team in a league to enable cross-league and cross-sport reads.',
      })
    }

    return {
      present: true,
      value: {
        crossLeagueObserved: crossLeague?.leaguesObserved ?? 0,
        crossLeagueWithoutProfile: crossLeague?.leaguesWithoutProfile ?? 0,
        crossLeagueConsistentLabels: crossLeague?.consistentLabels ?? [],
        crossLeagueCaveat: crossLeague?.caveat ?? 'No claimed team with a known platform identity was found.',
        crossSportObserved: crossSport.sportsObserved,
        crossSportWithoutProfile: crossSport.sportsWithoutProfile,
        crossSportConsistentLabels: crossSport.consistentLabels,
        crossSportSpecificLabels: crossSport.sportSpecificLabels,
        crossSportCaveat: crossSport.caveat,
      },
      // Derived at read, per-viewer, never served from a store — see the header.
      servedFrom: 'live',
      asOf: null,
      confidence: null,
      conclusive: { ok: true },
      gap: null,
    }
  } catch (err) {
    return absent({
      reason: 'not_computed',
      detail: `Cross-league/cross-sport psychology failed: ${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}`,
      remedy: 'It runs again on the next request.',
    })
  }
}
