/**
 * AllFantasy ADP recompute — ROW SELECTION contract.
 *
 * The existing D.5 suite mocks `recomputeAllFantasyAdp` wholesale to test the cron route's auth,
 * so nothing ever exercised the query the recompute actually issues. Two filters in it selected
 * approximately nothing while the job kept exiting 200 with `snapshotsWritten: 0`:
 *
 *   1. `sportType: 'NFL'` on DraftPick. That column is nullable and `lib/draft/sleeperSync.ts` —
 *      the mirror for live, externally hosted Sleeper drafts — never writes it. Prisma equality
 *      never matches NULL.
 *   2. `pickedAt != null OR session.status = 'completed'`. `pickedAt` is set by exactly one
 *      caller (`commissionerPickEditService`); the two ordinary pick writers omit it and
 *      `sleeperSync` nulls it on purpose. So every in-progress draft was excluded.
 *
 * Each test below fails against the pre-fix module. They assert on the `where` argument and on
 * end-to-end behaviour for a row shaped exactly like one `sleeperSync` writes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDraftPickFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockAdpUpsert = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockAdpFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockDraftFactFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockLeagueFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockIdentityFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftPick: { findMany: mockDraftPickFindMany },
    allFantasyAdpSnapshot: { upsert: mockAdpUpsert, findMany: mockAdpFindMany },
    draftFact: { findMany: mockDraftFactFindMany },
    league: { findMany: mockLeagueFindMany },
    playerIdentityMap: { findMany: mockIdentityFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
  },
}))

import { recomputeAllFantasyAdp } from '@/lib/adp/recomputeAllFantasyAdp'

/** A row shaped like the ones `lib/draft/sleeperSync.ts` writes: no sportType, no pickedAt. */
function mirroredPick(over: Record<string, unknown> = {}) {
  return {
    playerName: "Ja'Marr Chase",
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
      teamCount: 12,
      draftType: 'snake',
      sportType: null,
      league: {
        sport: 'NFL',
        season: 2026,
        scoring: 'ppr',
        isDynasty: false,
        leagueVariant: null,
      },
    },
    ...over,
  }
}

function whereArg() {
  return mockDraftPickFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>
}

beforeEach(() => {
  mockDraftPickFindMany.mockReset().mockResolvedValue([])
  mockAdpUpsert.mockReset().mockResolvedValue({})
  mockAdpFindMany.mockReset().mockResolvedValue([])
  mockDraftFactFindMany.mockReset().mockResolvedValue([])
  mockLeagueFindMany.mockReset().mockResolvedValue([])
  mockIdentityFindMany.mockReset().mockResolvedValue([])
  mockSportsPlayerFindMany.mockReset().mockResolvedValue([])
})

describe('recompute row selection — sport', () => {
  it('matches sport through league.sport, never DraftPick.sportType', async () => {
    await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    const where = whereArg()
    expect(where).toMatchObject({ session: { league: { sport: 'NFL' } } })
    // The whole bug in one assertion: a nullable column can never carry this filter.
    expect(where).not.toHaveProperty('sportType')
  })

  it('normalizes vendor college spellings onto the Prisma enum', async () => {
    await recomputeAllFantasyAdp({ sport: 'NCAAFB', apply: false })
    expect(whereArg()).toMatchObject({ session: { league: { sport: 'NCAAF' } } })
  })

  it('applies no sport filter when sport is null (CLI all-sports run)', async () => {
    await recomputeAllFantasyAdp({ sport: null, apply: false })
    expect(whereArg()).not.toHaveProperty('session')
  })
})

describe('recompute row selection — liveness', () => {
  it('does not gate on pickedAt or a completed session', async () => {
    await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    const serialized = JSON.stringify(whereArg() ?? {})
    expect(serialized).not.toContain('pickedAt')
    expect(serialized).not.toContain('completed')
  })

  it('keeps a mirrored pick from an in-progress draft (null pickedAt, null sportType)', async () => {
    mockDraftPickFindMany.mockResolvedValue([mirroredPick()])
    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(report.errors).toEqual([])
    expect(report.picksScanned).toBe(1)
    expect(report.picksKept).toBe(1)
    expect(report.uniquePlayers).toBe(1)
    expect(report.byDraftMode.real).toBe(1)
  })
})

