/**
 * Which clubs the defence box-score cron fetches. It read only `DEF`/`DST` rows and took the team label
 * upper-cased raw: an ESPN / Fleaflicker `D/ST` was never fetched, and a Sleeper DEF row whose team reads
 * "Arizona Cardinals" asked the provider for a team called "ARIZONA CARDINALS".
 */
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { resolveRosteredDefenseTeams } from '@/lib/redraft/teamDefenseProvider'
import { canonicalTeamDefenseId } from '@/lib/scoring-runtime/nflStatNormalization'

describe('canonicalTeamDefenseId — the one key a defence box score lives under', () => {
  it('both id forms resolve to nfl:def:<ABBR>', () => {
    expect(canonicalTeamDefenseId('KC', 'DEF')).toBe('nfl:def:KC')
    expect(canonicalTeamDefenseId('KC', 'D/ST')).toBe('nfl:def:KC')
    expect(canonicalTeamDefenseId('nfl:def:kc', null)).toBe('nfl:def:KC')
  })

  it('🛑 a bare code is a defence only on a defence row; a numeric or named id never is', () => {
    expect(canonicalTeamDefenseId('KC', 'WR')).toBeNull()
    expect(canonicalTeamDefenseId('KC', null)).toBeNull()
    expect(canonicalTeamDefenseId('4984', 'DEF')).toBeNull()
    expect(canonicalTeamDefenseId('-16012', 'D/ST')).toBeNull()
    expect(canonicalTeamDefenseId('name:Denver Defense:DEF:DEN', 'DEF')).toBeNull()
  })
})

function fakePrisma(rows: Array<Record<string, unknown>>) {
  return {
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'r1' }]) },
    redraftRosterPlayer: {
      // Evaluates the position filter, so a row the query would not return is not returned.
      findMany: vi.fn(async (args: { where: { position: { in: string[] } } }) =>
        rows.filter((r) => args.where.position.in.includes(String(r.position))),
      ),
    },
  } as unknown as PrismaClient
}

async function teams(rows: Array<Record<string, unknown>>) {
  const buckets = await resolveRosteredDefenseTeams(fakePrisma(rows), [{ id: 's1', season: 2026, currentWeek: 3 }])
  return [...(buckets.get('2026:3')?.teams ?? [])].sort()
}

describe('resolveRosteredDefenseTeams — one club code per rostered defence', () => {
  it('🛑 Sleeper\'s bare id names the club, whatever its team label says', async () => {
    expect(await teams([{ playerId: 'ARI', position: 'DEF', team: 'Arizona Cardinals' }])).toEqual(['ARI'])
  })

  it('🛑 an imported `D/ST` is fetched: ESPN by its team code, Fleaflicker by its nickname', async () => {
    expect(
      await teams([
        { playerId: '-16012', position: 'D/ST', team: 'KC' },
        { playerId: '2330', position: 'D/ST', team: 'Ravens' },
      ]),
    ).toEqual(['BAL', 'KC'])
  })

  it('a synthetic `nfl:def:` id still names its club; a label that names no club adds nothing', async () => {
    expect(
      await teams([
        { playerId: 'nfl:def:BUF', position: 'DEF', team: null },
        { playerId: 'name:Mystery Defense:DEF', position: 'DEF', team: 'Mystery' },
      ]),
    ).toEqual(['BUF'])
  })
})
