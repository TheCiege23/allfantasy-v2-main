import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  EXCLUDED_VARIANTS,
  EXCLUDED_STATUSES,
  isRealLeague,
} from '@/lib/leagues/leagueListFilter'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('Sleeper user import — ranking-only contract (no leagues in My Leagues)', () => {
  describe('Variant filter set covers the ranking-import tags', () => {
    it('EXCLUDED_VARIANTS contains every variant the import worker writes', () => {
      // The import worker (processImportJob) writes leagueVariant: 'legacy_summary'.
      // Other ranking-only flows historically used 'ranking', 'rank_only', 'profile_import',
      // 'career_import'. All must be in the exclusion set so they never leak into My Leagues.
      expect(EXCLUDED_VARIANTS.has('legacy_summary')).toBe(true)
      expect(EXCLUDED_VARIANTS.has('ranking')).toBe(true)
      expect(EXCLUDED_VARIANTS.has('rankings')).toBe(true)
      expect(EXCLUDED_VARIANTS.has('rank_only')).toBe(true)
      expect(EXCLUDED_VARIANTS.has('profile_import')).toBe(true)
      expect(EXCLUDED_VARIANTS.has('career_import')).toBe(true)
    })

    it('EXCLUDED_STATUSES catches non-variant ranking artifacts', () => {
      // Belt-and-braces: even if a row sneaks in with leagueVariant=null but a status that
      // marks it as a ranking artifact, it stays out of My Leagues.
      expect(EXCLUDED_STATUSES.has('ranking_only')).toBe(true)
      expect(EXCLUDED_STATUSES.has('artifact')).toBe(true)
      expect(EXCLUDED_STATUSES.has('profile_import')).toBe(true)
      expect(EXCLUDED_STATUSES.has('career_data')).toBe(true)
    })
  })

  describe('isRealLeague rejects ranking-import shapes', () => {
    it('rejects records with leagueVariant=legacy_summary regardless of status', () => {
      expect(
        isRealLeague({
          name: 'Some Sleeper League',
          leagueVariant: 'legacy_summary',
          leagueSize: 12,
          platform: 'sleeper',
          status: 'complete',
        }),
      ).toBe(false)
    })

    it('rejects records with rankImportOnly settings flag', () => {
      expect(
        isRealLeague({
          name: 'Some Sleeper League',
          leagueSize: 12,
          platform: 'sleeper',
          settings: { rankImportOnly: true },
        }),
      ).toBe(false)
    })

    it('rejects sleeper records with no variant AND no status (untagged ranking artifact)', () => {
      // Even before the retroactive tagger runs at finalize, untagged sleeper imports get
      // filtered by the platform+null-variant+null-status rule.
      expect(
        isRealLeague({
          name: 'Old Sleeper League',
          leagueSize: 10,
          platform: 'sleeper',
          leagueVariant: null,
          status: null,
        }),
      ).toBe(false)
    })

    it('accepts a real active-league sleeper import (has status from Sleeper API)', () => {
      // Real imports always have a non-null status copied from the Sleeper API.
      expect(
        isRealLeague({
          name: 'Active Sleeper League',
          leagueSize: 12,
          platform: 'sleeper',
          leagueVariant: null,
          status: 'in_season',
        }),
      ).toBe(true)
    })
  })

  describe('Import worker writes the right variant tag', () => {
    const processImportJobSrc = read('lib/import/processImportJob.ts')

    it('upsert.create branch sets leagueVariant: legacy_summary', () => {
      // Locks the literal string. Without this tag, leagues would leak into My Leagues
      // because the dashboard query only excludes EXCLUDED_VARIANTS members.
      expect(processImportJobSrc).toMatch(/leagueVariant:\s*'legacy_summary'/)
    })

    it('finalizeLegacyImportJob retroactively tags untagged sleeper leagues', () => {
      // Catches old rows from before the create-branch tagging existed.
      expect(processImportJobSrc).toMatch(/leagueVariant:\s*null/)
      expect(processImportJobSrc).toMatch(/data:\s*\{\s*leagueVariant:\s*'legacy_summary'\s*\}/)
    })

    it('finalizeLegacyImportJob runs a final calculateAndSaveRank after retroactive tagging', () => {
      // Per-season rank calls can be skipped when a season has 0 leagues. The retroactive
      // tag flip can also change rank input. A final pass guarantees the user's persisted
      // rank reflects the post-import state.
      const finalizeBlock =
        processImportJobSrc.split('export async function finalizeLegacyImportJob')[1]?.split('export async function processImportJob')[0] ?? ''
      expect(finalizeBlock).toMatch(/calculateAndSaveRank\(userId\)/)
    })

    it('per-season worker also calls calculateAndSaveRank when leagues were saved', () => {
      const seasonBlock =
        processImportJobSrc.split('export async function importLegacySeasonAtIndex')[1]?.split('export async function finalizeLegacyImportJob')[0] ?? ''
      expect(seasonBlock).toMatch(/calculateAndSaveRank\(userId\)/)
    })
  })

  describe('Dashboard query excludes ranking-import leagues', () => {
    const dashSrc = read('lib/dashboard/get-dashboard-league-list.ts')

    it('imports EXCLUDED_VARIANTS from the canonical filter module', () => {
      // Single source of truth — adding a new ranking variant only needs one edit.
      expect(dashSrc).toMatch(
        /import \{[^}]*EXCLUDED_VARIANTS[^}]*\} from '@\/lib\/leagues\/leagueListFilter'/,
      )
    })

    it('uses notIn against VARIANT_NOT_IN in the Prisma where clause', () => {
      expect(dashSrc).toMatch(/leagueVariant:\s*\{\s*notIn:\s*VARIANT_NOT_IN\s*\}/)
    })

    it('also excludes sleeper rows with null variant + null status (defensive layer)', () => {
      // Catches any old leagues that escaped the retroactive tagger.
      expect(dashSrc).toMatch(/platform:\s*'sleeper'/)
      expect(dashSrc).toMatch(/leagueVariant:\s*null/)
      expect(dashSrc).toMatch(/status:\s*null/)
    })
  })

  describe('Per-user rate-limit bypass (TheCiege24)', () => {
    const importRouteSrc = read('app/api/leagues/import/route.ts')

    it('bypasses consumeDailyLimit for theciege24 (case-insensitive)', () => {
      expect(importRouteSrc).toMatch(/RATE_LIMIT_BYPASS_SLEEPER_USERNAMES/)
      expect(importRouteSrc).toMatch(/"theciege24"/)
      expect(importRouteSrc).toMatch(/if \(!isBypassedSleeperUsername\)/)
    })

    it('uses a Set so additional bypass users can be added without changing call sites', () => {
      expect(importRouteSrc).toMatch(/new Set\(\["theciege24"\]\)/)
    })

    it('still returns 429 with the original error code for non-bypassed users', () => {
      // Existing rate-limit branch must remain reachable for everyone else.
      expect(importRouteSrc).toMatch(/Bulk Sleeper import is limited to once per day/)
      expect(importRouteSrc).toMatch(/status:\s*429/)
    })
  })
})