describe('recompute row selection — commissioner-cleared slots', () => {
  it('drops an EMPTY placeholder row and accounts for it separately', async () => {
    mockDraftPickFindMany.mockResolvedValue([
      mirroredPick({ playerName: '', position: 'EMPTY' }),
    ])
    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(report.picksKept).toBe(0)
    expect(report.filteredOutByEmptyRow).toBe(1)
    expect(report.filteredOutByAsset).toBe(0)
  })

  it('drops a row flagged pickEditorEmpty even when it still carries a player name', async () => {
    mockDraftPickFindMany.mockResolvedValue([
      mirroredPick({ pickMetadata: { pickEditorEmpty: true } }),
    ])
    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(report.picksKept).toBe(0)
    expect(report.filteredOutByEmptyRow).toBe(1)
  })

  it('still keeps an ordinary pick alongside a cleared one', async () => {
    mockDraftPickFindMany.mockResolvedValue([
      mirroredPick(),
      mirroredPick({ overall: 5, playerName: '', position: 'EMPTY' }),
    ])
    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(report.picksKept).toBe(1)
    expect(report.filteredOutByEmptyRow).toBe(1)
  })
})

describe('imported drafts are folded into the same recompute', () => {
  /* The bridge itself is covered in __tests__/adp/draft-fact-samples.test.ts; this is the wiring. */
  const importedFacts = [
    { leagueId: 'lg1', season: 2024, round: 1, pickNumber: 1, playerId: 'sleeper-1' },
    { leagueId: 'lg1', season: 2024, round: 1, pickNumber: 2, playerId: 'sleeper-2' },
  ]
  const importedIdentities = [
    { sleeperId: 'sleeper-1', canonicalName: 'Imported One', position: 'WR' },
    { sleeperId: 'sleeper-2', canonicalName: 'Imported Two', position: 'RB' },
  ]
  const importedLeague = { id: 'lg1', scoring: 'ppr', isDynasty: true, leagueVariant: null }

  function armImports() {
    mockDraftFactFindMany.mockResolvedValue(importedFacts)
    mockLeagueFindMany.mockResolvedValue([importedLeague])
    mockIdentityFindMany.mockResolvedValue(importedIdentities)
  }

  it('adds imported picks to the live ones and reports them separately', async () => {
    mockDraftPickFindMany.mockResolvedValue([mirroredPick()])
    armImports()

    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(report.errors).toEqual([])
    expect(report.importedFactsScanned).toBe(2)
    expect(report.importedPicksKept).toBe(2)
    expect(report.importedDraftsCovered).toBe(1)
    // One live pick + two imported.
    expect(report.picksKept).toBe(3)
    expect(report.uniquePlayers).toBe(3)
  })

  it('keeps imported samples on their own context, away from the live board', async () => {
    mockDraftPickFindMany.mockResolvedValue([mirroredPick()])
    armImports()

    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    // Live snake 2026 and imported 2024 are different contexts; neither merges into the other.
    expect(report.uniqueContexts).toBe(2)
  })

  it('aggregates a production-sized imported corpus without dropping the batch', async () => {
    const draftCount = 2_000
    const draftLength = 80
    const leagues = Array.from({ length: draftCount }, (_, index) => ({
      ...importedLeague,
      id: `imported-${index}`,
    }))
    const identities = Array.from({ length: draftLength }, (_, index) => ({
      sleeperId: `player-${index}`,
      canonicalName: `Imported Player ${index}`,
      position: 'WR',
    }))
    mockLeagueFindMany.mockResolvedValue(leagues)
    mockIdentityFindMany.mockResolvedValue(identities)
    const facts = leagues.flatMap((league, draftIndex) =>
      identities.map((player, index) => ({
        draftId: String(draftIndex * draftLength + index).padStart(6, '0'),
        leagueId: league.id,
        season: 2026,
        round: Math.floor(index / 10) + 1,
        pickNumber: index + 1,
        playerId: player.sleeperId,
      })),
    )
    mockDraftFactFindMany.mockImplementation(async ({ where, take }) => {
      const start = where.draftId ? Number(where.draftId.gt) + 1 : 0
      return facts.slice(start, start + take)
    })

    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(report.errors).toEqual([])
    expect(report.importedDraftsCovered).toBe(draftCount)
    expect(mockDraftFactFindMany.mock.calls.length).toBeGreaterThan(1)
    expect(report.picksKept).toBe(draftCount * draftLength)
    expect(report.uniquePlayers).toBe(draftLength)
  })

  it('rebuilds just the imported board when the backfill selects that draft type', async () => {
    armImports()
    const report = await recomputeAllFantasyAdp({
      sport: 'NFL',
      season: '2024',
      draftType: 'imported',
      apply: false,
    })
    expect(mockDraftPickFindMany).not.toHaveBeenCalled()
    expect(report.errors).toEqual([])
    expect(report.picksKept).toBe(importedFacts.length)
    expect(report.uniqueContexts).toBe(1)
  })

  it('can be switched off without touching the live pass', async () => {
    mockDraftPickFindMany.mockResolvedValue([mirroredPick()])
    armImports()

    const report = await recomputeAllFantasyAdp({
      sport: 'NFL',
      apply: false,
      includeImportedDrafts: false,
    })
    expect(mockDraftFactFindMany).not.toHaveBeenCalled()
    expect(report.importedPicksKept).toBe(0)
    expect(report.picksKept).toBe(1)
  })

  it('survives a failure in the imported pass without losing the live samples', async () => {
    mockDraftPickFindMany.mockResolvedValue([mirroredPick()])
    mockDraftFactFindMany.mockRejectedValue(new Error('warehouse unavailable'))

    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(report.picksKept).toBe(1)
    expect(report.errors.join(' ')).toContain('warehouse unavailable')
  })

  it('skips the imported pass entirely on an all-sports run', async () => {
    armImports()
    await recomputeAllFantasyAdp({ sport: null, apply: false })
    expect(mockDraftFactFindMany).not.toHaveBeenCalled()
  })
})

