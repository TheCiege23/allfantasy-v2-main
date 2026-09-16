// @vitest-environment node
/**
 * A re-import must not erase what AllFantasy stored in `League.settings`.
 *
 * 🛑 WHAT WAS BROKEN. `persistImportedLeagueFromNormalization` (forced re-import) and
 * `syncLeague` wrote the platform's payload as the WHOLE `settings` blob. Every key
 * AllFantasy itself had written — `publicStandings`, the `dues_tracker` with its
 * payment link, the invite code, a human-confirmed league type — was erased with no
 * error and no audit row. A published league went private the next time anyone
 * re-imported it.
 *
 * ⚠ THESE GO THROUGH THE REAL WRITE PATHS, not only the helper. The league write is
 * the assertion point: the prisma mock captures what would be written and then stops
 * the run, so a helper that exists but is no longer called from the write fails here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindFirst = vi.fn()
const leagueFindUnique = vi.fn()
const leagueUpdate = vi.fn()
const leagueUpsert = vi.fn()
const tombstoneFindUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: (...a: unknown[]) => leagueFindFirst(...a),
      findUnique: (...a: unknown[]) => leagueFindUnique(...a),
      update: (...a: unknown[]) => leagueUpdate(...a),
      upsert: (...a: unknown[]) => leagueUpsert(...a),
      create: vi.fn(),
    },
    deletedLeagueTombstone: {
      findUnique: (...a: unknown[]) => tombstoneFindUnique(...a),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import {
  buildImportedLeagueSettings,
  mergeCanonicalBundleIntoLeagueSettingsJson,
  persistImportedLeagueFromNormalization,
} from '@/lib/league-import/ImportedLeagueCommitService'
import {
  AF_OWNED_LEAGUE_SETTINGS_KEYS,
  carryAfOwnedLeagueSettings,
} from '@/lib/league/afOwnedLeagueSettings'
import { syncLeague } from '@/lib/league-sync-core'

/** Stops the run right after the league row would have been written. */
const STOP = 'STOP_AFTER_LEAGUE_WRITE'

const SLEEPER_LEAGUE: SleeperImportPayload = {
  league: {
    league_id: '1313584523757260800',
    name: 'Tree Keeper',
    sport: 'nfl',
    season: '2026',
    total_rosters: 12,
    metadata: { co_commissioners: null },
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    scoring_settings: { rec: 1, pass_td: 6 },
    settings: {
      waiver_type: 2,
      waiver_budget: 200,
      playoff_week_start: 15,
      playoff_teams: 6,
      trade_deadline: 11,
      type: 2,
      num_teams: 12,
    } as unknown as SleeperImportPayload['league']['settings'],
  },
}

function normalized(): NormalizedImportResult {
  const league = SleeperLeagueMapper.map(SLEEPER_LEAGUE)!
  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: SLEEPER_LEAGUE.league.league_id,
      imported_at: '2026-09-16T00:00:00.000Z',
    },
    league,
    rosters: [],
    scoring: null,
    schedule: [],
    draft_picks: [],
    transactions: [],
    standings: [],
    player_map: {},
    coverage: {
      leagueSettings: { state: 'full' },
      currentRosters: { state: 'full' },
      historicalRosterSnapshots: { state: 'missing' },
      scoringSettings: { state: 'full' },
      playoffSettings: { state: 'full' },
      currentStandings: { state: 'missing' },
      currentSchedule: { state: 'missing' },
      draftHistory: { state: 'missing' },
      tradeHistory: { state: 'missing' },
      previousSeasons: { state: 'missing' },
      playerIdentityMap: { state: 'missing' },
    },
  } as unknown as NormalizedImportResult
}

const DUES = {
  enabled: true,
  amount: 100,
  currency: 'USD',
  paymentLink: 'https://www.leaguesafe.com/league/12345',
  paymentProvider: 'leaguesafe',
  entries: [{ teamId: 't1', paid: true, paidSeasons: [2026], paidAt: '2026-08-20T00:00:00.000Z' }],
  lastUpdatedAt: '2026-08-20T00:00:00.000Z',
  lastUpdatedBy: 'commish',
}

