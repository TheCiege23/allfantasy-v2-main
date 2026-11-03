import { describe, expect, it } from 'vitest'
import { buildNbaCampusWeekSnapshot } from '@/lib/c2c/nbaCampusWeekSnapshot'
const now = new Date('2026-11-01T12:00:00Z')
const athlete = { id: 'espn:ncaab:12', espnId: '12', teamId: '10', name: 'A', school: 'School', position: 'G', jersey: null, observedAt: now }
const playerData = { lineup_sections: { devy: ['espn:ncaab:12'], campus: ['espn:ncaab:12'] } }
describe('NBA campus weekly school evidence', () => {
  it('records the rostered starter and preserves that week after a transfer', () => {
    const first = buildNbaCampusWeekSnapshot({ playerData, season: 2026, week: 2, now, evidence: [athlete] })
    expect(first.snapshot?.players[0]).toMatchObject({ id: athlete.id, teamId: '10' })
    const later = buildNbaCampusWeekSnapshot({ playerData, season: 2026, week: 2, now, evidence: [{ ...athlete, teamId: '20' }], previous: first.snapshot })
    expect(later.snapshot?.players[0].teamId).toBe('10')
    const next = buildNbaCampusWeekSnapshot({ playerData, season: 2026, week: 3, now, evidence: [{ ...athlete, teamId: '20' }], previous: first.snapshot })
    expect(next.snapshot?.players[0].teamId).toBe('20')
  })
  it('refuses unknown or unowned college players', () => {
    expect(buildNbaCampusWeekSnapshot({ playerData, season: 2026, week: 2, now, evidence: [] })).toEqual({ snapshot: null, missing: ['espn:ncaab:12'] })
    expect(buildNbaCampusWeekSnapshot({ playerData: { lineup_sections: { campus: [athlete.id], devy: [] } }, season: 2026, week: 2, now, evidence: [athlete] }).snapshot).toBeNull()
  })
})
