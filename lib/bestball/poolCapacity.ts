/**
 * Does a best ball league's size fit the sport's player pool?
 *
 * A best ball lineup sets itself from the players a team drafted, so every starter seat has to be
 * fillable for EVERY team at once. Only team-count limits were checked before (audit 2026-11-06,
 * "League size vs pool / positions / calendar validation"): a 35-team NFL Guilly league with best ball
 * lineups was accepted with a K seat and a DEF seat, although the NFL has 32 of each, so at least three
 * teams could never fill either seat in any week.
 *
 * THE CHECK. Seats are not independent — a FLEX seat draws on the same running backs as the RB seats —
 * so this is Hall's condition over the league's starter slots: for EVERY set of slot types, the league's
 * seats in that set (teams x seats) must not outnumber the pool of every position those slots accept.
 * Slot types are few (MLB's best ball template has 12, so 4,096 sets), and a violation reports the
 * smallest set that fails, which reads plainly ("the K seat"), never a twelve-slot union.
 *
 *   refuse  seats > pool         some team cannot fill the seats, in any week
 *   warn    seats > 75% of pool  every seat fills, but almost the whole position is drafted, so a bye,
 *                                an injury or a benching leaves a seat empty
 *   warn    a seat no position fills   the seat accepts no position this sport's players carry; it
 *                                stays empty every week whatever the league size. A slot-eligibility
 *                                defect rather than a size problem, so it is reported, not refused —
 *                                refusing would block the sport's own default template.
 *
 * THE POOL is a static estimate per sport and position, never a provider call and never a DB read
 * (this runs in the create wizard and on every save). Each figure is the number of players on a
 * team's active roster at that position who can log a stat line — a DRAFTABLE pool, not the number of
 * regular starters — and is deliberately generous, so a refusal is never a false one. The binding
 * limits are the one-per-team units: NFL K and DEF are 32 each because the league has 32 teams.
 * Where a provider labels the same players two ways (NCAAB `G` or `PG`/`SG`, MLB `OF` or `LF`/`CF`/`RF`)
 * both labels are counted, which can only make the check more lenient.
 *
 * Pure: no DB, no clock. Safe to import from client components.
 */
import type { LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { buildBestBallSlots } from '@/lib/bestball/productionLineup'
import { resolveNflRosterTemplate } from '@/lib/nfl-roster/NflRosterTemplates'
import { resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveNhlRosterTemplate } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveMlbRosterTemplate } from '@/lib/mlb-roster/MlbRosterTemplates'
import { resolveNcaafRosterTemplate } from '@/lib/ncaaf-roster/NcaafRosterTemplates'
import { resolveNcaabRosterTemplate } from '@/lib/ncaab-roster/NcaabRosterTemplates'
import { resolveSoccerRosterTemplate } from '@/lib/soccer-roster/SoccerRosterTemplates'

/** Share of a pool a league may start each week before it is called tight. */
export const BEST_BALL_POOL_TIGHT_SHARE = 0.75

/**
 * Draftable players per position (normalized tokens, as `buildBestBallSlots` eligibility names them).
 *
 *   NFL     32 teams. Roster depth per team: QB 3, RB 4, WR 6, TE 3, DL 9, LB 6, DB 9; one K and one
 *           DEF unit each, which is the binding limit.
 *   NCAAF   134 FBS programs at QB 3, RB 4, WR 6, TE 3, K 1; DEF one unit per program.
 *   NBA     30 teams x 15 roster spots, about 90 per listed position.
 *   NCAAB   362 Division I programs x ~13 scholarship players. Counted under both the grouped labels
 *           (G / F / C) and the granular ones (PG / SG / SF / PF), because both are in use.
 *   NHL     32 teams: C 4, LW 3.5, RW 3.5, D 8, G 2.2.
 *   MLB     30 teams x 26 active: C 2, each infield spot 1.5, OF 5 (and LF/CF/RF ~1.5 each), SP 5+,
 *           RP 8; `P` and `DH` hold few players; `TWP` (two-way) a handful.
 *   SOCCER  MLS, the smaller pipeline: 30 clubs x ~30, GK 3, DEF 10, MID 11, FWD 6. A Euro league's
 *           pool is larger, so this only errs toward accepting.
 */
