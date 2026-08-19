/**
 * Block D — `bootstrapLeagueWaiverSettings` prefers imported Sleeper waiver values
 * over sport defaults.
 *
 * Closes the residual "waiver contradiction" identified in the Tier 0 fidelity
 * audit: after PR #179 the `leagues` row correctly carries Sleeper's true values
 * (waiverType='faab', waiverBudget=250 for the fresh-import fixture), but
 * `league_waiver_settings.faabBudget` was still being written to the NFL sport
 * default (100). This suite proves the fix.
 *
 * Three assertions the user requested:
 *  1) Sleeper imported FAAB budget 250 persists as 250, not NFL default 100.
 *  2) Missing imported waiver settings still falls back to existing sport defaults.
 *  3) Existing non-import league behavior does not change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  waiverFindUnique: vi.fn(),
  waiverCreate: vi.fn(),
  waiverUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    leagueWaiverSettings: {
      findUnique: mocks.waiverFindUnique,
      create: mocks.waiverCreate,
      update: mocks.waiverUpdate,
    },
  },
}))

async function invokeBootstrap(leagueId: string) {
  const { bootstrapLeagueWaiverSettings } = await import(
    '@/lib/waiver-defaults/LeagueWaiverBootstrapService'
  )
  return bootstrapLeagueWaiverSettings(leagueId)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('Block D — Sleeper imported FAAB budget wins over sport default', () => {
  it('creates league_waiver_settings.faabBudget=250 when settings.waiverSettings.faabBudget=250', async () => {
    // Fresh Sleeper import fixture — matches "Premier League of Mediocrity"
    // (waiver_budget 250) from the post-merge validation run.
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-fresh-sleeper',
      sport: 'NFL',
      leagueVariant: null,
      settings: {
        waiverSettings: { waiverType: 'faab', faabBudget: 250 },
      },
    })
    mocks.waiverFindUnique.mockResolvedValue(null) // No prior row → CREATE path
    mocks.waiverCreate.mockResolvedValue({ id: 'ws-1' })

    const result = await invokeBootstrap('league-fresh-sleeper')

    expect(result.waiverSettingsApplied).toBe(true)
    expect(mocks.waiverCreate).toHaveBeenCalledOnce()

    const createArgs = mocks.waiverCreate.mock.calls[0][0]
    expect(createArgs.data.faabBudget).toBe(250) // Sleeper truth, NOT NFL default 100
    expect(createArgs.data.waiverType).toBe('faab')
    expect(createArgs.data.leagueId).toBe('league-fresh-sleeper')
  })

  it('also honors a non-default waiver_type (e.g. rolling) from the import', async () => {
    // Sleeper `waiver_type: 1` (rolling priority) → mapper emits 'rolling'.
    // NFL sport default is 'faab' — imported value must still win.
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-rolling-sleeper',
      sport: 'NFL',
      leagueVariant: null,
      settings: {
        waiverSettings: { waiverType: 'rolling', faabBudget: 0 },
      },
    })
    mocks.waiverFindUnique.mockResolvedValue(null)
    mocks.waiverCreate.mockResolvedValue({ id: 'ws-2' })

    await invokeBootstrap('league-rolling-sleeper')

    const createArgs = mocks.waiverCreate.mock.calls[0][0]
    expect(createArgs.data.waiverType).toBe('rolling')
    expect(createArgs.data.faabBudget).toBe(0)
  })
})

describe('Block D — missing imported waiver settings falls back to sport defaults', () => {
  it('creates row with NFL sport default (100) when settings has no waiverSettings slice', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-non-import',
      sport: 'NFL',
      leagueVariant: null,
      settings: {}, // No waiverSettings — non-import path
    })
    mocks.waiverFindUnique.mockResolvedValue(null)
    mocks.waiverCreate.mockResolvedValue({ id: 'ws-3' })

    await invokeBootstrap('league-non-import')

    const createArgs = mocks.waiverCreate.mock.calls[0][0]
    expect(createArgs.data.faabBudget).toBe(100) // NFL default
    expect(createArgs.data.waiverType).toBe('faab') // NFL default
  })

  it('handles null settings entirely (older league rows) without throwing', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-null-settings',
      sport: 'NFL',
      leagueVariant: null,
      settings: null,
    })
    mocks.waiverFindUnique.mockResolvedValue(null)
    mocks.waiverCreate.mockResolvedValue({ id: 'ws-4' })

    await invokeBootstrap('league-null-settings')

    const createArgs = mocks.waiverCreate.mock.calls[0][0]
    expect(createArgs.data.faabBudget).toBe(100)
  })

  it('ignores malformed waiverSettings (array / wrong types) and uses sport defaults', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-malformed',
      sport: 'NFL',
      leagueVariant: null,
      settings: {
        waiverSettings: ['not', 'an', 'object'], // wrong shape
      },
    })
    mocks.waiverFindUnique.mockResolvedValue(null)
    mocks.waiverCreate.mockResolvedValue({ id: 'ws-5' })

    await invokeBootstrap('league-malformed')

    const createArgs = mocks.waiverCreate.mock.calls[0][0]
    expect(createArgs.data.faabBudget).toBe(100)
    expect(createArgs.data.waiverType).toBe('faab')
  })

  it('ignores wrong-typed imported fields individually (partial fallback)', async () => {
    // waiverType is a string 'faab' (valid), but faabBudget is a string (invalid)
    // → prefer the valid one, fall back to default for the invalid one.
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-partial-malformed',
      sport: 'NFL',
      leagueVariant: null,
      settings: {
        waiverSettings: { waiverType: 'faab', faabBudget: 'two-fifty' },
      },
    })
    mocks.waiverFindUnique.mockResolvedValue(null)
    mocks.waiverCreate.mockResolvedValue({ id: 'ws-6' })

    await invokeBootstrap('league-partial-malformed')

    const createArgs = mocks.waiverCreate.mock.calls[0][0]
    expect(createArgs.data.waiverType).toBe('faab')
    expect(createArgs.data.faabBudget).toBe(100) // fallback
  })
})

describe('Block D — existing non-import league behavior does not change', () => {
  it('does NOT overwrite existing waiverType / faabBudget even when imported values differ', async () => {
    // Scenario: pre-Block-D imported league whose bootstrap already wrote the wrong
    // defaults (waiverType='faab', faabBudget=100). A re-run of the bootstrap must
    // NOT clobber those values — Block D scope requirement 3 explicitly forbids
    // changing existing-row behavior. (User edits or prior-imported values are
    // preserved; only truly-null fields ever get backfilled.)
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-existing',
      sport: 'NFL',
      leagueVariant: null,
      settings: {
        // Imported values say 250, but existing row already has 100.
        waiverSettings: { waiverType: 'faab', faabBudget: 250 },
      },
    })
    mocks.waiverFindUnique.mockResolvedValue({
      leagueId: 'league-existing',
      waiverType: 'faab',
      faabBudget: 100, // pre-existing user (or old-default) value
      processingDayOfWeek: 2,
      processingTimeUtc: '10:00',
      claimLimitPerPeriod: 10,
      tiebreakRule: 'faab_highest',
      lockType: 'game_start',
      instantFaAfterClear: false,
    })

    const result = await invokeBootstrap('league-existing')

    // No update call at all — every field on the existing row is non-null, so
    // the backfill patch is empty and short-circuits without hitting the DB.
    expect(mocks.waiverUpdate).not.toHaveBeenCalled()
    expect(mocks.waiverCreate).not.toHaveBeenCalled()
    expect(result.waiverSettingsApplied).toBe(false)
  })

  it('backfills only truly-null fields on an existing row; preserves user-set values', async () => {
    // Existing row has waiverType/faabBudget set, but claimLimitPerPeriod is null
    // → only claimLimitPerPeriod should be filled in. Imported waiverSettings=250
    // must NOT clobber the existing waiverType/faabBudget.
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-partial-existing',
      sport: 'NFL',
      leagueVariant: null,
      settings: {
        waiverSettings: { waiverType: 'rolling', faabBudget: 250 }, // imported "wants" these
      },
    })
    mocks.waiverFindUnique.mockResolvedValue({
      leagueId: 'league-partial-existing',
      waiverType: 'faab', // user-set — must be preserved
      faabBudget: 300, // user-set — must be preserved
      processingDayOfWeek: 2,
      processingTimeUtc: null, // null — should be filled
      claimLimitPerPeriod: null, // null — should be filled
      tiebreakRule: 'faab_highest',
      lockType: 'game_start',
      instantFaAfterClear: false,
    })
    mocks.waiverUpdate.mockResolvedValue({})

    await invokeBootstrap('league-partial-existing')

    expect(mocks.waiverUpdate).toHaveBeenCalledOnce()
    const updateArgs = mocks.waiverUpdate.mock.calls[0][0]
    // Only the two null fields land in the patch — waiverType / faabBudget are absent.
    expect(updateArgs.data.waiverType).toBeUndefined()
    expect(updateArgs.data.faabBudget).toBeUndefined()
    expect(updateArgs.data.processingTimeUtc).toBe('10:00') // NFL default
    expect(updateArgs.data.claimLimitPerPeriod).toBe(10) // NFL default
  })
})

describe('Block D — no side effects on the League lookup', () => {
  it('reads settings on the League row in a single findUnique (no extra round-trip)', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'league-x',
      sport: 'NFL',
      leagueVariant: null,
      settings: { waiverSettings: { faabBudget: 250 } },
    })
    mocks.waiverFindUnique.mockResolvedValue(null)
    mocks.waiverCreate.mockResolvedValue({ id: 'ws-x' })

    await invokeBootstrap('league-x')

    expect(mocks.leagueFindUnique).toHaveBeenCalledOnce()
    const selectArg = mocks.leagueFindUnique.mock.calls[0][0]
    // Confirms we ADDED `settings: true` to the select without dropping the prior fields.
    expect(selectArg.select).toMatchObject({
      id: true,
      sport: true,
      leagueVariant: true,
      settings: true,
    })
  })
})
