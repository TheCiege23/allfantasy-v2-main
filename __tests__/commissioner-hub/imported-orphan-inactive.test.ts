import { describe, expect, it } from 'vitest'
import { buildCommissionerHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'

/**
 * Imported orphan teams used to be stored with an empty owner key, which this health check reads as
 * "no manager". They now carry `orphan-<provider>-<teamId>` (one per team, so two orphans no longer
 * share a row) — and the four-hourly sync touches them, so `updatedAt` alone would call them active.
 */
const NOW = new Date('2026-09-17T12:00:00.000Z')
const roster = (id: string, platformUserId: string) => ({
  id,
  platformUserId,
  updatedAt: NOW,
  playerData: { players: ['p1'], starters: ['p1'], lineup_sections: { starters: [{ id: 'p1', position: 'QB' }], bench: [] } },
})
const inactive = (rosters: ReturnType<typeof roster>[]) =>
  buildCommissionerHealthSnapshot({
    now: NOW,
    league: { id: 'l', name: 'L', sport: 'NFL', leagueType: 'dynasty', leagueSize: rosters.length, rosters },
  } as never).metrics.inactiveTeams

describe('an imported orphan counts as inactive, however recently it was synced', () => {
  it('🛑 under its own orphan key', () => {
    expect(inactive([roster('a', 'mgr-1'), roster('b', 'orphan-sleeper-10'), roster('c', 'orphan-sleeper-11')])).toBe(2)
  })

  it('[control] under the old empty key', () => {
    expect(inactive([roster('a', 'mgr-1'), roster('b', '')])).toBe(1)
  })

  it('[control] a managed team synced now is active', () => {
    expect(inactive([roster('a', 'mgr-1'), roster('b', '1234567890')])).toBe(0)
  })
})
