import { describe, expect, it } from 'vitest'
import { readCommissionerTemplatePin, withCommissionerTemplatePin } from '@/lib/commissioner-os/profile/templatePin'
import { applicableTemplates, OWNER_APPLICABLE_TEMPLATE_IDS } from '@/lib/commissioner-os/profile/templateOffers'
import { latestVersionOf } from '@/lib/commissioner-os/template/registry'

/*
 * Nothing could write a template pin before 2026-10-02: 0 production leagues were pinned, so the EFL
 * template could not reach "EFL Dynasty League", the flat 32-team Sleeper league it was written for.
 */

const PIN = { id: 'efl_promotion_relegation_dynasty', version: '1.2.0' }

describe('withCommissionerTemplatePin', () => {
  const settings = {
    publicStandings: true,
    conceptRules: { concept: 'dynasty', version: 3, extensions: { aliasTags: ['x'] } },
  }

  it('sets a pin the canonical reader reads back, and keeps everything else', () => {
    const next = withCommissionerTemplatePin(settings, PIN)
    expect(readCommissionerTemplatePin(next)).toEqual(PIN)
    expect(next.publicStandings).toBe(true)
    expect(next.conceptRules).toMatchObject({ concept: 'dynasty', version: 3, extensions: { aliasTags: ['x'] } })
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(settings)
    withCommissionerTemplatePin(settings, PIN)
    expect(JSON.stringify(settings)).toBe(before)
  })

  it('removes the pin — BOTH spellings, or the reader would still find the older one', () => {
    const both = { conceptRules: { commissionerTemplate: PIN, extensions: { commissionerTemplate: PIN, aliasTags: ['x'] } } }
    const next = withCommissionerTemplatePin(both, null)
    expect(readCommissionerTemplatePin(next)).toBeNull()
    expect(next.conceptRules).toEqual({ extensions: { aliasTags: ['x'] } })
  })

  it('pins a league whose settings were empty or malformed', () => {
    expect(readCommissionerTemplatePin(withCommissionerTemplatePin(null, PIN))).toEqual(PIN)
    expect(readCommissionerTemplatePin(withCommissionerTemplatePin('nonsense', PIN))).toEqual(PIN)
  })
})

describe('applicableTemplates', () => {
  const efl = { sport: 'NFL', canonicalFormatId: 'dynasty', teamCount: 32 }

  it('offers EFL to a 32-team NFL dynasty league, at the version a new pin should use', () => {
    const offers = applicableTemplates(efl)
    expect(offers.map((t) => t.id)).toEqual(['efl_promotion_relegation_dynasty'])
    expect(offers[0].version).toBe(latestVersionOf('efl_promotion_relegation_dynasty')!.version)
  })

  it('never offers a template the league does not fit', () => {
    expect(applicableTemplates({ ...efl, teamCount: 12 })).toEqual([])
    expect(applicableTemplates({ ...efl, canonicalFormatId: 'redraft' })).toEqual([])
    expect(applicableTemplates({ ...efl, sport: 'NBA' })).toEqual([])
    expect(applicableTemplates({ sport: null, canonicalFormatId: null, teamCount: null })).toEqual([])
  })

  it('is an allowlist: Survivor All-Stars is published but not owner-applicable', () => {
    expect(OWNER_APPLICABLE_TEMPLATE_IDS).not.toContain('survivor_all_stars_guillotine')
  })
})
