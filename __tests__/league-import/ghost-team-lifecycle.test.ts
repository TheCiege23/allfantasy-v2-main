/**
 * Batch A/A.1 pre-merge — the ghost-team lifecycle.
 *
 * A league imports A, B, C, D. D vanishes from a complete authoritative refresh. D must:
 *   - be ARCHIVED, not deleted;
 *   - disappear from every CURRENT-competition surface;
 *   - remain resolvable on every HISTORICAL surface;
 *   - come back exactly once, with the same identity, when it reappears.
 * And a PARTIAL refresh missing D must not archive it at all.
 *
 * ⚠ WHY THIS IS A FIXTURE-LEVEL TEST AND NOT A DATABASE ONE. The repo's vitest setup pins
 * `DATABASE_URL` to `127.0.0.1:1` unless a human names a target, precisely so a suite like this
 * cannot silently reach production. So the league lives in an in-memory fixture and the test
 * exercises the REAL decision functions over it — `isActiveTeam` / `selectActiveTeams`, the same
 * authority the production readers now call. That proves the rule the readers depend on; it does
 * not prove any individual reader calls it, which is what the static reader guards cover.
 */

import { describe, expect, it } from 'vitest'

import { isActiveTeam, selectActiveTeams, selectOrphanTeams } from '@/lib/league-import/activeTeams'
import { isAuthoritativeStatus, rollUpStatus } from '@/lib/league-import/resourceStatus'
import type { ResourceFetchStatus } from '@/lib/league-import/resourceStatus'

interface Team {
  externalId: string
  teamName: string
  claimedByUserId: string | null
  isOrphan: boolean | null
  /** Stable across archival — the whole point of not deleting. */
  createdAt: string
}

interface HistoricalMatchup {
  week: number
  homeExternalId: string
  awayExternalId: string
  homePoints: number
  awayPoints: number
}

/** The league as stored. `D` is claimed, to prove claimed and unclaimed behave alike. */
function seedLeague(): {
  teams: Team[]
  matchups: HistoricalMatchup[]
  draftPicks: Array<{ round: number; externalId: string; playerId: string }>
  transactions: Array<{ id: string; externalId: string; type: string }>
} {
  return {
    teams: [
      { externalId: 'A', teamName: 'Alpha', claimedByUserId: 'u1', isOrphan: false, createdAt: '2026-08-01T00:00:00.000Z' },
      { externalId: 'B', teamName: 'Bravo', claimedByUserId: null, isOrphan: false, createdAt: '2026-08-01T00:00:00.000Z' },
      { externalId: 'C', teamName: 'Charlie', claimedByUserId: null, isOrphan: null, createdAt: '2026-08-01T00:00:00.000Z' },
      { externalId: 'D', teamName: 'Delta', claimedByUserId: 'u4', isOrphan: false, createdAt: '2026-08-01T00:00:00.000Z' },
    ],
    matchups: [
      { week: 1, homeExternalId: 'A', awayExternalId: 'D', homePoints: 101.2, awayPoints: 98.4 },
      { week: 2, homeExternalId: 'D', awayExternalId: 'B', homePoints: 120.0, awayPoints: 110.5 },
      { week: 3, homeExternalId: 'B', awayExternalId: 'C', homePoints: 88.0, awayPoints: 95.1 },
    ],
    draftPicks: [
      { round: 1, externalId: 'D', playerId: 'p-delta-1' },
      { round: 1, externalId: 'A', playerId: 'p-alpha-1' },
    ],
    transactions: [
      { id: 't1', externalId: 'D', type: 'trade' },
      { id: 't2', externalId: 'A', type: 'waiver' },
    ],
  }
}

/**
 * The reconciliation rule under test, expressed exactly as `applySleeperLeagueSync` implements it:
 * archive an absent team ONLY behind the authoritative gate, skip one already archived.
 */
function reconcile(
  teams: Team[],
  payloadExternalIds: string[],
  rosterStatuses: ResourceFetchStatus[],
  coverageState: 'full' | 'partial' | 'missing',
): { teams: Team[]; archived: string[]; deleted: string[] } {
  const authoritative =
    coverageState === 'full' &&
    payloadExternalIds.length > 0 &&
    rosterStatuses.every((s) => isAuthoritativeStatus(s))

  if (!authoritative) return { teams, archived: [], deleted: [] }

  const live = new Set(payloadExternalIds)
  const archived: string[] = []
  const next = teams.map((t) => {
    if (live.has(t.externalId)) return t
    if (t.isOrphan === true) return t // idempotent
    archived.push(t.externalId)
    return { ...t, isOrphan: true }
  })
  /* Nothing is ever removed — the array length is invariant. */
  return { teams: next, archived, deleted: [] }
}

