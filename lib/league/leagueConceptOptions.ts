/**
 * Canonical league concepts shown anywhere a person identifies a league.
 *
 * Kept in a client-safe module so the picker, import review, Trade OS, Chimmy,
 * and Decision OS all speak the same ids as the format engine.
 */
export const LEAGUE_CONCEPT_OPTIONS = [
  { id: 'redraft', label: 'Redraft' },
  { id: 'dynasty', label: 'Dynasty' },
  { id: 'keeper', label: 'Keeper' },
  { id: 'best_ball', label: 'Best Ball' },
  { id: 'guillotine', label: 'Guillotine' },
  { id: 'survivor', label: 'Survivor' },
  { id: 'tournament', label: 'Tournament' },
  { id: 'devy', label: 'Devy' },
  { id: 'c2c', label: 'Campus to Canton' },
  { id: 'zombie', label: 'Zombie' },
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

/** Prefer the human-confirmed concept when an importer later rewrites League.leagueType. */
export function resolveLeagueConcept(
  settings: unknown,
  storedType: string | null | undefined,
): LeagueConceptType | string | null {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const raw = (settings as Record<string, unknown>).leagueTypeConfirmation
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const confirmed = (raw as Record<string, unknown>).type
      if (isLeagueConceptType(confirmed)) return confirmed
    }
  }
  return typeof storedType === 'string' && storedType.trim() ? storedType.trim().toLowerCase() : null
}
