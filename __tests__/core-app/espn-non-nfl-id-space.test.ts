/**
 * @vitest-environment node
 *
 * 🛑 An ESPN league of another sport must never be translated through the NFL ESPN → Sleeper
 * crosswalk.
 *
 * Every ESPN translator (`loadEspnToSleeperMap`, `crosswalkToSleeperIds`) lands on
 * `PlayerIdentityMap.sleeperId`, which is NFL Sleeper's numbering — and Sleeper numbers each sport
 * separately. The real collision used here: Sleeper 1466 is NFL Travis Kelce and NBA JaVale McGee.
 * Kelce's ESPN id is 15847 (`__tests__/decision-os/trade-players.test.ts`). An ESPN basketball
 * roster whose id meets that NFL row (or a mislabelled non-NFL identity row carrying a `sleeperId`,
 * the shape `crossSportSleeperMislabels` repairs) came out as "1466" — Kelce to an NFL reader,
 * McGee to an NBA one, and the right player to neither. A known non-NFL ESPN league is now an
 * unreadable id space: no ids, never a wrong player. NFL ESPN leagues still translate (the control),
 * and an unknown sport keeps the old NFL answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type IdentityRow = { sport: string; espnId: string | null; fleaflickerId?: string | null; mflId?: string | null; sleeperId: string | null }

const KELCE_ESPN = '15847'
const COLLIDING_SLEEPER = '1466' // NFL Travis Kelce, NBA JaVale McGee

const state = {
  sport: 'NBA',
  platform: 'espn',
  playerData: { players: [KELCE_ESPN], starters: [KELCE_ESPN] } as Record<string, unknown>,
  identityRows: [] as IdentityRow[],
}

/** Evaluates the `where` these readers send: `sport`, `espnId: { in }`, `sleeperId: { not: null }`. */
function fakeIdentityFindMany({ where }: { where: Record<string, unknown> }) {
  return state.identityRows.filter((r) => {
    for (const [key, cond] of Object.entries(where)) {
      const v = (r as Record<string, unknown>)[key] ?? null
      if (key === 'sport') {
        if (typeof cond !== 'string' || v !== cond) return false
      } else if (cond && typeof cond === 'object' && 'in' in cond) {
        if (!(cond as { in: unknown[] }).in.includes(v)) return false
      } else if (cond && typeof cond === 'object' && 'not' in cond) {
        if (v === (cond as { not: unknown }).not) return false
      } else {
        throw new Error(`fake findMany cannot evaluate ${key}`)
      }
    }
    return true
  })
}

const identityFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => fakeIdentityFindMany(args))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({
        id: 'L1',
        sport: state.sport,
        season: 2026,
        scoring: null,
        scoringPresetId: null,
        leagueType: 'redraft',
        isDynasty: false,
        rosterSize: null,
        starters: null,
        irSlots: null,
        taxiSlots: null,
        waiverType: null,
        waiverBudget: null,
        waiverMinBid: null,
        waiverHours: null,
        tradeReviewHours: null,
        tradeDeadlineWeek: null,
        draftPickTrading: null,
        settings: null,
        lastSyncedAt: null,
        syncStatus: null,
        platform: state.platform,
        platformLeagueId: 'P1',
      })),
    },
    leagueTeam: { findMany: vi.fn(async () => []) },
    roster: {
      findMany: vi.fn(async () => [
        {
          id: 'r1',
          leagueId: 'L1',
          platformUserId: 'u1',
          playerData: state.playerData,
          faabRemaining: null,
          waiverPriority: null,
          settings: null,
          league: { platform: state.platform, sport: state.sport },
        },
      ]),
    },
    playerIdentityMap: { findMany: (args: { where: Record<string, unknown> }) => identityFindMany(args) },
    redraftRoster: { findMany: vi.fn(async () => []) },
    teamPerformance: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
  },
}))

import {
  espnSportOf,
  isForeignIdSpace,
  loadEspnToSleeperMap,
  rosterIdSpaceOf,
  sleeperReadableRosters,
  sleeperReadableRostersWithGaps,
  translateRostersToSleeperIds,
} from '@/lib/core-app/rosterIdSpace'
import { crosswalkToSleeperIds, sleeperLookupId } from '@/lib/core-app/rosterIdCrosswalk'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'

const NFL_KELCE_ROW: IdentityRow = { sport: 'NFL', espnId: KELCE_ESPN, sleeperId: COLLIDING_SLEEPER }
/** A non-NFL identity row carrying a `sleeperId` — the mislabel shape `crossSportSleeperMislabels` repairs. */
const NBA_MISLABELLED_ROW: IdentityRow = { sport: 'NBA', espnId: KELCE_ESPN, sleeperId: COLLIDING_SLEEPER }

beforeEach(() => {
  identityFindMany.mockClear()
  state.sport = 'NBA'
  state.platform = 'espn'
  state.playerData = { players: [KELCE_ESPN], starters: [KELCE_ESPN] }
  state.identityRows = [NFL_KELCE_ROW]
})

