/**
 * Batch A.2 — `TeamPerformance.opponent` resolves by the producer's contract.
 *
 * The producer is `SleeperLeagueCreationBootstrapService`, which stores the opposing
 * `LeagueTeam.id`. Both readers matched it against `teamName` instead, which is why every case
 * below is a real one rather than a hypothetical.
 */

import { describe, expect, it } from 'vitest'
import { resolveTeamPerformanceOpponent } from '@/lib/league-import/teamPerformanceOpponent'

const TEAMS = [
  { id: 'team-uuid-1', externalId: '1', teamName: 'Gridiron Giants' },
  { id: 'team-uuid-2', externalId: '2', teamName: 'Bench Warmers' },
  /* The seat that broke everything: retained by A.1, and never named by its manager. */
  { id: 'team-uuid-3', externalId: '3', teamName: '' },
  { id: 'team-uuid-4', externalId: '4', teamName: null },
]

describe('resolveTeamPerformanceOpponent', () => {
  it('resolves the id the importer actually writes', () => {
    const { team, via } = resolveTeamPerformanceOpponent('team-uuid-2', TEAMS)
    expect(team?.id).toBe('team-uuid-2')
    expect(via).toBe('team_id')
  })

  it('resolves a provider roster id when that is what was stored', () => {
    const { team, via } = resolveTeamPerformanceOpponent('2', TEAMS)
    expect(team?.id).toBe('team-uuid-2')
    expect(via).toBe('external_id')
  })

  it('resolves the legacy NAME representation exactly, case-insensitively', () => {
    /* `prisma/seed.ts` writes a name; rows predating the contract may too. */
    const { team, via } = resolveTeamPerformanceOpponent('  bench warmers ', TEAMS)
    expect(team?.id).toBe('team-uuid-2')
    expect(via).toBe('legacy_name')
  })

  it('does NOT match a name by substring', () => {
    /* The old bidirectional `includes` would have matched "Bench" to "Bench Warmers". */
    expect(resolveTeamPerformanceOpponent('Bench', TEAMS).team).toBeNull()
    expect(resolveTeamPerformanceOpponent('Bench Warmers Reloaded', TEAMS).team).toBeNull()
  })

  it('🛑 an unknown id resolves to NOTHING, never to an arbitrary team', () => {
    /*
     * THE BUG THIS FILE EXISTS FOR. `perf.opponent.includes((t.teamName ?? ''))` is true for
     * EVERY string when the name is empty, so `Array.find` returned the first unnamed seat and
     * the screen printed a confident points-against ranking about the wrong manager.
     */
    const { team, via } = resolveTeamPerformanceOpponent('team-uuid-does-not-exist', TEAMS)
    expect(team, 'an unresolved opponent must not fall onto the unnamed seat').toBeNull()
    expect(via).toBe('unresolved')
  })

  it('an empty or whitespace-only stored value resolves to nothing', () => {
    expect(resolveTeamPerformanceOpponent('', TEAMS).team).toBeNull()
    expect(resolveTeamPerformanceOpponent('   ', TEAMS).team).toBeNull()
    expect(resolveTeamPerformanceOpponent(null, TEAMS).team).toBeNull()
    expect(resolveTeamPerformanceOpponent(undefined, TEAMS).team).toBeNull()
  })

  it('an empty stored value never matches the empty-named seat either', () => {
    /* Both sides empty is the degenerate case the `name !== ''` guard exists for. */
    expect(resolveTeamPerformanceOpponent('', [{ id: 'x', externalId: '', teamName: '' }]).team).toBeNull()
  })

  it('resolves an ARCHIVED opponent — a past week can name a team that has since left', () => {
    /*
     * The caller passes the UNFILTERED array for exactly this reason. The resolver takes no view
     * on archival; it is the caller that decides whether archived rows are in scope.
     */
    const withArchived = [...TEAMS, { id: 'team-uuid-gone', externalId: '9', teamName: 'Departed FC' }]
    expect(resolveTeamPerformanceOpponent('team-uuid-gone', withArchived).team?.teamName).toBe('Departed FC')
  })

  it('excludeTeamId keeps a team from being its own opponent', () => {
    expect(resolveTeamPerformanceOpponent('team-uuid-1', TEAMS, { excludeTeamId: 'team-uuid-1' }).team).toBeNull()
    expect(resolveTeamPerformanceOpponent('team-uuid-2', TEAMS, { excludeTeamId: 'team-uuid-1' }).team?.id).toBe(
      'team-uuid-2',
    )
  })

  it('an externalId that is empty string never matches an empty stored value', () => {
    const teams = [{ id: 'a', externalId: '', teamName: 'A' }]
    expect(resolveTeamPerformanceOpponent('', teams).team).toBeNull()
  })
})

describe('the readers use the shared resolver rather than their own matcher', () => {
  const read = (p: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('node:fs') as typeof import('node:fs')).readFileSync(
      (require('node:path') as typeof import('node:path')).join(process.cwd(), p),
      'utf8',
    )

  it('opponentMatchup no longer substring-matches a team name', () => {
    const src = read('lib/ai-tools-start-sit/opponentMatchup.ts')
    expect(src).toMatch(/resolveTeamPerformanceOpponent\(perf\.opponent, teams\)/)
    /* The exact expression that matched every team for an unnamed seat. */
    expect(src).not.toMatch(/includes\(\(t\.teamName \?\? ''\)/)
  })

  it('resolveMatchupOpponent no longer name-matches, and its dead matcher is gone', () => {
    const src = read('lib/matchup-prep-dashboard/resolveMatchupOpponent.ts')
    expect(src).toMatch(/resolveTeamPerformanceOpponent\(label, teams/)
    expect(src).not.toMatch(/function fuzzyTeamMatch/)
  })
})
