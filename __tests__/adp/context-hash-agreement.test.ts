/**
 * The writer and the reader must agree on the context hash — end to end.
 *
 * `AllFantasyAdpSnapshot` is keyed on a sha256 over seven fields. The recompute built that tuple
 * from `DraftSession`; `readSnapshotForLeague` built it from `League` and `settings.draft.type`.
 * Three of the seven could differ, and any one of them means a reader finds ZERO rows for players
 * written seconds earlier.
 *
 * 🛑 THE FAILURE IS INVISIBLE BY CONSTRUCTION. readSnapshotForLeague never falls back to market
 * ADP — deliberately — so an empty result renders as em-dashes, which is exactly what the product
 * is supposed to show when there genuinely are no samples. Turning on
 * NEXT_PUBLIC_USE_ALLFANTASY_ADP against a mismatched hash would have looked like a correctly
 * working feature on a cold table.
 *
 * So this test does not compare two derivations in the abstract. It runs the real recompute,
 * captures the hash it WRITES, runs the real reader, captures the hash it QUERIES, and asserts
 * they are the same string. The fixture is chosen so all three historical divergences are live at
 * once: a capitalised leagueVariant, a session draftType that disagrees with settings.draft.type,
 * and a session teamCount with a null League.leagueSize.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDraftPickFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockAdpUpsert = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockAdpFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockDraftFactFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockLeagueFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockLeagueFindUnique = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const mockIdentityFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftPick: { findMany: mockDraftPickFindMany },
    allFantasyAdpSnapshot: { upsert: mockAdpUpsert, findMany: mockAdpFindMany },
    draftFact: { findMany: mockDraftFactFindMany },
    league: { findMany: mockLeagueFindMany, findUnique: mockLeagueFindUnique },
    playerIdentityMap: { findMany: mockIdentityFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
  },
}))

import { recomputeAllFantasyAdp } from '@/lib/adp/recomputeAllFantasyAdp'
import { readAllFantasyAdpForLeague } from '@/lib/adp/readSnapshotForLeague'
import { buildDraftContext } from '@/lib/adp/draftContextKey'
import { buildContextHash } from '@/lib/adp/computeAllFantasyAdp'

/*
 * Every one of these is a field the two sides used to disagree about:
 *   leagueVariant 'Dynasty'  — writer lowercased it, reader did not
 *   draftType     session says 'linear', settings says 'snake' — reader read settings
 *   teamCount     session says 10, leagueSize is null — reader defaulted to 12
 */
const LEAGUE_ROW = {
  sport: 'NFL',
  season: 2026,
  scoring: 'ppr',
  isDynasty: true,
  leagueVariant: 'Dynasty',
  leagueSize: null,
  settings: { draft: { type: 'snake' } },
  draftSessions: { draftType: 'linear', teamCount: 10 },
}

const PICK_ROW = {
  playerName: 'Ja’Marr Chase',
  position: 'WR',
  overall: 2,
  round: 1,
  roundPick: 2,
  pickedAt: null,
  source: 'sleeper-mirror',
  assetType: 'player',
  pickMetadata: null,
  session: {
    sessionKind: 'live',
    status: 'in_progress',
    teamCount: 10,
    draftType: 'linear',
    sportType: null,
    league: {
      sport: 'NFL',
      season: 2026,
      scoring: 'ppr',
      isDynasty: true,
      leagueVariant: 'Dynasty',
    },
  },
}

beforeEach(() => {
  mockDraftPickFindMany.mockReset().mockResolvedValue([PICK_ROW])
  mockAdpUpsert.mockReset().mockResolvedValue({})
  mockAdpFindMany.mockReset().mockResolvedValue([])
  mockDraftFactFindMany.mockReset().mockResolvedValue([])
  mockLeagueFindMany.mockReset().mockResolvedValue([])
  mockLeagueFindUnique.mockReset().mockResolvedValue(LEAGUE_ROW)
  mockIdentityFindMany.mockReset().mockResolvedValue([])
  mockSportsPlayerFindMany.mockReset().mockResolvedValue([])
})

