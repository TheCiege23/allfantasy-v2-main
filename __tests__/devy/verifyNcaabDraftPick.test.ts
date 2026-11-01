import { describe, expect, it, vi } from 'vitest'
import { verifyNcaabCollegeDraftPick } from '@/lib/devy/verifyNcaabDraftPick'
const now = new Date('2026-10-30T12:00:00Z')
const player = { id: 'espn:ncaab:1', name: 'A Player', position: 'G', school: 'School', sport: 'NCAAB', source: 'espn_ncaab_roster', devyEligible: true, graduatedToNFL: false }
const snapshot = (teamId = '1') => ({ cacheKey: `espn:ncaab:roster:2027:${teamId}`, expiresAt: new Date('2026-12-01'), data: { seasonYear: 2027, teamId, school: 'School', observedAt: now.toISOString(), athletes: [{ id: '1', fullName: 'A Player', position: 'G' }] } })
const input = { playerId: player.id, playerName: player.name, position: player.position, now }
const db = (row = player, rows = [snapshot()]) => ({ devyPlayer: { findUnique: vi.fn().mockResolvedValue(row) }, sportsDataCache: { findMany: vi.fn().mockResolvedValue(rows) } }) as any

describe('verify college basketball draft pick', () => {
  it('accepts a current exact provider ID and matching athlete', async () => { expect(await verifyNcaabCollegeDraftPick(db(), input)).toBe(true) })
  it('rejects name, position, sport, source, and eligibility mismatches', async () => {
    expect(await verifyNcaabCollegeDraftPick(db(), { ...input, playerName: 'Other' })).toBe(false)
    expect(await verifyNcaabCollegeDraftPick(db(), { ...input, position: 'F' })).toBe(false)
    for (const altered of [{ sport: 'NCAAF' }, { source: 'other' }, { devyEligible: false }, { graduatedToNFL: true }, { school: 'Old school' }]) {
      expect(await verifyNcaabCollegeDraftPick(db({ ...player, ...altered }), input)).toBe(false)
    }
  })
  it('rejects stale, conflicting and malformed evidence', async () => {
    expect(await verifyNcaabCollegeDraftPick(db(), { ...input, now: new Date('2026-11-20T12:00:00Z') })).toBe(false)
    expect(await verifyNcaabCollegeDraftPick(db(player, [snapshot('1'), snapshot('2')]), input)).toBe(false)
    const mock = db()
    expect(await verifyNcaabCollegeDraftPick(mock, { ...input, playerId: '1' })).toBe(false)
    expect(mock.devyPlayer.findUnique).not.toHaveBeenCalled()
  })
})