export const BEST_BALL_POSITION_POOL: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  NFL: { QB: 96, RB: 128, WR: 192, TE: 96, K: 32, DEF: 32, DL: 288, LB: 192, DB: 288 },
  NCAAF: { QB: 400, RB: 530, WR: 800, TE: 400, K: 134, DEF: 134 },
  NBA: { PG: 90, SG: 90, SF: 90, PF: 90, C: 90 },
  NCAAB: { G: 1800, F: 1800, C: 700, PG: 900, SG: 900, SF: 900, PF: 900 },
  NHL: { C: 128, LW: 112, RW: 112, D: 256, G: 70 },
  MLB: { C: 60, '1B': 45, '2B': 45, '3B': 45, SS: 45, OF: 150, LF: 45, CF: 45, RF: 45, DH: 30, TWP: 3, SP: 160, RP: 240, P: 20 },
  SOCCER: { GK: 90, DEF: 300, MID: 330, FWD: 180 },
}

export type BestBallPoolIssue = {
  code: 'pool_exhausted' | 'pool_tight' | 'seat_unfillable'
  severity: 'refuse' | 'warn'
  /** The slot tokens involved (normalized: `FLX`, `SF`, `DEF`). */
  slots: string[]
  /** Positions those slots accept. */
  positions: string[]
  /** Seats the league starts each week across `slots` (teams x seats). */
  seats: number
  /** Draftable players across `positions` (the estimate above). */
  pool: number
  message: string
}

export type BestBallPoolCheck = {
  /** False when the sport has no pool estimate: nothing was checked, and nothing is refused. */
  verified: boolean
  refusals: BestBallPoolIssue[]
  warnings: BestBallPoolIssue[]
}

const SPORT_WORDS: Record<string, string> = {
  NFL: 'the NFL',
  NCAAF: 'college football',
  NBA: 'the NBA',
  NCAAB: 'college basketball',
  NHL: 'the NHL',
  MLB: 'MLB',
  SOCCER: 'soccer',
}

