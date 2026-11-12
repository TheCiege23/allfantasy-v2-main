/**
 * The Front — the War Room's strategist view (lib/core-app/warRoomFront.ts).
 *
 * Pins: the posture bands are Season Outlook's own (bubble = 25 < p < 75, exclusive), the orders follow
 * the posture AND the format's horizon (a redraft team is never told to "build for next season"), the
 * trade deadline is only an order while it is ahead, and every league gets a card — a league the
 * outlook could not model is an `unplaced` card with the reason, never dropped.
 */

import { describe, expect, it } from 'vitest'

import type { OutlookLeague, OutlookTeam, SeasonOutlook, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import { buildWarFront, horizonOf, postureOf, type WarFrontLeagueInput, type WarOrder } from '@/lib/core-app/warRoomFront'

function team(over: Partial<OutlookTeam> = {}): OutlookTeam {
  return {
    rosterId: 'r1',
    name: 'My Team',
    isYou: true,
    wins: 5,
    losses: 4,
    ties: 0,
    pointsFor: 1100,
    seed: 5,
    playoffPct: 50,
    byePct: 10,
    titlePct: 8,
    missPct: 50,
    range: null,
    status: null,
    modelled: true,
    weeksFitted: 9,
    weeklyMean: 120,
    expectedWins: 5,
    schedule: null,
    ...over,
  }
}

function league(id: string, you: Partial<OutlookTeam> | null, over: Partial<OutlookLeague> = {}): OutlookLeague {
  const t = you ? team(you) : null
  return {
    period: 10,
    leagueId: id,
    leagueName: `League ${id}`,
    platform: 'sleeper',
    season: 2026,
    weeksRemaining: 4,
    playoffTeams: 6,
    byeTeams: 2,
    you: t,
    teams: t ? [t, team({ isYou: false, rosterId: 'r2', name: 'Rival' })] : [team({ isYou: false })],
    whatDecidesIt: 'Get to 8 wins',
    href: `/core/season-outlook?league=${id}`,
    milestones: null,
    assumptions: {} as OutlookLeague['assumptions'],
    focus: null,
    ...over,
  }
}

function outlook(leagues: OutlookLeague[], extra: Partial<SeasonOutlook> = {}): SeasonOutlook {
  return {
    leagues,
    summary: { makingPlayoffs: 0, clinched: 0, onTheBubble: 0, onByePace: 0, bestTitle: null },
    weekThatMatters: null,
    swingByLeague: {},
    priorities: [],
    basis: '',
    withheld: [],
    firstKickoffAt: null,
    generatedAt: '2026-11-11T00:00:00.000Z',
    runs: { reused: 0, computed: 0 },
    ...extra,
  }
}

const input = (id: string, over: Partial<WarFrontLeagueInput> = {}): WarFrontLeagueInput => ({
  id,
  name: `League ${id}`,
  format: 'redraft',
  tradeDeadlineWeek: null,
  ...over,
})

const swing = (leagueId: string, over: Partial<SwingMatchup> = {}): SwingMatchup => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  week: 10,
  opponentName: 'Rival',
  ifWin: 70,
  ifLose: 30,
  swing: 40,
  clinchOnWin: false,
  helpIfLose: [],
  ...over,
})

const kinds = (orders: WarOrder[]) => orders.map((o) => o.kind)

describe('postureOf — Season Outlook’s own bands', () => {
  it('bubble is strictly between 25 and 75, exactly as the outlook counts onTheBubble', () => {
    expect(postureOf(league('a', { playoffPct: 75 }))).toBe('contender')
    expect(postureOf(league('a', { playoffPct: 74.9 }))).toBe('bubble')
    expect(postureOf(league('a', { playoffPct: 25.1 }))).toBe('bubble')
    expect(postureOf(league('a', { playoffPct: 25 }))).toBe('long_shot')
    expect(postureOf(league('a', { playoffPct: 0.4 }))).toBe('long_shot')
  })

  it('arithmetic status wins over a percentage', () => {
    expect(postureOf(league('a', { playoffPct: 99.8, status: 'clinched' }))).toBe('clinched')
    expect(postureOf(league('a', { playoffPct: 0, status: 'eliminated' }))).toBe('eliminated')
  })

  it('an unidentified or unmodelled team is unplaced, not a long shot', () => {
    expect(postureOf(league('a', null))).toBe('unplaced')
    expect(postureOf(league('a', { modelled: false, playoffPct: 0 }))).toBe('unplaced')
    expect(postureOf(null)).toBe('unplaced')
  })
})

