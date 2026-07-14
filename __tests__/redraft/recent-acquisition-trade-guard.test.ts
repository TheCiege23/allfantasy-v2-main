import { describe, expect, it } from 'vitest'
import { evaluateRecentAcquisition } from '@/lib/league-trade-engine/recentAcquisitionGuard'

describe('recent acquisition trade guard', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('blocks authoritative waiver, free-agent, trade, and commissioner additions inside the window', () => {
    for (const acquisitionType of ['waiver', 'free_agent', 'trade', 'commissioner_add']) {
      expect(evaluateRecentAcquisition({ acquiredAt: new Date('2026-09-10T11:00:00Z'), acquisitionType, restrictionHours: 24, evaluatedAt: now })).toMatchObject({ allowed: false, code: 'PLAYER_RECENTLY_ADDED' })
    }
  })

  it('allows expired restrictions and imported or drafted baseline players', () => {
    expect(evaluateRecentAcquisition({ acquiredAt: new Date('2026-09-08T11:00:00Z'), acquisitionType: 'waiver', restrictionHours: 24, evaluatedAt: now })).toEqual({ allowed: true })
    expect(evaluateRecentAcquisition({ acquiredAt: null, acquisitionType: 'imported', restrictionHours: 24, evaluatedAt: now })).toEqual({ allowed: true })
    expect(evaluateRecentAcquisition({ acquiredAt: null, acquisitionType: 'drafted', restrictionHours: 24, evaluatedAt: now })).toEqual({ allowed: true })
  })

  it('does not invent missing authoritative time', () => {
    expect(evaluateRecentAcquisition({ acquiredAt: null, acquisitionType: 'waiver', restrictionHours: 24, evaluatedAt: now })).toMatchObject({ allowed: false, code: 'ACQUISITION_TIME_UNAVAILABLE' })
  })
})
