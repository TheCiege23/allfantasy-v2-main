/**
 * IMP-02 — initial import and scheduled refresh must publish the SAME canonical settings.
 *
 * Initial import merged a full `CanonicalImportBundle` into `League.settings`. The scheduled
 * `league_state` writer merged only the raw imported values and then re-asserted
 * `importCanonical` from the existing row — so canonical `scoringSettings`/`rosterSettings`
 * froze at import time while the raw values kept tracking the source. A league that changed
 * its scoring was graded on import-day rules indefinitely, with nothing going red.
 */

import { describe, expect, it } from 'vitest'

import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { republishCanonicalSettingsForRefresh } from '@/lib/league-import/ImportedLeagueCommitService'
import type { NormalizedImportResult } from '@/lib/league-import/types'

function normalized(scoringFormat: string): NormalizedImportResult {
  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: 'abc',
      imported_at: new Date().toISOString(),
    },
    league: {
      name: 'Test League',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      rosterSize: 16,
      scoring: scoringFormat,
      isDynasty: false,
      league_type: 'redraft',
    },
    rosters: [],
    scoring: { scoring_format: scoringFormat, rules: [] },
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
      playoffSettings: { state: 'partial' },
      currentStandings: { state: 'full' },
      currentSchedule: { state: 'full' },
      draftHistory: { state: 'missing' },
      tradeHistory: { state: 'missing' },
      previousSeasons: { state: 'missing' },
      playerIdentityMap: { state: 'full' },
    },
  } as NormalizedImportResult
}

describe('IMP-02 — refresh republishes canonical settings', () => {
  it('updates the canonical scoring slice when the source scoring changed', () => {
    /* Imported as standard; the league has since switched to full PPR. */
    const atImport = buildCanonicalImportBundle(normalized('standard non-ppr'))
    const existing: Record<string, unknown> = {
      scoringSettings: atImport.settingsSnapshot.scoringSettings,
      importCanonical: {
        presetKey: atImport.presetKey,
        scoringPresetId: atImport.scoringPresetId,
        draftType: atImport.draftType,
        inferredConcept: atImport.inferredConcept,
      },
    }
    expect((existing.importCanonical as { scoringPresetId: string }).scoringPresetId).toBe('fb_std')

    const nowBundle = buildCanonicalImportBundle(normalized('ppr'))
    const merged = republishCanonicalSettingsForRefresh(existing, {}, nowBundle)

    expect((merged.scoringSettings as { scoringTemplateId: string }).scoringTemplateId).toBe('fb_ppr')
    expect((merged.importCanonical as { scoringPresetId: string }).scoringPresetId).toBe('fb_ppr')
  })

  it('stamps a republishedAt so caches of derived values can invalidate', () => {
    const bundle = buildCanonicalImportBundle(normalized('ppr'))
    const merged = republishCanonicalSettingsForRefresh({}, {}, bundle)
    const stamp = (merged.importCanonical as { republishedAt?: string }).republishedAt
    expect(stamp).toBeTruthy()
    expect(Number.isNaN(Date.parse(String(stamp)))).toBe(false)
  })

  it('adopts an UNLAYERED existing presentation value as an override rather than losing it', () => {
    /*
     * 🛑 THE DEPLOY CASE, AND THE ONE THAT COSTS REAL USER DATA IF IT IS WRONG. Every league
     * that exists today carries `visualTheme` as a bare top-level key with no record of who
     * set it. Without first-adoption, resolution falls through to the provider value and a
     * manager's customisation is overwritten once, irreversibly, on the first refresh after
     * this ships. A value that differs from what the provider reports is adopted as an
     * override, because misfiling a provider value merely freezes branding (visible and
     * reversible) while misfiling a user's choice destroys it.
     */
    const bundle = buildCanonicalImportBundle(normalized('ppr'))
    const merged = republishCanonicalSettingsForRefresh(
      { visualTheme: { accent: 'user-picked' }, mediaSettings: { banner: 'user-upload' } },
      {},
      bundle,
    )
    expect(merged.visualTheme).toEqual({ accent: 'user-picked' })
    expect(merged.mediaSettings).toEqual({ banner: 'user-upload' })
    /* And it is now recorded as an override, so the next refresh needs no re-adoption. */
    expect((merged.userOverrides as Record<string, unknown>).visualTheme).toEqual({
      accent: 'user-picked',
    })
  })

  it('produces the same canonical slices a fresh import would', () => {
    /* Parity is the actual requirement: refresh and import must not disagree. */
    const bundle = buildCanonicalImportBundle(normalized('ppr'))
    const merged = republishCanonicalSettingsForRefresh({}, {}, bundle)
    expect(merged.scoringSettings).toEqual(bundle.settingsSnapshot.scoringSettings)
    expect(merged.rosterSettings).toEqual(bundle.settingsSnapshot.rosterSettings)
    expect(merged.playoffSettings).toEqual(bundle.settingsSnapshot.playoffSettings)
  })
})