describe('horizonOf — what carries into next season', () => {
  it('dynasty, devy, keeper and salary cap carry over; everything else is one season', () => {
    for (const f of ['dynasty', 'devy', 'keeper', 'salary_cap']) expect(horizonOf(f)).toBe('carries_over')
    for (const f of ['redraft', 'best_ball', 'guillotine', 'idp', null]) expect(horizonOf(f)).toBe('this_season')
  })
})

describe('buildWarFront — orders follow posture and horizon', () => {
  it('a bubble team gets its swing game first, then what decides it, then the deadline while it is open', () => {
    const front = buildWarFront({
      leagues: [input('b', { tradeDeadlineWeek: 12 })],
      outlook: outlook([league('b', { playoffPct: 48 })], { swingByLeague: { b: swing('b') } }),
    })
    const card = front.cards[0]!
    expect(card.posture).toBe('bubble')
    expect(kinds(card.orders)).toEqual(['swing_game', 'what_decides', 'trade_deadline'])
    expect(card.orders[2]).toMatchObject({ kind: 'trade_deadline', week: 12, weeksLeft: 2, intent: 'buy', href: '/core/trades?league=b' })
  })

  it('a passed deadline is never an order', () => {
    const front = buildWarFront({ leagues: [input('b', { tradeDeadlineWeek: 9 })], outlook: outlook([league('b', { playoffPct: 48 })]) })
    expect(kinds(front.cards[0]!.orders)).not.toContain('trade_deadline')
  })

  it('a deadline that cannot be placed against the current week is not an order', () => {
    const front = buildWarFront({ leagues: [input('b', { tradeDeadlineWeek: 12 })], outlook: outlook([league('b', { playoffPct: 48 }, { period: undefined })]) })
    expect(kinds(front.cards[0]!.orders)).not.toContain('trade_deadline')
  })

  it('falls back to the league row’s own week when the outlook states none', () => {
    const front = buildWarFront({
      leagues: [input('b', { tradeDeadlineWeek: 12, currentWeek: 11 })],
      outlook: outlook([league('b', { playoffPct: 48 }, { period: undefined })]),
    })
    expect(front.cards[0]!.orders.find((o) => o.kind === 'trade_deadline')).toMatchObject({ weeksLeft: 1 })
  })

  it('a contender with a bye in play chases it first; consolidate before the deadline', () => {
    const front = buildWarFront({
      leagues: [input('c', { tradeDeadlineWeek: 11 })],
      outlook: outlook([league('c', { playoffPct: 88, byePct: 55 })]),
    })
    expect(front.cards[0]!.posture).toBe('contender')
    expect(kinds(front.cards[0]!.orders)).toEqual(['chase_bye', 'trade_deadline', 'priced_moves'])
    expect(front.cards[0]!.orders[1]).toMatchObject({ intent: 'consolidate' })
  })

  it('no bye order in a league with no byes, or when the bye is settled', () => {
    const noByes = buildWarFront({ leagues: [input('c')], outlook: outlook([league('c', { playoffPct: 88, byePct: 55 }, { byeTeams: 0 })]) })
    expect(kinds(noByes.cards[0]!.orders)).not.toContain('chase_bye')
    expect(noByes.cards[0]!.odds?.bye).toBeNull()
    const settled = buildWarFront({ leagues: [input('c')], outlook: outlook([league('c', { playoffPct: 99, byePct: 97 })]) })
    expect(kinds(settled.cards[0]!.orders)).not.toContain('chase_bye')
  })

  it('a clinched team plays for the title', () => {
    const front = buildWarFront({ leagues: [input('k')], outlook: outlook([league('k', { playoffPct: 100, status: 'clinched', titlePct: 31 })]) })
    expect(front.cards[0]!.orders[0]).toMatchObject({ kind: 'title_odds', titlePct: 31 })
  })

  it('a dynasty long shot is told to build for next season and sell before the deadline', () => {
    const front = buildWarFront({
      leagues: [input('d', { format: 'dynasty', tradeDeadlineWeek: 13 })],
      outlook: outlook([league('d', { playoffPct: 6 })]),
    })
    expect(kinds(front.cards[0]!.orders)).toEqual(['what_decides', 'build_next_season', 'trade_deadline'])
    expect(front.cards[0]!.orders[1]).toMatchObject({ deadlineOpen: true })
    expect(front.cards[0]!.orders[2]).toMatchObject({ intent: 'sell' })
  })

  it('🛑 a redraft long shot is NEVER told to build for next season — nothing carries over', () => {
    for (const status of [null, 'eliminated'] as const) {
      const front = buildWarFront({
        leagues: [input('r', { format: 'redraft', tradeDeadlineWeek: 13 })],
        outlook: outlook([league('r', { playoffPct: status ? 0 : 6, status })]),
      })
      const k = kinds(front.cards[0]!.orders)
      expect(k).not.toContain('build_next_season')
      expect(k).toContain('redraft_nothing_carries')
      expect(k).not.toContain('trade_deadline')
    }
  })

  it('an eliminated keeper team plans next season, saying whether trades are still open', () => {
    const closed = buildWarFront({ leagues: [input('e', { format: 'keeper', tradeDeadlineWeek: 8 })], outlook: outlook([league('e', { playoffPct: 0, status: 'eliminated' })]) })
    expect(closed.cards[0]!.orders).toEqual([{ kind: 'build_next_season', deadlineOpen: false, href: '/core/trades?league=e' }])
  })

  it('never more than three orders', () => {
    const front = buildWarFront({
      leagues: [input('b', { tradeDeadlineWeek: 12 })],
      outlook: outlook([league('b', { playoffPct: 48 })], { swingByLeague: { b: swing('b') } }),
    })
    expect(front.cards[0]!.orders.length).toBeLessThanOrEqual(3)
  })
})

