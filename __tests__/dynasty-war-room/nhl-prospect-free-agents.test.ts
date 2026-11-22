/**
 * @vitest-environment node
 *
 * NHL DYNASTY WAR ROOM: the free Fantrax prospects #3063 put in the league's own free-agent list.
 *
 * The war room's pool was the dynasty-ADP pool only, so a dynasty manager browsing free agents there
 * never saw an AHL, junior or unsigned prospect. It now lists them AFTER the ADP pool, by #3063's rule
 * (`offersNhlProspectFreeAgency` + `loadNhlProspectFreeAgents`), with no value or ADP, and the waiver
 * engine and the prompt never rank or advise them.
 *
 * Drives the real context builder, the real pool module and the real engines; only the database and
 * unrelated readers are stubbed. The stored universe is the #3063 fixture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prospectDb } from '../waiver-wire/nhl-prospect-fixture'

const db = vi.hoisted(() => ({
  league: null as unknown,
  rosters: [] as unknown[],
  adpRows: [] as unknown[],
  prospect: null as null | { sportsDataCache: { findUnique: (...a: unknown[]) => unknown }; playerIdentityMap: { findMany: (...a: unknown[]) => unknown } },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league) },
    roster: { findMany: vi.fn(async () => db.rosters) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    rookieDraftWindow: { findMany: vi.fn(async () => []) },
    futureDraftPick: { findMany: vi.fn(async () => []) },
    draftFact: { groupBy: vi.fn(async () => []) },
    allFantasyAdpSnapshot: { findMany: vi.fn(async () => db.adpRows) },
    sportsDataCache: { findUnique: vi.fn(async (...a: unknown[]) => db.prospect!.sportsDataCache.findUnique(...a)) },
    playerIdentityMap: { findMany: vi.fn(async (...a: unknown[]) => db.prospect!.playerIdentityMap.findMany(...a)) },
  },
}))
vi.mock('@/lib/league-access', () => ({
  resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })),
}))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({
    template: {
      slots: [
        { slotName: 'C', allowedPositions: ['C'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, isFlexibleSlot: false },
        { slotName: 'RW', allowedPositions: ['RW'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, isFlexibleSlot: false },
        { slotName: 'BN', allowedPositions: [], starterCount: 0, benchCount: 6, reserveCount: 0, taxiCount: 0, isFlexibleSlot: false },
      ],
    },
  })),
}))
vi.mock('@/lib/redraft-war-room/redraftInjuryNews', () => ({
  fetchRedraftInjuryNews: vi.fn(async () => ({ injuryByName: new Map(), newsCount: 0, injuriesAsOf: null })),
  injuryNameKey: (n: string) => String(n ?? '').trim().toLowerCase(),
}))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({
  getEffectiveDynastySettings: vi.fn(async () => null),
}))

import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'
import { fetchDynastyNhlProspectFreeAgents } from '@/lib/dynasty-war-room/dynastyFreeAgentPool'
import { buildDynastyWaiverRecommendations } from '@/lib/dynasty-war-room/dynastyWaiverEngine'
import { buildDynastyWarRoomPrompt } from '@/lib/dynasty-war-room/dynastyWarRoomPrompt'

function adpRow(name: string, pos: string, adp: number) {
  return {
    playerKey: `${name.toLowerCase()}|${pos.toLowerCase()}`,
    playerName: name,
    scoringFormat: 'points',
    averageOverallPick: adp,
    sampleSize: 10,
    contextHash: 'ctx',
    draftMode: 'snake',
  }
}

/** The viewer's roster holds a pro and the prospect another team drafted (fantrax:04abc). */
function rosters(sport: string) {
  const pro = sport === 'NBA' ? { id: 'p1', name: 'Some Guard', position: 'PG' } : { id: 'p1', name: 'Rostered Center', position: 'C' }
  return [
    {
      id: 'r1',
      platformUserId: 'af-user',
      playerData: {
        lineup_sections: { starters: [pro], taxi: [{ id: 'fantrax:04abc', name: 'Already Drafted', position: 'D' }] },
      },
      faabRemaining: null,
    },
  ]
}

function leagueRow(sport: string, over: Record<string, unknown> = {}) {
  return { sport, season: 2026, isDynasty: true, leagueType: 'dynasty', leagueVariant: null, platform: 'espn', settings: {}, ...over }
}

async function build() {
  const res = await buildDynastyWarRoomContext({ leagueId: 'L1', userId: 'af-user' })
  if (!res.ok) throw new Error(`build failed: ${res.status} ${res.error}`)
  return res.context
}

