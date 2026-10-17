import { describe, expect, it } from 'vitest'
import {
  SURVIVOR_CANONICAL_DRAFT_TYPE_IDS,
  buildSurvivorLeagueColumnPatch,
  buildSurvivorSettingsSnapshotPatch,
  normalizeSurvivorFoundationSettings,
} from '@/lib/survivor/normalizeSurvivorSettings'
import {
  buildSurvivorSettingsSnapshot,
  getSurvivorDefaultContract,
  SURVIVOR_DRAFT_TYPE_IDS,
} from '@/lib/league-concepts/survivorDefaults'

describe('Survivor foundation settings', () => {
  it('normalizes the Phase 1 canonical defaults', () => {
    const settings = normalizeSurvivorFoundationSettings(null)
    expect(settings.defaultTeamCount).toBe(20)
    expect(settings.minTeamCount).toBe(16)
    expect(settings.maxTeamCount).toBe(20)
    expect(settings.tribeCount).toBe(4)
    expect(settings.mergeTriggerType).toBe('active_player_count')
    expect(settings.mergeActivePlayerCount).toBe(10)
    expect(settings.commissionerParticipationMode).toBe('non_participating_host')
    expect(settings.idolExpiryRemainingPlayers).toBe(5)
    expect(settings.idolInvalidRemainingPlayers).toBe(4)
    expect(settings.noConsecutiveSitOuts).toBe(true)
    expect(settings.exileIslandEnabled).toBe(true)
    expect(settings.exileReturnWeek).toBe(10)
    expect(settings.exileReturnTokens).toBe(4)
  })

  it('preserves an explicit Exile opt-out', () => {
    expect(normalizeSurvivorFoundationSettings({ exile_enabled: false }).exileIslandEnabled).toBe(false)
  })

  it('reads nested survivorFoundationSettings and clamps team counts', () => {
    const settings = normalizeSurvivorFoundationSettings({
      survivorFoundationSettings: {
        defaultTeamCount: 24,
        tribeCount: 9,
        commissionerParticipationMode: 'participating_player',
      },
    })
    expect(settings.defaultTeamCount).toBe(20)
    expect(settings.tribeCount).toBe(5)
    expect(settings.commissionerParticipationMode).toBe('participating_player')
  })

  it('writes a legacy-compatible snapshot and League column patch', () => {
    const settings = normalizeSurvivorFoundationSettings({
      defaultTeamCount: 18,
      tribeCount: 4,
      commissionerParticipationMode: 'participating_player',
    })
    expect(buildSurvivorSettingsSnapshotPatch(settings)).toEqual(
      expect.objectContaining({
        survivor_no_fake_gameplay_state: true,
        survivor_privacy_lock_enabled: true,
        survivor_commissioner_role: 'player_commissioner',
      }),
    )
    expect(buildSurvivorLeagueColumnPatch(settings)).toEqual(
      expect.objectContaining({
        survivorMode: true,
        survivorPlayerCount: 18,
        survivorTribeCount: 4,
        survivorTribeSize: 5,
        survivorIdolCount: 6,
      }),
    )
  })

  it('keeps draft type IDs aligned with the Survivor concept defaults', () => {
    expect(SURVIVOR_DRAFT_TYPE_IDS).toEqual(SURVIVOR_CANONICAL_DRAFT_TYPE_IDS)
    expect(SURVIVOR_DRAFT_TYPE_IDS).toContain('real_time')
    expect(SURVIVOR_DRAFT_TYPE_IDS).toContain('by_team')
  })

  it('builds NFL and NCAAF Survivor snapshots with the Phase 1 structure', () => {
    const nfl = getSurvivorDefaultContract({ sport: 'NFL' })
    const ncaaf = buildSurvivorSettingsSnapshot({ sport: 'NCAAF' })
    expect(nfl?.teams).toBe(20)
    expect(nfl?.survivorStructure.tribeSettings.tribeCount).toBe(4)
    expect(nfl?.survivorStructure.tribeSettings.mergeAtCount).toBe(10)
    expect(ncaaf).toEqual(
      expect.objectContaining({
        cast_size: 20,
        tribe_count: 4,
        merge_at_count: 10,
        idol_count: 24,
      }),
    )
  })
})