async function hashTheWriterWrites(): Promise<string> {
  await recomputeAllFantasyAdp({ sport: 'NFL', apply: true })
  const call = mockAdpUpsert.mock.calls[0]?.[0]
  return String(call?.create?.contextHash ?? '')
}

async function hashTheReaderQueries(): Promise<string> {
  /*
   * The recompute ALSO calls allFantasyAdpSnapshot.findMany, for its 7/30-day trend windows, so
   * calls[0] can belong to the writer. Clearing first makes calls[0] unambiguously the reader's.
   */
  mockAdpFindMany.mockClear()
  await readAllFantasyAdpForLeague('lg1')
  return String(mockAdpFindMany.mock.calls[0]?.[0]?.where?.contextHash ?? '')
}

describe('writer and reader agree on the context hash', () => {
  it('produces the identical hash end to end', async () => {
    const written = await hashTheWriterWrites()
    const queried = await hashTheReaderQueries()

    // Positive control: both sides actually produced a hash, so equality is not two empty strings.
    expect(written).toMatch(/^[0-9a-f]{16}$/)
    expect(queried).toMatch(/^[0-9a-f]{16}$/)
    expect(queried).toBe(written)
  })

  it('the shared derivation is what both sides land on', async () => {
    const expected = buildContextHash(
      buildDraftContext({
        league: {
          sport: 'NFL',
          season: 2026,
          scoring: 'ppr',
          isDynasty: true,
          leagueVariant: 'Dynasty',
          leagueSize: null,
          settings: { draft: { type: 'snake' } },
        },
        session: { draftType: 'linear', teamCount: 10 },
      }),
    )
    expect(await hashTheWriterWrites()).toBe(expected)
    expect(await hashTheReaderQueries()).toBe(expected)
  })
})

describe('each field that historically diverged', () => {
  it('lowercases leagueVariant on both sides', () => {
    const upper = buildDraftContext({
      league: { ...LEAGUE_ROW, leagueVariant: 'Dynasty' },
      session: LEAGUE_ROW.draftSessions,
    })
    const lower = buildDraftContext({
      league: { ...LEAGUE_ROW, leagueVariant: 'dynasty' },
      session: LEAGUE_ROW.draftSessions,
    })
    expect(upper.leagueType).toBe('dynasty')
    expect(buildContextHash(upper)).toBe(buildContextHash(lower))
  })

  it('prefers the session draft type over settings.draft.type', () => {
    const ctx = buildDraftContext({
      league: { ...LEAGUE_ROW, settings: { draft: { type: 'snake' } } },
      session: { draftType: 'auction', teamCount: 10 },
    })
    expect(ctx.draftType).toBe('auction')
  })

  it('falls back to settings.draft.type only when there is no session', () => {
    const ctx = buildDraftContext({
      league: { ...LEAGUE_ROW, settings: { draft: { type: 'auction' } } },
      session: null,
    })
    expect(ctx.draftType).toBe('auction')
  })

  it('prefers the session team count over League.leagueSize', () => {
    const ctx = buildDraftContext({
      league: { ...LEAGUE_ROW, leagueSize: 12 },
      session: { draftType: 'snake', teamCount: 10 },
    })
    expect(ctx.teamCount).toBe(10)
  })

  it('treats a zero team count as absent rather than as a size', () => {
    const ctx = buildDraftContext({
      league: { ...LEAGUE_ROW, leagueSize: 8 },
      session: { draftType: 'snake', teamCount: 0 },
    })
    expect(ctx.teamCount).toBe(8)
  })

  it('falls back to 12 only when neither side gives a usable size', () => {
    const ctx = buildDraftContext({
      league: { ...LEAGUE_ROW, leagueSize: null },
      session: { draftType: 'snake', teamCount: null },
    })
    expect(ctx.teamCount).toBe(12)
  })
})
