import { describe, expect, it } from 'vitest'
import { runLiveDraftBrainDeterministic } from '@/lib/live-draft-brain'

describe('Live Draft Brain (deterministic)', () => {
  it('returns a valid envelope with top recommendations', () => {
    const envelope = runLiveDraftBrainDeterministic({
      context: {
        sport: 'NFL',
        draftFormat: 'SNAKE',
        round: 3,
        pick: 4,
        totalTeams: 12,
        overallPick: 28,
      },
      mode: 'balanced',
      available: [
        { name: 'Player A', position: 'RB', team: 'TST', adp: 24 },
        { name: 'Player B', position: 'WR', team: 'TST', adp: 30 },
        { name: 'Player C', position: 'QB', team: 'TST', adp: 40 },
      ],
      myTeam: {
        teamRoster: [{ position: 'RB' }, { position: 'WR' }],
        rosterSlots: ['RB', 'WR', 'WR', 'FLEX', 'BN', 'BN', 'BN'],
      },
      upcomingTeamOrder: ['t1', 't2', 't3'],
      managerHintsByTeamId: {
        t1: { managerId: 't1', displayName: 'Team One' },
      },
    })

    expect(envelope.pickRecommendation.playerName.length).toBeGreaterThan(0)
    expect(envelope.pickRecommendationsTop3.length).toBeGreaterThan(0)
    expect(envelope.deterministicMeta.sport).toBe('NFL')
  })
})


describe('Draft brain ADP evidence', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const)('does not invent observed market or site ADP for %s', sport => {
    const envelope = runLiveDraftBrainDeterministic({
      context: { sport, draftFormat: 'SNAKE', round: 1, pick: 1, totalTeams: 4, overallPick: 1 },
      mode: 'balanced',
      available: [{ name: 'Evidence Missing', position: sport === 'SOCCER' ? 'FWD' : sport === 'NHL' ? 'C' : sport === 'MLB' ? 'OF' : sport === 'NBA' ? 'PG' : sport === 'NCAAB' ? 'G' : 'WR', team: 'TST', adp: null }],
      myTeam: { teamRoster: [], rosterSlots: ['BN'] },
    })
    expect(envelope.pickRecommendation.externalAdp).toBeNull()
    expect(envelope.pickRecommendation.siteAdp).toBeNull()
  })
})
