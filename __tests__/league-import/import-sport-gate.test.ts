import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The import sport gate: `supportedSports` in provider-ui-config.ts is enforced, for every provider.
 *
 * 🛑 IT WAS DISPLAY-ONLY. The import page printed each provider's sports and the pipeline imported
 * any sport the provider returned. This file pins two things for EVERY provider:
 *   - each sport it is listed for still passes the gate in the real pipeline;
 *   - a sport it is not listed for, or no sport at all, is refused with UNSUPPORTED_SPORT.
 *
 * The provider fetch services and the adapter normalization are stubbed so the test isolates the
 * gate itself; each stub returns `league.sport` exactly as that provider's adapter spells it
 * (uppercase LeagueSport — ESPN hardcodes 'NFL'/'MLB', MFL 'NFL', Fantrax and Fleaflicker run
 * `normalizeToSupportedSport`, Sleeper and Yahoo uppercase the provider's code). No network.
 */

const sportBox = vi.hoisted(() => ({ sport: 'NFL' as string | null }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    deletedLeagueTombstone: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('@/lib/league-import/ImportNormalizationPipeline', () => ({
  runImportNormalizationPipeline: vi.fn(async () => ({ league: { sport: sportBox.sport } })),
}))

vi.mock('@/lib/league-import/sleeper/SleeperLeagueFetchService', async (orig) => ({
  ...(await orig<object>()),
  fetchSleeperLeagueForImport: vi.fn(async () => ({ league: { league_id: 'sl-1' } })),
}))
vi.mock('@/lib/league-import/espn/EspnLeagueFetchService', async (orig) => ({
  ...(await orig<object>()),
  fetchEspnLeagueForImport: vi.fn(async () => ({})),
}))
vi.mock('@/lib/league-import/yahoo/YahooLeagueFetchService', async (orig) => ({
  ...(await orig<object>()),
  fetchYahooLeagueForImport: vi.fn(async () => ({})),
}))
vi.mock('@/lib/league-import/mfl/MflLeagueFetchService', async (orig) => ({
  ...(await orig<object>()),
  fetchMflLeagueForImport: vi.fn(async () => ({})),
}))
vi.mock('@/lib/league-import/fantrax/FantraxLeagueFetchService', async (orig) => ({
  ...(await orig<object>()),
  fetchFantraxLeagueForImport: vi.fn(async () => ({})),
}))
vi.mock('@/lib/league-import/fleaflicker/FleaflickerLeagueFetchService', async (orig) => ({
  ...(await orig<object>()),
  fetchFleaflickerLeagueForImport: vi.fn(async () => ({})),
}))

import {
  IMPORT_PROVIDER_UI_OPTIONS,
  checkImportSportSupported,
  type ImportSupportedSport,
} from '@/lib/league-import/provider-ui-config'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import type { ImportProvider } from '@/lib/league-import/types'

const ALL: ImportSupportedSport[] = ['NFL', 'NCAAF', 'MLB', 'NBA', 'NHL']

/* Pinned here, so a change to any provider's list is a conscious edit in two places. */
const EXPECTED: Record<ImportProvider, ImportSupportedSport[]> = {
  sleeper: ['NFL'],
  espn: ['NFL', 'MLB'],
  yahoo: ['NFL'],
  fantrax: ['NFL', 'NCAAF', 'MLB', 'NBA', 'NHL'],
  mfl: ['NFL'],
  fleaflicker: ['NFL'],
}

async function runFor(provider: ImportProvider, sport: string | null, extra: { refreshOfImportedLeague?: boolean } = {}) {
  sportBox.sport = sport
  return runImportedLeagueNormalizationPipeline({ provider, sourceId: 'src-1', userId: 'u1', ...extra })
}

beforeEach(() => {
  sportBox.sport = 'NFL'
})

describe('import sport gate — every provider', () => {
  it('the config lists the sports this test expects (update both deliberately)', () => {
    for (const option of IMPORT_PROVIDER_UI_OPTIONS) {
      expect([...option.supportedSports]).toEqual(EXPECTED[option.provider])
    }
    expect(IMPORT_PROVIDER_UI_OPTIONS.map((o) => o.provider).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  for (const [provider, listed] of Object.entries(EXPECTED) as Array<[ImportProvider, ImportSupportedSport[]]>) {
    describe(provider, () => {
      for (const sport of listed) {
        it(`imports a listed sport: ${sport}`, async () => {
          const out = await runFor(provider, sport)
          expect(out.success).toBe(true)
        })
      }

      const unlisted = ALL.filter((s) => !listed.includes(s))
      for (const sport of unlisted) {
        it(`refuses an unlisted sport: ${sport}`, async () => {
          const out = await runFor(provider, sport)
          expect(out.success).toBe(false)
          if (out.success) return
          expect(out.code).toBe('UNSUPPORTED_SPORT')
          expect(out.error).toContain(`this league is ${sport}`)
        })
      }

      it('refuses a league with no sport rather than defaulting it', async () => {
        const out = await runFor(provider, null)
        expect(out.success).toBe(false)
        if (out.success) return
        expect(out.code).toBe('UNSUPPORTED_SPORT')
        expect(out.error).toMatch(/did not say which sport/)
      })
    })
  }

  it('a refresh of an already-imported league is not gated (it must keep syncing)', async () => {
    const out = await runFor('sleeper', 'NBA', { refreshOfImportedLeague: true })
    expect(out.success).toBe(true)
  })
})

describe('checkImportSportSupported', () => {
  it('normalises case and whitespace', () => {
    expect(checkImportSportSupported('espn', ' mlb ')).toEqual({ ok: true, sport: 'MLB' })
  })

  it('names the provider and its sports in the refusal', () => {
    const out = checkImportSportSupported('yahoo', 'NHL')
    expect(out).toEqual({
      ok: false,
      reason: 'unsupported',
      message: 'Yahoo imports support NFL leagues right now — this league is NHL, so it was not imported. Nothing was saved.',
    })
  })

  it('treats empty and missing as missing, never as NFL', () => {
    expect(checkImportSportSupported('yahoo', '').ok).toBe(false)
    expect(checkImportSportSupported('yahoo', undefined)).toMatchObject({ ok: false, reason: 'missing' })
  })
})
