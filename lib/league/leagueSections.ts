/** Personal display choices. They never change league rules, access, or notifications. */
export const HIDDEN_LEAGUE_SECTIONS_KEY = 'hiddenLeagueSections'
export const LEAGUE_SECTIONS = [
  'week', 'team', 'matchups', 'standings', 'activity', 'chat', 'insights',
  'timeline', 'draft', 'commissioner', 'managers', 'format', 'pairing',
] as const
export type LeagueSectionId = (typeof LEAGUE_SECTIONS)[number]

export function readHiddenLeagueSections(saved: unknown): LeagueSectionId[] {
  const raw = saved && typeof saved === 'object'
    ? (saved as Record<string, unknown>)[HIDDEN_LEAGUE_SECTIONS_KEY] : null
  return Array.isArray(raw) ? LEAGUE_SECTIONS.filter(id => raw.includes(id)) : []
}
