import { describe, expect, it, vi } from 'vitest'

/**
 * Fleaflicker's `currentStandings` coverage bucket.
 *
 * 🛑 IT WAS A BARE `{ state: 'full' }` — an assertion that every team's standing
 * came across, made without looking at anything. The coverage block is what the
 * nav gating and the import banner both read, so an unmeasured `full` presents a
 * partial import as a whole one.
 *
 * ⚠ AND THE CHECK IS ONLY MEANINGFUL WHEN `lg.size` IS PRESENT. `leagueSize`
 * falls back to `teamsFlat.length` when it is absent, so comparing them would be
 * a tautology that always says 'full'. That case must report `partial` with a
 * reason — "could not verify" is not "verified complete".
 */

vi.mock('server-only', () => ({}))

function team(id: number) {
  return {
    id,
    name: `Team ${id}`,
    owners: [{ id: id * 10, displayName: `Owner ${id}` }],
    recordOverall: { wins: 1, losses: 1, ties: 0 },
    pointsFor: { value: 100 },
    pointsAgainst: { value: 90 },
  }
}

function payload(teamCount: number, size: number | undefined) {
  return {
    sport: 'NFL' as const,
    season: 2026,
    standings: {
      league: {
        id: 206154,
        name: 'Jackpot Dynasty League',
        ...(size === undefined ? {} : { size }),
        logoUrl: null,
      },
      divisions: [{ name: 'East', teams: Array.from({ length: teamCount }, (_, i) => team(i + 1)) }],
    },
    rosters: { rosters: [] },
  }
}

async function coverageFor(teamCount: number, size: number | undefined) {
  const { FleaflickerAdapter } = await import(
    '@/lib/league-import/adapters/fleaflicker/FleaflickerAdapter'
  )
  const result = await (FleaflickerAdapter as never as {
    normalize: (raw: unknown) => Promise<{ coverage: Record<string, { state: string; count?: number; note?: string }> }>
  }).normalize(payload(teamCount, size) as unknown)
  return result.coverage.currentStandings
}

describe('fleaflicker standings coverage is measured', () => {
  it('reports full only when the rows match the league size the provider declared', async () => {
    const c = await coverageFor(12, 12)
    expect(c.state).toBe('full')
    expect(c.count).toBe(12)
  })

  /*
   * The case the bare assertion hid: eight of twelve teams present, previously
   * rendered as a complete standings table.
   */
  it('reports partial, with the shortfall named, when rows are missing', async () => {
    const c = await coverageFor(8, 12)
    expect(c.state).toBe('partial')
    expect(c.count).toBe(8)
    expect(c.note).toContain('8 of 12')
  })

  /*
   * Circular-comparison guard. Without `lg.size`, `leagueSize` becomes
   * `teamsFlat.length`, so any self-comparison agrees by construction.
   */
  it('refuses to claim full when the provider reported no league size', async () => {
    const c = await coverageFor(10, undefined)
    expect(c.state).toBe('partial')
    expect(c.count).toBe(10)
    expect(c.note).toContain('could not be verified')
  })

  it('reports missing when there are no teams at all', async () => {
    const c = await coverageFor(0, 12)
    expect(c.state).toBe('missing')
  })
})
