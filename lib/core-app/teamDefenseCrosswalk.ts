import { getAllCanonicalTeams, getTeamInfo, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { espnDefenseTeamAbbreviation } from '@/lib/league-import/espn/espnTeamDefenseIds'

/**
 * An imported roster's TEAM DEFENCE → the Sleeper id of that defence, which is the team code
 * (`KC`), or null when the row is not unambiguously one.
 *
 * ⚠ A PURE MODULE, because `rosterIdCrosswalk.ts` imports prisma at module scope and this is the
 * part most worth a unit test — the same split as `crosswalkRules.ts`.
 *
 * 🛑 THE PLAYER CROSSWALK CANNOT CARRY A DEFENCE, SO EVERY IMPORTED D/ST WAS SKIPPED. A defence is
 * not an athlete: `PlayerIdentityMap` holds no row for ESPN `-16012` or Fleaflicker `2343` (0 rows,
 * production 2026-10-13), so since the foreign-id fix (08a012b4c / f89600828) every ESPN and
 * Fleaflicker D/ST read no score, was skipped by the score sync and refused by the stat ingest.
 * Sleeper's id for a defence is its team code — all 1,431 active Sleeper-league DEF slots hold one
 * of exactly the 32 codes in `lib/team-abbrev.ts` — so the translation is a team, not a person.
 *
 * Two providers, two encodings, both measured on production:
 *  - ESPN: the id IS the team, `-16000 - proTeamId` (`espnDefenseTeamAbbreviation`). 10 ESPN rows
 *    carry that id with position `UNK` and the id as their name — the importer could not label
 *    them — and the id alone still names the defence.
 *  - Fleaflicker: the id (`2330`..`2359`) says nothing; the row does — position `D/ST`, name
 *    "Baltimore Ravens", team "Ravens". Only the labels can map it, so all of them must agree.
 *
 * NEVER A GUESS: a position that says defence is not enough. The row's NAME must itself be an NFL
 * club (a person's name never is), any team label must name the same club, and a bare city is not
 * accepted ("Los Angeles" and "New York" each name two). Anything else stays unmapped and skipped,
 * exactly as before.
 */
export type TeamDefenseRosterRow = {
  playerId: string
  position?: string | null
  team?: string | null
  playerName?: string | null
}

const TEAM_DEFENSE_POSITIONS = new Set(['D/ST', 'DST', 'DEF'])
/** What an ESPN D/ST row reads when the importer could not label it (10 production rows). */
const UNLABELLED_POSITIONS = new Set(['', 'UNK', 'UNKNOWN'])

/** An NFL club's code from its code, a code alias, its full name or its nickname — never a bare city. */
export function nflTeamCodeOf(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const lower = s.toLowerCase()
  for (const t of getAllCanonicalTeams()) {
    if (t.abbrev.toLowerCase() === lower || t.fullName.toLowerCase() === lower || t.mascot.toLowerCase() === lower) {
      return t.abbrev
    }
  }
  // Code aliases (JAC, WSH, OAK…) through the shared table — only for a short code, because
  // `normalizeTeamAbbrev` also matches a CITY, and it returns unknown input unchanged.
  if (/^[A-Za-z]{2,4}$/.test(s)) {
    const alias = normalizeTeamAbbrev(s)
    if (alias && getTeamInfo(alias)?.canonical === alias) return alias
  }
  return null
}

/** "Chiefs D/ST", "Kansas City Chiefs", "KC Defense" → KC. */
function clubOfName(name: string | null | undefined): string | null {
  return nflTeamCodeOf(String(name ?? '').replace(/\s+(D\/ST|DST|DEF|Defen[sc]e)$/i, ''))
}

export function teamDefenseSleeperId(platform: string | null | undefined, row: TeamDefenseRosterRow): string | null {
  const position = String(row.position ?? '').trim().toUpperCase()
  const fromTeam = String(row.team ?? '').trim() ? nflTeamCodeOf(row.team) : null
  const fromName = clubOfName(row.playerName)

  if (String(platform ?? '').trim().toLowerCase() === 'espn') {
    const fromId = espnDefenseTeamAbbreviation(row.playerId)
    if (fromId) {
      if (!TEAM_DEFENSE_POSITIONS.has(position) && !UNLABELLED_POSITIONS.has(position)) return null
      // The id is authoritative; a label that names a DIFFERENT club is a contradiction, not a tie-break.
      if ((fromTeam && fromTeam !== fromId) || (fromName && fromName !== fromId)) return null
      return fromId
    }
  }

  if (!TEAM_DEFENSE_POSITIONS.has(position)) return null
  if (!fromName) return null
  if (String(row.team ?? '').trim() && fromTeam !== fromName) return null
  return fromName
}
