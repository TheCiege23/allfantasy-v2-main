import 'server-only'

import { prisma } from '@/lib/prisma'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { lookupProjections } from '@/lib/core-app/playerProjections'
import { playoffSpots, playoffStartWeek } from '@/lib/core-app/seasonTimeline'
import { detectQbFormat, lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'
import { loadWaiverPool } from '@/lib/decision-os/waiver/pool'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'
import { byeForTeam, resolveTeamByeWeeks } from '@/lib/schedule/teamByeWeeks'
import { isLeagueWeekRefusal, leagueWeekBasis } from './leagueWeekPricing'
import { computeTeamBenefit, type BenefitPlayer, type TeamBenefitResult } from './teamBenefit'
import type { TradeSide } from './tradeRecord'

/**
 * Gather what the team-benefit model (`./teamBenefit.ts`) reads, for one league and one two-team
 * deal, and run it. Database reads only — the projection feed, the schedule, injuries, the stored
 * FantasyCalc chart, the waiver pool — so a request path never calls a provider.
 *
 * NFL only (design: "NFL redraft first"); a league the weekly basis refuses is refused with the same
 * words. Never throws: every gap is a refusal with a reason.
 */

const NFL_REGULAR_SEASON_WEEKS = 18

export type TeamBenefitDeps = {
  leagueSettings: (leagueId: string) => Promise<{ settings: unknown; season: number | null } | null>
  freeAgents: (leagueId: string) => Promise<Array<{ id: string; name: string; position: string; team: string | null }>>
  projections: typeof lookupProjections
  injuries: (ids: string[]) => Promise<Map<string, { status: string | null; team: string | null }>>
  byes: (season: number | null) => Promise<Map<string, number>>
  market: (args: { isDynasty: boolean; numQbs: 1 | 2; numTeams: number; ppr: 0 | 0.5 | 1 }) => Promise<Map<string, number>>
  latestWeek: Parameters<typeof leagueWeekBasis>[1]
}

export const defaultTeamBenefitDeps: TeamBenefitDeps = {
  leagueSettings: (leagueId) =>
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, season: true } }).catch(() => null),
  freeAgents: async (leagueId) => {
    const pool = await loadWaiverPool(leagueId, 'NFL').catch(() => null)
    return (pool?.availablePlayers ?? []).map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team }))
  },
  projections: lookupProjections,
  injuries: async (ids) => {
    const rows = await prisma.sportsPlayer
      .findMany({ where: sleeperIdWhere(ids, 'NFL'), select: { sleeperId: true, externalId: true, status: true, team: true } })
      .catch(() => [] as Array<{ sleeperId: string | null; externalId: string; status: string | null; team: string | null }>)
    const out = new Map<string, { status: string | null; team: string | null }>()
    for (const r of rows) {
      const key = r.sleeperId ?? (r.externalId.startsWith('sleeper:') ? r.externalId.slice(8) : null)
      if (key && !out.has(key)) out.set(key, { status: r.status ?? null, team: r.team ?? null })
    }
    return out
  },
  byes: (season) => resolveTeamByeWeeks('NFL', season).catch(() => new Map()),
  market: async (s) => {
    const rows = await getFantasyCalcValuesDbFirst(s, { maxStaleMs: 2 * 60 * 60 * 1000 }).catch(() => [])
    return new Map(rows.filter((r) => r.player?.sleeperId).map((r) => [String(r.player.sleeperId), r.value]))
  },
  latestWeek: undefined,
}

/** The last fantasy week: the playoffs' final round when the league states them, else the regular-season end. */
export function fantasyFinalWeek(settings: unknown): { finalWeek: number; playoffStart: number | null } {
  const start = playoffStartWeek(settings)
  if (start == null) return { finalWeek: Math.min(17, NFL_REGULAR_SEASON_WEEKS), playoffStart: null }
  const teams = playoffSpots(settings) ?? 4
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, teams))))
  return { finalWeek: Math.min(NFL_REGULAR_SEASON_WEEKS, start + rounds - 1), playoffStart: start }
}

/** Active ids (reserve and taxi do not count against capacity). */
const activeIdsOf = (r: CanonicalWorld['rosters'][number]) => {
  const off = new Set([...r.reserveIds, ...r.taxiIds])
  return r.playerIds.filter((id) => !off.has(id))
}

