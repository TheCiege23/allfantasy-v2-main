import { describe, expect, it } from 'vitest'
import { assembleEngineInputFromPicks } from '@/lib/shared-services/draft/DraftContextAssembler'
import { computeDraftPlayerRankings, computeNeeds } from '@/lib/draft-helper/RecommendationEngine'

/*
 * Three draft-context bugs found 2026-11-14, each pinned against the behaviour that was wrong:
 *  - WRRB_FLEX / REC_FLEX were unknown slots: each became a fake position with its own need, and
 *    RB/WR (or WR/TE) got no flex credit.
 *  - A draft mirrored from Sleeper files picks under the Sleeper user id, so the user's own picks
 *    were never found and the roster scored empty.
 *  - (Covered in draft-context-assembler.test.ts) the decision context passed the overall pick
 *    where the engine expects the pick within the round.
 */

const SLEEPER_KBI_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'WRRB_FLEX', 'WRRB_FLEX']

describe('WRRB_FLEX / REC_FLEX', () => {
  it('are flex slots, never a position of their own', () => {
    const needs = computeNeeds([], SLEEPER_KBI_SLOTS, false, [], 'NFL')
    expect(needs.WRRB_FLEX).toBeUndefined()
    expect(computeNeeds([], ['REC_FLEX'], false, [], 'NFL').REC_FLEX).toBeUndefined()
  })

  it('give RB and WR flex credit, and TE none', () => {
    const roster = [{ position: 'RB' }, { position: 'RB' }, { position: 'WR' }, { position: 'WR' }, { position: 'TE' }]
    const without = computeNeeds(roster, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'], false, [], 'NFL')
    const withWrrb = computeNeeds(roster, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WRRB_FLEX', 'WRRB_FLEX'], false, [], 'NFL')
    expect(withWrrb.RB).toBeGreaterThan(without.RB!)
    expect(withWrrb.WR).toBeGreaterThan(without.WR!)
    expect(withWrrb.TE).toBe(without.TE)
  })

  it('a WRRB_FLEX player pool row is not penalised as an unknown position', () => {
    const ranked = computeDraftPlayerRankings({
      available: [{ name: 'Back', position: 'RB', adp: 40 }],
      teamRoster: [],
      rosterSlots: SLEEPER_KBI_SLOTS,
      round: 4,
      pick: 1,
      totalTeams: 16,
      sport: 'NFL',
    })
    expect(Object.keys(ranked!.needs)).not.toContain('WRRB_FLEX')
  })
})

describe('Sleeper-mirrored picks are found under the user’s Sleeper id', () => {
  const picks = [
    { rosterId: 'sleeper-user-9', position: 'QB', team: 'BUF', byeWeek: null, playerName: 'Josh Allen' },
    { rosterId: 'sleeper-user-9', position: 'WR', team: 'KC', byeWeek: null, playerName: 'Rashee Rice' },
    { rosterId: 'someone-else', position: 'RB', team: 'SF', byeWeek: null, playerName: 'Christian McCaffrey' },
  ]
  const base = {
    picksSoFar: picks,
    targetRosterId: 'af-roster-uuid',
    adpEntries: [],
    poolByKey: new Map(),
    rosterSlots: SLEEPER_KBI_SLOTS,
    round: 4,
    pick: 16,
    totalTeams: 16,
    sport: 'NFL',
    isDynasty: false,
    isSF: false,
    mode: 'needs' as const,
  }

  it('without the alias the roster is empty — the bug', () => {
    expect(assembleEngineInputFromPicks(base).engineInput.teamRoster).toHaveLength(0)
  })

  it('with the alias the roster is the user’s own two picks', () => {
    const roster = assembleEngineInputFromPicks({ ...base, targetRosterAliases: ['sleeper-user-9'] }).engineInput.teamRoster
    expect(roster.map((r) => r.position)).toEqual(['QB', 'WR'])
  })
})
