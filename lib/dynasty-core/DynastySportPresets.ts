/**
 * Dynasty roster + scoring presets for the daily sports (NBA, NHL, MLB).
 *
 * The football presets in `constants.ts` (`DYNASTY_ROSTER_PRESETS` / `DYNASTY_SCORING_PRESETS`) are
 * QB/RB/WR/TE formats and are deliberately withheld from these sports. This is their counterpart.
 *
 * A preset is a choice of values the dynasty pipeline ALREADY carries — nothing here adds a slot type
 * or a scoring mode:
 *   - `scoringPresetId` is a `lib/league-creation-preset/scoring-presets` id the create allowlist
 *     already accepts for that sport's dynasty concept (points scoring; AF default point values).
 *   - `benchCount` / `irCount` / `taxiSlotCount` override the BN / IL-or-IR / TAXI keys of the sport's
 *     `dynasty` roster template, exactly as `resolveDynastyCreationRoster` already does at create.
 *     Starters stay the template's.
 *   - `taxiEligibilityYears` is `DynastyLeagueConfig.taxiEligibilityYears` (1–3).
 *
 * ⚠ NHL AND MLB PRESETS CARRY NO TAXI. There is no NHL/MLB prospect or minor-league player pool
 * (owner's decision 2026-10-20, `lib/league-creation/prospectStashPolicy.ts`), so their
 * `taxiSlotCount` is 0 and `rosterSlotsWithDynastySportPreset` clamps TAXI to 0 for them as a
 * backstop. Each preset's former taxi depth is on its BENCH instead (owner, 2026-10-23), so total
 * roster depth and the gaps between presets are what they were: bench = old bench + old taxi. The
 * template's own NA / PROSPECT counts are left exactly as they are.
 *
 * The FIRST preset of each sport equals what the create wizard already defaults to
 * (`defaultDynastyBySport` + `getDefaultDynastySetup`), so offering presets changes no default.
 */
import type { DynastySetupState } from '@/lib/create-league-v2/state'
import { sportSupportsProspectStash } from '@/lib/league-creation/prospectStashPolicy'

export type DynastySportPresetSport = 'NBA' | 'NHL' | 'MLB'

export type DynastySportPreset = {
  id: string
  sport: DynastySportPresetSport
  scoringPresetId: string
  benchCount: number
  irCount: number
  taxiSlotCount: number
  taxiEligibilityYears: 1 | 2 | 3
  startupRosterDepth: number
}

export const DYNASTY_SPORT_PRESETS: readonly DynastySportPreset[] = [
  // NBA starters (template): PG SG G SF PF F C×2 UTIL×2 = 10.
  { id: 'nba_dynasty_points_taxi', sport: 'NBA', scoringPresetId: 'nba_points', benchCount: 8, irCount: 3, taxiSlotCount: 4, taxiEligibilityYears: 2, startupRosterDepth: 24 },
  { id: 'nba_dynasty_points_compact', sport: 'NBA', scoringPresetId: 'nba_points', benchCount: 5, irCount: 3, taxiSlotCount: 3, taxiEligibilityYears: 1, startupRosterDepth: 18 },
  { id: 'nba_dynasty_points_deep', sport: 'NBA', scoringPresetId: 'nba_points', benchCount: 12, irCount: 4, taxiSlotCount: 6, taxiEligibilityYears: 3, startupRosterDepth: 28 },
  // NHL starters (template): C×2 LW×2 RW×2 D×4 UTIL×2 G×2 = 14 (skaters + goalies, one points table).
  // No taxi (see header); bench carries the old 4 / 8 taxi: 9+4 = 13, 10+8 = 18. Roster 30 / 35.
  { id: 'nhl_dynasty_points_taxi', sport: 'NHL', scoringPresetId: 'nhl_points', benchCount: 13, irCount: 3, taxiSlotCount: 0, taxiEligibilityYears: 2, startupRosterDepth: 26 },
  { id: 'nhl_dynasty_points_minors', sport: 'NHL', scoringPresetId: 'nhl_points', benchCount: 18, irCount: 3, taxiSlotCount: 0, taxiEligibilityYears: 3, startupRosterDepth: 30 },
  // MLB starters (template): C 1B 2B 3B SS CI MI OF×5 UTIL×2 SP×3 RP×2 P×4 = 23, plus the template's NA×5.
  // No taxi; bench carries the old 6 / 10 taxi: 12+6 = 18, 16+10 = 26. Roster 50 / 60.
  { id: 'mlb_dynasty_points_minors', sport: 'MLB', scoringPresetId: 'mlb_points', benchCount: 18, irCount: 4, taxiSlotCount: 0, taxiEligibilityYears: 2, startupRosterDepth: 34 },
  { id: 'mlb_dynasty_points_deep', sport: 'MLB', scoringPresetId: 'mlb_points', benchCount: 26, irCount: 6, taxiSlotCount: 0, taxiEligibilityYears: 3, startupRosterDepth: 40 },
]

