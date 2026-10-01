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

/*
 * Words that name a KIND of venue, a sponsor-style filler, or a place every campus has — not
 * a venue. "Memorial Stadium" is the home of a dozen schools, so "memorial" says nothing about
 * WHICH one; a shared "field" or "university" says even less.
 */
const GENERIC_VENUE_WORDS = new Set([
  'stadium', 'field', 'park', 'dome', 'arena', 'coliseum', 'bowl', 'complex', 'center', 'centre',
  'the', 'at', 'of', 'and', 'in', 'on',
  'memorial', 'veterans', 'university', 'alumni', 'municipal', 'county', 'city', 'community',
  'athletic', 'athletics', 'football', 'sports', 'home', 'new', 'old',
])

/* Spellings that differ between feeds and the CFBD directory for the same words. */
const VENUE_WORD_ALIASES: Record<string, string> = {
  losangeles: 'la',
  saint: 'st',
  mount: 'mt',
  fort: 'ft',
}

function venueWords(s: string): string[] {
  const folded = s
    .toLowerCase()
    .replace(/los\s+angeles/g, 'la')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return folded
    .split(' ')
    .filter((w) => w && !/^\d+$/.test(w))
    .map((w) => VENUE_WORD_ALIASES[w] ?? w)
}

/**
 * Does a feed's venue string name the home team's stadium?
 *
 * 🛑 A FALSE YES FORECASTS THE HOME CAMPUS FOR A NEUTRAL-SITE GAME, which is worse than no
 * forecast: it is written onto the key My Team reads, with full confidence. So the test errs
 * towards NO, and the cron reports every NO as `venueMismatch` so a wrong NO is visible.
 *
 * The first matcher accepted only when one whole string contained the other. Measured on the
 * 2026-10-01 09:00Z run, 17 of its rejections were HOME games spelled differently by the feed
 * and by CFBD: "Fisher Stadium" / "Fisher Field", "Bethpage Stadium" / "Bethpage Federal
 * Credit Union Stadium", and earlier "Bobby Bowden Field at Doak S. Campbell Stadium" / "Doak
 * Campbell Stadium", "Los Angeles Memorial Coliseum" / "LA Memorial Coliseum".
 *
 * Accepted now, in order:
 *   1. the normalised strings are equal, or one contains the other and the contained one
 *      has a distinctive word (the original rule, with punctuation, numbers and a few
 *      spellings folded) — "LA Memorial Coliseum";
 *   2. the two share at least two DISTINCTIVE words — "Doak" + "Campbell";
 *   3. the two share one distinctive word of six or more letters — "Fisher", "Bethpage".
 *
 * ⚠ Rule 3's floor is deliberate. "Ford Field" (Detroit, a neutral and bowl site) shares
 * "ford" with SMU's "Gerald J. Ford Stadium"; at four letters that is still a mismatch, as it
 * must be. A rename with no word in common ("Broadview Stadium" / "UB Stadium") stays a
 * mismatch too — that needs an alias, not a looser matcher.
 */
export function venueNamesAgree(feedVenue: string, homeStadium: string): boolean {
  const a = venueWords(feedVenue)
  const b = venueWords(homeStadium)
  if (!a.length || !b.length) return false
  const aKey = a.join('')
  const bKey = b.join('')
  if (aKey === bKey) return true

  const distinctiveA = new Set(a.filter((w) => !GENERIC_VENUE_WORDS.has(w)))
  const distinctiveB = new Set(b.filter((w) => !GENERIC_VENUE_WORDS.has(w)))
  // Containment counts only when the contained side names something: "Memorial Stadium" sits
  // inside "Veterans Memorial Stadium" and inside a dozen other campuses' stadium names.
  if (aKey.includes(bKey) && distinctiveB.size) return true
  if (bKey.includes(aKey) && distinctiveA.size) return true

  const shared = [...distinctiveB].filter((w) => distinctiveA.has(w))
  if (shared.length >= 2) return true
  return shared.some((w) => w.length >= 6)
}
