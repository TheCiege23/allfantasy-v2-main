import 'server-only'

import { prisma } from '@/lib/prisma'
import { crosswalkToSleeperIds } from './rosterIdCrosswalk'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
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
  /**
   * EVERY starter, in the order the platform stores the lineup, priced or not.
   *
   * ⚠ THIS IS NOT `starters` WITH NULLS. `starters` is the priced subset the win
   * probability model consumes and it must stay that way — a player carried into
   * the model at zero reads as "certain to score nothing" rather than "unknown".
   * The slot-by-slot view has the opposite requirement: a starter we cannot
   * price still occupies a slot, and dropping him would silently shorten one
   * side's lineup against the other's.
   *
   * `null` here means unpriced. It never means zero.
   */
  lineup: Array<{ playerId: string; projected: number | null }>
}

/**
 * Both sides, priced under THIS league's own scoring — or not at all.
 *
 * ⚠ SAME STANCE AS playerImpact: REFUSE rather than fall back to the generic
 * full-PPR number. A standard projection silently substituted for a
 * league-specific one is indistinguishable from the real thing on screen, and
 * it is wrong in exactly the leagues that differ most from default. When
 * `leagueScoring` is unavailable the sides carry no priced starters, so a
 * caller that forgets to check still cannot leak a generic number.
 */
export type SideProjections = {
  you: SideProjection
  opponent: SideProjection
  leagueScoring: { available: true } | { available: false; reason: string }
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
}): Promise<SideProjections | null> {
  const { leagueId, season, week } = args
  if (!args.yourPlatformUserId || !args.opponentPlatformUserId) return null

  const rosters = await prisma.roster.findMany({
    where: { leagueId, platformUserId: { in: [args.yourPlatformUserId, args.opponentPlatformUserId] } },
    select: { platformUserId: true, playerData: true },
  })
  if (rosters.length < 2) return null

  // The league's own scoring rules — the SAME extraction playerImpact uses, so
  // the Matchup screen and the game-day screen cannot disagree about one
  // league's rules or one player's price.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, platform: true, sport: true },
  })
  const scoring = extractScoringSettings(league?.settings)

  const byUser = new Map(rosters.map((r) => [r.platformUserId, startersOf(r.playerData)]))
  const yourIds = byUser.get(args.yourPlatformUserId) ?? []
  const oppIds = byUser.get(args.opponentPlatformUserId) ?? []
  if (yourIds.length === 0 || oppIds.length === 0) return null

  const rosterIds = [...yourIds, ...oppIds].filter(isResolvableId)

  /*
   * ⚠ `fantasyProjection.playerId` IS A SLEEPER ID, so an ESPN roster priced
   * nothing at all — every starter came back unprojected and the board showed a
   * column of em dashes beside names it could now read. Same cause as the
   * identity join in `matchup.ts`, and the same fix: translate through the
   * id-composed crosswalk before the lookup.
   *
   * ⚠ THE LINEUP KEEPS THE ROSTER'S OWN IDS. `matchup.ts` pairs slots and joins
   * live scores on the id the roster holds, and `league_player_weekly_scores` is
   * written with the platform's ids too — so only the projection lookup is
   * translated, and `lineup[].playerId` below stays exactly what came off the
   * roster.
   */
  const sleeperIdByRosterId = await crosswalkToSleeperIds(
    String(league?.platform ?? ''),
    String(league?.sport ?? 'NFL'),
    rosterIds,
  ).catch(() => new Map<string, string>())

  const lookupIds = [...new Set(rosterIds.map((id) => sleeperIdByRosterId.get(id) ?? id))]
  const projections = await prisma.fantasyProjection.findMany({
    // AF mirror rows (source 'allfantasy') carry no component stat line to rescore.
    where: { playerId: { in: lookupIds }, season: String(season), week, source: { not: 'allfantasy' } },
    // `stats` carries the FULL component stat line the import cron preserves so
    // consumers can rescore under league settings (see app/api/cron/
    // import-projections). The generic `projectedPoints` total is deliberately
    // not read here — a PPR number is not this league's number.
    select: { playerId: true, stats: true },
  })
  const byPlayer = new Map(projections.map((p) => [p.playerId, p]))

  const build = (ids: string[]): SideProjection => {
    const starters: MatchupPlayer[] = []
    const lineup: SideProjection['lineup'] = []
    let unprojected = 0
    let projectedRemaining = 0
    for (const id of ids) {
      const proj = isResolvableId(id)
        ? byPlayer.get(sleeperIdByRosterId.get(id) ?? id)
        : undefined
      if (!proj) {
        unprojected++
        lineup.push({ playerId: id, projected: null })
        continue
      }
      /*
       * ⚠ RESCORED UNDER THE LEAGUE'S OWN RULES, NEVER READ FROM THE GENERIC
       * pts_ppr TOTAL. The feed nests component stats one level down; the outer
       * object is metadata (name/team/week) and scoring it would be
       * meaningless. A starter whose stats the rules cannot score is unpriced —
       * not zero — same as a starter the feed does not carry.
       */
      const s = (proj.stats ?? {}) as Record<string, unknown>
      const scored = scoring
        ? computeLeagueProjectedPoints((s.stats ?? null) as Record<string, unknown> | null, scoring)
        : null
      if (!scored) {
        unprojected++
        lineup.push({ playerId: id, projected: null })
        continue
      }
      starters.push({
        playerId: id,
        projectedPoints: scored.points,
        actualPoints: 0,
        isFinal: false,
      })
      lineup.push({ playerId: id, projected: scored.points })
      projectedRemaining += scored.points
    }
    return {
      starters,
      unprojected,
      projectedRemaining: Math.round(projectedRemaining * 100) / 100,
      lineup,
    }
  }

  return {
    you: build(yourIds),
    opponent: build(oppIds),
    leagueScoring: scoring
      ? { available: true }
      : {
          available: false,
          reason: 'we hold no scoring settings for this league, and a generic projection would not be yours',
        },
  }
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
  sides: SideProjections,
  currentPoints: { you: number; opponent: number }
):
  | { available: true; data: { pWin: number; projectedMargin: number; confidence: string; detail: string } }
  | { available: false; reason: string } {
  // "No rules" and "no projection" are DIFFERENT failures — blaming the feed
  // for a missing league import sends someone hunting the wrong problem.
  if (!sides.leagueScoring.available) {
    return { available: false, reason: sides.leagueScoring.reason }
  }

  const totalUnprojected = sides.you.unprojected + sides.opponent.unprojected
  if (totalUnprojected > 0) {
    return {
      available: false,
      reason: `${totalUnprojected} starter${totalUnprojected === 1 ? '' : 's'} could not be priced under this league's scoring — no projection on file, or stats its rules do not cover — and counting them as zero would tilt the result toward the other side`,
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