export async function loadTeamBenefit(
  args: { world: CanonicalWorld; me: TradeSide; them: TradeSide },
  deps: Partial<TeamBenefitDeps> = {},
): Promise<TeamBenefitResult> {
  const d: TeamBenefitDeps = { ...defaultTeamBenefitDeps, ...deps }
  const { world, me, them } = args
  if (!me.rosterId || !them.rosterId) return { ok: false, reason: 'Both rosters must be known to price team benefit.', missingAssets: [] }

  const basis = await leagueWeekBasis(world.league, d.latestWeek ?? undefined)
  if (isLeagueWeekRefusal(basis)) return { ok: false, reason: basis.detail, missingAssets: [] }

  const league = await d.leagueSettings(world.league.leagueId)
  const { finalWeek, playoffStart } = fantasyFinalWeek(league?.settings)
  const starterSlots = world.league.rosterSettings.starterSlots ?? []
  const seats = lineupSeatsFromSettings({ roster_positions: starterSlots })
  if (!seats || seats.length === 0) {
    return { ok: false, reason: 'This league has a starting slot the lineup solver does not recognise, so lineups cannot be solved.', missingAssets: [] }
  }

  const rosterById = new Map(world.rosters.map((r) => [r.rosterId, r]))
  const myRoster = rosterById.get(me.rosterId)
  const theirRoster = rosterById.get(them.rosterId)
  if (!myRoster || !theirRoster) return { ok: false, reason: 'A trading roster is missing from the league.', missingAssets: [] }

  const freeAgents = await d.freeAgents(world.league.leagueId)
  const leaguePlayerIds = [...new Set(world.rosters.flatMap((r) => r.playerIds))]
  const faIds = freeAgents.map((f) => f.id).filter((id) => !leaguePlayerIds.includes(id))
  const allIds = [...new Set([...leaguePlayerIds, ...faIds])]

  const rules = basis.rules as Record<string, unknown>
  const ppr = Number((rules as { rec?: unknown }).rec)
  const [projections, injuries, byes, market] = await Promise.all([
    d.projections(allIds, basis.week, { scoringSettings: rules, positionBySleeperId: new Map() }, 'NFL').catch(() => new Map()),
    d.injuries(allIds),
    d.byes(league?.season ?? world.league.season ?? null),
    d.market({
      isDynasty: world.league.isDynasty,
      numQbs: detectQbFormat(starterSlots) === 'SUPERFLEX' ? 2 : 1,
      numTeams: Math.max(2, world.rosters.length),
      ppr: ppr === 0 || ppr === 0.5 ? ppr : 1,
    }),
  ])

  const faById = new Map(freeAgents.map((f) => [f.id, f]))
  const players = new Map<string, BenefitPlayer>()
  for (const id of allIds) {
    const proj = projections.get(id)
    const inj = injuries.get(id)
    const fa = faById.get(id)
    const team = proj?.team ?? inj?.team ?? fa?.team ?? null
    const scored = proj?.componentStats ? computeLeagueProjectedPoints(proj.componentStats, rules) : null
    players.set(id, {
      playerId: id,
      name: proj?.name ?? fa?.name ?? id,
      position: String(proj?.position ?? fa?.position ?? '').toUpperCase(),
      team,
      perGame: scored ? Math.round(scored.points * 100) / 100 : null,
      injuryStatus: inj?.status ?? null,
      byeWeek: byeForTeam(byes, team),
      marketValue: market.get(id) ?? null,
    })
  }

  // Capacity: the league's slots that are not reserve or taxi (starters + bench), when they include a bench.
  const activeSlots = starterSlots.map((s) => String(s).toUpperCase()).filter((s) => !['IR', 'TAXI', 'RES'].includes(s))
  const rosterCapacity = activeSlots.some((s) => s === 'BN' || s === 'BE' || s === 'BENCH') ? activeSlots.length : world.league.rosterSettings.rosterSize ?? null

  const playerIdsOf = (s: TradeSide) => s.gives.flatMap((g) => (g.kind === 'player' ? [g.playerId] : []))
  const otherOf = (s: TradeSide) => s.gives.flatMap((g) => (g.kind === 'pick' ? [g.label] : g.kind === 'faab' ? [`$${g.amount} FAAB`] : []))

  return computeTeamBenefit({
    horizon: { currentWeek: basis.week.week, finalWeek, playoffStartWeek: playoffStart },
    seats,
    rosterCapacity,
    players,
    leaguePlayerIds,
    freeAgentIds: faIds,
    sides: [
      { teamId: me.teamId, activeIds: activeIdsOf(myRoster), givesPlayerIds: playerIdsOf(me), givesOther: otherOf(me) },
      { teamId: them.teamId, activeIds: activeIdsOf(theirRoster), givesPlayerIds: playerIdsOf(them), givesOther: otherOf(them) },
    ],
  })
}
