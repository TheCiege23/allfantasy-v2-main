/**
 * @vitest-environment node
 *
 * 🛑 THE DYNASTY WAR ROOM SHOWED NO PICKS FOR ANY IMPORTED TEAM, AND CALLED PICK DATA AVAILABLE.
 *
 * It grouped `future_draft_picks` by `currentOwnerId` and looked teams up by `Roster.id`; imported
 * leagues store the provider's team id there. Measured on staging 2026-09-17: 103 imported dynasty
 * leagues with pick rows, 0 of 1,462 teams with a pick, `futurePicks: 'available'` for all 103.
 *
 * Drives the real `buildDynastyWarRoomContext` and the real pick engine; only the database and the
 * unrelated readers (values, injuries, templates) are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: null as unknown,
  rosters: [] as unknown[],
  teams: [] as unknown[],
  futurePicks: vi.fn(),
  draftFacts: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league) },
    roster: { findMany: vi.fn(async () => db.rosters) },
    leagueTeam: { findMany: vi.fn(async () => db.teams) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    rookieDraftWindow: { findMany: vi.fn(async () => []) },
    futureDraftPick: { findMany: (...a: unknown[]) => db.futurePicks(...a) },
    draftFact: { groupBy: (...a: unknown[]) => db.draftFacts(...a) },
  },
}))
vi.mock('@/lib/league-access', () => ({
  resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })),
}))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ template: { slots: [] } })),
}))
vi.mock('@/lib/redraft-war-room/redraftInjuryNews', () => ({
  fetchRedraftInjuryNews: vi.fn(async () => ({ injuryByName: new Map(), newsCount: 0, injuriesAsOf: null })),
  injuryNameKey: (n: string) => String(n ?? '').trim().toLowerCase(),
}))
vi.mock('@/lib/dynasty-war-room/dynastyFreeAgentPool', () => ({
  fetchDynastyValueByKey: vi.fn(async () => new Map()),
  fetchDynastyFreeAgentPool: vi.fn(async () => []),
  dynastyRosteredKeys: () => new Set(),
}))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({
  getEffectiveDynastySettings: vi.fn(async () => null),
}))

import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'
import { evaluateDynastyPickValue } from '@/lib/dynasty-war-room/dynastyPickValueEngine'
import { evaluateDynastyTeamDirection } from '@/lib/dynasty-war-room/dynastyTeamDirectionEngine'
import { analyzeDynastyTrade } from '@/lib/dynasty-war-room/dynastyTradeEngine'
import { pickHeuristicValue } from '@/lib/dynasty-war-room/dynastyPlayerValue'

const team = (id: string, externalId: string, platformUserId: string, teamName: string) => ({
  id, externalId, platformUserId, claimedByUserId: null, ownerName: teamName, teamName,
  wins: 0, losses: 0, ties: 0, pointsFor: 0, currentRank: null,
})

async function build() {
  const res = await buildDynastyWarRoomContext({ leagueId: 'L1', userId: 'af-user' })
  if (!res.ok) throw new Error(`build failed: ${res.status} ${res.error}`)
  const ctx = res.context
  const picksOf = (rosterId: string) => ctx.teams.find((t) => t.rosterId === rosterId)!.picks
  return { ctx, picksOf }
}

beforeEach(() => {
  db.league = {
    sport: 'NFL', season: 2026, isDynasty: true, leagueVariant: null, platform: 'sleeper',
    settings: { status: 'in_season' },
  }
  db.teams = [team('t1', '1', 'sleeper-1', 'Alpha'), team('t2', '2', 'sleeper-2', 'Bravo')]
  db.rosters = [
    // The viewer linked an AllFantasy account, so only the import's source team id joins this roster.
    { id: 'r1', platformUserId: 'af-user', playerData: { players: [], source_team_id: '1' }, faabRemaining: null },
    { id: 'r2', platformUserId: 'sleeper-2', playerData: { players: [] }, faabRemaining: null },
  ]
  // A 20-round startup, then 2-round rookie drafts.
  db.draftFacts.mockReset().mockResolvedValue([
    { season: 2021, _max: { round: 20 }, _count: { _all: 40 } },
    { season: 2026, _max: { round: 2 }, _count: { _all: 4 } },
  ])
  // Stored rows are provider-id keyed and TRADED-only: Bravo's 2027 1st now belongs to Alpha.
  db.futurePicks.mockReset().mockResolvedValue([
    { pickSeason: 2027, round: 1, originalRosterId: '2', currentOwnerId: '1' },
  ])
})

describe('🛑 an imported league\'s teams get their pick capital', () => {
  it('attaches every upcoming pick to the roster that holds it', async () => {
    const { picksOf } = await build()
    // Alpha: own 2 rounds × 3 drafts, plus Bravo's 2027 1st. Bravo: its own 6, less that pick.
    expect(picksOf('r1')).toHaveLength(7)
    expect(picksOf('r2')).toHaveLength(5)
  })

  it('keeps owners in Roster.id space, so "own" and "acquired" mean what they say', async () => {
    const { picksOf } = await build()
    const acquired = picksOf('r1').find((p) => p.id === 'fdp:2027:1:2')!
    expect(acquired).toMatchObject({
      season: 2027, round: 1, originalRosterId: 'r2', currentOwnerId: 'r1', traded: true, originalTeamName: 'Bravo',
    })
    expect(acquired.estValue).toBe(pickHeuristicValue(1, 1))
    const own = picksOf('r1').find((p) => p.id === 'fdp:2027:1:1')!
    expect(own).toMatchObject({ originalRosterId: 'r1', currentOwnerId: 'r1', traded: false })
  })

  it('the pick engine counts the acquired pick as acquired, and names where it came from', async () => {
    const { ctx } = await build()
    const pv = evaluateDynastyPickValue(ctx, 'r1')
    expect(pv.picks).toHaveLength(7)
    const acquired = pv.picks.find((p) => p.id === 'fdp:2027:1:2')!
    expect(acquired.fromOriginalOwner).toBe(false)
    expect(acquired.note).toContain('acquired from Bravo')
    expect(pv.picks.filter((p) => p.fromOriginalOwner)).toHaveLength(6)
    expect(pv.totalEstValue).toBeGreaterThan(0)
    expect(pv.trackingEnabledEmpty).toBe(false)
  })

  it('reports pick data available, and turns the pick-value feature on', async () => {
    const { ctx } = await build()
    expect(ctx.availability.futurePicks).toBe('available')
    expect(ctx.featureAvailability.pickValue).toBe(true)
    const pv = evaluateDynastyPickValue(ctx, 'r1')
    expect(pv.partial).toBe(false)
  })

  it('[control] a complete list IS capital to team direction', async () => {
    db.teams = db.teams.map((t) => ({ ...(t as object), wins: 5, losses: 3 }))
    const { ctx } = await build()
    // r2: the context joins records by platformUserId, and only Bravo's roster carries its team's.
    const dir = evaluateDynastyTeamDirection(ctx, 'r2')
    // Own 1st and 2nd in each of three 2-round drafts, less the 2027 1st: all five are "early".
    expect(dir.earlyPickCount).toBe(5)
    expect(dir.pickCapitalValue).not.toBeNull()
    expect(dir.explanationFacts.join(' ')).toContain('Pick capital: 5 future pick(s)')
  })

  it('never shows a pick from a draft already held', async () => {
    db.futurePicks.mockResolvedValue([{ pickSeason: 2026, round: 1, originalRosterId: '2', currentOwnerId: '1' }])
    const { picksOf } = await build()
    expect([...picksOf('r1'), ...picksOf('r2')].some((p) => p.season <= 2026)).toBe(false)
  })

  it('🛑 rows that reach no team are NOT "available"', async () => {
    // No roster joins either team: the old flag said 'available' on row count alone.
    db.rosters = [{ id: 'rx', platformUserId: 'stranger', playerData: { players: [] }, faabRemaining: null }]
    const { ctx, picksOf } = await build()
    expect(picksOf('rx')).toEqual([])
    expect(ctx.availability.futurePicks).toBe('available_empty')
    expect(ctx.featureAvailability.pickValue).toBe(false)
  })

  describe('🛑 with no known draft size, the traded picks are a FRAGMENT, not a team\'s capital', () => {
    beforeEach(() => {
      db.draftFacts.mockResolvedValue([])
    })

    it('lists only the traded picks, says so, and marks the data partial', async () => {
      const { ctx, picksOf } = await build()
      expect(picksOf('r1').map((p) => p.id)).toEqual(['fdp:2027:1:2'])
      expect(picksOf('r2')).toEqual([])
      expect(ctx.missingDataFlags.join(' ')).toContain('Only picks that changed hands are modeled')
      expect(ctx.availability.futurePicks).toBe('partial')
      expect(ctx.featureAvailability.pickValue).toBe(true)
    })

    it('the pick engine lists them but withholds a total', async () => {
      const { ctx } = await build()
      const pv = evaluateDynastyPickValue(ctx, 'r1')
      expect(pv.picks.map((p) => p.id)).toEqual(['fdp:2027:1:2'])
      expect(pv.partial).toBe(true)
      expect(pv.totalEstValue).toBeNull()
      expect(pv.needsProviderIntegration).toBe(false)
    })

    it('team direction does not read the fragment as capital', async () => {
      // A record, so the direction engine writes its facts at all.
      db.teams = db.teams.map((t) => ({ ...(t as object), wins: 5, losses: 3 }))
      const { ctx } = await build()
      // Alpha "holds" one early pick and Bravo none — both false as statements of their capital.
      expect(evaluateDynastyTeamDirection(ctx, 'r1')).toMatchObject({ pickCapitalValue: null, earlyPickCount: 0 })
      const dir = evaluateDynastyTeamDirection(ctx, 'r2')
      expect(dir).toMatchObject({ pickCapitalValue: null, earlyPickCount: 0 })
      expect(dir.explanationFacts.join(' ')).toContain('Record 5-3')
      expect(dir.explanationFacts.join(' ')).not.toContain('Pick capital')
    })

    it('a trade can still price a pick the list names', async () => {
      const { ctx } = await build()
      const res = analyzeDynastyTrade(ctx, {
        rosterId: 'r1',
        outgoingPlayerIds: [],
        incomingPlayerIds: [],
        outgoingPickIds: ['fdp:2027:1:2'],
      })
      expect(res.pickImpact.join(' ')).toContain('Sending')
      expect(res.riskFlags.join(' ')).not.toContain('not tracked')
    })

    it('rows that reach no team are still partial, never "no picks recorded"', async () => {
      db.rosters = [{ id: 'rx', platformUserId: 'stranger', playerData: { players: [] }, faabRemaining: null }]
      const { ctx } = await build()
      expect(ctx.availability.futurePicks).toBe('partial')
    })

    it('a league with no draft history and no traded picks is partial too', async () => {
      db.futurePicks.mockResolvedValue([])
      const { ctx, picksOf } = await build()
      expect(picksOf('r1')).toEqual([])
      expect(ctx.availability.futurePicks).toBe('partial')
    })
  })

  describe('🛑 two roster rows for one team: the owner\'s row holds the picks, whatever the row order', () => {
    const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }))
    // A re-import's copy: no owner id, and (as on staging) sometimes the fuller roster.
    const ownerless = { id: 'r1copy', platformUserId: '', playerData: { players: players(3), source_team_id: '1' }, faabRemaining: null }
    // A copy under another user's id, beside the roster whose owner IS the team's owner.
    const stranger = { id: 'r0stranger', platformUserId: 'someone-else', playerData: { players: players(5), source_team_id: '2' }, faabRemaining: null }

    for (const order of ['copies last', 'copies first'] as const) {
      it(`an ownerless copy never takes a team's picks (${order})`, async () => {
        const base = db.rosters as unknown[]
        db.rosters = order === 'copies last' ? [...base, ownerless] : [ownerless, ...base]
        const { picksOf } = await build()
        expect(picksOf('r1')).toHaveLength(7)
        expect(picksOf('r1copy')).toEqual([])
      })

      it(`the team owner's roster beats another user's copy (${order})`, async () => {
        const base = db.rosters as unknown[]
        db.rosters = order === 'copies last' ? [...base, stranger] : [stranger, ...base]
        const { picksOf } = await build()
        expect(picksOf('r2')).toHaveLength(5)
        expect(picksOf('r0stranger')).toEqual([])
      })
    }

    it('with nothing else to tell them apart, the fuller roster wins, then the lower id', async () => {
      const thin = { id: 'r1a', platformUserId: '', playerData: { players: players(1), source_team_id: '1' }, faabRemaining: null }
      const full = { id: 'r1b', platformUserId: '', playerData: { players: players(4), source_team_id: '1' }, faabRemaining: null }
      const twin = { id: 'r1c', platformUserId: '', playerData: { players: players(4), source_team_id: '1' }, faabRemaining: null }
      db.rosters = [twin, thin, full, (db.rosters as unknown[])[1]]
      const { picksOf } = await build()
      expect(picksOf('r1b')).toHaveLength(7)
      expect([...picksOf('r1a'), ...picksOf('r1c')]).toEqual([])
    })
  })

  it('an orphan roster shows no owner name, not its placeholder key', async () => {
    db.rosters = [
      ...(db.rosters as unknown[]),
      { id: 'r3', platformUserId: 'orphan-sleeper-3', playerData: { players: [], source_team_id: '3' }, faabRemaining: null },
      // [control] a manager with no team row still shows the id it has.
      { id: 'r4', platformUserId: 'sleeper-77', playerData: { players: [], source_team_id: '4' }, faabRemaining: null },
    ]
    const { ctx } = await build()
    expect(ctx.teams.find((t) => t.rosterId === 'r3')!.ownerName).toBe('')
    expect(ctx.teams.find((t) => t.rosterId === 'r4')!.ownerName).toBe('sleeper-77')
  })

  it('a failed pick read is "missing", not "no picks recorded"', async () => {
    db.futurePicks.mockRejectedValue(new Error('db down'))
    const { ctx } = await build()
    expect(ctx.availability.futurePicks).toBe('missing')
  })
})

describe('a native league keeps its Roster.id-keyed picks', () => {
  beforeEach(() => {
    db.league = { sport: 'NFL', season: 2026, isDynasty: true, leagueVariant: null, platform: 'allfantasy', settings: {} }
    db.teams = [team('t1', 'r1', 'af-user', 'Alpha'), team('t2', 'r2', 'af-other', 'Bravo')]
    db.rosters = [
      { id: 'r1', platformUserId: 'af-user', playerData: { players: [] }, faabRemaining: null },
      { id: 'r2', platformUserId: 'af-other', playerData: { players: [] }, faabRemaining: null },
    ]
    db.futurePicks.mockResolvedValue([
      { id: 'fp1', pickSeason: 2027, round: 1, originalRosterId: 'r1', currentOwnerId: 'r1', status: 'active', traded: false },
      { id: 'fp2', pickSeason: 2027, round: 1, originalRosterId: 'r2', currentOwnerId: 'r1', status: 'active', traded: true },
    ])
  })

  it('[control] attaches rows by roster id, with their own ids', async () => {
    const { ctx, picksOf } = await build()
    expect(picksOf('r1').map((p) => p.id)).toEqual(['fp1', 'fp2'])
    expect(ctx.availability.futurePicks).toBe('available')
    // A native league never reads the draft history: its picks are all rows.
    expect(db.draftFacts).not.toHaveBeenCalled()
  })

  it('a row whose owner is no roster here is reported, and does not make the data "available"', async () => {
    db.futurePicks.mockResolvedValue([
      { id: 'fp9', pickSeason: 2027, round: 1, originalRosterId: 'ghost', currentOwnerId: 'ghost', status: 'active', traded: false },
    ])
    const { ctx } = await build()
    expect(ctx.availability.futurePicks).toBe('available_empty')
    expect(ctx.missingDataFlags.join(' ')).toContain('could not be matched to a team')
  })

  it('an absent table (P2021) is "missing"', async () => {
    db.futurePicks.mockRejectedValue(Object.assign(new Error('no table'), { code: 'P2021' }))
    const { ctx } = await build()
    expect(ctx.availability.futurePicks).toBe('missing')
  })
})
