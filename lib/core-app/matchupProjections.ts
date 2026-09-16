import 'server-only'

import { prisma } from '@/lib/prisma'
import { crosswalkToSleeperIds } from './rosterIdCrosswalk'
import {
  computeLeagueProjectedPoints,
  extractScoringSettings,
  hasScoringRules,
  NO_LEAGUE_SCORING_REASON,
} from '@/lib/projections/leagueScoring'
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
 * Every starter comes back with `actualPoints: 0`; points already scored are applied
 * later from `LivePoints` (see `winProbabilityFor` / `projectedFinalFor`), where a
 * starter with no score row is treated as not yet played — the safe direction: a
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
    // A metadata-only settings object is "no rules" too — see `hasScoringRules`. Without this the
    // eight label-only leagues read "N starters could not be priced", blaming the feed.
    leagueScoring: hasScoringRules(scoring)
      ? { available: true }
      : { available: false, reason: NO_LEAGUE_SCORING_REASON },
  }
}

/**
 * What is already on the board for one matchup.
 *
 * `team` is the scoreboard total for each side (`WeeklyMatchup.pointsFor`) — the number the
 * screen prints, and the authority on how much has been banked. `byPlayer` is each starter's
 * own points so far (`league_player_weekly_scores`), keyed by the id the ROSTER holds, or null
 * when per-player scoring was not read. The model needs both: the team total says how much is
 * banked, the per-player points say how much of each projection is still to come.
 */
export type LivePoints = {
  team: { you: number; opponent: number }
  byPlayer: ReadonlyMap<string, number> | null
}

/** Before kickoff: nothing banked, and per-player points are not needed. */
export const NO_LIVE_POINTS: LivePoints = { team: { you: 0, opponent: 0 }, byPlayer: null }

/**
 * Why a live matchup cannot be priced when only team totals are known. Shared by the win
 * probability and the projected final so the screen gives one reason, not two.
 */
export const LIVE_SCORES_UNATTRIBUTED_REASON =
  "points are already on the board, but this league's per-player scores have not been imported, so we cannot tell how much of each starter's projection is still to come"

/** A banked total with no player row behind it — see `liveSide`. Never a real player id. */
const UNATTRIBUTED_BANKED = '__banked_unattributed__'

/**
 * A side with points on its scoreboard and not one per-player row behind them.
 *
 * ⚠ PER SIDE, NOT PER MATCHUP. The Sleeper ingester skips a roster that has not scored and
 * writes every player of one that has, so rows can exist for one side and not the other when
 * the two syncs are a pass apart. Checked across the matchup, that side's whole total would be
 * banked while every one of its starters still counted his full projection as to come.
 */
const unattributable = (side: SideProjection, teamPoints: number, byPlayer: ReadonlyMap<string, number> | null) =>
  teamPoints !== 0 && !side.lineup.some((slot) => byPlayer?.has(slot.playerId))

const liveUnattributable = (sides: SideProjections, live: LivePoints): boolean =>
  unattributable(sides.you, live.team.you, live.byPlayer) ||
  unattributable(sides.opponent, live.team.opponent, live.byPlayer)

/**
 * One side's starters with their own points so far, plus whatever the scoreboard has banked
 * that no player row accounts for.
 *
 * 🛑 PER PLAYER, NEVER A TEAM TOTAL ON ONE STARTER. This used to attach the whole team's points
 * to the first starter, on the reasoning that only sums matter. They do not: the model takes
 * each starter's remaining projection as `max(0, projected − actual)`, so the team total was
 * subtracted from ONE player's projection (clamped at zero) while every other starter — games
 * already over included — kept his full projection as still to come. A 20-point QB listed
 * first, with a WR projected 14 who had already scored 25, came out at 115 instead of 121.
 *
 * ⚠ THE SCOREBOARD STAYS THE AUTHORITY ON WHAT IS BANKED. Per-player rows and team totals are
 * written by different syncs and can drift apart mid-slate. When the team total is ahead, the
 * difference is added as a finished, zero-projection entry: banked exactly once, never
 * double-counted and never lost. When the player rows are ahead, their sum stands.
 *
 * A starter with no row is treated as not yet played — the model's safe direction (more
 * uncertainty, never false certainty), the same stance `lib/live/starterSwings.ts` takes.
 *
 * ⚠ STILL UNKNOWN: WHETHER A STARTER'S GAME IS OVER. Nothing sets `isFinalized` on these rows
 * (`ingestSleeperPlayerScores` always writes false), so a starter who finished UNDER his
 * projection still counts the gap as to come. That overstates his side and widens the spread;
 * a starter who BEAT his projection is no longer affected.
 */
function liveSide(side: SideProjection, teamPoints: number, byPlayer: ReadonlyMap<string, number> | null) {
  const actualOf = (playerId: string) => byPlayer?.get(playerId) ?? 0
  const starters: MatchupPlayer[] = side.starters.map((p) => ({ ...p, actualPoints: actualOf(p.playerId) }))
  // Over the whole LINEUP: an unpriced starter's points are banked too, just not projectable.
  const attributed = side.lineup.reduce((sum, slot) => sum + actualOf(slot.playerId), 0)
  const unattributed = teamPoints - attributed
  if (unattributed > 0.005) {
    starters.push({ playerId: UNATTRIBUTED_BANKED, projectedPoints: 0, actualPoints: unattributed, isFinal: true })
  }
  const banked = Math.max(teamPoints, attributed)
  const remaining = starters.reduce(
    (sum, p) => (p.isFinal || p.projectedPoints == null ? sum : sum + Math.max(0, p.projectedPoints - p.actualPoints)),
    0,
  )
  return { starters, banked, remaining }
}

/**
 * Each side's projected final: what is banked plus what its priced starters are still
 * projected to add. Before kickoff that is the plain projected total.
 *
 * Returns an explicit refusal when points are on the board but per-player scores are not —
 * the one case where "what is left" cannot be known.
 */
export function projectedFinalFor(
  sides: SideProjections,
  live: LivePoints,
): { available: true; data: { you: number; opponent: number } } | { available: false; reason: string } {
  if (liveUnattributable(sides, live)) {
    return { available: false, reason: LIVE_SCORES_UNATTRIBUTED_REASON }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100
  const you = liveSide(sides.you, live.team.you, live.byPlayer)
  const opponent = liveSide(sides.opponent, live.team.opponent, live.byPlayer)
  return {
    available: true,
    data: { you: round2(you.banked + you.remaining), opponent: round2(opponent.banked + opponent.remaining) },
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
  live: LivePoints
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

  // Mid-slate with only team totals, "what is left" is unknowable — see `liveSide`.
  if (liveUnattributable(sides, live)) {
    return { available: false, reason: LIVE_SCORES_UNATTRIBUTED_REASON }
  }

  const result = computeWinProbability(
    { teamId: 'you', starters: liveSide(sides.you, live.team.you, live.byPlayer).starters },
    { teamId: 'opponent', starters: liveSide(sides.opponent, live.team.opponent, live.byPlayer).starters }
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
