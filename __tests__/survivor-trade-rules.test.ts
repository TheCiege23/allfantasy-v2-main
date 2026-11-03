import { describe, expect, it } from 'vitest'
import { SURVIVOR_GOVERNANCE_DEFAULTS } from '@/lib/survivor/survivorGovernanceSettings'
import { easternWeekMinute, judgeSurvivorTrade, minutesSinceTribal, survivorTradeWindowStatus, tradeCrossesTribes } from '@/lib/survivor/survivorTradeRules'

// Tribal Council: Tuesday 20:00 ET. 2026-11-03 is a Tuesday; ET is UTC-5 in November.
const tribal = { tribalDay: 'Tuesday', tribalTime: '20:00' }
const at = (iso: string) => ({ ...tribal, now: new Date(iso) })
const rules = { ...SURVIVOR_GOVERNANCE_DEFAULTS, tradeRulesEnabled: true }
const crossTribe = new Map([['ra', 'scorps'], ['rb', 'shrooms']])
const sameTribe = new Map([['ra', 'scorps'], ['rb', 'scorps']])
const unplayed = [{ playerId: 'p1', playerName: 'Player One', fromRosterId: 'ra', hasPlayed: false }]
const played = [{ playerId: 'p2', playerName: 'Jalen Hurts', fromRosterId: 'ra', hasPlayed: true }]

describe('the Survivor week clock (US Eastern, from the Torch Ceremony)', () => {
  it('reads Eastern weekday and time', () => {
    expect(easternWeekMinute(new Date('2026-11-03T01:00:00Z'))).toBe(1 * 1440 + 20 * 60) // Monday 20:00 ET
    expect(minutesSinceTribal(new Date('2026-11-04T01:00:00Z'), 'Tuesday', '20:00')).toBe(0)
    expect(minutesSinceTribal(new Date('2026-11-04T02:30:00Z'), 'Tuesday', '20:00')).toBe(90)
  })

  it('the cross-tribe window is open from Tribal until Thursday 7 PM ET, then closed until the next Tribal', () => {
    const open = survivorTradeWindowStatus(rules, at('2026-11-05T15:00:00Z')) // Thursday 10:00 ET
    expect(open.crossTribeOpen).toBe(true)
    expect(open.crossTribeClosesAt?.toISOString()).toBe('2026-11-06T00:00:00.000Z')
    const closed = survivorTradeWindowStatus(rules, at('2026-11-06T00:30:00Z')) // Thursday 19:30 ET
    expect(closed.crossTribeOpen).toBe(false)
    expect(closed.crossTribeClosesAt).toBeNull()
  })

  it('the weekly freeze starts at its time and lifts at the next Tribal', () => {
    const freezing = { ...rules, weeklyTradeFreezeEnabled: true }
    expect(survivorTradeWindowStatus(freezing, at('2026-11-08T05:30:00Z')).frozen).toBe(true) // Sunday 00:30 ET
    expect(survivorTradeWindowStatus(freezing, at('2026-11-11T01:30:00Z')).frozen).toBe(false) // Tuesday 20:30 ET, after Tribal
  })
})

describe('judgeSurvivorTrade', () => {
  const base = { settings: rules, merged: false, tribalDoneThisWeek: false }

  it('rules off: everything passes', () => {
    expect(judgeSurvivorTrade({ ...base, settings: SURVIVOR_GOVERNANCE_DEFAULTS, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: crossTribe, players: played }).ok).toBe(true)
  })

  it('cross-tribe: allowed in the window, refused after it, banned outright', () => {
    expect(judgeSurvivorTrade({ ...base, clock: at('2026-11-05T15:00:00Z'), tribeByRoster: crossTribe, players: unplayed })).toEqual({ ok: true, crossTribe: true, bypassed: false })
    expect(judgeSurvivorTrade({ ...base, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: crossTribe, players: unplayed })).toEqual({ ok: false, code: 'SURVIVOR_CROSS_TRIBE_CLOSED' })
    expect(judgeSurvivorTrade({ ...base, settings: { ...rules, crossTribeTrades: 'banned' }, clock: at('2026-11-05T15:00:00Z'), tribeByRoster: crossTribe, players: unplayed })).toEqual({ ok: false, code: 'SURVIVOR_CROSS_TRIBE_BANNED' })
    expect(judgeSurvivorTrade({ ...base, settings: { ...rules, crossTribeTrades: 'allowed' }, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: crossTribe, players: unplayed }).ok).toBe(true)
  })

  it('within a tribe: any time for unplayed players; a played player waits for Tribal', () => {
    expect(judgeSurvivorTrade({ ...base, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: sameTribe, players: unplayed }).ok).toBe(true)
    expect(judgeSurvivorTrade({ ...base, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: sameTribe, players: played })).toEqual({ ok: false, code: 'SURVIVOR_PLAYED_LOCK', playerName: 'Jalen Hurts' })
    expect(judgeSurvivorTrade({ ...base, tribalDoneThisWeek: true, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: sameTribe, players: played }).ok).toBe(true)
    expect(judgeSurvivorTrade({ ...base, settings: { ...rules, withinTribeUnplayedOnly: false, playedLockUntilTribal: false }, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: sameTribe, players: played }).ok).toBe(true)
  })

  it('after the merge, tribes no longer matter; the freeze still does', () => {
    expect(judgeSurvivorTrade({ ...base, merged: true, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: crossTribe, players: unplayed }).ok).toBe(true)
    expect(judgeSurvivorTrade({ ...base, merged: true, settings: { ...rules, weeklyTradeFreezeEnabled: true }, clock: at('2026-11-08T05:30:00Z'), tribeByRoster: crossTribe, players: unplayed })).toEqual({ ok: false, code: 'SURVIVOR_TRADE_FROZEN' })
  })

  it('a free-trade bypass skips the tribe and played rules but never the freeze', () => {
    expect(judgeSurvivorTrade({ ...base, bypass: true, clock: at('2026-11-06T00:30:00Z'), tribeByRoster: crossTribe, players: played })).toEqual({ ok: true, crossTribe: true, bypassed: true })
    expect(judgeSurvivorTrade({ ...base, bypass: true, settings: { ...rules, weeklyTradeFreezeEnabled: true }, clock: at('2026-11-08T05:30:00Z'), tribeByRoster: crossTribe, players: played }).ok).toBe(false)
  })

  it('a roster with no tribe beside one with a tribe cannot be checked against a tribe rule', () => {
    expect(tradeCrossesTribes(new Map([['ra', 'scorps'], ['rb', null]]))).toBeNull()
    expect(tradeCrossesTribes(new Map([['ra', null], ['rb', null]]))).toBe(false)
    expect(judgeSurvivorTrade({ ...base, clock: at('2026-11-05T15:00:00Z'), tribeByRoster: new Map([['ra', 'scorps'], ['rb', null]]), players: unplayed })).toEqual({ ok: false, code: 'SURVIVOR_TRIBE_UNKNOWN' })
  })
})