describe('rosterIdSpaceOf — ESPN is an NFL answer', () => {
  it('an ESPN league of a known non-NFL sport is foreign; NFL and an unknown sport stay ESPN', () => {
    for (const sport of ['NBA', 'nba', 'MLB', 'NHL', 'NCAAB']) {
      expect(rosterIdSpaceOf('espn', sport)).toBe('other')
      expect(isForeignIdSpace('ESPN ', sport)).toBe(true)
    }
    expect(rosterIdSpaceOf('espn', 'NFL')).toBe('espn')
    expect(rosterIdSpaceOf('espn', 'nfl')).toBe('espn')
    for (const sport of [undefined, null, '']) expect(rosterIdSpaceOf('espn', sport)).toBe('espn')
  })

  it('espnSportOf hands the sport to the ESPN rule only — a native league of another sport is untouched', () => {
    expect(espnSportOf('espn', 'NBA')).toBe('NBA')
    expect(rosterIdSpaceOf('espn', espnSportOf('espn', 'NBA'))).toBe('other')
    expect(espnSportOf('native', 'NBA')).toBeUndefined()
    expect(rosterIdSpaceOf('native', espnSportOf('native', 'NBA'))).toBe('sleeper')
  })
})

describe('the roster translators', () => {
  it('an NBA ESPN roster does NOT come out as NFL 1466 — no ids, and no crosswalk read', async () => {
    const [nba] = await sleeperReadableRosters([{ playerData: state.playerData }], 'espn', 'NBA')
    expect(nba!.playerData).toEqual({ players: [], starters: [] })
    expect(identityFindMany).not.toHaveBeenCalled()
  })

  it('control: the same ids in an NFL ESPN league still translate to the NFL player', async () => {
    const [nfl] = await sleeperReadableRosters([{ playerData: state.playerData }], 'espn', 'NFL')
    expect(nfl!.playerData).toEqual({ players: [COLLIDING_SLEEPER], starters: [COLLIDING_SLEEPER] })
  })

  it('a mixed batch translates the NFL league and strips the NBA one, in one read', async () => {
    const rosters = [
      { leagueId: 'nfl', playerData: { players: [KELCE_ESPN] } },
      { leagueId: 'nba', playerData: { players: [KELCE_ESPN] } },
    ]
    const sportOf = (r: { leagueId: string }) => (r.leagueId === 'nfl' ? 'NFL' : 'NBA')
    const { rosters: out, untranslatedEspnIds } = await sleeperReadableRostersWithGaps(rosters, 'espn', sportOf)
    expect(out.map((r) => r.playerData)).toEqual([{ players: [COLLIDING_SLEEPER] }, { players: [] }])
    // The NBA ids are not reported as NFL ESPN players the map failed to place either.
    expect(untranslatedEspnIds).toEqual([])
    expect(identityFindMany).toHaveBeenCalledTimes(1)
  })

  it('translateRostersToSleeperIds reports an NBA ESPN league as foreign, counted and unread', async () => {
    const out = await translateRostersToSleeperIds('espn', [{ playerData: state.playerData }], 'NBA')
    expect(out.idSpace).toBe('other')
    expect(out.translated).toBe(0)
    expect(out.rosters[0]!.playerData).toEqual({ players: [], starters: [] })
    expect(identityFindMany).not.toHaveBeenCalled()
  })

  it('loadEspnToSleeperMap refuses a known non-NFL sport; NFL and an unknown sport translate', async () => {
    expect([...(await loadEspnToSleeperMap([KELCE_ESPN], 'NBA'))]).toEqual([])
    expect(identityFindMany).not.toHaveBeenCalled()
    expect([...(await loadEspnToSleeperMap([KELCE_ESPN], 'NFL'))]).toEqual([[KELCE_ESPN, COLLIDING_SLEEPER]])
    expect([...(await loadEspnToSleeperMap([KELCE_ESPN]))]).toEqual([[KELCE_ESPN, COLLIDING_SLEEPER]])
  })
})

describe('crosswalkToSleeperIds — the matchup / My Team / scoring crosswalk', () => {
  it('an NBA ESPN roster gets no Sleeper id even when a mislabelled NBA row carries one', async () => {
    state.identityRows = [NFL_KELCE_ROW, NBA_MISLABELLED_ROW]
    expect([...(await crosswalkToSleeperIds('espn', 'NBA', [KELCE_ESPN]))]).toEqual([])
    // ...and the per-id lookup the readers use resolves to nothing, not to the raw ESPN number.
    expect(sleeperLookupId('espn', KELCE_ESPN, new Map(), 'NBA')).toBeNull()
  })

  it('control: an NFL ESPN roster still crosswalks', async () => {
    expect([...(await crosswalkToSleeperIds('espn', 'NFL', [KELCE_ESPN]))]).toEqual([[KELCE_ESPN, COLLIDING_SLEEPER]])
  })
})

describe('canonical world (Chimmy, trade and waiver grounding) — the real port and assembler', () => {
  it('an NBA ESPN league reads no player ids, rather than NFL 1466', async () => {
    const world = await resolveCanonicalWorld('L1')
    expect(world!.rosters.flatMap((r) => r.playerIds)).toEqual([])
  })

  it('control: an NFL ESPN league reads the translated NFL id', async () => {
    state.sport = 'NFL'
    const world = await resolveCanonicalWorld('L1')
    expect(world!.rosters.flatMap((r) => r.playerIds)).toEqual([COLLIDING_SLEEPER])
  })

  it('control: a native NBA league keeps its catalog ids — the other-sport readers of the world read them by sport', async () => {
    state.platform = 'native'
    state.playerData = { players: ['1114'], starters: ['1114'] }
    const world = await resolveCanonicalWorld('L1')
    expect(world!.rosters.flatMap((r) => r.playerIds)).toEqual(['1114'])
    expect(identityFindMany).not.toHaveBeenCalled()
  })
})
