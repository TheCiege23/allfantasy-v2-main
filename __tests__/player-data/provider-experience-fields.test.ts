import { describe, expect, it } from 'vitest'
import {
  extractClearSportsExperienceSignals,
  extractExperienceSignalsFromProviderPayload,
  extractTheSportsDbExperienceSignals,
  normalizeExperienceNumber,
} from '@/lib/player-data/providerExperienceFields'

describe('providerExperienceFields', () => {
  it('extracts explicit isRookie from TheSportsDB-like payload', () => {
    const r = extractTheSportsDbExperienceSignals({ player: { isRookie: true } })
    expect(r.rookie).toBe(true)
    expect(r.field).toMatch(/isRookie/i)
  })

  it('extracts draftYear from TheSportsDB-like payload', () => {
    const r = extractTheSportsDbExperienceSignals({ draft_year: 2023 })
    expect(r.draftYear).toBe(2023)
    expect(r.reason).toContain('draft')
  })

  it('extracts debutYear from ClearSports-like payload', () => {
    const r = extractClearSportsExperienceSignals({ debutYear: 2021 })
    expect(r.debutYear).toBe(2021)
  })

  it('extracts debut year from MLB debut string when present', () => {
    const r = extractExperienceSignalsFromProviderPayload({ mlbDebut: '2019-08-12' }, 'unknown')
    expect(r.debutYear).toBe(2019)
  })

  it('extracts pro seasons from service-time style numeric fields when present', () => {
    const st = extractExperienceSignalsFromProviderPayload({ serviceTimeYears: 2.1 }, 'unknown')
    expect(st.proYears).toBe(2)
  })

  it('does not infer rookie from age alone', () => {
    const r = extractExperienceSignalsFromProviderPayload({ age: 21 }, 'unknown')
    expect(r.reason).toBe('no_matching_fields')
  })

  it('does not infer rookie from college alone for pro-style payloads', () => {
    const r = extractExperienceSignalsFromProviderPayload({ college: 'Alabama' }, 'unknown')
    expect(r.reason).toBe('no_matching_fields')
  })

  it('normalizeExperienceNumber handles R, Rookie, and numeric strings', () => {
    expect(normalizeExperienceNumber('R').rookie).toBe(true)
    expect(normalizeExperienceNumber('Rookie').rookie).toBe(true)
    expect(normalizeExperienceNumber('2 years').proYears).toBe(2)
    expect(normalizeExperienceNumber(0).proYears).toBe(0)
  })
})
