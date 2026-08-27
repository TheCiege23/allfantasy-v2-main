import type { PrismaClient } from '@prisma/client'

import { findMyRoster, rosterPlayerIds } from '@/lib/core-app/myRoster'
import { hasIdpScoring } from '@/lib/core-app/scoringNotes'
import { canFillSlot, startingSlots } from '@/lib/core-app/slotEligibility'
import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

import { projectFromRecentForm } from './recentFormProjection'

/**
 * What a waiver add is actually worth: how much it improves YOUR starting lineup.
 *
 * ⚠ WHAT THIS REPLACES DID NOT READ ANYTHING. `lib/ai/waivers/waiverRecommendationService.ts`
 * selects `Roster.faabBalance` and `Roster.players` — neither column exists, they are
 * `faabRemaining` and `playerData` — and queries `prisma.leaguePlayer`, which is not a model in
 * the schema at all. Every read throws, every throw is caught, and `analyzeRosterNeeds` returns
 * the literal `["WR_depth", "RB_depth", "TE_upgrade"]` for every manager in every league
 * regardless of roster. Those type errors are sitting in the tsc baseline today.
 *
 * ⚠ AND "BEST AVAILABLE PLAYER" IS THE WRONG QUESTION. A free agent projected for 14 points is
 * worth nothing to a manager already starting three better players at that position, and a
 * 9-point defender can be the best add on the board for someone starting a hole. So the ranking
 * is MARGINAL: solve your best lineup now, solve it again with the candidate added, and the
 * difference is what he is worth to you. That also makes flex handling fall out for free instead
 * of needing a rule.
 */

export interface WaiverCandidate {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  /** Projected under THIS league's scoring. Never a generic-PPR number. */
  projectedPoints: number
  /** Points added to your best starting lineup by rostering him. Zero means he would not start. */
  gain: number
  /** The starter he pushes out, when he displaces one. Null when he fills an unfilled slot. */
  displaces: { sleeperId: string; name: string; projectedPoints: number } | null
  /**
   * Where the projection came from.
   *
   * ⚠ 'form' IS BACKWARD-LOOKING AND MUST BE LABELLED AS SUCH. It is a recency-weighted mean of
   * what he has actually scored under this league's rules — it knows nothing about a coming bye,
   * a return from injury or a changed depth chart. A surface that renders it identically to a
   * real projection is making a forecast the number never made.
   */
  basis: 'projection' | 'form'
  /** Games behind a 'form' number, so a two-game estimate can be weighed as one. */
  formGames?: number
}

export type WaiverBoardState =
  | 'ok'
  | 'no_team_claimed'
  | 'no_roster'
  | 'no_scoring_settings'
  | 'no_slots'
  | 'no_projections'

export interface WaiverBoard {
  state: WaiverBoardState
  season: string | null
  week: number | null
  /** Your best lineup's projected total as it stands, so a gain has something to be a gain over. */
  currentLineupPoints: number | null
  candidates: WaiverCandidate[]
  notes: string[]
}

const EMPTY = (state: WaiverBoardState, notes: string[] = []): WaiverBoard => ({
  state,
  season: null,
  week: null,
  currentLineupPoints: null,
  candidates: [],
  notes,
})

export interface Scored {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  points: number
  basis?: 'projection' | 'form'
  formGames?: number
}

/**
 * Best starting lineup by projected points.
 *
 * ⚠ MOST-RESTRICTIVE SLOT FIRST, OR FLEX EATS THE STARTERS. Filling in roster order lets a FLEX
 * take the best running back before the dedicated RB slots are considered, which leaves a real
 * starting slot empty and undervalues every subsequent candidate. Sorting slots by how many of
 * the available positions can fill them puts dedicated slots ahead of flex automatically, with
 * no list of which slots are "flex" to keep in sync.
 */
