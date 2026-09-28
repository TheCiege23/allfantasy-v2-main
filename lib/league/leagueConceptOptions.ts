/**
 * Canonical league concepts shown anywhere a person identifies a league.
 *
 * Kept in a client-safe module so the picker, import review, Trade OS, Chimmy,
 * and Decision OS all speak the same ids.
 *
 * ⚠ TWELVE OF THESE ARE FORMAT-ENGINE IDS (`LeagueFormatId` in
 * lib/league/format-engine.ts); `pirate`, `efl` AND `survivor_guillotine` ARE
 * NOT. Nothing imports this list into the format engine, and nothing should:
 * those three are concepts a commissioner can CONFIRM about an existing league,
 * each sitting on a base format rather than defining one (user decision,
 * 2026-09-16). The `League.leagueType` column only ever receives the base — see
 * `leagueTypeColumnFor` in lib/career/leagueTypeConfirmation.ts.
 *
 *   - `pirate` — the rules in lib/trade-intel/pirate.ts. The base is the
 *     commissioner's own answer, stored as `leagueTypeConfirmation.baseFormat`
 *     and read through `readConfirmedPirateBase` below.
 *   - `efl` — a label that prices on the dynasty book and nothing else. It does
 *     NOT attach the EFL Commissioner OS template pin, which is what the EFL hub
 *     keys on (lib/core-app/formatHubs.ts).
 *   - `survivor_guillotine` — ONE format, not Survivor plus Guillotine: tribes,
 *     guillotine elimination, a lineup that grows on a schedule, and no trades
 *     (lib/trade-intel/survivorGuillotine.ts; catalog entry of the same id).
 *     Guillotine chassis, redraft book.
 */
export const LEAGUE_CONCEPT_OPTIONS = [
  { id: 'redraft', label: 'Redraft' },
  { id: 'dynasty', label: 'Dynasty' },
  { id: 'keeper', label: 'Keeper' },
  { id: 'best_ball', label: 'Best Ball' },
  { id: 'guillotine', label: 'Guillotine' },
  { id: 'survivor', label: 'Survivor' },
  { id: 'survivor_guillotine', label: 'Survivor Guillotine' },
  { id: 'tournament', label: 'Tournament' },
  { id: 'devy', label: 'Devy' },
  { id: 'c2c', label: 'Campus to Canton' },
  { id: 'efl', label: 'EFL' },
  { id: 'zombie', label: 'Zombie' },
  { id: 'pirate', label: 'Pirate' },
  { id: 'salary_cap', label: 'Salary Cap' },
  { id: 'big_brother', label: 'Big Brother' },
] as const

export type LeagueConceptType = (typeof LEAGUE_CONCEPT_OPTIONS)[number]['id']

const IDS = new Set<string>(LEAGUE_CONCEPT_OPTIONS.map((option) => option.id))

export function isLeagueConceptType(value: unknown): value is LeagueConceptType {
  return typeof value === 'string' && IDS.has(value)
}

export function leagueConceptLabel(value: string | null | undefined): string {
  return LEAGUE_CONCEPT_OPTIONS.find((option) => option.id === value)?.label ?? 'Choose league type'
}

/**
 * The follow-up a Pirate league must answer: do rosters carry over?
 *
 * Pirate is a set of steal/protect rules, and they sit on either shell. The
 * answer decides which value book the league prices on, so it is asked rather
 * than guessed.
 */
export const PIRATE_BASE_FORMAT_OPTIONS = [
  { id: 'dynasty', label: 'Dynasty' },
  { id: 'redraft', label: 'Redraft' },
] as const

export type PirateBaseFormat = (typeof PIRATE_BASE_FORMAT_OPTIONS)[number]['id']

export function isPirateBaseFormat(value: unknown): value is PirateBaseFormat {
  return value === 'dynasty' || value === 'redraft'
}

export function pirateBaseFormatLabel(value: string | null | undefined): string | null {
  return PIRATE_BASE_FORMAT_OPTIONS.find((option) => option.id === value)?.label ?? null
}

/**
 * The base format a commissioner confirmed for a Pirate league.
 *
 * ⚠ THE ONE READER OF `leagueTypeConfirmation.baseFormat`, so pricing, the API
 * and the picker cannot each parse the settings blob their own way. Null unless
 * the confirmation is a Pirate one AND carries a valid answer — a stray field on
 * any other confirmation is not an answer to a question nobody asked.
 */
export function readConfirmedPirateBase(settings: unknown): PirateBaseFormat | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>).leagueTypeConfirmation
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  if (c.type !== 'pirate') return null
  return isPirateBaseFormat(c.baseFormat) ? c.baseFormat : null
}

/**
 * The league type a PERSON confirmed, or null when nobody has — the one reader of
 * `leagueTypeConfirmation.type`. A null here means every trait of the league is still the
 * importer's reading of the host platform, which is what the grade's label has to say.
 */
export function readConfirmedLeagueConcept(settings: unknown): LeagueConceptType | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>).leagueTypeConfirmation
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const confirmed = (raw as Record<string, unknown>).type
  return isLeagueConceptType(confirmed) ? confirmed : null
}

/**
 * The host platform's own KEEPER fact, as the importer stored it — Sleeper `settings.type: 1` lands
 * in `conceptRules.extensions.keeperProvenance.isKeeper`. Only a `provider`-sourced fact counts.
 */
export function readProviderKeeperFact(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  const rules = (settings as Record<string, unknown>).conceptRules
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return false
  const ext = (rules as Record<string, unknown>).extensions
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return false
  const kp = (ext as Record<string, unknown>).keeperProvenance
  if (!kp || typeof kp !== 'object' || Array.isArray(kp)) return false
  const p = kp as Record<string, unknown>
  return p.isKeeper === true && p.source === 'provider'
}

/** The host platform's own DYNASTY fact, as the importer stored it in `settings.isDynasty`. */
export function readProviderDynastyFact(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  return (settings as Record<string, unknown>).isDynasty === true
}

/** Prefer the human-confirmed concept when an importer later rewrites League.leagueType. */
export function resolveLeagueConcept(
  settings: unknown,
  storedType: string | null | undefined,
): LeagueConceptType | string | null {
  const confirmed = readConfirmedLeagueConcept(settings)
  if (confirmed) return confirmed
  return typeof storedType === 'string' && storedType.trim() ? storedType.trim().toLowerCase() : null
}
