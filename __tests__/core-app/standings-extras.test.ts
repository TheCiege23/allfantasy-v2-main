import { describe, expect, it } from 'vitest'

import { pickBackfillWeeks } from '@/lib/sleeper/sync/sleeperScoreBackfillWeeks'
import { summariseLineupEfficiency } from '@/lib/core-app/lineupEfficiency'
import { buildDraftOrderPreview } from '@/lib/core-app/standingsDraftOrder'
import { lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'
import { standingsCardRows, STANDINGS_CARD_MAX_ROWS } from '@/lib/share/standingsCard'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG } from '@/lib/draft-lottery/types'
import {
  advanceWeek,
  buildStandingsBoard,
  type StandingsRules,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'

/*
 * The last three standings additions, pure halves: the Sleeper backfill's week choice, lineup
 * efficiency, the draft order if the season ended today, and the share card's rows.
 */

const RULES: StandingsRules = {
  playoffTeams: 2,
  playoffTeamsSource: 'league',
  byes: 0,
  regularSeasonEnd: null,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}

/** n teams; team i scores 100 + 10·(n − i) every week, so team 1 is best. Round robin pairings. */
function league(n: number, weeks: number, you = String(n)) {
  const ids = Array.from({ length: n }, (_, i) => String(i + 1))
  const snaps: WeekSnapshot[] = []
  for (let w = 1; w <= weeks; w += 1) {
    const list = [...ids]
    for (let k = 0; k < w - 1; k += 1) list.splice(1, 0, list.pop()!)
    const rows: WeekRow[] = []
    for (let i = 0; i < n / 2; i += 1) {
      const a = list[i]
      const b = list[n - 1 - i]
      const pa = 100 + 10 * (n - Number(a))
      const pb = 100 + 10 * (n - Number(b))
      rows.push({ week: w, rosterId: a, matchupId: i + 1, pointsFor: pa, pointsAgainst: pb })
      rows.push({ week: w, rosterId: b, matchupId: i + 1, pointsFor: pb, pointsAgainst: pa })
    }
    snaps.push(advanceWeek(snaps[w - 2] ?? null, 2026, w, rows, ids, `s${w}`))
  }
  const teams: TeamMeta[] = ids.map((id) => ({
    rosterId: id,
    name: `Team ${id}`,
    avatarUrl: null,
    isYou: id === you,
    division: null,
    reported: null,
  }))
  return buildStandingsBoard({ season: 2026, snapshots: snaps, unplayed: [], teams, rules: { ...RULES, playoffTeams: Math.floor(n / 2) } })
}

describe('pickBackfillWeeks', () => {
  it('picks finished weeks with no scores, oldest first, a few per run', () => {
    expect(pickBackfillWeeks({ scoredWeeks: [1, 2, 3, 4, 5, 6, 7, 8], haveWeeks: [7, 8], targetWeeks: [8, 9], limit: 4 })).toEqual([1, 2, 3, 4])
  })

  it('never re-fetches a week that has scores, a target week, or anything after the targets', () => {
    expect(pickBackfillWeeks({ scoredWeeks: [1, 2, 3, 9], haveWeeks: [1, 3], targetWeeks: [5, 6] })).toEqual([2])
    // Once the backlog is clear, the steady state costs nothing.
    expect(pickBackfillWeeks({ scoredWeeks: [1, 2, 3], haveWeeks: [1, 2, 3], targetWeeks: [4] })).toEqual([])
    expect(pickBackfillWeeks({ scoredWeeks: [1, 2], haveWeeks: [], targetWeeks: [2, 1] })).toEqual([])
  })
})

describe('summariseLineupEfficiency', () => {
  const seats = lineupSeatsFromSettings({ roster_positions: ['QB', 'RB', 'FLEX', 'BN', 'BN'] })!
  const pos: Record<string, string[]> = { qb: ['QB'], rb1: ['RB'], rb2: ['RB'], wr: ['WR'], ghost: [] }
  const positionsOf = (id: string) => pos[id.split(':')[0]] ?? []

  /** One roster-week. `start` names the starters; everyone else is on the bench. */
  const week = (w: number, rosterId: number, points: Record<string, number>, start: string[]) =>
    Object.entries(points).map(([id, p]) => ({ week: w, playerId: `${id}:${rosterId}`, rosterId, isStarter: start.includes(id), points: p }))

  it('scores the lineup set against the best one the roster allowed, FLEX included', () => {
    const rows = [
      // Week 1: started rb2 (5) in FLEX over wr (20) — 15 left on the bench.
      ...week(1, 1, { qb: 20, rb1: 10, rb2: 5, wr: 20 }, ['qb', 'rb1', 'rb2']),
      // Week 2: perfect.
      ...week(2, 1, { qb: 10, rb1: 10, rb2: 10, wr: 1 }, ['qb', 'rb1', 'rb2']),
    ]
    const r = summariseLineupEfficiency({ rows, seats, positionsOf })['1']
    expect(r.weeks).toBe(2)
    expect(r.actual).toBe(65)
    expect(r.best).toBe(80)
    expect(r.efficiency).toBeCloseTo(65 / 80, 6)
    expect(r.benchPerWeek).toBe(7.5)
  })

  it('leaves a week out when a starter has no position, instead of guessing', () => {
    const rows = [
      ...week(1, 1, { qb: 20, rb1: 10, rb2: 5, wr: 20 }, ['qb', 'rb1', 'rb2']),
      ...week(2, 1, { qb: 20, rb1: 10, ghost: 30, wr: 20 }, ['qb', 'rb1', 'ghost']),
    ]
    expect(summariseLineupEfficiency({ rows, seats, positionsOf })['1'].weeks).toBe(1)
  })

  it('does not count a bench player on the current IR or taxi list as available', () => {
    const rows = week(1, 1, { qb: 20, rb1: 10, rb2: 5, wr: 20 }, ['qb', 'rb1', 'rb2'])
    const inactive = new Map([['1', new Set(['wr:1'])]])
    expect(summariseLineupEfficiency({ rows, seats, positionsOf, inactive })['1'].efficiency).toBe(1)
  })
})

describe('buildDraftOrderPreview', () => {
  const board = league(6, 5)

  it('gives the worst record the first pick under reverse standings, and stops at the playoff line', () => {
    const p = buildDraftOrderPreview(board, { kind: 'reverse_standings' })!
    expect(p.playoffTeams).toBe(3)
    expect(p.picks.map((x) => x.name)).toEqual(['Team 6', 'Team 5', 'Team 4'])
    expect(p.picks[0]).toMatchObject({ pick: 1, isYou: true, firstPickOdds: null })
    expect(p.ruleText).toMatch(/Worst record picks first/)
  })

  it('orders by fewest points for under a points rule', () => {
    const p = buildDraftOrderPreview(board, { kind: 'lowest_points' })!
    const pf = p.picks.map((x) => x.pointsFor)
    expect([...pf].sort((a, b) => a - b)).toEqual(pf)
    expect(p.ruleText).toMatch(/Fewest points for/)
  })

  it('attaches the lottery’s own first-pick odds, and they add up to the whole', () => {
    const p = buildDraftOrderPreview(board, {
      kind: 'lottery',
      config: { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, enabled: true, lotteryTeamCount: 3, lotteryPickCount: 2 },
    })!
    expect(p.lotteryPicks).toBe(2)
    const odds = p.picks.map((x) => x.firstPickOdds!)
    expect(odds.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6)
    // Worse teams get better odds.
    expect(odds[0]).toBeGreaterThan(odds[odds.length - 1])
  })

  it('draws nothing when everyone makes the playoffs', () => {
    const all = buildStandingsBoard({
      season: 2026,
      snapshots: [],
      unplayed: [],
      teams: [],
      rules: RULES,
    })
    expect(buildDraftOrderPreview(all, { kind: 'reverse_standings' })).toBeNull()
  })
})

describe('standingsCardRows', () => {
  it('draws every team and the playoff line for a league that fits', () => {
    const card = standingsCardRows(league(8, 3, '5'))!
    const kinds = card.rows.map((r) => r.kind)
    expect(kinds.filter((k) => k === 'team')).toHaveLength(8)
    expect(kinds.indexOf('line')).toBe(4)
    expect(card.subtitle).toBe('2026 · through week 3')
  })

  it('keeps YOUR row on the card in a big league, after a gap and with no false playoff line', () => {
    const card = standingsCardRows(league(14, 3, '14'))!
    const teams = card.rows.filter((r) => r.kind === 'team')
    expect(teams).toHaveLength(STANDINGS_CARD_MAX_ROWS)
    const last = card.rows[card.rows.length - 1]
    expect(last).toMatchObject({ kind: 'team', isYou: true, seed: 14 })
    expect(card.rows[card.rows.length - 2]).toMatchObject({ kind: 'gap' })
    // Top 7 make it in a 14-team league, so the line sits after seed 7 — above the gap, between neighbours.
    const line = card.rows.findIndex((r) => r.kind === 'line')
    expect(card.rows[line - 1]).toMatchObject({ seed: 7 })
    expect(card.rows[line + 1]).toMatchObject({ seed: 8 })
  })

  it('needs no gap when you are already near the top', () => {
    const card = standingsCardRows(league(14, 3, '2'))!
    expect(card.rows.some((r) => r.kind === 'gap')).toBe(false)
    expect(card.rows.filter((r) => r.kind === 'team')).toHaveLength(STANDINGS_CARD_MAX_ROWS)
  })
})
