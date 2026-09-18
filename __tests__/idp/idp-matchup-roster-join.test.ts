// @vitest-environment node
/**
 * The IDP scoreboard's roster join — this loader's first test.
 *
 * 🛑 THE OPPONENT'S ROSTER IS OFTEN UNDER A KEY NO MANAGER ID CAN REACH. Since #1005 a managerless
 * team's row is keyed `orphan-<provider>-<teamId>`, so both keys this file used to try — the team's
 * `platformUserId` and its roster id — miss. The board then printed the official score with ZERO
 * players beneath it and a note reading "priced 0 of 0 rostered players", which reads as an
 * ingestion failure rather than as a join that missed.
 *
 * Production 2026-09-17: 15 such teams across 6 IDP leagues, every one a league somebody has
 * claimed a team in.
 */
import { describe, expect, it } from 'vitest'

import { loadIdpMatchup } from '@/lib/idp-projections/idpMatchup'

const LEAGUE = 'L1'
const USER = 'af-user-1'

/** An IDP scoring block strict enough for `hasIdpScoring`. */
const SCORING = { idp_tkl_solo: 1, idp_sack: 4, idp_int: 6, pass_td: 4, rec: 1 }

type Roster = { id: string; platformUserId: string | null; playerData: unknown }

function fakePrisma(rosters: Roster[], teams: Array<Record<string, unknown>>) {
  const ok = <T>(v: T) => Promise.resolve(v)
  return {
    league: {
      findUnique: () => ok({ id: LEAGUE, settings: { scoring_settings: SCORING } }),
      findFirst: () => ok(null),
    },
    leagueTeam: {
      findFirst: () => ok(teams.find((t) => t.claimedByUserId === USER) ?? null),
      findMany: () => ok(teams),
    },
    matchupFact: {
      findFirst: () => ok({ teamA: '1', teamB: '2', scoreA: 100, scoreB: 90 }),
    },
    roster: {
      findMany: () => ok(rosters),
      findFirst: () => ok(rosters.find((r) => r.platformUserId === USER) ?? null),
    },
    sportsPlayer: {
      findMany: ({ where }: { where: { sleeperId: { in: string[] } } }) =>
        ok(
          where.sleeperId.in.map((id) => ({
            sleeperId: id,
            name: `Player ${id}`,
            position: 'LB',
            team: 'SF',
            updatedAt: new Date('2026-09-01'),
          })),
        ),
    },
    playerGameStat: {
      aggregate: () => ok({ _max: { season: null, weekOrRound: null } }),
      findMany: () => ok([]),
    },
  } as unknown as Parameters<typeof loadIdpMatchup>[0]['prisma']
}

const TEAMS = [
  { externalId: '1', teamName: 'Mine', platformUserId: 'me-sleeper', claimedByUserId: USER },
  /* Managerless: there is no manager id to join on. */
  { externalId: '2', teamName: 'Theirs', platformUserId: null, claimedByUserId: null },
]

const run = (rosters: Roster[], teams = TEAMS) =>
  loadIdpMatchup({ prisma: fakePrisma(rosters, teams), leagueId: LEAGUE, userId: USER, season: 2026, week: 2 })

describe('loadIdpMatchup roster join', () => {
  it('🛑 fields an opponent whose roster is under the orphan key', async () => {
    const out = await run([
      { id: 'r1', platformUserId: 'me-sleeper', playerData: { players: ['a', 'b'] } },
      { id: 'r2', platformUserId: 'orphan-sleeper-2', playerData: { source_team_id: '2', players: ['c', 'd'] } },
    ])
    expect(out.you?.totalPlayers).toBe(2)
    expect(out.opponent?.totalPlayers).toBe(2)
    expect(out.opponent?.players.map((p) => p.sleeperId).sort()).toEqual(['c', 'd'])
  })

  it('still fields an opponent keyed by their manager id', async () => {
    const out = await run(
      [
        { id: 'r1', platformUserId: 'me-sleeper', playerData: { players: ['a', 'b'] } },
        { id: 'r2', platformUserId: 'them-sleeper', playerData: { players: ['c', 'd'] } },
      ],
      [TEAMS[0], { ...TEAMS[1], platformUserId: 'them-sleeper' }],
    )
    expect(out.opponent?.totalPlayers).toBe(2)
  })

  it('and by the bare roster id, which some imports use as the owner key', async () => {
    const out = await run([
      { id: 'r1', platformUserId: 'me-sleeper', playerData: { players: ['a', 'b'] } },
      { id: 'r2', platformUserId: '2', playerData: { players: ['c'] } },
    ])
    expect(out.opponent?.totalPlayers).toBe(1)
  })

  it('says so rather than inventing a side when nothing matches', async () => {
    const out = await run([{ id: 'r1', platformUserId: 'someone-else', playerData: { players: [] } }])
    expect(out.state).toBe('no_matchup')
    expect(out.notes.join(' ')).toMatch(/no rosters imported/i)
  })
})
