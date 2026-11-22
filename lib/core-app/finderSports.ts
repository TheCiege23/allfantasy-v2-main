/** Sports available in the Player Finder's catalog. Null means all sports. */
export const FINDER_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
export type FinderSport = (typeof FINDER_SPORTS)[number]

export function normalizeFinderSport(value: unknown): FinderSport | null {
  if (typeof value !== 'string') return null
  const sport = value.trim().toUpperCase()
  return FINDER_SPORTS.find((candidate) => candidate === sport) ?? null
}
