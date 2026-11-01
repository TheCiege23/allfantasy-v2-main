/**
 * Redraft waivers (owner's decision 2026-10-20): FAAB is the default for new redraft leagues in
 * NFL, NBA, NHL and MLB, and every engine-supported waiver type stays a commissioner choice.
 *
 * The NBA redraft defaults used to disagree with each other — the redraft sport config said FAAB,
 * the sport-defaults registry said rolling with `faab_enabled: false` — and the registry is what
 * the canonical create path writes to `foundation_defaults.waiver` and `LeagueWaiverSettings`.
 */
import { describe, expect, it } from 'vitest'
import { getWaiverDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { resolveLeagueFormat } from '@/lib/league/format-engine'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { WAIVER_TYPES } from '@/lib/waiver-wire/types'
import { waiverSettingsRequestSchema } from '@/lib/waiver-wire/settings-request'
import { normalizeWaiverTypeForEngine } from '@/lib/waiver-wire/waiver-engine-config'
import { orderClaimsForProcessing } from '@/lib/waiver-wire/process-engine'
import { HUB_WAIVER_TYPE_OPTIONS } from '@/components/league-settings/tabs/WaiversTab'

const REDRAFT_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const

describe('redraft waiver default is FAAB in every default source', () => {
  for (const sport of REDRAFT_SPORTS) {
    it(`${sport}: registry, format resolution, foundation defaults and sport config agree on FAAB $100`, () => {
      const registry = getWaiverDefaults(sport, 'redraft')
      expect(registry).toMatchObject({
        waiver_type: 'faab',
        faab_enabled: true,
        FAAB_budget_default: 100,
        claim_priority_behavior: 'faab_highest',
      })

      const resolution = resolveLeagueFormat({ sport, leagueType: 'redraft', draftType: 'snake' })
      expect(resolution.waiverDefaults.waiver_type).toBe('faab')
      expect(resolution.waiverDefaults.FAAB_budget_default).toBe(100)

      const foundation = getLeagueDefaults({ sport, format: 'redraft', draftType: 'snake', managerCount: 12 })
      expect(foundation.waiverSettings.waiver_type).toBe('faab')
      expect(foundation.waiverSettings.waiverType).toBe('faab')
      expect(foundation.waiverSettings.faabBudget).toBe(100)
      expect(foundation.waiverSettings.FAAB_budget_default).toBe(100)
      expect(foundation.waiverSettings.faab_enabled).toBe(true)

      const config = getRedraftSportConfig(sport.toLowerCase())
      expect(config.defaultWaiverType).toBe('faab')
      expect(config.defaultFaabBudget).toBe(100)
    })
  }

  it('leaves the STANDARD (no-variant) fallback alone, so leagues without a waiver row do not change', () => {
    // settings-service falls back to getWaiverDefaults(sport, league.leagueVariant) and a redraft
    // league's leagueVariant is null, so these are what an existing row-less league resolves to.
    expect(getWaiverDefaults('NBA').waiver_type).toBe('rolling')
    expect(getWaiverDefaults('NHL').waiver_type).toBe('reverse_standings')
    expect(getWaiverDefaults('NBA', 'STANDARD').waiver_type).toBe('rolling')
  })

  it('does not touch other formats', () => {
    expect(getWaiverDefaults('NBA', 'dynasty').waiver_type).toBe('rolling')
    expect(getWaiverDefaults('NHL', 'keeper').waiver_type).toBe('reverse_standings')
  })
})

describe('every engine waiver type is selectable, accepted and processed', () => {
  it('the league settings hub offers all engine types', () => {
    expect(HUB_WAIVER_TYPE_OPTIONS.map((o) => o.value).sort()).toEqual([...WAIVER_TYPES].sort())
  })

  for (const type of WAIVER_TYPES) {
    it(`${type}: the waiver settings API accepts it and the engine keeps it`, () => {
      expect(waiverSettingsRequestSchema.safeParse({ waiverType: type }).success).toBe(true)
      expect(normalizeWaiverTypeForEngine(type)).toBe(type)
    })
  }

  it('rejects an unknown waiver type', () => {
    expect(waiverSettingsRequestSchema.safeParse({ waiverType: 'blind_auction' }).success).toBe(false)
  })

  it('FAAB accepts the $0-bid and minimum-bid engine options', () => {
    expect(
      waiverSettingsRequestSchema.safeParse({
        waiverType: 'faab',
        faabBudget: 100,
        waiverEngineConfig: { allow_zero_faab_bid: true, faab_min_bid: 0 },
      }).success,
    ).toBe(true)
  })

  it('each type orders claims by its own rule', () => {
    const claim = (id: string, bid: number, priority: number, platformUserId: string, createdAt: string) =>
      ({
        id,
        faabBid: bid,
        priorityOrder: 1,
        createdAt,
        roster: { platformUserId, waiverPriority: priority },
      }) as any
    const a = claim('a', 5, 2, 'ua', '2026-10-20T10:00:00Z')
    const b = claim('b', 20, 3, 'ub', '2026-10-20T11:00:00Z')
    const c = claim('c', 1, 1, 'uc', '2026-10-20T12:00:00Z')
    // Standings rank (1 = first place): ub is last, so it gets first pick.
    const ranks = new Map([['ub', 3], ['uc', 2], ['ua', 1]])
    const ids = (type: string) => orderClaimsForProcessing([a, b, c], type, ranks).map((x) => x.id)
    expect(ids('faab')).toEqual(['b', 'a', 'c'])
    expect(ids('rolling')).toEqual(['c', 'a', 'b'])
    expect(ids('standard')).toEqual(['c', 'a', 'b'])
    expect(ids('reverse_standings')).toEqual(['b', 'c', 'a'])
    expect(ids('fcfs')).toEqual(['a', 'b', 'c'])
  })
})
