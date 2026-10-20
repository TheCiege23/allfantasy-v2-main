import { describe, expect, it } from 'vitest'
import { buildWeeklyChecklist, checklistSummary, isStarterSlot, isUnavailable, STALE_CLAIM_MS, type WeeklyChecklistInput } from '@/lib/commissioner/weeklyChecklist'

const NOW = new Date('2026-10-21T15:00:00Z')
const base = (over: Partial<WeeklyChecklistInput> = {}): WeeklyChecklistInput => ({
  leagueId: 'L 1', week: 7, totalWeeks: 17, playoffStartWeek: 15,
  lastWeekMatchups: [{ status: 'final' }, { status: 'final' }],
  pendingClaims: [], processedClaimsLast7Days: 4,
  lineups: [{ teamName: 'Aces', required: 9, filled: 9, unavailable: [] }, { teamName: 'Bolts', required: 9, filled: 9, unavailable: [] }],
  tradesAwaitingReview: 0, tradeDeadlineWeek: 11, dues: null, ...over,
})
const byId = (input: WeeklyChecklistInput) => Object.fromEntries(buildWeeklyChecklist(input, NOW).map((i) => [i.id, i]))

describe('weekly commissioner checklist (pure)', () => {
  it('a quiet, healthy week confirms each job rather than staying silent', () => {
    const items = buildWeeklyChecklist(base(), NOW)
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ['scores', 'done'], ['waivers', 'done'], ['lineups', 'done'], ['trades', 'done'],
    ])
    expect(items[0].title.en).toBe('Week 6 scores are final')
    expect(items[1].detail.en).toBe('4 claims processed this week, none stuck.')
    expect(checklistSummary(items)).toEqual({ todo: 0, done: 4 })
  })

  it('links go to the screen that fixes each item, with the league id encoded', () => {
    const items = byId(base({ tradesAwaitingReview: 1 }))
    expect(items.scores.href).toBe('/core/standings?league=L%201')
    expect(items.waivers.href).toBe('/core/waivers?league=L%201')
    expect(items.trades.href).toBe('/core/trades?league=L%201')
  })

  it('open matchups from last week are a to-do; week 1 has no "last week"', () => {
    expect(byId(base({ lastWeekMatchups: [{ status: 'final' }, { status: 'in_progress' }] })).scores).toMatchObject({
      status: 'todo', title: { en: "Week 6 scores aren't final" }, detail: { en: expect.stringMatching(/^1 matchup is still open\./) },
    })
    expect(byId(base({ week: 1, lastWeekMatchups: [] })).scores).toBeUndefined()
  })

  it('a claim older than 36 hours means waivers did not run', () => {
    const old = new Date(NOW.getTime() - STALE_CLAIM_MS - 1)
    const fresh = new Date(NOW.getTime() - 3_600_000)
    expect(byId(base({ pendingClaims: [{ submittedAt: fresh }] })).waivers.status).toBe('done')
    expect(byId(base({ pendingClaims: [{ submittedAt: old }, { submittedAt: old }] })).waivers).toMatchObject({
      status: 'todo', detail: { en: expect.stringMatching(/^2 claims have waited more than 36 hours/) },
    })
  })

  it('names teams with empty slots and teams starting someone who cannot play, once each', () => {
    const lineups = base().lineups.concat([
      { teamName: 'Comets', required: 9, filled: 7, unavailable: ['Jo Back'] },
      { teamName: 'Dukes', required: 9, filled: 9, unavailable: ['Al Out'] },
    ])
    const item = byId(base({ lineups })).lineups
    expect(item.status).toBe('todo')
    expect(item.title.en).toBe('2 teams need a lineup fix for week 7')
    expect(item.detail.en).toContain('Empty starting slots: Comets.')
    expect(item.detail.en).toContain("Starting someone who can't play: Comets, Dukes.")
  })

  it('no required count (layout unknown) never reports empty slots', () => {
    expect(byId(base({ lineups: [{ teamName: 'X', required: 0, filled: 0, unavailable: [] }] })).lineups.status).toBe('done')
  })

  it('dues appear only when the league tracks them', () => {
    expect(byId(base()).dues).toBeUndefined()
    expect(byId(base({ dues: { unpaid: ['Aces', 'Bolts', 'Comets', 'Dukes'], total: 10 } })).dues).toMatchObject({
      status: 'todo', title: { en: "4 of 10 teams haven't paid dues" }, detail: { en: 'Still owed: Aces, Bolts, Comets +1.' },
    })
    expect(byId(base({ dues: { unpaid: [], total: 10 } })).dues.status).toBe('done')
  })

  it('heads-ups for the trade deadline and the playoffs, this week or next', () => {
    expect(byId(base({ week: 11 })).trade_deadline.title.en).toBe('The trade deadline is this week')
    expect(byId(base({ week: 10 })).trade_deadline.title.en).toBe('The trade deadline is next week')
    expect(byId(base({ week: 9 })).trade_deadline).toBeUndefined()
    expect(byId(base({ week: 14 })).playoffs.title.en).toBe('The playoffs start next week')
    expect(byId(base({ week: 13 })).final_week.title.en).toBe('Two regular-season weeks left')
    expect(byId(base({ tradeDeadlineWeek: null, week: 11 })).trade_deadline).toBeUndefined()
  })

  it('every item has Spanish copy, and none of it says «waiver»', () => {
    const all = buildWeeklyChecklist(base({
      week: 11, lastWeekMatchups: [{ status: 'open' }], pendingClaims: [{ submittedAt: new Date(0) }], tradesAwaitingReview: 2,
      lineups: [{ teamName: 'X', required: 9, filled: 8, unavailable: ['Y'] }], dues: { unpaid: ['X'], total: 2 }, playoffStartWeek: 12,
    }), NOW)
    expect(all.map((i) => i.id)).toEqual(['scores', 'waivers', 'lineups', 'trades', 'dues', 'trade_deadline', 'playoffs'])
    for (const i of all) {
      expect(i.title.es.length).toBeGreaterThan(0)
      expect(i.detail.es.length).toBeGreaterThan(0)
      expect(`${i.title.es} ${i.detail.es}`).not.toMatch(/waiver/i)
    }
    expect(all[0].detail.es).toMatch(/^1 enfrentamiento sigue abierto\./)
  })

  it('"cannot play" is the lineup validator’s own rule, plus a bye', () => {
    expect(isUnavailable({ injuryStatus: 'Out', byeWeek: null }, 7)).toBe(true)
    expect(isUnavailable({ injuryStatus: 'Suspension', byeWeek: null }, 7)).toBe(true)
    expect(isUnavailable({ injuryStatus: 'Injured Reserve', byeWeek: null }, 7)).toBe(true)
    expect(isUnavailable({ injuryStatus: 'Questionable', byeWeek: null }, 7)).toBe(false)
    expect(isUnavailable({ injuryStatus: null, byeWeek: 7 }, 7)).toBe(true)
    expect(isUnavailable({ injuryStatus: null, byeWeek: 8 }, 7)).toBe(false)
  })

  it('a starter is any slot that is not a reserve slot (redraft slot types are position codes)', () => {
    for (const s of ['QB', 'RB', 'FLEX', 'SUPER_FLEX', 'DEF', 'starter']) expect(isStarterSlot(s)).toBe(true)
    for (const s of ['BN', 'bench', 'IR', 'TAXI', 'IL', 'free_agent']) expect(isStarterSlot(s)).toBe(false)
  })
})
