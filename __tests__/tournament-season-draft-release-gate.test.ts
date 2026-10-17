import { describe, expect, it, vi } from 'vitest'
import { hasSeasonDraftRelease } from '@/lib/tournament/seasonDraftReleaseGate'

const marker = { version: 1, launchBlocked: true, tournamentId: 't1', freezeId: 'f1', manifestHash: 'hash1', key: 'stage-1-league-1' }
const settings = { seasonTournament: marker }
const receipt = { version: 1, freezeId: 'f1', manifestHash: 'hash1', key: marker.key, leagueId: 'league1', seasonLaunchReady: false }
const reader = (data: unknown) => ({ tournamentAuditLog: { findFirst: vi.fn(async () => data == null ? null : { data }) } }) as any

describe('audited opening-draft release gate', () => {
  it('requires an exact frozen league receipt before allowing draft actions', async () => {
    const db = reader(receipt)
    expect(await hasSeasonDraftRelease('league1', settings, db)).toBe(true)
    expect(db.tournamentAuditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tournamentId: 't1', action: 'season_opening_draft_released', targetType: 'league', targetId: 'league1' } }))
    expect(await hasSeasonDraftRelease('league2', settings, reader(receipt))).toBe(false)
    expect(await hasSeasonDraftRelease('league1', settings, reader({ ...receipt, manifestHash: 'other' }))).toBe(false)
    expect(await hasSeasonDraftRelease('league1', settings, reader({ ...receipt, seasonLaunchReady: true }))).toBe(false)
  })

  it('refuses missing or altered frozen markers without querying the audit log', async () => {
    const db = reader(receipt)
    expect(await hasSeasonDraftRelease('league1', {}, db)).toBe(false)
    expect(await hasSeasonDraftRelease('league1', { seasonTournament: { ...marker, launchBlocked: false } }, db)).toBe(false)
    expect(db.tournamentAuditLog.findFirst).not.toHaveBeenCalled()
  })
})