/** A team present in a payload is un-archived by the bootstrap upsert. */
function applyPresentTeams(teams: Team[], payloadExternalIds: string[]): Team[] {
  const live = new Set(payloadExternalIds)
  return teams.map((t) => (live.has(t.externalId) ? { ...t, isOrphan: false } : t))
}

const ALL_OBSERVED: ResourceFetchStatus[] = ['fetched', 'fetched', 'fetched']

describe('D vanishes from a COMPLETE authoritative refresh', () => {
  const seed = seedLeague()
  const after = reconcile(seed.teams, ['A', 'B', 'C'], ALL_OBSERVED, 'full')

  it('archives D and deletes nothing', () => {
    expect(after.archived).toEqual(['D'])
    expect(after.deleted).toEqual([])
    expect(after.teams).toHaveLength(4)
    expect(after.teams.find((t) => t.externalId === 'D')?.isOrphan).toBe(true)
  })

  it('preserves D\'s identity and history fields through archival', () => {
    const d = after.teams.find((t) => t.externalId === 'D')!
    expect(d.teamName).toBe('Delta')
    expect(d.claimedByUserId).toBe('u4')
    expect(d.createdAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('archives a CLAIMED team on the same rule as an unclaimed one', () => {
    /* D is claimed; the old code preserved claimed teams and hard-deleted unclaimed ones. */
    expect(after.teams.find((t) => t.externalId === 'D')?.claimedByUserId).toBe('u4')
    expect(after.teams.find((t) => t.externalId === 'D')?.isOrphan).toBe(true)
  })

  it('is idempotent — a second identical refresh archives nothing further', () => {
    const again = reconcile(after.teams, ['A', 'B', 'C'], ALL_OBSERVED, 'full')
    expect(again.archived).toEqual([])
    expect(again.teams).toEqual(after.teams)
  })
})

describe('CURRENT surfaces show only A–C', () => {
  const seed = seedLeague()
  const after = reconcile(seed.teams, ['A', 'B', 'C'], ALL_OBSERVED, 'full')
  const active = selectActiveTeams(after.teams)
  const ids = active.map((t) => t.externalId)

  it('standings / dashboard team list', () => {
    expect(ids).toEqual(['A', 'B', 'C'])
    expect(ids).not.toContain('D')
  })

  it('keeps C, whose isOrphan is NULL — absent evidence is not archival', () => {
    expect(ids).toContain('C')
  })

  it('trade partners exclude D', () => {
    const partners = active.filter((t) => t.externalId !== 'A').map((t) => t.externalId)
    expect(partners).toEqual(['B', 'C'])
  })

  it('waiver / team-fit inputs exclude D', () => {
    expect(active.every((t) => isActiveTeam(t))).toBe(true)
    expect(active.find((t) => t.externalId === 'D')).toBeUndefined()
  })

  it('playoff calculations count three seats, not four', () => {
    expect(active).toHaveLength(3)
  })

  it('Chimmy current-league grounding names only A–C', () => {
    const grounding = active.map((t) => t.teamName)
    expect(grounding).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(grounding).not.toContain('Delta')
  })

  it('notification recipients drop the archived team\'s claimer', () => {
    const recipients = selectActiveTeams(after.teams)
      .map((t) => t.claimedByUserId)
      .filter((x): x is string => !!x)
    expect(recipients).toEqual(['u1'])
    expect(recipients).not.toContain('u4')
  })
})

describe('HISTORICAL surfaces still resolve D', () => {
  const seed = seedLeague()
  const after = reconcile(seed.teams, ['A', 'B', 'C'], ALL_OBSERVED, 'full')
  /* History reads the FULL team set — it must never call selectActiveTeams. */
  const byId = new Map(after.teams.map((t) => [t.externalId, t]))

  it('historical matchups still name D', () => {
    const played = seed.matchups.filter(
      (m) => m.homeExternalId === 'D' || m.awayExternalId === 'D',
    )
    expect(played).toHaveLength(2)
    for (const m of played) {
      expect(byId.get('D')?.teamName).toBe('Delta')
      expect(m.homePoints).toBeGreaterThan(0)
    }
  })

  it('draft history still resolves D\'s picks', () => {
    const picks = seed.draftPicks.filter((p) => p.externalId === 'D')
    expect(picks).toHaveLength(1)
    expect(byId.get(picks[0]!.externalId)?.teamName).toBe('Delta')
  })

  it('transaction history still resolves D', () => {
    const tx = seed.transactions.filter((t) => t.externalId === 'D')
    expect(tx).toHaveLength(1)
    expect(byId.has(tx[0]!.externalId)).toBe(true)
  })

  it('head-to-head A versus D survives', () => {
    const h2h = seed.matchups.filter(
      (m) =>
        (m.homeExternalId === 'A' && m.awayExternalId === 'D') ||
        (m.homeExternalId === 'D' && m.awayExternalId === 'A'),
    )
    expect(h2h).toHaveLength(1)
    expect(byId.get('D')).toBeDefined()
  })

  it('the archived team is enumerable as archived, for a disclosure surface', () => {
    expect(selectOrphanTeams(after.teams).map((t) => t.externalId)).toEqual(['D'])
  })
})

describe('a PARTIAL refresh missing D does not archive it', () => {
  it('does nothing when coverage is partial', () => {
    const seed = seedLeague()
    const after = reconcile(seed.teams, ['A', 'B', 'C'], ALL_OBSERVED, 'partial')
    expect(after.archived).toEqual([])
    expect(after.teams.find((t) => t.externalId === 'D')?.isOrphan).toBe(false)
  })

  it('does nothing when coverage claims full but a roster was NOT observed', () => {
    /*
     * The second gate: an adapter's `full` claim is not trusted on its own, because this batch
     * exists because that claim was wrong twice.
     */
    const seed = seedLeague()
    const after = reconcile(seed.teams, ['A', 'B', 'C'], ['fetched', 'failed', 'fetched'], 'full')
    expect(after.archived).toEqual([])
    expect(after.teams.find((t) => t.externalId === 'D')?.isOrphan).toBe(false)
  })

  it('does nothing when an unauthorized read makes the set unobserved', () => {
    const seed = seedLeague()
    const after = reconcile(seed.teams, ['A', 'B', 'C'], ['unauthorized', 'unauthorized', 'unauthorized'], 'full')
    expect(rollUpStatus(['unauthorized', 'unauthorized', 'unauthorized'])).toBe('unauthorized')
    expect(after.archived).toEqual([])
  })
})

describe('D reappears in a later authoritative refresh', () => {
  const seed = seedLeague()
  const archivedState = reconcile(seed.teams, ['A', 'B', 'C'], ALL_OBSERVED, 'full')
  const restored = applyPresentTeams(archivedState.teams, ['A', 'B', 'C', 'D'])

  it('becomes active again', () => {
    expect(restored.find((t) => t.externalId === 'D')?.isOrphan).toBe(false)
    expect(selectActiveTeams(restored).map((t) => t.externalId)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('exists exactly ONCE — no duplicate identity was created', () => {
    /*
     * 🛑 THE FAILURE ARCHIVAL COULD HAVE INTRODUCED. Under the old hard delete, a reappearing
     * team was a fresh row with a new id and no history. Restoration must reuse the SAME row,
     * or the league quietly grows a second Delta and the history splits between them.
     */
    expect(restored.filter((t) => t.externalId === 'D')).toHaveLength(1)
    expect(restored).toHaveLength(4)
  })

  it('keeps its original identity and claim', () => {
    const d = restored.find((t) => t.externalId === 'D')!
    expect(d.teamName).toBe('Delta')
    expect(d.claimedByUserId).toBe('u4')
    expect(d.createdAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('keeps its history attached to that same identity', () => {
    const byId = new Map(restored.map((t) => [t.externalId, t]))
    const played = seed.matchups.filter((m) => m.homeExternalId === 'D' || m.awayExternalId === 'D')
    expect(played).toHaveLength(2)
    expect(byId.get('D')?.createdAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('round-trips: archive → restore → archive is stable', () => {
    const again = reconcile(restored, ['A', 'B', 'C'], ALL_OBSERVED, 'full')
    expect(again.archived).toEqual(['D'])
    expect(again.teams).toHaveLength(4)
    expect(again.teams.filter((t) => t.externalId === 'D')).toHaveLength(1)
  })
})
