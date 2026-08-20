import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeWinProbability, type MatchupPlayer } from '@/lib/projections/winProbability'

/**
 * Turns stored rosters + projections into the numbers the Matchup screen was
 * withholding.
 *
 * ⚠ THESE SECTIONS WERE MARKED "NOT INGESTED" AND THAT WAS WRONG. The resolver
 * was written when fantasy_projections was empty and never revisited; 994 rows
 * exist for 2026 wk1, keyed by Sleeper id, and roster starters are Sleeper ids
 * too — a sampled lineup matched 10 of 10. The data was there the whole time and
 * the screen said we did not have it, which is its own kind of lie.
 */

/** Starters as stored, plus the projections we can price them with. */
export type SideProjection = {
  starters: MatchupPlayer[]
  /** Starters we could not price — surfaced, never silently treated as zero. */
  unprojected: number
  projectedRemaining: number
}

/**
 * ⚠ SOME STARTERS ARE STORED AS A DESCRIPTOR, NOT AN ID. Real production values
 * include `"name:Lamar Jackson:QB:BAL"` and `"name:Philadelphia Defense:DEF:PHI"`
 * — a fallback the importer writes when it cannot resolve a player to a platform
 * id. They can never join to a projection, so they are counted as unprojected
 * rather than dropped: a lineup with three of these is a lineup we cannot price,
 * and the screen must say so.
 */
function isResolvableId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && !raw.startsWith('name:')
}

function startersOf(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object') return []
  const s = (playerData as Record<string, unknown>).starters
  return Array.isArray(s) ? s.map(String) : []
}

/**
 * Load starters for two rosters and price them against this week's projections.
 *
 * `actualByPlayer` carries points already scored, when the caller has them.
 * Anything absent is treated as not yet played, which is the safe direction: a
 * player counted as still-to-come adds variance, whereas one wrongly counted as
 * final removes it and makes the model overconfident.
 */
export async function loadSideProjections(args: {
  leagueId: string
  season: number
  week: number
  yourPlatformUserId: string | null
  opponentPlatformUserId: string | null
}): Promise<{ you: SideProjection; opponent: SideProjection } | null> {
  const { leagueId, season, week } = args
  if (!args.yourPlatformUserId || !args.opponentPlatformUserId) return null

  const rosters = await prisma.roster.findMany({
    where: { leagueId, platformUserId: { in: [args.yourPlatformUserId, args.opponentPlatformUserId] } },
    select: { platformUserId: true, playerData: true },
  })
  if (rosters.length < 2) return null

  const byUser = new Map(rosters.map((r) => [r.platformUserId, startersOf(r.playerData)]))
  const yourIds = byUser.get(args.yourPlatformUserId) ?? []
  const oppIds = byUser.get(args.opponentPlatformUserId) ?? []
  if (yourIds.length === 0 || oppIds.length === 0) return null

  const lookupIds = [...yourIds, ...oppIds].filter(isResolvableId)
  const projections = await prisma.fantasyProjection.findMany({
    where: { playerId: { in: lookupIds }, season: String(season), week },
    select: { playerId: true, projectedPoints: true, stats: true },
  })
  const byPlayer = new Map(projections.map((p) => [p.playerId, p]))

  const build = (ids: string[]): SideProjection => {
    const starters: MatchupPlayer[] = []
    let unprojected = 0
    let projectedRemaining = 0
    for (const id of ids) {
      const proj = isResolvableId(id) ? byPlayer.get(id) : undefined
      if (!proj) {
        unprojected++
        continue
      }
      const pts = Number(proj.projectedPoints)
      starters.push({
        playerId: id,
        projectedPoints: Number.isFinite(pts) ? pts : null,
        actualPoints: 0,
        isFinal: false,
      })
      if (Number.isFinite(pts)) projectedRemaining += pts
    }
    return { starters, unprojected, projectedRemaining: Math.round(projectedRemaining * 100) / 100 }
  }

  return { you: build(yourIds), opponent: build(oppIds) }
}

/**
 * Win probability for a matchup, or an explicit reason there is none.
 *
 * ⚠ AN UNPROJECTED STARTER MAKES THE WHOLE MATCHUP UNANSWERABLE, NOT MERELY LESS
 * PRECISE — the engine enforces this and this wrapper surfaces WHY. A starter with
 * no projection contributes zero expected points and zero variance, which does not
 * read as "unknown"; it reads as "certain to score nothing", and it tilts the
 * result toward whichever side has full coverage.
 */
export function winProbabilityFor(
  sides: { you: SideProjection; opponent: SideProjection },
  currentPoints: { you: number; opponent: number }
):
  | { available: true; data: { pWin: number; projectedMargin: number; confidence: string; detail: string } }
  | { available: false; reason: string } {
  const totalUnprojected = sides.you.unprojected + sides.opponent.unprojected
  if (totalUnprojected > 0) {
    return {
      available: false,
      reason: `${totalUnprojected} starter${totalUnprojected === 1 ? '' : 's'} have no projection on file — counting them as zero would tilt the result toward the other side`,
    }
  }

  /*
   * Points already on the board are attached to the first starter rather than
   * spread, because only the TOTAL matters to the model — the margin and the
   * variance are both computed from sums.
   */
  const withActuals = (side: SideProjection, points: number): MatchupPlayer[] =>
    side.starters.length === 0
      ? []
      : side.starters.map((p, i) => (i === 0 ? { ...p, actualPoints: points } : p))

  const result = computeWinProbability(
    { teamId: 'you', starters: withActuals(sides.you, currentPoints.you) },
    { teamId: 'opponent', starters: withActuals(sides.opponent, currentPoints.opponent) }
  )

  if (!result.available) return { available: false, reason: result.reason }

  return {
    available: true,
    data: {
      pWin: result.pWin,
      projectedMargin: result.projectedMargin,
      confidence: result.confidence,
      detail: result.detail,
    },
  }
}
