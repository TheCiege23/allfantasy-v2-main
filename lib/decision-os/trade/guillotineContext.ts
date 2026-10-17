import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, hasScoringRules, NO_LEAGUE_SCORING_REASON } from '@/lib/projections/leagueScoring'
import { lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'
import { isTeamEliminated } from '@/lib/core-app/teamElimination'
import { rosteredIdsOf } from './ncaafRedraftContext'
import { scoringRulesFrom } from './scoringContextFromWorld'
import { indexBoard, sampleGamesFromReasons, type BoardPlayer } from './sportPointsValue'
import {
  releaseValue,
  slotReplacement,
  survivalCurve,
  wireValue,
  type GuillotineContext,
  type GuillotineRoster,
  type GuillotineSeat,
} from './guillotineValue'

/**
 * What a guillotine grade is priced from, read once per league. See `./guillotineValue.ts` for the rules.
 *
 * DB-first: the league's settings (lineup, scoring), its rosters (who is alive, who is rostered, the FAAB
 * each live team holds), the NFL season projections (`AFProjectionSnapshot`, keyed on
 * `PlayerIdentityMap.id`) and their Sleeper ids. No provider call.
 *
 * ⚠ A CHOPPED SLEEPER TEAM IS ONLY VISIBLE AS AN EMPTY ROSTER. An imported Sleeper guillotine league
 * records no `eliminatedAt` and no `guillotine_roster_states` row (Guillotine League 26 (1), 2026-10-11:
 * 18 teams, none marked, 4 rosters empty) — so "alive" is `isTeamEliminated`, which reads the provider's
 * flag and the emptied roster.
 */

/**
 * Below this share of the live rosters' ids mapping onto the board, the rosters cannot say who is a free
 * agent — an unmapped rostered star would read as available and raise the replacement level for his whole
 * slot — so the deal is refused rather than priced against an imaginary waiver wire.
 */
const MIN_ROSTER_MAPPING = 0.5

const RECEPTION_KEYS = ['rec', 'receptions', 'receiving.REC'] as const

function readRates(adjustmentFactors: unknown): Record<string, unknown> | null {
  if (!adjustmentFactors || typeof adjustmentFactors !== 'object' || Array.isArray(adjustmentFactors)) return null
  const f = adjustmentFactors as Record<string, unknown>
  const rates = f.perGameRates ?? f.componentRates ?? null
  return rates && typeof rates === 'object' && !Array.isArray(rates) ? (rates as Record<string, unknown>) : null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Points a game under the league's rules, with its position-based reception bonus.
 *
 * ⚠ `computeLeagueProjectedPoints` TAKES NO POSITION, so a TE premium (`bonus_rec_te`, which this league
 * scores) matches no projected stat and adds nothing. It is added here from the receptions the line
 * carries — the same for `bonus_rec_rb` / `_wr` / `_qb`.
 */
export function leaguePointsPerGame(rates: Record<string, unknown> | null, rules: Record<string, unknown>, position: string): number | null {
  const scored = computeLeagueProjectedPoints(rates, rules)
  if (!scored || !Number.isFinite(scored.points)) return null
  const bonus = num(rules[`bonus_rec_${position.trim().toLowerCase()}`])
  if (!bonus || !rates) return scored.points
  let receptions: number | null = null
  for (const k of RECEPTION_KEYS) {
    receptions = num(rates[k])
    if (receptions != null) break
  }
  return scored.points + (receptions ?? 0) * bonus
}

function lineupLabel(seats: readonly GuillotineSeat[]): string {
  const counts = new Map<string, number>()
  for (const s of seats) counts.set(s.slot, (counts.get(s.slot) ?? 0) + 1)
  return [...counts].map(([slot, n]) => `${n} ${slot}`).join(', ')
}

export type GuillotineContextResult = { ok: true; ctx: GuillotineContext } | { ok: false; reason: string }

export async function loadGuillotineContext(league: {
  id: string
  settings: unknown
  leagueSize: number | null
}): Promise<GuillotineContextResult> {
  const seatsRaw = lineupSeatsFromSettings(league.settings)
  if (!seatsRaw) return { ok: false, reason: 'This league’s starting lineup could not be read, so a guillotine grade cannot be priced.' }
  const seats: GuillotineSeat[] = seatsRaw.map((s) => ({ slot: s.slot, eligible: s.eligible }))
  const rules = scoringRulesFrom(league.settings)
  if (!rules || !hasScoringRules(rules)) return { ok: false, reason: NO_LEAGUE_SCORING_REASON }

  // The newest run's season (one run writes one season) — never the highest season on file.
  const latest = await prisma.aFProjectionSnapshot
    .findFirst({ where: { sport: 'NFL', week: null }, orderBy: { computedAt: 'desc' }, select: { season: true } })
    .catch(() => null)
  if (!latest) return { ok: false, reason: 'No NFL projections are on file, so this guillotine trade cannot be graded yet.' }

  const [rows, rosterRows] = await Promise.all([
    prisma.aFProjectionSnapshot
      .findMany({
        where: { sport: 'NFL', season: latest.season, week: null },
        select: { playerId: true, playerName: true, position: true, adjustmentFactors: true, rosWeeksRemaining: true },
      })
      .catch(() => null),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true, faabRemaining: true } }).catch(() => null),
  ])
  if (!rows) return { ok: false, reason: 'The NFL projections could not be read just now.' }
  if (!rosterRows) return { ok: false, reason: 'This league’s rosters could not be read just now.' }

  /*
   * 🛑 SLEEPER IDS ONLY. Rolling Insights' bare numbers share Sleeper's range, and the board index drops
   * an id two players answer to: with both on the board, Bijan Robinson (Sleeper 9509, RI 7408) lost his
   * own Sleeper id to that clash, his roster spot matched nothing, and he became the "best free agent"
   * for every slot (production, 2026-10-11) — zeroing every value in the league. These rosters and the
   * deals graded here carry Sleeper ids; a league rostered in another id space falls below the mapping
   * floor and is refused, never priced against a wire it cannot see.
   */
  const identities = await prisma.playerIdentityMap
    .findMany({ where: { id: { in: rows.map((r) => r.playerId) } }, select: { id: true, sleeperId: true } })
    .catch(() => [] as Array<{ id: string; sleeperId: string | null }>)
  const aliasesById = new Map(identities.map((i) => [i.id, i.sleeperId ? [i.sleeperId] : []]))

  const board: BoardPlayer[] = []
  const weeksLeft: number[] = []
  for (const r of rows) {
    const position = String(r.position ?? '').trim().toUpperCase()
    const perGame = leaguePointsPerGame(readRates(r.adjustmentFactors), rules, position)
    if (perGame == null) continue
    const f = (r.adjustmentFactors ?? {}) as Record<string, unknown>
    board.push({
      id: r.playerId,
      name: r.playerName,
      position,
      perGame,
      sampleGames: sampleGamesFromReasons(f.confidenceReasons),
      aliases: aliasesById.get(r.playerId) ?? [],
      sourceSeason: num(f.sourceSeason),
    })
    if (typeof r.rosWeeksRemaining === 'number') weeksLeft.push(r.rosWeeksRemaining)
  }
  if (board.length === 0) return { ok: false, reason: 'No NFL projection could be scored on this league’s rules.' }
  weeksLeft.sort((a, b) => a - b)
  const nflWeeksLeft = weeksLeft.length ? weeksLeft[Math.floor(weeksLeft.length / 2)]! : 0

  const index = indexBoard(board)
  const live: GuillotineRoster[] = []
  const rostered = new Set<string>()
  let ids = 0
  let mapped = 0
  for (const r of rosterRows) {
    if (isTeamEliminated({ playerData: r.playerData, league: { guillotineMode: true }, eliminationRecorded: false })) continue
    const players: string[] = []
    for (const id of rosteredIdsOf(r.playerData)) {
      ids += 1
      const bare = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
      const hit = index.get(id) ?? index.get(bare)
      if (!hit) continue
      mapped += 1
      players.push(hit.id)
      rostered.add(hit.id)
    }
    live.push({ players, faab: typeof r.faabRemaining === 'number' ? r.faabRemaining : null })
  }
  if (live.length < 2) return { ok: false, reason: 'Fewer than two teams are alive in this guillotine league, so there is nothing left to trade for.' }
  if (ids === 0 || mapped / ids < MIN_ROSTER_MAPPING) {
    return { ok: false, reason: 'This league’s rosters could not be matched to projected players, so the waiver wire cannot be priced.' }
  }

  const replacementBySlot = slotReplacement(board, rostered, seats, live.length)
  const survival = survivalCurve(live.length, nflWeeksLeft)
  const byId = new Map(board.map((p) => [p.id, p]))
  return {
    ok: true,
    ctx: {
      board,
      seats,
      replacementBySlot,
      teamsAlive: live.length,
      startingTeams: Math.max(rosterRows.length, league.leagueSize ?? 0),
      nflWeeksLeft,
      survival,
      liveFaab: live.reduce((s, r) => s + Math.max(0, r.faab ?? 0), 0),
      releaseValue: releaseValue({ rosters: live, board: byId, seats, replacementBySlot, survival }),
      wireValue: wireValue({ board, rostered, seats, replacementBySlot, survival }),
      lineupLabel: lineupLabel(seats),
    },
  }
}