function slotName(token: string, sport: string): string {
  if (token === 'FLX') return 'FLEX'
  // Football's `SF` is the superflex seat; in basketball it is small forward.
  if (token === 'SF' && (sport === 'NFL' || sport === 'NCAAF')) return 'SUPERFLEX'
  return token
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function seatWords(slots: string[], sport: string): string {
  return `${listWords(slots.map((s) => slotName(s, sport)))} seat${slots.length === 1 ? '' : 's'}`
}

/**
 * Check a league's starter slots against the sport's pool. `slots` is what production seats
 * (`buildBestBallSlots`), so the check reads the same seats scoring fills.
 */
export function checkBestBallPoolCapacity(input: {
  sport: string
  teamCount: number
  slots: readonly LineupSlotSpec[]
}): BestBallPoolCheck {
  const sport = String(input.sport ?? '').trim().toUpperCase()
  const pool = BEST_BALL_POSITION_POOL[sport]
  const teams = Math.floor(Number(input.teamCount))
  if (!pool || !Number.isFinite(teams) || teams < 1) return { verified: false, refusals: [], warnings: [] }
  const sportWords = SPORT_WORDS[sport] ?? sport

  const allPositions = Object.keys(pool)
  const groups = input.slots
    .filter((s) => s.count > 0)
    .map((s) => {
      const eligible = s.eligible.includes('*') ? allPositions : [...new Set(s.eligible.map((p) => String(p).toUpperCase()))]
      return { slot: s.slot, count: s.count, eligible, pool: eligible.reduce((sum, p) => sum + (pool[p] ?? 0), 0) }
    })

  const warnings: BestBallPoolIssue[] = groups
    .filter((g) => g.pool === 0)
    .map((g) => ({
      code: 'seat_unfillable' as const,
      severity: 'warn' as const,
      slots: [g.slot],
      positions: g.eligible,
      seats: teams * g.count,
      pool: 0,
      message: `The ${seatWords([g.slot], sport)} accepts no position ${sportWords} players are listed at, so it will stay empty every week.`,
    }))

  // Hall's condition over every set of the remaining slot types. Only the SMALLEST failing sets are
  // reported: "the K seat" and "the DEF seat" each, never every union that contains one of them.
  const live = groups.filter((g) => g.pool > 0)
  type Found = { slots: string[]; positions: string[]; seats: number; pool: number; ratio: number }
  const over: Found[] = []
  const tight: Found[] = []
  for (let mask = 1; mask < 1 << live.length; mask++) {
    const chosen = live.filter((_, i) => mask & (1 << i))
    const positions = [...new Set(chosen.flatMap((g) => g.eligible))].filter((p) => (pool[p] ?? 0) > 0)
    const available = positions.reduce((sum, p) => sum + (pool[p] ?? 0), 0)
    const seats = teams * chosen.reduce((sum, g) => sum + g.count, 0)
    const found: Found = { slots: chosen.map((g) => g.slot), positions, seats, pool: available, ratio: seats / available }
    if (seats > available) over.push(found)
    else if (seats > BEST_BALL_POOL_TIGHT_SHARE * available) tight.push(found)
  }
  const smallest = (list: Found[]) => {
    const size = Math.min(...list.map((f) => f.slots.length))
    return list.filter((f) => f.slots.length === size).sort((a, b) => b.ratio - a.ratio)
  }

  const refusals: BestBallPoolIssue[] = over.length
    ? smallest(over).map((f) => ({
        code: 'pool_exhausted' as const,
        severity: 'refuse' as const,
        slots: f.slots,
        positions: f.positions,
        seats: f.seats,
        pool: f.pool,
        message:
          `A ${teams}-team league starts ${f.seats} players in its ${seatWords(f.slots, sport)} every week, ` +
          `but ${sportWords} has only about ${f.pool} ${listWords(f.positions)} players to draft. ` +
          `Use fewer teams or fewer of those seats.`,
      }))
    : []
  // Tight is reported only when nothing is refused: a refusal has to be fixed first anyway.
  if (!refusals.length && tight.length) {
    for (const f of smallest(tight)) {
      warnings.push({
        code: 'pool_tight',
        severity: 'warn',
        slots: f.slots,
        positions: f.positions,
        seats: f.seats,
        pool: f.pool,
        message:
          `A ${teams}-team league starts ${f.seats} of the about ${f.pool} ${listWords(f.positions)} players ` +
          `${sportWords} has (${Math.round(f.ratio * 100)}%) in its ${seatWords(f.slots, sport)}. ` +
          `Nearly all of them will be drafted, so a seat can sit empty whenever one of its players does not play.`,
      })
    }
  }
  return { verified: true, refusals, warnings }
}

const TEMPLATE_RESOLVERS: Record<string, (leagueType: string) => { slots: Record<string, number> }> = {
  NFL: resolveNflRosterTemplate,
  NBA: resolveNbaRosterTemplate,
  NHL: resolveNhlRosterTemplate,
  MLB: resolveMlbRosterTemplate,
  NCAAF: resolveNcaafRosterTemplate,
  NCAAB: resolveNcaabRosterTemplate,
  SOCCER: resolveSoccerRosterTemplate,
}

/** Settings carrying only a roster slot map, in the shape the roster engine writes. */
export function settingsWithRosterSlots(slots: Record<string, number>): Record<string, unknown> {
  return { roster: { config: { sections: [{ key: 'primary', label: 'Primary', slots }] } } }
}

/**
 * The starter seats a NEW league will be scored on: the roster template league bootstrap installs for
 * that league type (`createDefaultLeagueRosterConfig(leagueId, sport, settings.league_type)`), read
 * through `buildBestBallSlots`. Classic Best Ball gets `best_ball`; a best ball Guilly league keeps the
 * `guillotine` template. Null for a sport with no roster template.
 */
export function newLeagueBestBallSlots(sport: string, leagueType: string): LineupSlotSpec[] | null {
  const normalized = String(sport ?? '').trim().toUpperCase()
  const resolve = TEMPLATE_RESOLVERS[normalized]
  if (!resolve) return null
  return buildBestBallSlots(normalized, settingsWithRosterSlots({ ...resolve(leagueType).slots }))
}

/** The creation-time check: a new best ball league of this sport, type and size. */
export function checkNewBestBallLeaguePool(input: { sport: string; leagueType: 'best_ball' | 'guillotine'; teamCount: number }): BestBallPoolCheck {
  const slots = newLeagueBestBallSlots(input.sport, input.leagueType)
  if (!slots) return { verified: false, refusals: [], warnings: [] }
  return checkBestBallPoolCapacity({ sport: input.sport, teamCount: input.teamCount, slots })
}
