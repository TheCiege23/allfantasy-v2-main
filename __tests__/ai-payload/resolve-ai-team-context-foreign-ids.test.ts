/**
 * `resolveAiTeamContext` — the roster every Chimmy "my team" tool grounds on — for a league whose
 * roster ids are not Sleeper ids.
 *
 * A Fleaflicker roster id is a short number in Sleeper's range: '6038' on a Fleaflicker roster is
 * NOT Sleeper's '6038'. `resolveNames` looks ids up in the Sleeper space, so a foreign id named a
 * real stranger, with his injury, as the user's starter.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({ platform: 'sleeper' }))

vi.mock('@/lib/leagues/rosterForTeam', () => ({
  findRosterForTeam: vi.fn(async () => ({ playerData: { players: ['6038'], starters: ['6038'] } })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: {
      findFirst: vi.fn(async () => ({
        id: 'team-1',
        teamName: 'My Team',
        platformUserId: 'mgr-1',
        wins: 1,
        losses: 0,
        ties: 0,
        pointsFor: 100,
        currentRank: 1,
        league: { platform: state.platform },
      })),
    },
    roster: { findFirst: vi.fn(async () => null) },
    teamPerformance: { findUnique: vi.fn(async () => null) },
    sportsPlayerRecord: { findMany: vi.fn(async () => []) },
    // The fake Sleeper player table: '6038' IS a real Sleeper id, and it is somebody else.
    sportsPlayer: {
      findMany: vi.fn(async (args: any) =>
        JSON.stringify(args?.where ?? {}).includes('"6038"')
          ? [{ externalId: 'x', sleeperId: '6038', name: 'Wrong Player', position: 'RB', team: 'KC', status: 'Out' }]
          : [],
      ),
    },
  },
}))

import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'

async function contextFor(platform: string) {
  state.platform = platform
  const ctx = await resolveAiTeamContext({ userId: 'u-1', leagueId: 'lg-1', sport: 'NFL', season: 2026, currentPeriod: 3 })
  if (!ctx) throw new Error('no context')
  return ctx
}

describe('resolveAiTeamContext — foreign roster ids', () => {
  it('does not name the Sleeper player who shares a Fleaflicker roster id', async () => {
    const ctx = await contextFor('fleaflicker')
    const names = [...ctx.starters, ...ctx.bench, ...ctx.injuredReserve, ...ctx.taxi].map((p) => p.name)
    expect(names).not.toContain('Wrong Player')
    expect(JSON.stringify(ctx)).not.toContain('Wrong Player')
    // Said, not silently empty.
    expect(ctx.dataGaps.join(' ')).toContain('cannot be resolved')
  })

  it('CONTROL: the same id in a Sleeper league IS named', async () => {
    const ctx = await contextFor('sleeper')
    expect(ctx.starters.map((p) => p.name)).toEqual(['Wrong Player'])
    expect(ctx.dataGaps).toEqual([])
  })
})
