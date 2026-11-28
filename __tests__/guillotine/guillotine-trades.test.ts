/**
 * Trades in a Guilly league (owner's list, 2026-11-25): lib/guillotine/guillotineTradeRules.ts, the resolver that
 * every trade path reads, and the rules patch. The chop, the undo and the refusals run on a real database in
 * chop-week-db.test.ts.
 */
import { describe, expect, it } from 'vitest'
import type { League } from '@prisma/client'
import { readGuillotineTrades, tradesShouldBeClosed, writeGuillotineTradeRules } from '@/lib/guillotine/guillotineTradeRules'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { normalizeGuillotineRulesPatch } from '@/lib/guillotine/guillotineRules'

const guilly = (settings: unknown) => ({ id: 'L', guillotineMode: true, leagueVariant: 'guillotine', platform: 'allfantasy', settings, lockAllMoves: false, bestBallMode: false }) as unknown as League

describe('Guilly trades', () => {
  it('off unless the commissioner turns them on — every league saved before reads exactly as before', () => {
    expect(readGuillotineTrades({})).toEqual({ tradesAllowed: false, tradesCloseAtTeamsLeft: null, tradesClosed: false })
    expect(resolveLeagueTradeSettings(guilly({})).tradesAllowed).toBe(false)
    expect(resolveLeagueTradeSettings(guilly({ guillotineSettings: { tradesAllowed: true } })).tradesAllowed).toBe(true)
  })

  it('a closed window turns them off for every trade path the resolver feeds', () => {
    expect(resolveLeagueTradeSettings(guilly({ guillotineSettings: { tradesAllowed: true, tradesCloseAtTeamsLeft: 6, tradesClosed: true } })).tradesAllowed).toBe(false)
  })

  it('[control] a league with no settings at all does not throw', () => {
    expect(resolveLeagueTradeSettings(guilly(null)).tradesAllowed).toBe(false)
  })

  it('closes at the line and under it, only when trades are on and the line is set', () => {
    const on = { tradesAllowed: true, tradesCloseAtTeamsLeft: 6 }
    expect([8, 7, 6, 5].map((n) => tradesShouldBeClosed(on, n))).toEqual([false, false, true, true])
    expect(tradesShouldBeClosed({ ...on, tradesAllowed: false }, 2)).toBe(false)
    expect(tradesShouldBeClosed({ ...on, tradesCloseAtTeamsLeft: null }, 2)).toBe(false)
  })

  it('writing the commissioner’s choices keeps the rest of the settings and the closed mark', () => {
    const before = { other: 1, guillotineSettings: { tradesAllowed: true, tradesCloseAtTeamsLeft: 6, tradesClosed: true } }
    expect(writeGuillotineTradeRules(before, { tradesCloseAtTeamsLeft: null })).toEqual({ other: 1, guillotineSettings: { tradesAllowed: true, tradesClosed: true } })
    expect(writeGuillotineTradeRules({}, { tradesAllowed: true, tradesCloseAtTeamsLeft: 4 })).toEqual({ guillotineSettings: { tradesAllowed: true, tradesCloseAtTeamsLeft: 4 } })
  })

  it('saved through the rules; a closed mark is never accepted from the page', () => {
    expect(normalizeGuillotineRulesPatch({ tradesAllowed: true, tradesCloseAtTeamsLeft: 6 })).toEqual({ ok: true, value: { tradesAllowed: true, tradesCloseAtTeamsLeft: 6 } })
    expect(normalizeGuillotineRulesPatch({ tradesCloseAtTeamsLeft: null })).toEqual({ ok: true, value: { tradesCloseAtTeamsLeft: null } })
    expect(normalizeGuillotineRulesPatch({ tradesCloseAtTeamsLeft: 1 })).toMatchObject({ ok: false, error: { field: 'tradesCloseAtTeamsLeft' } })
    expect(normalizeGuillotineRulesPatch({ tradesAllowed: 'yes' })).toMatchObject({ ok: false, error: { field: 'tradesAllowed' } })
    expect(normalizeGuillotineRulesPatch({ tradesClosed: false })).toMatchObject({ ok: false })
  })
})
