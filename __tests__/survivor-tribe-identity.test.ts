import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { SURVIVOR_TRIBE_CATALOG, defaultTribeSlots, validateTribeSlots, tribeCrestUrl } from '@/lib/survivor/survivorTribeIdentity'
import { computeTribeAssignment } from '@/lib/survivor/survivorTribeAssignmentEngine'
import { buildSurvivorSettingsSnapshotPatch, normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { formatOptionsApplyToLeagueType, DEFAULT_WIZARD_FORMAT_OPTIONS } from '@/lib/league-creation-wizard/wizard-format-options'
const participants = Array.from({ length: 20 }, (_, i) => ({ userId: `u${i}`, rosterId: `r${i}`, displayName: `Manager ${i}` }))
describe('Survivor tribe identity and assignment', () => {
  it('ships every supplied crest for every supported sport, with no executable SVG content', () => {
    expect(SURVIVOR_TRIBE_CATALOG).toHaveLength(50)
    expect(new Set(SURVIVOR_TRIBE_CATALOG.map(t => t.id)).size).toBe(50)
    for (const sport of ['NFL','NBA','NHL','NCAAF','NCAAB','MLB','SOCCER']) for (const tribe of SURVIVOR_TRIBE_CATALOG) {
      const url = tribeCrestUrl(tribe.id, sport)!
      expect(existsSync(`public${url}`), url).toBe(true)
      expect(readFileSync(`public${url}`, 'utf8')).not.toMatch(/<script|<foreignObject|\bon\w+\s*=/i)
    }
    expect(tribeCrestUrl('../../secret', 'NBA')).toBeNull()
    expect(tribeCrestUrl('crab', '../../NBA')).toBeNull()
  })
  it('validates exact total, distinct identities and positive whole capacities', () => {
    expect(validateTribeSlots(defaultTribeSlots(18,4),18,4)).toBeNull()
    expect(validateTribeSlots([{ catalogId:'crab',managerCount:10 },{ catalogId:'shark',managerCount:8 }],20,2)).toContain('total 18')
    expect(validateTribeSlots([{ catalogId:'crab',managerCount:10 },{ catalogId:'crab',managerCount:10 }],20,2)).toContain('different identity')
    expect(validateTribeSlots([{ catalogId:'crab',managerCount:9.5 },{ catalogId:'shark',managerCount:10.5 }],20,2)).toContain('whole-number')
  })
  it.each(['random','draft_pattern'] as const)('honors unequal capacities exactly in %s mode without duplicate managers', mode => {
    const result = computeTribeAssignment({ participants, tribeCount:3, capacities:[8,7,5], mode, seed:123, draftOrder: [...participants.map(p => p.userId), 'u0'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tribes.map(t => t.memberUserIds.length)).toEqual([8,7,5])
    expect(new Set(result.tribes.flatMap(t => t.memberUserIds)).size).toBe(20)
  })
  it('rejects invalid capacities before mutation or looping', () => {
    for (const capacities of [[8,7,4],[10,0,10],[5,5],[5.5,5.5,9]]) expect(computeTribeAssignment({ participants, tribeCount:3, capacities, mode:'random' }).ok).toBe(false)
  })
  it('retains identities and capacities through creation and settings round trips', () => {
    const slots = [{ catalogId:'orca',managerCount:12 },{ catalogId:'tiger',managerCount:8 }]
    const wizard = formatOptionsApplyToLeagueType('survivor', { ...DEFAULT_WIZARD_FORMAT_OPTIONS, survivorTribeCountOverride:2, survivorTribeSlots:slots }, 'NHL')
    const snapshot = buildSurvivorSettingsSnapshotPatch({ ...wizard, defaultTeamCount:20, tribeCount:2 })
    expect(normalizeSurvivorFoundationSettings(snapshot).survivorTribeSlots).toEqual(slots)
  })
})
