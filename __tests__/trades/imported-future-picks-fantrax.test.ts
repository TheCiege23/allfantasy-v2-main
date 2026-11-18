// @vitest-environment node
/**
 * Fantrax picks on the trade screens.
 *
 * The pick reader listed imported picks for Sleeper and MFL only, so a Fantrax league's traded
 * picks were saved and shown nowhere. These pin that a Fantrax league now gets every team's own
 * picks in the rounds Fantrax publishes, moved to their holder where a stored row says so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  futurePicks: vi.fn(),
  draftFacts: vi.fn(),
  league: vi.fn(),
  snapshot: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    futureDraftPick: { findMany: h.futurePicks },
    draftFact: { groupBy: h.draftFacts },
    league: { findUnique: h.league },
    fantraxLeague: { findFirst: h.snapshot },
  },
}))
vi.mock('@/lib/decision-os/world/assemble', () => ({
  matchTeamIdForRoster: (roster: { teamId: string }) => roster.teamId,
}))

import { hasSyncedProviderPicks, loadImportedFuturePicks } from '@/lib/league-trade-engine/importedFuturePicks'

const TEAMS = [
  { id: 'team-jets', externalId: '9', platformUserId: null, claimedByUserId: null, teamName: 'Jets' },
  { id: 'team-oilers', externalId: '27', platformUserId: null, claimedByUserId: null, teamName: 'Oilers' },
]
const ROSTERS = [
  { id: 'roster-jets', teamId: 'team-jets', platformUserId: 'u1', playerData: { players: [] } },
  { id: 'roster-oilers', teamId: 'team-oilers', platformUserId: 'u2', playerData: { players: [] } },
]
/* What Fantrax publishes: rounds 1-4 for each of the next drafts, for both teams. */
const futureRaw = [2027, 2028, 2029, 2030].flatMap((year) =>
  [1, 2, 3, 4].flatMap((round) =>
    ['fx-jets', 'fx-oilers'].map((team) => ({ year, round, originalOwnerTeamId: team, currentOwnerTeamId: team })),
  ),
)

const load = (overrides: Record<string, unknown> = {}) =>
  loadImportedFuturePicks({
    leagueId: 'lea-1', platform: 'fantrax', isDynasty: false, leagueSeason: 2026, status: 'in_season',
    teams: TEAMS, rosters: ROSTERS as never, ...overrides,
  })

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ platformLeagueId: 'tau9a8fomvmq84sx' })
  h.snapshot.mockResolvedValue({ draftPicks: { version: 1, current: [], futureRaw } })
  /* One traded pick: the Oilers' 2027 1st is held by the Jets. */
  h.futurePicks.mockResolvedValue([{ pickSeason: 2027, round: 1, originalRosterId: '27', currentOwnerId: '9' }])
})

describe('Fantrax picks reach the trade screens', () => {
  it('counts Fantrax among the providers whose picks are read', () => {
    expect(hasSyncedProviderPicks('fantrax')).toBe(true)
    expect(hasSyncedProviderPicks('Fantrax')).toBe(true)
    expect(hasSyncedProviderPicks('espn')).toBe(false)
  })

  it('lists every team\'s own picks for three drafts, with the traded one on its holder', async () => {
    const out = await load()

    expect(out.coverage).toBe('complete')
    const jets = out.picksByRosterId.get('roster-jets') ?? []
    const oilers = out.picksByRosterId.get('roster-oilers') ?? []
    /* 3 drafts x 4 rounds = 12 each; one moved Oilers -> Jets. */
    expect(jets).toHaveLength(13)
    expect(oilers).toHaveLength(11)
    expect(jets.find((p) => p.originalTeamId === '27')).toMatchObject({
      season: 2027, round: 1, ownerTeamId: '9', source: 'stored', fromTeamName: 'Oilers',
    })
    expect(oilers.some((p) => p.season === 2027 && p.round === 1)).toBe(false)
    /* The horizon is three drafts, not Fantrax's ten. */
    expect(Math.max(...jets.map((p) => p.season))).toBe(2029)
  })

  /** A 36-round startup draft must never be read as the rookie round count. */
  it('does not size the draft from Fantrax draft history', async () => {
    await load({ isDynasty: true })
    expect(h.draftFacts).not.toHaveBeenCalled()
  })

  it('falls back to traded picks alone when no pick list is on file', async () => {
    h.snapshot.mockResolvedValue({ draftPicks: null })
    const out = await load()
    expect(out.coverage).toBe('traded_only')
    expect(out.picksByRosterId.get('roster-jets')).toHaveLength(1)
    expect(out.picksByRosterId.get('roster-oilers')).toBeUndefined()
  })

  it('falls back the same way when the snapshot cannot be read', async () => {
    h.snapshot.mockRejectedValue(new Error('column "draftPicks" does not exist'))
    const out = await load()
    expect(out.coverage).toBe('traded_only')
    expect(out.readFailed).toBe(false)
  })

  it('leaves Sleeper on the draft-history path, untouched', async () => {
    h.draftFacts.mockResolvedValue([])
    await load({ platform: 'sleeper', isDynasty: true })
    expect(h.draftFacts).toHaveBeenCalledOnce()
    expect(h.snapshot).not.toHaveBeenCalled()
  })
})
