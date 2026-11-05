import { describe, expect, it } from 'vitest'
import { selectCurrentNcaabAthletes } from '@/lib/devy/ncaabRosterEvidence'
const now = new Date('2026-10-30T12:00:00Z')
const snapshot = (teamId: string, observedAt = now.toISOString()) => ({ cacheKey: `espn:ncaab:roster:2027:${teamId}`, expiresAt: new Date('2026-12-01T00:00:00Z'), data: { seasonYear: 2027, teamId, school: `School ${teamId}`, observedAt, athletes: [{ id: '123', fullName: 'A Player', position: 'G', jersey: '4' }] } })
describe('current college roster evidence', () => {
  it('preserves a stable sport-scoped athlete ID', () => {
    expect(selectCurrentNcaabAthletes([snapshot('1')], now).athletes).toMatchObject([{ id: 'espn:ncaab:123', espnId: '123', school: 'School 1', position: 'G' }])
  })
  it('refuses an athlete appearing on two schools while a transfer is unresolved', () => {
    expect(selectCurrentNcaabAthletes([snapshot('1'), snapshot('2')], now)).toEqual({ athletes: [], ambiguous: ['123'] })
  })
  it('ignores stale, expired, wrong-season, and future evidence', () => {
    const stale = snapshot('1', '2026-10-01T12:00:00Z')
    const expired = { ...snapshot('2'), expiresAt: new Date('2026-10-29T00:00:00Z') }
    const wrongSeason = { ...snapshot('3'), cacheKey: 'espn:ncaab:roster:2026:3' }
    const future = snapshot('4', '2026-10-31T12:00:00Z')
    expect(selectCurrentNcaabAthletes([stale, expired, wrongSeason, future], now)).toEqual({ athletes: [], ambiguous: [] })
  })
  it('does not guess a missing basketball position', () => {
    const r = snapshot('1'); r.data.athletes[0].position = ''
    expect(selectCurrentNcaabAthletes([r], now).athletes).toEqual([])
  })
})
