import { describe, expect, it } from 'vitest'
import { assembleEngineInputFromPicks, playerKey } from '@/lib/shared-services/draft/DraftContextAssembler'

// Phase 30: real finding -- kept players ARE already excluded from `available` once
// KeeperAutomationService materializes them as a real DraftPick row (source: 'keeper'),
// via the existing `picksSoFar`/draftedKeys mechanism. The genuine, undetected gap is a
// player locked into a FUTURE keeper round (via DraftSession.keeperSelections) that
// hasn't been materialized yet -- they can still appear in `available` today, and could
// be recommended to a DIFFERENT team even though they're guaranteed to become that
// keeper-team's pick later. These tests demonstrate that gap first, then verify the fix.
describe('assembleEngineInputFromPicks — keeper-lock exclusion (Phase 30)', () => {
  const baseParams = {
    picksSoFar: [],
    targetRosterId: 'roster-1',
    adpEntries: [
      { playerName: 'Future Keeper', position: 'RB', team: 'KC', adp: 12 },
      { playerName: 'Open Player', position: 'WR', team: 'BUF', adp: 20 },
    ],
    poolByKey: new Map(),
    rosterSlots: ['QB', 'RB', 'WR'],
    round: 2,
    pick: 3,
    totalTeams: 12,
    sport: 'NFL',
    isDynasty: false,
    isSF: false,
    mode: 'needs' as const,
  }

  it('excludes a player locked into a future keeper round, not yet materialized as a real pick', () => {
    const result = assembleEngineInputFromPicks({
      ...baseParams,
      keeperLockedPlayers: [{ playerName: 'Future Keeper', position: 'RB' }],
    })

    const names = result.engineInput.available.map((p) => p.name)
    expect(names).not.toContain('Future Keeper')
    expect(names).toContain('Open Player')
  })

  it('omitting keeperLockedPlayers preserves exact pre-Phase-30 behavior (backward compatible)', () => {
    const withField = assembleEngineInputFromPicks({ ...baseParams, keeperLockedPlayers: [] })
    const omitted = assembleEngineInputFromPicks(baseParams)

    expect(withField.engineInput.available).toEqual(omitted.engineInput.available)
  })

  it('a keeper lock uses the same playerKey normalization as real drafted-player exclusion', () => {
    const result = assembleEngineInputFromPicks({
      ...baseParams,
      keeperLockedPlayers: [{ playerName: '  future KEEPER  ', position: 'rb' }],
    })
    const names = result.engineInput.available.map((p) => p.name)
    expect(names).not.toContain('Future Keeper')
  })

  it('does not double-exclude or throw when a player is both already-drafted AND keeper-locked', () => {
    const result = assembleEngineInputFromPicks({
      ...baseParams,
      picksSoFar: [{ rosterId: 'roster-2', position: 'RB', team: 'KC', byeWeek: null, playerName: 'Future Keeper' }],
      keeperLockedPlayers: [{ playerName: 'Future Keeper', position: 'RB' }],
    })
    expect(result.engineInput.available.map((p) => p.name)).not.toContain('Future Keeper')
  })

  it('playerKey normalization is unaffected (regression check)', () => {
    expect(playerKey('  Player One ', 'RB')).toBe('player one|rb')
  })
})