export function bestLineup(players: readonly Scored[], slots: readonly string[]): {
  total: number
  used: Set<string>
} {
  const positions = [...new Set(players.map((p) => (p.position ?? '').toUpperCase()))]
  const breadth = (slot: string) => positions.filter((pos) => canFillSlot(slot, pos)).length
  const ordered = [...slots].sort((a, b) => breadth(a) - breadth(b))

  const pool = [...players].sort((a, b) => b.points - a.points)
  const used = new Set<string>()
  let total = 0

  for (const slot of ordered) {
    const pick = pool.find((p) => !used.has(p.sleeperId) && canFillSlot(slot, p.position))
    if (!pick) continue
    used.add(pick.sleeperId)
    total += pick.points
  }
  return { total: Math.round(total * 100) / 100, used }
}

export interface LoadWaiverBoardArgs {
  prisma: PrismaClient
  /** Either id space. */
  leagueId: string
  userId: string
  /** How many candidates to return. */
  limit?: number
}

export async function loadWaiverBoard(args: LoadWaiverBoardArgs): Promise<WaiverBoard> {
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100)

  const league =
    (await args.prisma.league
      .findUnique({ where: { id: args.leagueId }, select: { id: true, settings: true } })
      .catch(() => null)) ??
    (await args.prisma.league
      .findFirst({
        where: { platformLeagueId: args.leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, settings: true },
      })
      .catch(() => null))
  if (!league) return EMPTY('no_scoring_settings')

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const scoring = (settings.scoring_settings ?? settings.scoringSettings ?? null) as
    | Record<string, unknown>
    | null
  if (!scoring) return EMPTY('no_scoring_settings')

  const slots = startingSlots(league.settings)
  if (!slots || slots.length === 0) {
    // Without the league's own slots there is no lineup to improve, and assuming a standard
    // shape would price a superflex or IDP add against a roster nobody runs.
    return EMPTY('no_slots')
  }

  const mine = await findMyRoster(args.prisma, league.id, args.userId)
  if (!mine.found) return EMPTY(mine.reason === 'no_team_claimed' ? 'no_team_claimed' : 'no_roster')
  const myIds = rosterPlayerIds(mine.playerData)
  if (myIds.length === 0) return EMPTY('no_roster')

  /* Everyone rostered anywhere in the league is off the board. */
  const allRosters = await args.prisma.roster
    .findMany({ where: { leagueId: league.id }, select: { playerData: true } })
    .catch(() => [] as Array<{ playerData: unknown }>)
  const rostered = new Set<string>()
  for (const r of allRosters) for (const id of rosterPlayerIds(r.playerData)) rostered.add(id)
  for (const id of myIds) rostered.add(id)

  const { lookupProjections } = await import('@/lib/core-app/playerProjections')

  /*
   * The candidate pool is players who ACTUALLY PLAYED in the most recent scored week, plus
   * anyone the projection feed already carries. Using the whole player universe would mean
   * projecting tens of thousands of people to rank twenty-five, and most of them have not taken
   * a snap in years. The cap is reported rather than applied silently.
   */
  const newest = await args.prisma.playerGameStat
    .aggregate({ where: { sportType: 'NFL' }, _max: { season: true } })
    .catch(() => null)
  const statSeason = newest?._max.season ?? null
  const statWeek = statSeason
    ? (
        await args.prisma.playerGameStat
          .aggregate({ where: { sportType: 'NFL', season: statSeason }, _max: { weekOrRound: true } })
          .catch(() => null)
      )?._max.weekOrRound ?? null
    : null

  const activeRows =
    statSeason && statWeek
      ? await args.prisma.playerGameStat
          .findMany({
            where: { sportType: 'NFL', season: statSeason, weekOrRound: statWeek },
            select: { playerId: true },
            distinct: ['playerId'],
          })
          .catch(() => [] as Array<{ playerId: string }>)
      : []

  const activeIds = new Set<string>()
  for (const r of activeRows) if (!rostered.has(r.playerId)) activeIds.add(r.playerId)
  if (activeIds.size === 0) return EMPTY('no_projections', ['No recent game data to build a free-agent pool from.'])

  /*
   * ⚠ A PLAYER WHO CANNOT FILL A SLOT IS NOT A FREE AGENT THIS LEAGUE HAS, AND COUNTING HIM MADE
   * THE COVERAGE NOTE LIE. "Played last week" is the right way to find who is active; it is the
   * wrong way to decide who is relevant. Measured on a standard PPR superflex league: of 2,457
   * players in that pool only 732 can fill any of its slots — the rest are 1,127 defenders in a
   * league with no defensive slots, plus 434 offensive linemen and long snappers. The page was
   * reporting "1,623 of 2,176 free agents could not be projected", which is true of long snappers
   * and says nothing about the waiver wire.
   *
   * Filtering here also cuts the projection work by two thirds, and a player who fills no slot
   * has a marginal gain of exactly zero by construction — so nothing rankable is lost.
   */
  const poolMeta = await args.prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: [...activeIds] } },
      select: { sleeperId: true, name: true, team: true, position: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    .catch(() => [] as Array<{ sleeperId: string | null; name: string; team: string | null; position: string | null }>)

  /*
   * Name and team come from here too, not only position. The players the form fallback rescues
   * are by definition the ones the projection feed does not carry, so its metadata cannot name
   * them — and a board listing "11699" instead of a player is worse than one row shorter.
   */
  const positionOf = new Map<string, string | null>()
  const metaOf = new Map<string, { name: string; team: string | null; position: string | null }>()
  for (const r of poolMeta) {
    if (!r.sleeperId) continue
    const cur = metaOf.get(r.sleeperId)
    if (!cur || (!cur.position && r.position) || (!cur.team && r.team)) {
      metaOf.set(r.sleeperId, { name: r.name, team: r.team, position: r.position })
    }
    const curPos = positionOf.get(r.sleeperId)
    if (curPos == null || (!curPos && r.position)) positionOf.set(r.sleeperId, r.position)
  }

  const poolIds = new Set<string>()
  for (const id of activeIds) {
    const pos = positionOf.get(id)
    // `canFillSlot` normalises, so a cache row spelling the position out in full still matches.
    if (pos && slots.some((slot) => canFillSlot(slot, pos))) poolIds.add(id)
  }
  const ineligible = activeIds.size - poolIds.size
  if (poolIds.size === 0) {
    return EMPTY('no_projections', ['No available player can fill a starting slot in this league.'])
  }

  /*
   * The IDP enrichment is passed only when the league actually scores defenders — the strict
   * predicate, not the loose one. Handing it to a non-IDP league would project defensive lines
   * nobody can score and pad the pool with players who cannot help.
   */
  const idpEnrichment = hasIdpScoring(scoring) ? { scoringSettings: scoring } : null

  const [mineProj, poolProj] = await Promise.all([
    lookupProjections(myIds, null, idpEnrichment),
    lookupProjections([...poolIds], null, idpEnrichment),
  ])

  /*
   * ONE scoring path for both sides of the comparison. Scoring a candidate under the league and
   * the incumbent under a generic preset would make the gain a comparison between two different
   * currencies — which is exactly how a "best available" list ends up recommending a downgrade.
   */
  const score = (proj: Map<string, { projectedPoints: number; name: string | null; position: string | null; team: string | null; componentStats: Record<string, unknown> | null; idpProjection?: { statLine: Record<string, unknown> } }>) => {
    const out: Scored[] = []
    for (const [id, p] of proj) {
      const line = p.idpProjection?.statLine ?? extractLine(p.componentStats)
      const priced = line ? computeLeagueProjectedPoints(line, scoring) : null
      if (!priced) continue // never a zero — an unpriceable player simply is not on the board
      out.push({
        sleeperId: id,
        name: p.name ?? id,
        position: p.position,
        team: p.team,
        points: Math.round(priced.points * 100) / 100,
        basis: 'projection',
      })
    }
    return out
  }

  const roster = score(mineProj as never)
  const pool = score(poolProj as never)

  /*
   * ⚠ THE VENDOR FEED IS ONE WEEK DEEP, SO MOST OF THE WIRE HAD NO PROJECTION AT ALL.
   * `FantasyProjection` carries ~1,000 rows for a single week and preset — on a standard league
   * that left 141 of 449 startable free agents projectable and the other 308 unrankable. Recent
   * form fills those gaps from what each player has actually scored under THIS league's rules.
   *
   * It NEVER overrides a real projection. A vendor number is forward-looking; this one is not,
   * and quietly preferring it would trade a forecast for a memory. Every filled gap is marked
   * `basis: 'form'` so the surface can say which it is showing.
   */
  const missing = [...poolIds].filter((id) => !pool.some((p) => p.sleeperId === id))
  if (missing.length > 0 && statSeason != null) {
    const form = await projectFromRecentForm({
      prisma: args.prisma,
      season: statSeason,
      playerIds: missing,
      scoring,
    })
    for (const [id, f] of form) {
      const fromFeed = poolProj.get(id)
      const cached = metaOf.get(id)
      pool.push({
        sleeperId: id,
        name: fromFeed?.name ?? cached?.name ?? id,
        position: fromFeed?.position ?? cached?.position ?? null,
        team: fromFeed?.team ?? cached?.team ?? null,
        points: f.points,
        basis: 'form',
        formGames: f.games,
      })
    }
  }
  if (roster.length === 0) {
    return EMPTY('no_projections', ['None of your rostered players could be projected under this league’s scoring.'])
  }

  const base = bestLineup(roster, slots)

  const candidates: WaiverCandidate[] = []
  for (const cand of pool) {
    const withCand = bestLineup([...roster, cand], slots)
    const gain = Math.round((withCand.total - base.total) * 100) / 100
    if (gain <= 0) continue // he would not start; that is not a recommendation

    /* Who left the lineup when he entered — the concrete "start him over" answer. */
    const dropped = roster.find((p) => base.used.has(p.sleeperId) && !withCand.used.has(p.sleeperId))
    candidates.push({
      sleeperId: cand.sleeperId,
      name: cand.name,
      position: cand.position,
      team: cand.team,
      projectedPoints: cand.points,
      gain,
      displaces: dropped
        ? { sleeperId: dropped.sleeperId, name: dropped.name, projectedPoints: dropped.points }
        : null,
      basis: cand.basis ?? 'projection',
      formGames: cand.formGames,
    })
  }

  candidates.sort((a, b) => b.gain - a.gain)

  const notes: string[] = [
    `Ranked by how much each adds to your best starting lineup, not by raw projection — ` +
      `a big name who would not crack your lineup is worth nothing this week.`,
  ]
  if (candidates.length > limit) {
    notes.push(`${candidates.length} free agents would improve your lineup; showing the top ${limit}.`)
  }
  if (pool.length < poolIds.size) {
    notes.push(
      `${poolIds.size - pool.length} of ${poolIds.size} startable free agents could not be ` +
        `projected under this league’s scoring and are not shown.`,
    )
  }
  if (ineligible > 0) {
    // Stated rather than silently dropped, so the pool size is auditable.
    notes.push(
      `${ineligible} other active players were skipped because no slot in this league can hold them.`,
    )
  }

  return {
    state: 'ok',
    season: statSeason != null ? String(statSeason) : null,
    week: statWeek,
    currentLineupPoints: base.total,
    candidates: candidates.slice(0, limit),
    notes,
  }
}

/** The vendor row nests the real stat line one level down at `stats.stats`. */
function extractLine(componentStats: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!componentStats) return null
  const inner = (componentStats as { stats?: unknown }).stats
  if (inner && typeof inner === 'object') return inner as Record<string, unknown>
  return componentStats
}
