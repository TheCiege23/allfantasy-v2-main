import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/** Historical NFL aliases must not rename clubs in other sports. */
export function liveTeamAbbreviation(raw: string, sport: string): string {
  return sport === 'NFL' ? normalizeTeamAbbrev(raw) || raw : raw.trim().toUpperCase()
}