/** What the row looks like before the re-import: an old import plus AllFantasy's own keys. */
const EXISTING_SETTINGS = {
  // Platform keys from the previous import — one of them the platform has since dropped.
  playoff_start_week: 14,
  a_rule_sleeper_removed: true,
  // AllFantasy's own.
  publicStandings: true,
  dues_tracker: DUES,
  inviteCode: 'JOIN-ABC',
  leagueTypeConfirmation: { type: 'dynasty', confirmedByUserId: 'commish', confirmedAt: '2026-08-01T00:00:00.000Z' },
  conceptRules: { extensions: { commissionerTemplate: { id: 'efl', version: '1.0.0' }, aliasTags: ['old'] } },
}

beforeEach(() => {
  vi.clearAllMocks()
  tombstoneFindUnique.mockResolvedValue(null)
  leagueFindFirst.mockResolvedValue({ id: 'L1', userId: 'u1', settings: EXISTING_SETTINGS })
  leagueFindUnique.mockResolvedValue({ settings: EXISTING_SETTINGS })
  leagueUpdate.mockRejectedValue(new Error(STOP))
  leagueUpsert.mockRejectedValue(new Error(STOP))
})

function writtenSettings(mock: ReturnType<typeof vi.fn>, branch: 'data' | 'update'): Record<string, unknown> {
  expect(mock).toHaveBeenCalledTimes(1)
  const arg = mock.mock.calls[0][0] as Record<string, Record<string, unknown>>
  return arg[branch].settings as Record<string, unknown>
}

describe('a forced re-import keeps what AllFantasy stored', () => {
  it('keeps publicStandings and the dues tracker, and writes the platform’s fresh rules', async () => {
    await expect(
      persistImportedLeagueFromNormalization({
        userId: 'u1',
        provider: 'sleeper' as never,
        normalized: normalized(),
        allowUpdateExisting: true,
      }),
    ).rejects.toThrow(STOP)

    const settings = writtenSettings(leagueUpdate, 'data')
    expect(settings.publicStandings).toBe(true)
    expect(settings.dues_tracker).toEqual(DUES)
    expect(settings.inviteCode).toBe('JOIN-ABC')
    expect(settings.leagueTypeConfirmation).toEqual(EXISTING_SETTINGS.leagueTypeConfirmation)
    // The platform's current value, not the stale one.
    expect(settings.playoff_start_week).toBe(15)
    // An allowlist, not a blanket merge: a rule the platform dropped is gone.
    expect(settings).not.toHaveProperty('a_rule_sleeper_removed')
  })

  it('keeps the Commissioner OS template pin when the canonical bundle replaces conceptRules', async () => {
    await expect(
      persistImportedLeagueFromNormalization({
        userId: 'u1',
        provider: 'sleeper' as never,
        normalized: normalized(),
        allowUpdateExisting: true,
        canonicalBundle: {
          settingsSnapshot: { conceptRules: { concept: 'dynasty', extensions: { aliasTags: ['fresh'] } } },
          presetKey: 'nfl-dynasty',
          scoringPresetId: null,
          draftType: 'snake',
          inferredConcept: 'dynasty',
          leagueTypeColumn: 'dynasty',
        } as never,
      }),
    ).rejects.toThrow(STOP)

    const settings = writtenSettings(leagueUpdate, 'data')
    expect(settings.conceptRules).toEqual({
      concept: 'dynasty',
      // Platform-derived siblings are the fresh ones …
      extensions: {
        aliasTags: ['fresh'],
        // … and only the pin is carried forward.
        commissionerTemplate: { id: 'efl', version: '1.0.0' },
      },
    })
    expect(settings.publicStandings).toBe(true)
  })

  it('a first import has nothing to carry and writes the payload as-is', async () => {
    leagueFindFirst.mockResolvedValue(null)
    leagueUpdate.mockResolvedValue({})
    const create = (await import('@/lib/prisma')).prisma.league.create as ReturnType<typeof vi.fn>
    create.mockRejectedValue(new Error(STOP))

    await expect(
      persistImportedLeagueFromNormalization({
        userId: 'u1',
        provider: 'sleeper' as never,
        normalized: normalized(),
        confirmReimportOfDeleted: true,
      }),
    ).rejects.toThrow(STOP)

    const arg = create.mock.calls[0][0] as { data: { settings: Record<string, unknown> } }
    expect(arg.data.settings).not.toHaveProperty('publicStandings')
    expect(arg.data.settings).toEqual(buildImportedLeagueSettings(normalized()))
  })
})

