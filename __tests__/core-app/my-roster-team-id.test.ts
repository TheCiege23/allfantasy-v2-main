// @vitest-environment node
/**
 * `findMyRoster` — the chokepoint eleven "my team" surfaces reach their own roster through.
 *
 * Every key it knew was a MANAGER id. PR #1005 made the write side key a managerless team's roster
 * `orphan-<provider>-<teamId>` and keep the old row when a manager changes, so a roster can sit under
 * a key this helper cannot name, and the failure is SILENT — an empty screen that reads as "never
 * imported" rather than as a join that missed.
 *
 * ⚠ ROBUSTNESS, NOT A LIVE FIX. Read-only on production 2026-09-18: of 392 claimed teams, ZERO are
 * stranded this way, because #1005 deliberately keeps a CLAIMED roster under the claimant key. These
 * tests pin the behaviour before the population exists, not after.
 */
import { describe, expect, it, vi } from 'vitest'

import { findMyRoster } from '@/lib/core-app/myRoster'

const LEAGUE = 'L1'
const USER = 'af-user-1'

type Roster = { id: string; platformUserId: string | null; playerData: unknown }

function fakePrisma(team: Record<string, unknown> | null, rosters: Roster[]) {
  const findMany = vi.fn(async () => rosters)
  const findFirst = vi.fn(async ({ where }: { where: { platformUserId?: { in: string[] } } }) => {
    const keys = where.platformUserId?.in ?? []
    return rosters.find((r) => keys.includes(String(r.platformUserId))) ?? null
  })
  return {
    prisma: {
      leagueTeam: { findFirst: vi.fn(async () => team) },
      roster: { findFirst, findMany },
    } as unknown as Parameters<typeof findMyRoster>[0],
    findMany,
    findFirst,
  }
}

describe('findMyRoster', () => {
  it('🛑 finds a claimed team whose roster sits under a key no manager id can name', async () => {
    const { prisma } = fakePrisma(
      { platformUserId: 'sleeper-me', externalId: '7', claimedByUserId: USER },
      [{ id: 'r7', platformUserId: 'orphan-sleeper-7', playerData: { source_team_id: '7', players: ['a'] } }],
    )
    const out = await findMyRoster(prisma, LEAGUE, USER)
    expect(out.found).toBe(true)
    expect(out).toMatchObject({ playerData: { source_team_id: '7' } })
  })

  it('🛑 spends NO extra query when an owner key already answers', async () => {
    /* The common path must stay exactly as cheap as it was: one findFirst, no league-wide read. */
    const { prisma, findMany } = fakePrisma(
      { platformUserId: 'sleeper-me', externalId: '7', claimedByUserId: USER },
      [{ id: 'r7', platformUserId: 'sleeper-me', playerData: { players: ['a'] } }],
    )
    expect((await findMyRoster(prisma, LEAGUE, USER)).found).toBe(true)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('still answers no_team_claimed and no_roster as different things', async () => {
    const none = fakePrisma(null, [])
    expect(await findMyRoster(none.prisma, LEAGUE, USER)).toEqual({ found: false, reason: 'no_team_claimed' })

    /* A claimed team in a league whose rosters genuinely are not there. */
    const empty = fakePrisma({ platformUserId: 'sleeper-me', externalId: '7', claimedByUserId: USER }, [])
    expect(await findMyRoster(empty.prisma, LEAGUE, USER)).toEqual({ found: false, reason: 'no_roster' })
  })

  it('never hands back another team\'s roster', async () => {
    /* A row stamped with a different team id, under a key that is nobody's manager id. */
    const { prisma } = fakePrisma(
      { platformUserId: 'sleeper-me', externalId: '7', claimedByUserId: USER },
      [{ id: 'r9', platformUserId: 'orphan-sleeper-9', playerData: { source_team_id: '9', players: ['z'] } }],
    )
    expect(await findMyRoster(prisma, LEAGUE, USER)).toEqual({ found: false, reason: 'no_roster' })
  })

  it('survives a team row that carries no provider id at all', async () => {
    /* The manual-league shape: no externalId to resolve by, so the owner keys are all there is. */
    const { prisma } = fakePrisma({ platformUserId: null, externalId: null, claimedByUserId: USER }, [
      { id: 'r1', platformUserId: USER, playerData: { players: ['a'] } },
    ])
    expect((await findMyRoster(prisma, LEAGUE, USER)).found).toBe(true)
  })
})
