/**
 * FAAB at season rollover (lib/waiver-wire/faab-rollover.ts): the commissioner chooses reset or carry
 * over; unset, each renewal keeps what it always did. Saving the setting moves no balance.
 */
import { describe, expect, it } from 'vitest'
import {
  effectiveFaabRolloverRule,
  faabBalanceAfterRollover,
  faabRolloverFamilyForLeague,
  renewalFamilyForLeague,
  storedFaabRolloverRule,
} from '@/lib/waiver-wire/faab-rollover'
import { hubWaiverEngineConfigPatch, parseHubWaiverOptions, readFaabRolloverRule } from '@/lib/waiver-wire/hub-waiver-options'
import { waiverSettingsRequestSchema } from '@/lib/waiver-wire/settings-request'

describe('the rule a renewal applies', () => {
  it('unset: a redraft resets (as it always did), a keeper / dynasty league carries over (as it always did)', () => {
    expect(effectiveFaabRolloverRule(null, 'redraft')).toBe('reset')
    expect(effectiveFaabRolloverRule(null, 'carry_rosters')).toBe('carry_over')
  })

  it("the commissioner's choice wins in either family", () => {
    expect(effectiveFaabRolloverRule('carry_over', 'redraft')).toBe('carry_over')
    expect(effectiveFaabRolloverRule('reset', 'carry_rosters')).toBe('reset')
  })

  it('reset gives the starting budget; carry over keeps the balance, and seeds a team that has none', () => {
    expect(faabBalanceAfterRollover('reset', 100, 12)).toBe(100)
    expect(faabBalanceAfterRollover('carry_over', 100, 12)).toBe(12)
    expect(faabBalanceAfterRollover('carry_over', 100, 0)).toBe(0)
    expect(faabBalanceAfterRollover('carry_over', 100, null)).toBe(100)
  })

  it('reads the stored rule from the engine config, and nothing else as a rule', () => {
    expect(storedFaabRolloverRule({ faab_rollover_rule: 'carry_over' })).toBe('carry_over')
    expect(storedFaabRolloverRule({ faab_rollover_rule: 'RESET' })).toBe('reset')
    expect(storedFaabRolloverRule({ faab_rollover_rule: 'refund' })).toBeNull()
    expect(storedFaabRolloverRule(null)).toBeNull()
    expect(readFaabRolloverRule(undefined)).toBeNull()
  })
})

describe('renewalFamilyForLeague: the renew route\'s own classifier', () => {
  it('a keeper league NOT flagged isDynasty carries rosters (and so carries FAAB by default)', () => {
    expect(renewalFamilyForLeague({ leagueVariant: 'keeper', isDynasty: false })).toBe('carry_rosters')
    expect(renewalFamilyForLeague({ leagueVariant: null, settings: { league_type: 'keeper' }, isDynasty: false })).toBe('carry_rosters')
    expect(effectiveFaabRolloverRule(null, renewalFamilyForLeague({ leagueVariant: 'keeper', isDynasty: false }))).toBe('carry_over')
  })

  it('the dynasty family carries; a plain redraft resets', () => {
    expect(renewalFamilyForLeague({ leagueVariant: 'devy', isDynasty: false })).toBe('carry_rosters')
    expect(renewalFamilyForLeague({ leagueVariant: 'dynasty', isDynasty: true })).toBe('carry_rosters')
    // As the renew route reads it: an explicit `redraft` variant renews as a redraft even with the flag.
    expect(renewalFamilyForLeague({ leagueVariant: 'redraft', isDynasty: true })).toBe('redraft')
    expect(renewalFamilyForLeague({ leagueVariant: 'redraft', isDynasty: false })).toBe('redraft')
    expect(renewalFamilyForLeague({})).toBe('redraft')
  })
})

describe('faabRolloverFamilyForLeague: keeper and dynasty carry FAAB over by default', () => {
  it('an IDP keeper league (variant idp, which the renewal classifier reads as redraft) carries over', () => {
    const idpKeeper = { leagueType: 'keeper', leagueVariant: 'idp', settings: { league_type: 'keeper' }, isDynasty: false }
    expect(renewalFamilyForLeague(idpKeeper)).toBe('redraft')
    expect(faabRolloverFamilyForLeague(idpKeeper)).toBe('carry_rosters')
    expect(effectiveFaabRolloverRule(null, faabRolloverFamilyForLeague(idpKeeper))).toBe('carry_over')
  })

  it('the League.leagueType column alone is enough (no settings, no variant)', () => {
    expect(faabRolloverFamilyForLeague({ leagueType: 'keeper', leagueVariant: null, settings: null, isDynasty: false })).toBe('carry_rosters')
    expect(faabRolloverFamilyForLeague({ leagueType: 'dynasty' })).toBe('carry_rosters')
    expect(faabRolloverFamilyForLeague({ leagueType: 'redraft', settings: { leagueType: 'Devy' } })).toBe('carry_rosters')
  })

  it('the classifier still decides the rest: isDynasty and dynasty variants carry, redraft resets', () => {
    expect(faabRolloverFamilyForLeague({ leagueType: 'redraft', leagueVariant: 'dynasty', isDynasty: true })).toBe('carry_rosters')
    expect(faabRolloverFamilyForLeague({ leagueType: 'redraft', leagueVariant: null, isDynasty: true })).toBe('carry_rosters')
    expect(faabRolloverFamilyForLeague({ leagueType: 'redraft', leagueVariant: 'idp', settings: { league_type: 'redraft' }, isDynasty: false })).toBe('redraft')
    expect(faabRolloverFamilyForLeague({ leagueType: 'redraft' })).toBe('redraft')
    expect(faabRolloverFamilyForLeague({})).toBe('redraft')
  })

  it('a stored choice is never overridden: only the unset default moved', () => {
    expect(effectiveFaabRolloverRule('reset', faabRolloverFamilyForLeague({ leagueType: 'keeper' }))).toBe('reset')
    expect(effectiveFaabRolloverRule('carry_over', faabRolloverFamilyForLeague({ leagueType: 'redraft' }))).toBe('carry_over')
  })
})

describe('the commissioner option', () => {
  it('validates in the settings patch and writes ONLY the engine key — no balance is touched', () => {
    const parsed = parseHubWaiverOptions({ waiverFaabRollover: 'carry_over' }, { budget: 100 })
    expect(parsed).toEqual({ ok: true, options: { faabRolloverRule: 'carry_over' } })
    expect(hubWaiverEngineConfigPatch(parsed.ok ? parsed.options : {})).toEqual({ faab_rollover_rule: 'carry_over' })
    expect(parseHubWaiverOptions({ waiverFaabRollover: 'refund' }, { budget: 100 })).toEqual({ ok: false, error: 'Invalid waiverFaabRollover' })
  })

  it('the commissioner waivers API validates the engine keys too', () => {
    expect(waiverSettingsRequestSchema.safeParse({ waiverEngineConfig: { faab_rollover_rule: 'carry_over', free_agency_mode: 'after_run' } }).success).toBe(true)
    expect(waiverSettingsRequestSchema.safeParse({ waiverEngineConfig: { faab_rollover_rule: 'refund' } }).success).toBe(false)
    expect(waiverSettingsRequestSchema.safeParse({ waiverEngineConfig: { free_agency_mode: 'sleeper' } }).success).toBe(false)
  })
})
