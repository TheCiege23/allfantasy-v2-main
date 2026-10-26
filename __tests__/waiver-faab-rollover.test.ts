/**
 * FAAB at season rollover (lib/waiver-wire/faab-rollover.ts): the commissioner chooses reset or carry
 * over; unset, each renewal keeps what it always did. Saving the setting moves no balance.
 */
import { describe, expect, it } from 'vitest'
import {
  effectiveFaabRolloverRule,
  faabBalanceAfterRollover,
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
