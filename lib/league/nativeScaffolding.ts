import { importedLineupTemplateSlots } from '@/lib/league/importedLineupTemplate'
import { getRosterEngineRegistry } from '@/lib/roster-engine/RosterEngineRegistry'
import { validateRosterConfig } from '@/lib/roster-engine/RosterValidationEngine'
import type { SupportedRosterSport } from '@/lib/roster-engine/RosterEngineTypes'
import { storeSavedByPerson } from '@/lib/redraft/uiScoringStoreBridge'
import { asRecord } from '@/lib/league-creation/canonical/importedIdentityPlan'

/**
 * The settings a converted league needs so it plays like the provider league it was — the decisions the readiness
 * check (`nativeReadiness.ts`) and the switch (`convertImportedLeagueInPlace.ts`) must agree on, so they live once.
 * docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §7 step 3.10, owner decision Q8 (AF edits win).
 *
 * 🛑 WHY THE SWITCH CANNOT SKIP THIS. While a league is imported, the lineup screen reads the provider's own
 * `roster_positions` (RosterTemplateService, gated on `isImportedPlatform`) and scoring is the provider's. The moment
 * `platform` becomes 'manual' both readers fall to AllFantasy DEFAULTS: scoring to standard PPR, and the roster to a
 * template that 4,871 of 6,734 Sleeper NFL rosters overflowed (lib/league/importedLineupTemplate.ts). Nothing errors.
 */

/** A scoring or roster store a PERSON saved in AllFantasy (not the seeder, not a conversion), which therefore wins. */
export function savedInAllFantasy(store: unknown): boolean {
  return storeSavedByPerson(store) && asRecord(store).source !== 'IMPORTED_MAPPED'
}

/**
 * Did a commissioner save this league's roster layout in AllFantasy? The roster writer stamps `settings.roster`
 * with `updatedBy` and an audit log; a conversion's own write is the audit action `import`, so a retried switch
 * re-maps rather than mistaking its earlier attempt for the commissioner's choice.
 */
export function rosterSavedInAllFantasy(settings: unknown): boolean {
  const roster = asRecord(asRecord(settings).roster)
  if (typeof roster.updatedBy !== 'string' || !roster.updatedBy.trim()) return false
  const audit = Array.isArray(roster.auditLog) ? roster.auditLog : []
  const last = asRecord(audit[audit.length - 1])
  return last.action !== 'import'
}

export type ImportedRosterLayout =
  | { kind: 'af_saved' }
  /** Baseball's roster comes with its scoring conversion (`importedMlbRoster`), not from here. */
  | { kind: 'mlb' }
  | { kind: 'mapped'; slots: Record<string, number> }
  | { kind: 'unreadable'; reason: string }

/**
 * `importedLineupTemplateSlots` names a few football slots differently from the roster engine's keys
 * (`lib/nfl-roster`). Everything else it names identically; a name with no engine key at all (`HC`, `P`, split IDP
 * spots like `DE`/`CB`) is caught by the known-key check below rather than guessed.
 */
const TEMPLATE_TO_ENGINE_KEY: Record<string, string> = {
  DST: 'DEF',
  WRRB_FLEX: 'FLEX_WR_RB',
  REC_FLEX: 'FLEX_WR_TE',
}

/**
 * The provider's roster layout as roster-engine slot counts — or why it cannot be. Pure: reads settings, writes nothing.
 *
 * It reads the layout with `importedLineupTemplateSlots`, the same reader the lineup screen uses for an imported league
 * today (both Sleeper's one-entry-per-seat list and the `SLOT:COUNT` pairs), so a converted league keeps exactly the
 * lineup its managers already see.
 *
 * 🛑 NOT `mapImportedRosterToAF`. Measured 2026-11-26: for ESPN and Sleeper it passes provider names through unchanged
 * (`D/ST`, `BE`, `SUPER_FLEX`), none of which is an engine key — and `validateRosterConfig` accepts an unknown key by
 * skipping it. A layout saved that way validates, and the league silently plays starters short.
 */
export function planImportedRosterLayout(league: {
  sport: string
  platform: string
  leagueType: string | null
  settings: unknown
  taxiSlots?: number | null
  irSlots?: number | null
}): ImportedRosterLayout {
  const settings = asRecord(league.settings)
  if (rosterSavedInAllFantasy(settings)) return { kind: 'af_saved' }
  // The roster engine's sport union; an unsupported sport is caught by `isSupported` below.
  const sport = String(league.sport).toUpperCase() as SupportedRosterSport
  if (sport === 'MLB') return { kind: 'mlb' }

  const template = importedLineupTemplateSlots({ sport, settings, taxiSlots: league.taxiSlots ?? null, irSlots: league.irSlots ?? null })
  if (!template) return { kind: 'unreadable', reason: 'AllFantasy could not read the roster layout the import stored.' }
  const slots: Record<string, number> = {}
  const add = (key: string, n: number) => { if (n > 0) slots[key] = (slots[key] ?? 0) + n }
  for (const row of template) {
    add(TEMPLATE_TO_ENGINE_KEY[row.slotName] ?? row.slotName, row.starterCount)
    add('BN', row.benchCount)
    add('IR', row.reserveCount)
    add('TAXI', row.taxiCount)
  }

  // Ask first rather than catching: a broad catch here once turned a load failure into "no roster editor for NFL".
  const registry = getRosterEngineRegistry()
  if (!registry.isSupported(sport)) return { kind: 'unreadable', reason: `AllFantasy has no roster editor for ${sport} yet.` }
  const defs = registry.getService(sport).getSlots()
  // validateRosterConfig skips a key it has no definition for; a slot nobody recognises must refuse, not vanish.
  const known = new Set(defs.map((d) => d.key))
  const unknown = Object.keys(slots).filter((key) => !known.has(key))
  if (unknown.length) return { kind: 'unreadable', reason: `Roster spots AllFantasy can't place: ${unknown.join(', ')}.` }
  const validation = validateRosterConfig(sport, league.leagueType ?? 'redraft', slots, defs)
  if (!validation.valid) return { kind: 'unreadable', reason: validation.errors.join(' ') }
  return { kind: 'mapped', slots }
}

/** The per-sport scoring store a commissioner saves (`nfl_scoring_config`, `nba_scoring_config`, …). */
export function sportScoringStore(settings: unknown, sport: string): unknown {
  return asRecord(settings)[`${String(sport).trim().toLowerCase()}_scoring_config`]
}
