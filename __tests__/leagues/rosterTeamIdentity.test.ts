// @vitest-environment node
/**
 * The one roster↔team rule. See the module header for the production measurements this pins.
 */
import { describe, expect, it } from 'vitest'

import {
  matchTeamIdForRoster,
  readSourceManagerId,
  readSourceTeamId,
  resolveRostersForTeams,
} from '@/lib/leagues/rosterTeamIdentity'

const team = (externalId: string, extra: Record<string, unknown> = {}) => ({
  id: `af-${externalId}`,
  externalId,
  platformUserId: null,
  claimedByUserId: null,
  ...extra,
})

const roster = (id: string, platformUserId: string | null, playerData: unknown) => ({ id, platformUserId, playerData })

describe('readSourceTeamId / readSourceManagerId', () => {
  it('reads either place an import writes them, and nothing else', () => {
    expect(readSourceTeamId({ playerData: { source_team_id: ' 7 ' } })).toBe('7')
    expect(readSourceTeamId({ playerData: { import: { sourceTeamId: '9' } } })).toBe('9')
    /* Sleeper roster ids arrive as numbers often enough that a string-only read drops them. */
    expect(readSourceTeamId({ playerData: { source_team_id: 7 } })).toBe('7')
    expect(readSourceManagerId({ playerData: { source_manager_id: 'u1' } })).toBe('u1')
    expect(readSourceTeamId({ playerData: null })).toBeNull()
    expect(readSourceTeamId({ playerData: ['not', 'an', 'object'] })).toBeNull()
    expect(readSourceTeamId({ playerData: { source_team_id: '   ' } })).toBeNull()
  })
})

describe('matchTeamIdForRoster', () => {
  const teams = [
    team('3', { platformUserId: 'sleeper-3' }),
    team('7', { platformUserId: 'sleeper-7', claimedByUserId: 'af-user' }),
  ]

  it('prefers the provider team id, then the manager id, then the claimant', () => {
    expect(matchTeamIdForRoster({ playerData: { source_team_id: '7' }, platformUserId: 'sleeper-3' }, teams)).toBe('af-7')
    expect(matchTeamIdForRoster({ playerData: {}, platformUserId: 'sleeper-3' }, teams)).toBe('af-3')
    expect(matchTeamIdForRoster({ playerData: {}, platformUserId: 'af-user' }, teams)).toBe('af-7')
    expect(matchTeamIdForRoster({ playerData: {}, platformUserId: 'orphan-sleeper-7' }, teams)).toBeNull()
  })
})

describe('resolveRostersForTeams', () => {
  it('🛑 finds an orphan team by its provider id, which no owner key can reach', () => {
    const teams = [team('3', { platformUserId: 'sleeper-3' }), team('7')]
    const rosters = [
      roster('r3', 'sleeper-3', { starters: ['a'] }),
      roster('r7', 'orphan-sleeper-7', { source_team_id: '7', starters: ['b'] }),
    ]
    const out = resolveRostersForTeams(teams, rosters)
    expect(out.get('7')?.id).toBe('r7')
    expect(out.get('3')?.id).toBe('r3')
  })

  it('🛑 spends the strongest evidence first, so a weak match cannot take a row a strong one needs', () => {
    /*
     * r-x is team 7's by its own stamp, and would also answer team 3's owner key. Resolving team 3
     * first by owner key would strand team 7 — so rule 1 runs for every team before rule 3 runs for any.
     */
    const teams = [team('3', { platformUserId: 'shared-key' }), team('7')]
    const rosters = [
      roster('r-x', 'shared-key', { source_team_id: '7', starters: ['b'] }),
      roster('r-y', 'shared-key-2', { starters: ['c'] }),
    ]
    const out = resolveRostersForTeams(teams, rosters, (t) => [t.platformUserId, 'shared-key'])
    expect(out.get('7')?.id).toBe('r-x')
    expect(out.get('3')).toBeUndefined()
  })

  it('gives one row to one team', () => {
    const teams = [team('3', { platformUserId: 'same' }), team('7', { platformUserId: 'same' })]
    const rosters = [roster('r1', 'same', { starters: ['a'] })]
    const out = resolveRostersForTeams(teams, rosters)
    expect([...out.values()].map((r) => r.id)).toEqual(['r1'])
    expect(out.size).toBe(1)
  })

  it('pins the choice between duplicate rows, whatever order they arrive in', () => {
    const teams = [team('7')]
    const fuller = roster('r-b', 'orphan-sleeper-7', { source_team_id: '7', players: ['a', 'b', 'c'] })
    const thinner = roster('r-a', 'import:sleeper:7', { source_team_id: '7', players: ['a'] })
    expect(resolveRostersForTeams(teams, [thinner, fuller]).get('7')?.id).toBe('r-b')
    expect(resolveRostersForTeams(teams, [fuller, thinner]).get('7')?.id).toBe('r-b')

    /* Same size — the six real duplicate pairs are identical — so the id decides, both ways round. */
    const a = roster('r-a', 'k1', { source_team_id: '7', players: ['a'] })
    const b = roster('r-b', 'k2', { source_team_id: '7', players: ['z'] })
    expect(resolveRostersForTeams(teams, [a, b]).get('7')?.id).toBe('r-a')
    expect(resolveRostersForTeams(teams, [b, a]).get('7')?.id).toBe('r-a')
  })

  it('keeps the owner rules, which 93 teams still match on alone', () => {
    const teams = [team('3', { platformUserId: 'sleeper-3' }), team('7', { claimedByUserId: 'af-user' })]
    const rosters = [
      roster('r3', 'sleeper-3', { starters: ['a'] }),
      roster('r7', 'af-user', { starters: ['b'] }),
    ]
    const out = resolveRostersForTeams(teams, rosters, (t) => [t.platformUserId, t.externalId, t.claimedByUserId])
    expect(out.get('3')?.id).toBe('r3')
    expect(out.get('7')?.id).toBe('r7')
  })

  it('matches the source manager id when no team id was recorded', () => {
    const teams = [team('3', { platformUserId: 'sleeper-3' })]
    const rosters = [roster('r3', 'some-other-key', { source_manager_id: 'sleeper-3', starters: ['a'] })]
    expect(resolveRostersForTeams(teams, rosters).get('3')?.id).toBe('r3')
  })

  it('returns nothing rather than guessing', () => {
    expect(resolveRostersForTeams([team('3')], []).size).toBe(0)
    expect(resolveRostersForTeams([], [roster('r', 'k', {})]).size).toBe(0)
    /* A team with no externalId cannot be keyed, and is skipped rather than keyed as "". */
    expect(resolveRostersForTeams([{ id: 'x', externalId: null }], [roster('r', 'k', {})]).size).toBe(0)
  })
})