describe('buildWarFront — every league, in a strategist’s order', () => {
  it('every league gets a card; an unmodelled one says why', () => {
    const front = buildWarFront({
      leagues: [input('ok'), input('gone', { name: 'Guillotine Gauntlet' }), input('new'), input('who'), input('missing')],
      outlook: outlook(
        [league('ok', { playoffPct: 60 }), league('new', { modelled: false, weeksFitted: 2 }), league('who', null)],
        { withheld: [{ leagueName: 'Guillotine Gauntlet', reason: 'Elimination formats have no playoff field to simulate.' }] },
      ),
    })
    expect(front.cards).toHaveLength(5)
    const why = Object.fromEntries(front.cards.filter((c) => c.posture === 'unplaced').map((c) => [c.leagueId, c.orders[0]]))
    expect(why.gone).toMatchObject({ kind: 'unplaced', why: 'withheld', reason: 'Elimination formats have no playoff field to simulate.' })
    expect(why.new).toMatchObject({ why: 'too_few_weeks', weeksFitted: 2 })
    expect(why.who).toMatchObject({ why: 'no_team' })
    expect(why.missing).toMatchObject({ why: 'not_modelled' })
    expect(front.counts).toMatchObject({ bubble: 1, unplaced: 4 })
  })

  it('bubble first, nearest a coin flip first; unplaced last', () => {
    const front = buildWarFront({
      leagues: [input('far'), input('flip'), input('lock'), input('out'), input('x')],
      outlook: outlook([
        league('far', { playoffPct: 70 }),
        league('flip', { playoffPct: 51 }),
        league('lock', { playoffPct: 95 }),
        league('out', { playoffPct: 0, status: 'eliminated' }),
      ]),
    })
    expect(front.cards.map((c) => c.leagueId)).toEqual(['flip', 'far', 'lock', 'out', 'x'])
  })

  it('a failed outlook read is one fact, not sixty unplaced teams', () => {
    const front = buildWarFront({ leagues: [input('a'), input('b')], outlook: null })
    expect(front.available).toBe(false)
  })

  it('🛑 a posture is only ever about YOUR team — no rival is classified', () => {
    const front = buildWarFront({
      leagues: [input('b', { tradeDeadlineWeek: 12 })],
      outlook: outlook([league('b', { playoffPct: 48 })], { swingByLeague: { b: swing('b', { opponentName: 'Rival' }) } }),
    })
    // The only place a rival appears is the swing game's opponent — a scheduled fact, not a label.
    const json = JSON.stringify(front.cards[0]!.orders.filter((o) => o.kind !== 'swing_game'))
    expect(json).not.toContain('Rival')
    expect(front.cards).toHaveLength(1)
  })
})
