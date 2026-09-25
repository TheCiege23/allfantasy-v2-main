import { expect, it, vi } from 'vitest'
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn() }))
vi.mock('@/lib/access/canAccessForUser', () => ({ canAccessForUser: vi.fn() }))
import { presentProfile, buildPsychologyGroundingLines } from '@/lib/psychological-profiles/ProfileAccess'
import type { ManagerPsychProfileView } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { publicRelationshipInsights } from '@/lib/relationship-insights/publicView'
import type { UnifiedRelationshipInsights } from '@/lib/relationship-insights/types'
import { publicDramaSummary } from '@/lib/drama-engine/publicNarrative'
import { readManagerFingerprints } from '@/lib/league-history/leagueWarehouseReads'

const profile = { id: 'P', leagueId: 'L', managerId: 'M', sport: 'NFL', sportLabel: 'NFL', updatedAt: new Date(),
  profileLabels: ['chaos agent'], aggressionScore: 91.123, riskToleranceScore: 88.123, activityScore: 55,
  tradeFrequencyScore: 67, waiverFocusScore: 77 } as ManagerPsychProfileView
it.each([false, true])('never presents a full profile even with opponent entitlement %s', canSeeOpponents => {
  for (const ownManagerIds of [new Set<string>(), new Set(['M'])]) {
    const result = JSON.stringify(presentProfile(profile, { ok: true, userId: 'U', ownManagerIds, canSeeOpponents }))
    expect(result).not.toContain('chaos agent')
    expect(result).not.toContain('91.123')
    expect(result).not.toContain('riskToleranceScore')
  }
})
it('does not inject an unrestricted manager dossier into Chimmy prompts', async () => {
  expect(await buildPsychologyGroundingLines({ userId: 'U', leagueId: 'L' })).toEqual([])
})
it('removes both direct and nested profile projections from relationship responses', () => {
  const input = { leagueId: 'L', sport: 'NFL', season: 2026, profiles: [profile], behaviorDramaContext: [{ profile, behaviorHeat: 91.123 }],
    relationshipProfile: {}, rivalries: [], drama: [], storylines: [{ id: 'S', headline: 'Rivals', sport: 'NFL', season: 2026,
      storylineScore: 10, rivalryId: 'R', rivalryTier: 'active', dramaEventId: null, dramaType: null, managerAId: 'A', managerBId: 'B',
      relatedManagerIds: ['A', 'B'], relatedTeamIds: [], reasons: ['Rivalry score 10', 'Behavior heat 91'] }] } as unknown as UnifiedRelationshipInsights
  const result = publicRelationshipInsights(input)
  expect(JSON.stringify(result)).not.toMatch(/chaos agent|aggressionScore|91\.123|Behavior heat/)
  expect(result.storylines[0].reasons).toEqual(['Rivalry score 10'])
  expect(input.profiles).toHaveLength(1) // The internal computation remains intact.
})
it('removes labels from persisted historical drama narratives and disables fingerprint reads', async () => {
  expect(publicDramaSummary('REBUILD_PROGRESS', 'Behavior profile (chaos agent)')).not.toContain('chaos agent')
  expect(publicDramaSummary('PLAYOFF_UPSET', 'A recorded playoff upset.')).toBe('A recorded playoff upset.')
  expect(await readManagerFingerprints('L')).toEqual([])
})