export function isDynastySportPresetSport(sport: string | null | undefined): sport is DynastySportPresetSport {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NBA' || s === 'NHL' || s === 'MLB'
}

/** Presets for one sport, default first. Empty for NFL / NCAAF / NCAAB / SOCCER. */
export function getDynastySportPresets(sport: string | null | undefined): DynastySportPreset[] {
  const s = String(sport ?? '').trim().toUpperCase()
  return DYNASTY_SPORT_PRESETS.filter((p) => p.sport === s)
}

export function findDynastySportPreset(id: string | null | undefined): DynastySportPreset | undefined {
  return DYNASTY_SPORT_PRESETS.find((p) => p.id === id)
}

/** Create wizard: the dynasty setup with a preset's roster + taxi values written over it. */
export function applyDynastySportPresetToSetup(setup: DynastySetupState, preset: DynastySportPreset): DynastySetupState {
  return {
    ...setup,
    benchCount: preset.benchCount,
    irCount: preset.irCount,
    taxiSlotCount: presetTaxiSlotCount(preset),
    taxiEligibilityYears: preset.taxiEligibilityYears,
    startupRosterDepth: preset.startupRosterDepth,
  }
}

/** The preset's taxi count, 0 for a sport without a prospect pool (NHL / MLB) whatever the row says. */
export function presetTaxiSlotCount(preset: DynastySportPreset): number {
  return sportSupportsProspectStash(preset.sport) ? preset.taxiSlotCount : 0
}

/** The preset the wizard state currently equals, or null ("Custom"). */
export function matchDynastySportPreset(
  sport: string,
  scoringPresetId: string,
  setup: Pick<DynastySetupState, 'benchCount' | 'irCount' | 'taxiSlotCount' | 'taxiEligibilityYears' | 'startupRosterDepth'>,
): DynastySportPreset | null {
  return getDynastySportPresets(sport).find((p) =>
    p.scoringPresetId === scoringPresetId &&
    p.benchCount === setup.benchCount &&
    p.irCount === setup.irCount &&
    p.taxiSlotCount === setup.taxiSlotCount &&
    p.taxiEligibilityYears === setup.taxiEligibilityYears &&
    p.startupRosterDepth === setup.startupRosterDepth,
  ) ?? null
}

/**
 * Pre-draft edit: the league's current roster slots with the preset's BN / IR / TAXI counts written
 * over them — the same three keys `resolveDynastyCreationRoster` overrides at create. NBA and MLB
 * name injured reserve `IL`, NHL names it `IR`; bench is `BN` in all three. NHL / MLB get no TAXI.
 */
export function rosterSlotsWithDynastySportPreset(
  current: Record<string, number>,
  preset: DynastySportPreset,
): Record<string, number> {
  const irKey = preset.sport === 'NHL' ? 'IR' : 'IL'
  const next = { ...current, BN: preset.benchCount, [irKey]: preset.irCount }
  // NHL / MLB: never add a TAXI slot. One the league already stores is lowered to 0 rather than
  // dropped, so the sport template's own TAXI count cannot reappear through a missing key.
  if (sportSupportsProspectStash(preset.sport) || 'TAXI' in current) next.TAXI = presetTaxiSlotCount(preset)
  return next
}
