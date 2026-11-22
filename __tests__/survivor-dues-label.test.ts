import { describe, expect, it } from 'vitest'
import {
  parseSurvivorDuesUsd,
  readSurvivorEntryFee,
  SURVIVOR_DUES_OFF_APP_NOTE,
  survivorDuesTrackerSeed,
} from '@/lib/survivor/survivorCreationAvailability'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'

/*
 * Owner's call, 2026-10-25: AllFantasy takes no payments of any kind. A Survivor league is always free;
 * "paid" labels dues collected on LeagueSafe or FanCred, and the commissioner marks managers paid.
 */
describe('Survivor dues label', () => {
  it('reads free and paid, with the amount optional', () => {
    expect(readSurvivorEntryFee(undefined, undefined)).toEqual({ mode: 'free', amountCents: null })
    expect(readSurvivorEntryFee('free', 2500)).toEqual({ mode: 'free', amountCents: null })
    expect(readSurvivorEntryFee('PAID', null)).toEqual({ mode: 'paid', amountCents: null })
    expect(readSurvivorEntryFee('paid', '2500')).toEqual({ mode: 'paid', amountCents: 2500 })
    for (const bad of [0, -1, 12.5, 'abc', 10_000_001]) expect(readSurvivorEntryFee('paid', bad)).toHaveProperty('error')
  })

  it('parses what the commissioner types', () => {
    expect(parseSurvivorDuesUsd('')).toBeNull()
    expect(parseSurvivorDuesUsd('  ')).toBeNull()
    expect(parseSurvivorDuesUsd('25')).toBe(2500)
    expect(parseSurvivorDuesUsd('$25.5')).toBe(2550)
    expect(parseSurvivorDuesUsd('0.01')).toBe(1)
    for (const bad of ['0', '-5', '25.555', 'ten', '1e3']) expect(parseSurvivorDuesUsd(bad)).toBe('invalid')
  })

  it('seeds League Dues switched on, in dollars, with nobody marked paid', () => {
    expect(survivorDuesTrackerSeed(2550)).toMatchObject({ enabled: true, amount: 25.5, currency: 'USD', paymentLink: null, entries: [] })
    expect(survivorDuesTrackerSeed(null).amount).toBeNull()
  })

  it('says plainly that the app holds no money', () => {
    expect(SURVIVOR_DUES_OFF_APP_NOTE).toMatch(/never collects or holds money/)
    expect(SURVIVOR_DUES_OFF_APP_NOTE).toMatch(/LeagueSafe/)
  })

  it('the wizard flags a bad dues amount on a paid Survivor league only', () => {
    const base = { ...DEFAULT_V2_STATE, leagueType: 'survivor' as const, sport: 'NBA' as const, teamCount: 16, survivorTribeCount: 4 }
    const codes = (s: typeof base) => analyzeCreateLeagueCompletion(s).map((i) => i.code)
    expect(codes({ ...base, survivorEntryFeeMode: 'paid', survivorDuesUsd: 'ten' })).toContain('survivor_dues_invalid')
    expect(codes({ ...base, survivorEntryFeeMode: 'paid', survivorDuesUsd: '' })).not.toContain('survivor_dues_invalid')
    expect(codes({ ...base, survivorEntryFeeMode: 'free', survivorDuesUsd: 'ten' })).not.toContain('survivor_dues_invalid')
  })
})