describe('syncLeague keeps what AllFantasy stored', () => {
  it('carries AllFantasy’s keys into the upsert’s update branch only', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/rosters')
          ? []
          : { name: 'Tree Keeper', season: '2026', total_rosters: 12, settings: { playoff_week_start: 15, type: 2 } },
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(syncLeague('u1', 'sleeper', '1313584523757260800')).rejects.toThrow(STOP)
    } finally {
      vi.unstubAllGlobals()
    }

    const update = writtenSettings(leagueUpsert, 'update')
    expect(update.publicStandings).toBe(true)
    expect(update.dues_tracker).toEqual(DUES)
    expect(update.playoff_week_start).toBe(15)
    expect(update).not.toHaveProperty('a_rule_sleeper_removed')

    // A brand-new row gets exactly what the platform sent.
    const create = (leagueUpsert.mock.calls[0][0] as { create: { settings: unknown } }).create.settings
    expect(create).toEqual({ playoff_week_start: 15, type: 2 })
  })
})

describe('carryAfOwnedLeagueSettings', () => {
  it('never mutates its inputs', () => {
    const current = structuredClone(EXISTING_SETTINGS)
    const fresh = { conceptRules: { extensions: { aliasTags: ['x'] } } }
    const frozenFresh = structuredClone(fresh)
    carryAfOwnedLeagueSettings(current, fresh)
    expect(current).toEqual(EXISTING_SETTINGS)
    expect(fresh).toEqual(frozenFresh)
  })

  it('returns the fresh payload when there is no usable current row', () => {
    expect(carryAfOwnedLeagueSettings(null, { a: 1 })).toEqual({ a: 1 })
    expect(carryAfOwnedLeagueSettings('nope', { a: 1 })).toEqual({ a: 1 })
    expect(carryAfOwnedLeagueSettings([1, 2], { a: 1 })).toEqual({ a: 1 })
  })

  it('carries a key explicitly set to false or null — a choice, not an absence', () => {
    const out = carryAfOwnedLeagueSettings({ publicStandings: false, inviteCode: null }, {})
    expect(out).toEqual({ publicStandings: false, inviteCode: null })
  })

  /*
   * The allowlist is only safe because no importer writes these names. If a mapper
   * starts emitting one, the AllFantasy value would silently override the platform's —
   * so an overlap fails here instead.
   */
  it('shares no key with what an import writes', () => {
    const imported = mergeCanonicalBundleIntoLeagueSettingsJson(buildImportedLeagueSettings(normalized()), {
      settingsSnapshot: {},
      presetKey: 'k',
      scoringPresetId: null,
      draftType: 'snake',
      inferredConcept: 'dynasty',
    } as never)
    const overlap = AF_OWNED_LEAGUE_SETTINGS_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(imported, k))
    expect(overlap).toEqual([])
  })
})

describe('the Sleeper import upsert keeps what AllFantasy stored', () => {
  it('carries AllFantasy’s keys into a historical-season metadata upsert', async () => {
    const { upsertSleeperLeagueMetadataOnly } = await import('@/lib/league/sleeper-import-process')
    await expect(
      upsertSleeperLeagueMetadataOnly(
        { ...SLEEPER_LEAGUE.league, settings: { playoff_week_start: 15, type: 2 } } as never,
        'u1',
        2025,
        'NFL' as never,
      ),
    ).rejects.toThrow(STOP)

    const update = writtenSettings(leagueUpsert, 'update')
    expect(update.publicStandings).toBe(true)
    expect(update.dues_tracker).toEqual(DUES)
    expect(update.playoff_week_start).toBe(15)
    expect(update).not.toHaveProperty('a_rule_sleeper_removed')
  })

  it('still writes the payload when the current row cannot be read', async () => {
    leagueFindUnique.mockImplementation(() => {
      throw new Error('db down')
    })
    const { upsertSleeperLeagueMetadataOnly } = await import('@/lib/league/sleeper-import-process')
    await expect(
      upsertSleeperLeagueMetadataOnly(
        { ...SLEEPER_LEAGUE.league, settings: { type: 2 } } as never,
        'u1',
        2025,
        'NFL' as never,
      ),
    ).rejects.toThrow(STOP)
    expect(writtenSettings(leagueUpsert, 'update')).toEqual({ type: 2 })
  })
})
