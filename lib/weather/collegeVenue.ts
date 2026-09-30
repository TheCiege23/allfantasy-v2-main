import { resolveCollegeTeam, type CollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIdentity'
import { NCAAF_TEAM_STADIUM } from '@/lib/weather/ncaafTeamStadiums'

export type CollegeVenue = { lat: number; lng: number; dome: boolean; label: string }

/**
 * A college team's home stadium, keyed by the team's CANONICAL school — the same
 * directory record My Team's fixture join lands on (lib/core-app/collegeNextGame.ts).
 *
 * 🛑 ONE PATH FOR BOTH SIDES OF THE WEATHER CACHE. The prewarm cron writes a
 * `weather:coords:{lat}:{lng}:{day}` row and My Team reads one, and they only meet if
 * both derive identical coordinates. Before this, the cron passed a raw feed string
 * and the reader a string first put through the NFL fold, into a 15-team table keyed
 * by short codes — so "Tennessee" became TENN on one side and TEN on the other. Both
 * now resolve the string to ONE directory record and take that record's stadium.
 *
 * SOURCE: CFBD `/teams` → `location`, carried on the directory since 2026-09-30
 * (664 of 1,933 teams, including all 138 FBS). `NCAAF_TEAM_STADIUM` is only the
 * fallback for a directory ingested before venues were kept, reached through the
 * RECORD's abbreviation, never the raw string — a raw-string fallback is exactly how
 * the two sides used to disagree.
 *
 * ⚠ AN UNRESOLVED OR AMBIGUOUS TEAM HAS NO STADIUM. No guess from a partial name.
 */
export function resolveCollegeVenue(
  team: string | null | undefined,
  index: CollegeTeamIndex | null,
): CollegeVenue | null {
  if (!index) return null
  const record = resolveCollegeTeam(team, index)
  if (!record) return null

  if (record.venue) {
    return {
      lat: record.venue.latitude,
      lng: record.venue.longitude,
      dome: record.venue.dome,
      label: record.venue.name ?? record.school,
    }
  }

  const code = record.abbreviation?.trim().toUpperCase()
  const legacy = code ? NCAAF_TEAM_STADIUM[code] : undefined
  return legacy ? { lat: legacy.lat, lng: legacy.lng, dome: legacy.dome, label: legacy.label } : null
}