/** The same context with the prospect layer forced off: what the War Room was before this change. */
async function buildWithoutProspects() {
  const saved = db.prospect
  db.prospect = prospectDb({ universe: null })
  try {
    const ctx = await build()
    return { ...ctx, nhlProspectFreeAgents: undefined }
  } finally {
    db.prospect = saved
  }
}

const NHL_ADP = [adpRow('Real Winger', 'RW', 40), adpRow('Real Center', 'C', 12)]
const NBA_ADP = [adpRow('Free Forward', 'SF', 20)]

beforeEach(() => {
  db.prospect = prospectDb()
  db.adpRows = NHL_ADP
  db.league = leagueRow('NHL')
  db.rosters = rosters('NHL')
})

describe('NHL dynasty: the war-room pool lists the free prospects after the ADP pool', () => {
  it('includes the free prospects, excludes rostered and linked ones, and places them last', async () => {
    const ctx = await build()
    expect(ctx.freeAgents.map((p) => p.playerId)).toEqual([
      'real center|c',
      'real winger|rw',
      'fantrax:04qyh',
      'fantrax:04qyf',
    ])
    // fantrax:04abc is on a roster here; 04lnk is linked to an NHL identity (he is a pro now).
    expect(ctx.freeAgents.some((p) => p.playerId === 'fantrax:04abc' || p.playerId === 'fantrax:04lnk')).toBe(false)
    expect(ctx.nhlProspectFreeAgents).toEqual({ total: 2, listed: 2 })
  })

  it('a prospect carries no value, ADP or age — never a zero', async () => {
    const ctx = await build()
    const madden = ctx.freeAgents.find((p) => p.playerId === 'fantrax:04qyh')!
    const hillis = ctx.freeAgents.find((p) => p.playerId === 'fantrax:04qyf')!
    expect(madden).toMatchObject({ playerName: 'Tyler Madden', position: 'RW', team: 'MIN', prospectSource: 'fantrax' })
    expect(hillis).toMatchObject({ playerName: 'Cameron Hillis', position: 'C', team: null, prospectSource: 'fantrax' })
    for (const p of [madden, hillis]) {
      expect(p.dynastyValue).toBeNull()
      expect(p.adp).toBeNull()
      expect(p.age).toBeNull()
      expect(p.hasNoValueSignal).toBe(true)
    }
    // Real free agents are untouched by the prospect layer.
    const real = ctx.freeAgents.filter((p) => !p.prospectSource)
    expect(real.every((p) => p.adp != null && p.prospectSource === undefined)).toBe(true)
  })

  it('the waiver engine never ranks a prospect; it lists them after the adds, unranked', async () => {
    const ctx = await build()
    const w = buildDynastyWaiverRecommendations(ctx, 'r1')
    expect(w.recommendedAdds.map((a) => a.playerId)).toEqual(['real center|c', 'real winger|rw'])
    expect(w.unrankedProspects).toEqual([
      { playerId: 'fantrax:04qyh', playerName: 'Tyler Madden', position: 'RW', team: 'MIN' },
      { playerId: 'fantrax:04qyf', playerName: 'Cameron Hillis', position: 'C', team: null },
    ])
    expect(w.prospectList).toEqual({ total: 2, listed: 2 })
  })

  it('with no ranked pool, prospects alone do not make waiver adds "available"', async () => {
    db.adpRows = []
    const ctx = await build()
    expect(ctx.freeAgents.map((p) => p.playerId)).toEqual(['fantrax:04qyh', 'fantrax:04qyf'])
    expect(ctx.availability.freeAgentPool).toBe('missing')
    expect(ctx.featureAvailability.waivers).toBe(false)
    const w = buildDynastyWaiverRecommendations(ctx, 'r1')
    expect(w.needsProviderIntegration).toBe(true)
    expect(w.recommendedAdds).toEqual([])
    expect(w.unrankedProspects?.length).toBe(2)
  })

  it('the prompt (the ask and Chimmy) gets an unranked count only — no prospect is ranked or named', async () => {
    const ctx = await build()
    const prompt = buildDynastyWarRoomPrompt({ context: ctx, waivers: buildDynastyWaiverRecommendations(ctx, 'r1') })
    expect(prompt).toContain('=== TOP FREE AGENTS (dynasty-ADP-ranked, 2 available) ===')
    expect(prompt).toContain('NHL PROSPECTS: 2 Fantrax NHL prospects')
    expect(prompt).toContain('must give no value- or projection-based advice about them')
    expect(prompt).not.toContain('Tyler Madden')
    expect(prompt).not.toContain('Cameron Hillis')
  })
})

