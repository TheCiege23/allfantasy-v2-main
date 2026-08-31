/**
 * `processAllActiveLeaguesForWeek` must never touch an IMPORTED league.
 *
 * 🛑 THE FAILURE THIS PINS IS SILENT AND LOOKS LIKE A WORKING FEATURE. `processLeagueWeek`
 * builds its head-to-head pairings with `buildRoundRobinPairsForWeek` — a synthetic circle-method
 * schedule over sorted roster ids. It never reads a real schedule. A Sleeper/ESPN/Yahoo/MFL
 * league's real schedule lives on the host platform, so processing one writes `TeamWeekResult`
 * rows carrying invented opponents and invented win/loss. Those rows are read as authoritative by
 * the standings route, `matchupCenterService`, `standingsEngine` and Chimmy's matchup context, so
 * the fabrication renders to managers as their actual season. Nothing throws and no row is
 * missing — the only tell is that the opponents are wrong.
 *
 * There are TWO guards in the driver and this asserts each one separately, because either alone
 * would pass a test that only checked the end result:
 *
 *   1. the Prisma `where` narrows to native platforms, and
 *   2. `isNativePlatform` re-checks every returned row.
 *
 * Guard 2 is verified with a POSITIVE CONTROL — the query is made to hand back an imported league
 * regardless of its filter, standing in for the SQL narrowing drifting away from
 * `NATIVE_PLATFORMS`. Without that control, guard 2 could be deleted and this file would stay
 * green on the strength of guard 1 alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLeagueFindMany = vi.hoisted(() => vi.fn())
const mockLeagueFindUnique = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: mockLeagueFindMany, findUnique: mockLeagueFindUnique },
    weeklyScore: { count: vi.fn().mockResolvedValue(0) },
    teamWeekResult: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}))

import { processAllActiveLeaguesForWeek } from '@/server/services/weeklyProcessor'
import { NATIVE_PLATFORMS } from '@/lib/league/isNativeLeague'

/** Every id `processLeagueWeek` actually opened — it loads the league first thing. */
function processedLeagueIds(): string[] {
  return mockLeagueFindUnique.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id)
}

describe('processAllActiveLeaguesForWeek — native leagues only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `processLeagueWeek` throws 'League not found' and the driver logs and moves on. That is
    // enough: the assertion is about WHICH leagues it reached, not what it computed for them.
    mockLeagueFindUnique.mockResolvedValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('guard 1: asks the database only for native platforms', async () => {
    mockLeagueFindMany.mockResolvedValue([])

    await processAllActiveLeaguesForWeek(2026, 3)

    const where = mockLeagueFindMany.mock.calls[0][0].where as {
      AND: Array<{ OR: Array<Record<string, unknown>> }>
    }
    const platformClause = where.AND.find((c) =>
      c.OR.every((o) => Object.prototype.hasOwnProperty.call(o, 'platform')),
    )
    expect(platformClause).toBeDefined()

    const asked = platformClause!.OR.map(
      (o) => (o as { platform: { equals: string } }).platform.equals,
    )
    // Exactly the allowlist — no more, no fewer. A new native platform string added to
    // NATIVE_PLATFORMS must reach the query too, or those leagues stop being processed.
    expect(new Set(asked)).toEqual(new Set(NATIVE_PLATFORMS))
    // Case-insensitively, because the column stores whatever the importer wrote.
    for (const clause of platformClause!.OR) {
      expect((clause as { platform: { mode: string } }).platform.mode).toBe('insensitive')
    }
  })

  it('guard 2: skips an imported league even when the query hands one back', async () => {
    // Positive control: the SQL filter is simulated as broken/drifted.
    mockLeagueFindMany.mockResolvedValue([
      { id: 'lg-sleeper', platform: 'sleeper' },
      { id: 'lg-espn', platform: 'ESPN' },
      { id: 'lg-yahoo', platform: 'yahoo' },
      { id: 'lg-mfl', platform: 'mfl' },
      // Unrecognised provider — the allowlist must read this as imported, not as ours.
      { id: 'lg-future', platform: 'some-provider-added-next-year' },
      { id: 'lg-native', platform: 'allfantasy' },
    ])

    await processAllActiveLeaguesForWeek(2026, 3)

    expect(processedLeagueIds()).toEqual(['lg-native'])
  })

  it('processes native leagues, including the legacy empty-platform spelling', async () => {
    mockLeagueFindMany.mockResolvedValue([
      { id: 'lg-af', platform: 'allfantasy' },
      { id: 'lg-manual', platform: 'manual' },
      { id: 'lg-legacy', platform: '' },
      { id: 'lg-cased', platform: 'AllFantasy' },
    ])

    await processAllActiveLeaguesForWeek(2026, 3)

    expect(processedLeagueIds()).toEqual(['lg-af', 'lg-manual', 'lg-legacy', 'lg-cased'])
  })
})
