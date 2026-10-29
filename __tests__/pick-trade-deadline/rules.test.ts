// @vitest-environment node
/** A separate deadline for pick trades (lib/trade-deadline/pickTradeDeadline.ts): the rule, its reads, and where it shows. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  isPicksOnlyTrade,
  parsePickTradeDeadline,
  pickTradeDeadlineFor,
  pickTradeDeadlinePassed,
  readPickTradeDeadline,
} from '@/lib/trade-deadline/pickTradeDeadline'
import { loadPickTradeDeadlineView, tradeDeadlineRefusal } from '@/lib/trade-deadline/tradeDeadlineWindow'
import { buildLeagueCalendar } from '@/lib/core-app/commissioner/calendar'

describe('the rule', () => {
  it('is `same` unless stored in a shape it knows', () => {
    expect(readPickTradeDeadline(null)).toEqual({ mode: 'same' })
    expect(readPickTradeDeadline({ pick_trade_deadline: { mode: 'week', week: 0 } })).toEqual({ mode: 'same' })
    expect(readPickTradeDeadline({ pick_trade_deadline: { mode: 'week', week: 15 } })).toEqual({ mode: 'week', week: 15 })
    expect(readPickTradeDeadline({ pick_trade_deadline: { mode: 'open', week: 3 } })).toEqual({ mode: 'open' })
  })

  it('parses a save, refusing a week out of range or a mode it does not know', () => {
    expect(parsePickTradeDeadline({ mode: 'week', week: 52 })).toEqual({ ok: true, value: { mode: 'week', week: 52 } })
    for (const bad of [{ mode: 'week', week: 53 }, { mode: 'week', week: 2.5 }, { mode: 'week' }, { mode: 'never' }, 'open', null]) {
      expect(parsePickTradeDeadline(bad).ok).toBe(false)
    }
  })

  it('applies to dynasty, devy and C2C leagues only', () => {
    const settings = { pick_trade_deadline: { mode: 'open' } }
    expect(pickTradeDeadlineFor({ leagueType: 'dynasty', settings })).toEqual({ mode: 'open' })
    expect(pickTradeDeadlineFor({ leagueType: 'c2c', settings })).toEqual({ mode: 'open' })
    expect(pickTradeDeadlineFor({ leagueType: 'redraft', isDynasty: true, settings })).toEqual({ mode: 'open' })
    expect(pickTradeDeadlineFor({ leagueType: 'redraft', settings })).toEqual({ mode: 'same' })
    expect(pickTradeDeadlineFor({ leagueType: 'keeper', settings })).toEqual({ mode: 'same' })
  })

  it('a pick trade is every item a pick: a player or FAAB makes it a player trade', () => {
    expect(isPicksOnlyTrade([{ itemType: 'rookie_pick' }, { itemType: 'devy_pick' }, { itemType: 'future_pick' }])).toBe(true)
    expect(isPicksOnlyTrade([{ itemType: 'rookie_pick' }, { itemType: 'player' }])).toBe(false)
    expect(isPicksOnlyTrade([{ itemType: 'rookie_pick' }, { itemType: 'faab' }])).toBe(false)
    expect(isPicksOnlyTrade([])).toBe(false)
  })

  it('a week rule closes AFTER its week, and only in season', () => {
    const r = { mode: 'week' as const, week: 14 }
    expect(pickTradeDeadlinePassed(r, { inSeason: true, currentWeek: 14 })).toBe(false)
    expect(pickTradeDeadlinePassed(r, { inSeason: true, currentWeek: 15 })).toBe(true)
    expect(pickTradeDeadlinePassed(r, { inSeason: false, currentWeek: 17 })).toBe(false)
    expect(pickTradeDeadlinePassed({ mode: 'open' }, { inSeason: true, currentWeek: 17 })).toBe(false)
  })
})

describe('reads that take only a league id', () => {
  const deps = (league: Record<string, unknown>, week: number) => ({
    leagueDb: { league: { findUnique: vi.fn(async () => league) } } as never,
    prisma: { redraftSeason: { findFirst: vi.fn(async () => ({ id: 's', currentWeek: week, status: 'active' })) } } as never,
    resolveWeek: async () => week,
  })
  const base = { id: 'L', lifecycleState: 'in_season', platform: 'allfantasy', tradeDeadlineWeek: 11, leagueType: 'dynasty' }

  it('the draft room, which trades only picks, reads the pick rule', async () => {
    const open = { ...base, settings: { pick_trade_deadline: { mode: 'open' } } }
    expect(await tradeDeadlineRefusal('L', deps(open, 13), { picksOnly: true })).toBeNull()
    expect(await tradeDeadlineRefusal('L', deps(open, 13))).toBe('Trade deadline passed after Week 11.')
    const week = { ...base, settings: { pick_trade_deadline: { mode: 'week', week: 12 } } }
    expect(await tradeDeadlineRefusal('L', deps(week, 13), { picksOnly: true })).toBe('Pick trades closed after Week 12.')
    expect(await tradeDeadlineRefusal('L', deps({ ...base, settings: null }, 13), { picksOnly: true })).toBe('Trade deadline passed after Week 11.')
  })

  it('the Trade Center chip: nothing when pick trades follow the deadline, the rule and whether it closed otherwise', async () => {
    expect(await loadPickTradeDeadlineView('L', deps({ ...base, settings: null }, 13))).toBeNull()
    expect(await loadPickTradeDeadlineView('L', deps({ ...base, leagueType: 'redraft', settings: { pick_trade_deadline: { mode: 'open' } } }, 13))).toBeNull()
    expect(await loadPickTradeDeadlineView('L', deps({ ...base, settings: { pick_trade_deadline: { mode: 'open' } } }, 13))).toEqual({ mode: 'open', week: null, passed: false })
    expect(await loadPickTradeDeadlineView('L', deps({ ...base, settings: { pick_trade_deadline: { mode: 'week', week: 12 } } }, 13))).toEqual({ mode: 'week', week: 12, passed: true })
  })
})

describe('the Commissioner Hub calendar', () => {
  const input = (pickTradeDeadline: unknown, language = 'en') =>
    buildLeagueCalendar({
      now: new Date('2026-10-01T00:00:00Z'), leagueId: 'L', platformLabel: 'AllFantasy', native: true, status: 'in_season', season: 2026,
      draftAt: null, waivers: null, tradeDeadlineWeek: 11, noTradeDeadline: false, pickTradeDeadline: pickTradeDeadline as never,
      playoffStartWeek: 15, currentWeek: 5, weekStarts: new Map(), dues: null, polls: [], language,
    })

  it('a week rule is its own event; open is said in a line; the default adds nothing', () => {
    const week = input({ mode: 'week', week: 16 })
    expect(week.events.find((e) => e.id === 'pick-trade-deadline')).toMatchObject({ title: 'Pick trade deadline', week: 16, detail: 'Trades made only of draft picks close after week 16.' })
    expect(input({ mode: 'open' }).gaps).toContain('Pick trades stay open all season; only player trades close at the deadline.')
    const none = input(null)
    expect(none.events.some((e) => e.id === 'pick-trade-deadline')).toBe(false)
    expect(none.gaps.some((g) => g.includes('Pick trades'))).toBe(false)
  })

  it('in Spanish', () => {
    expect(input({ mode: 'week', week: 16 }, 'es').events.find((e) => e.id === 'pick-trade-deadline')?.title).toBe('Fecha límite para intercambiar selecciones')
  })
})