describe('everything else is unchanged', () => {
  it('NBA dynasty: no prospect read, pool and waiver result exactly as before', async () => {
    db.league = leagueRow('NBA')
    db.adpRows = NBA_ADP
    db.rosters = rosters('NBA')
    const ctx = await build()
    expect(ctx.freeAgents.map((p) => p.playerId)).toEqual(['free forward|sf'])
    expect('nhlProspectFreeAgents' in ctx).toBe(false)
    const w = buildDynastyWaiverRecommendations(ctx, 'r1')
    expect('unrankedProspects' in w).toBe(false)
    expect('prospectList' in w).toBe(false)
    expect(buildDynastyWarRoomPrompt({ context: ctx })).not.toContain('NHL PROSPECTS')
  })

  it('NHL redraft: the war room refuses it and no prospect is read', async () => {
    // isDynasty false with a redraft type is not a dynasty-family league: the war room refuses it
    // (404) before any pool is built, and the shared rule says no prospects either.
    db.league = leagueRow('NHL', { isDynasty: false, leagueType: 'redraft' })
    const res = await buildDynastyWarRoomContext({ leagueId: 'L1', userId: 'af-user' })
    expect(res.ok).toBe(false)
    const findUnique = db.prospect!.sportsDataCache.findUnique as ReturnType<typeof vi.fn>
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('an NHL devy-dynasty variant whose type is not in the dynasty family gets no prospects', async () => {
    // The war room admits `leagueVariant: devy_dynasty`; the #3063 rule decides on isDynasty/leagueType.
    db.league = leagueRow('NHL', { isDynasty: false, leagueType: 'redraft', leagueVariant: 'devy_dynasty' })
    const ctx = await build()
    expect(ctx.freeAgents.map((p) => p.playerId)).toEqual(['real center|c', 'real winger|rw'])
    expect('nhlProspectFreeAgents' in ctx).toBe(false)
  })

  it('an unreadable stored universe leaves the pool exactly as it was', async () => {
    const before = await buildWithoutProspects()
    db.prospect = prospectDb({ universe: 'throw' })
    const ctx = await build()
    expect('nhlProspectFreeAgents' in ctx).toBe(false)
    expect(ctx.freeAgents).toEqual(before.freeAgents)
    expect(ctx.availability).toEqual(before.availability)
    expect(buildDynastyWaiverRecommendations(ctx, 'r1')).toEqual(
      (({ unrankedProspects: _u, prospectList: _p, ...rest }) => rest)(buildDynastyWaiverRecommendations(before, 'r1')),
    )
  })
})

describe('fetchDynastyNhlProspectFreeAgents (the rule is #3063’s)', () => {
  it('NHL dynasty: returns the free prospects minus rostered ids', async () => {
    const out = await fetchDynastyNhlProspectFreeAgents(prospectDb() as never, {
      league: { sport: 'NHL', isDynasty: true },
      rosteredIds: new Set(['fantrax:04qyh']),
    })
    // The reader's order: signed (an NHL org) before unsigned.
    expect(out?.prospects.map((p) => p.playerId)).toEqual(['fantrax:04abc', 'fantrax:04qyf'])
    expect(out?.meta).toEqual({ total: 2, listed: 2 })
  })

  it('caps the list and keeps the true total', async () => {
    const out = await fetchDynastyNhlProspectFreeAgents(prospectDb() as never, {
      league: { sport: 'NHL', leagueType: 'devy' },
      rosteredIds: new Set(),
      limit: 1,
    })
    expect(out?.meta).toEqual({ total: 3, listed: 1 })
  })

  it.each([
    ['NHL redraft', { sport: 'NHL', isDynasty: false, leagueType: 'redraft' }],
    ['NHL keeper', { sport: 'NHL', isDynasty: false, leagueType: 'keeper' }],
    ['NBA dynasty', { sport: 'NBA', isDynasty: true }],
    ['NFL dynasty', { sport: 'NFL', isDynasty: true, leagueType: 'dynasty' }],
  ])('%s: null, and the stored universe is never read', async (_label, league) => {
    const fake = prospectDb()
    const out = await fetchDynastyNhlProspectFreeAgents(fake as never, { league, rosteredIds: new Set() })
    expect(out).toBeNull()
    expect(fake.sportsDataCache.findUnique).not.toHaveBeenCalled()
  })

  it('a failed read is null (the caller keeps the ADP pool)', async () => {
    const out = await fetchDynastyNhlProspectFreeAgents(prospectDb({ universe: 'throw' }) as never, {
      league: { sport: 'NHL', isDynasty: true },
      rosteredIds: new Set(),
    })
    expect(out).toBeNull()
  })
})
