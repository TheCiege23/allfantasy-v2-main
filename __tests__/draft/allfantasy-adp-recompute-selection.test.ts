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