describe('recompute row selection — what counts as evidence (2026-11-22)', () => {
  it('an autopick is our own board talking back: left out, and counted', async () => {
    mockDraftPickFindMany.mockResolvedValue([mirroredPick(), mirroredPick({ source: 'auto', playerName: 'Bot Pick', overall: 3 })])
    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(report.picksKept).toBe(1)
    expect(report.filteredOutByAutopick).toBe(1)
  })

  it('a pick with no pickedAt is dated by when its row was written, so it can weigh as recent', async () => {
    const now = new Date('2026-11-22T12:00:00Z')
    mockDraftPickFindMany.mockResolvedValue([
      // Ten days ago at 10, today at 40: recency pulls the board toward 40, past the plain mean of 25.
      mirroredPick({ overall: 10, createdAt: new Date(now.getTime() - 10 * 86_400_000) }),
      mirroredPick({ overall: 40, createdAt: now }),
    ])
    const report = await recomputeAllFantasyAdp({ sport: 'NFL', apply: true, now })
    expect(report.picksKept).toBe(2)
    const written = mockAdpUpsert.mock.calls.map((c) => c[0]?.create ?? c[0]?.update).find(Boolean) as { averageOverallPick?: number } | undefined
    expect(written?.averageOverallPick ?? 0).toBeGreaterThan(25)
  })

  it('selects the row time it dates picks by', async () => {
    await recomputeAllFantasyAdp({ sport: 'NFL', apply: false })
    expect(mockDraftPickFindMany.mock.calls[0]?.[0]?.select).toMatchObject({ createdAt: true })
  })
})
