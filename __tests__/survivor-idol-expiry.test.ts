import { describe, expect, it } from 'vitest'
import {
  isSurvivorIdolExpired,
  survivorIdolExpiredMessage,
  survivorIdolExpiryLabel,
  survivorIdolExpiryRule,
  survivorIdolExpiryText,
  survivorIdolRowExpiry,
} from '@/lib/survivor/survivorIdolExpiry'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'

/** ONE league rule for idol expiry (owner's call, 2026-10-20), read from settings and enforced everywhere. */
describe('idol expiry rule', () => {
  it('defaults to "while at least 5 managers remain", and reads the legacy invalid-at count when that is all there is', () => {
    expect(survivorIdolExpiryRule(null)).toEqual({ mode: 'players_left', playersLeft: 5, week: 10 })
    expect(survivorIdolExpiryRule({ idolInvalidRemainingPlayers: 3 })).toEqual({ mode: 'players_left', playersLeft: 4, week: 10 })
    expect(survivorIdolExpiryRule(normalizeSurvivorFoundationSettings({ idolExpiryMode: 'week', idolExpiryWeek: 14 }))).toEqual({ mode: 'week', playersLeft: 5, week: 14 })
    expect(survivorIdolExpiryRule(normalizeSurvivorFoundationSettings({ idolExpiryMode: 'bogus' })).mode).toBe('players_left')
  })

  it('players-left: playable while at least N remain, expired once fewer are left', () => {
    const rule = survivorIdolExpiryRule({ idolExpiryMode: 'players_left', idolExpiryRemainingPlayers: 5 })
    expect(isSurvivorIdolExpired(rule, { activePlayerCount: 5, week: 20, phase: 'post_merge' })).toBe(false)
    expect(isSurvivorIdolExpired(rule, { activePlayerCount: 4 })).toBe(true)
    expect(survivorIdolExpiryText(rule)).toBe('Play it while at least 5 managers remain; it expires once fewer are left.')
    expect(survivorIdolExpiredMessage(rule)).toBe('Idols are invalid once fewer than 5 managers remain.')
    expect(survivorIdolRowExpiry(rule)).toEqual({ expiresAtMerge: false, expiresAtWeek: null, validUntilPhase: 'final_5' })
  })

  it('merge: expired in any merged phase, whatever the counts', () => {
    const rule = survivorIdolExpiryRule({ idolExpiryMode: 'merge' })
    expect(isSurvivorIdolExpired(rule, { activePlayerCount: 2, week: 30, phase: 'pre_merge' })).toBe(false)
    for (const phase of ['merge', 'post_merge', 'jury', 'finale']) expect(isSurvivorIdolExpired(rule, { activePlayerCount: 12, week: 3, phase })).toBe(true)
    expect(survivorIdolExpiryLabel(rule)).toBe('At the merge')
    expect(survivorIdolRowExpiry(rule)).toEqual({ expiresAtMerge: true, expiresAtWeek: null, validUntilPhase: 'merge' })
  })

  it('week: playable through the week, expired after it; the row stores week + 1 for the >= check at play time', () => {
    const rule = survivorIdolExpiryRule({ idolExpiryMode: 'week', idolExpiryWeek: 10 })
    expect(isSurvivorIdolExpired(rule, { week: 10, activePlayerCount: 2, phase: 'post_merge' })).toBe(false)
    expect(isSurvivorIdolExpired(rule, { week: 11 })).toBe(true)
    expect(survivorIdolExpiryText(rule)).toBe('Play it by week 10; it expires after that week.')
    expect(survivorIdolRowExpiry(rule)).toEqual({ expiresAtMerge: false, expiresAtWeek: 11, validUntilPhase: 'week_10' })
  })

  it('the foundation settings carry the rule and the Shot in the Dark odds, with safe defaults', () => {
    const settings = normalizeSurvivorFoundationSettings({ shotInTheDarkOdds: 5, idolExpiryMode: 'week', idolExpiryWeek: 99 })
    expect(settings.shotInTheDarkOdds).toBe(5)
    expect(settings.idolExpiryWeek).toBe(52)
    expect(normalizeSurvivorFoundationSettings({ shotInTheDarkOdds: 7 }).shotInTheDarkOdds).toBe(6)
    expect(normalizeSurvivorFoundationSettings(null)).toMatchObject({ idolExpiryMode: 'players_left', idolExpiryRemainingPlayers: 5, shotInTheDarkOdds: 6 })
  })
})
