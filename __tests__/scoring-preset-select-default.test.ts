/**
 * Scoring presets default to the Sleeper-style preset for a league whose scoring was never saved,
 * list it first, and never override a saved choice or what a non-commissioner sees (2026-10-14).
 */
import { describe, expect, it } from 'vitest'
import { orderPresetKeys, pickInitialPreset } from '@/components/league-settings/scoring/ScoringPresetSelect'

const PRESETS = [
  { key: 'af_default', rules: { rec: 0.5 } },
  { key: 'sleeper_default', rules: { rec: 1 } },
  { key: 'yahoo_default', rules: { rec: 0.5 } },
]

describe('pickInitialPreset', () => {
  it('never-saved league + commissioner → Sleeper, with its rules staged', () => {
    expect(pickInitialPreset({ presetKey: 'af_default', lastUpdatedAt: null }, PRESETS, 'sleeper_default', 'af_default', true))
      .toEqual({ key: 'sleeper_default', stagedRules: { rec: 1 } })
  })
  it('a saved choice is respected', () => {
    expect(pickInitialPreset({ presetKey: 'af_default', lastUpdatedAt: '2026-01-01T00:00:00Z' }, PRESETS, 'sleeper_default', 'af_default', true))
      .toEqual({ key: 'af_default', stagedRules: null })
    expect(pickInitialPreset({ presetKey: 'yahoo_default', lastUpdatedAt: null }, PRESETS, 'sleeper_default', 'af_default', true).key).toBe('yahoo_default')
  })
  it('a non-commissioner sees what is live, not a staged default', () => {
    expect(pickInitialPreset({ presetKey: 'af_default', lastUpdatedAt: null }, PRESETS, 'sleeper_default', 'af_default', false))
      .toEqual({ key: 'af_default', stagedRules: null })
  })
  it('a sport without the Sleeper preset is left alone', () => {
    expect(pickInitialPreset({ presetKey: 'af_default', lastUpdatedAt: null }, [PRESETS[0]!], 'sleeper_default', 'af_default', true).key).toBe('af_default')
  })
})

describe('orderPresetKeys', () => {
  it('puts the default first and keeps the rest in order', () => {
    expect(orderPresetKeys(['af_default', 'af_ppr', 'sleeper_default', 'custom'], 'sleeper_default')).toEqual(['sleeper_default', 'af_default', 'af_ppr', 'custom'])
    expect(orderPresetKeys(['af_default', 'custom'], undefined)).toEqual(['af_default', 'custom'])
  })
})
