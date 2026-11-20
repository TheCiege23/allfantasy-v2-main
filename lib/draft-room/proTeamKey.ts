/**
 * One key per pro team, whichever way a feed spells it (2026-11-19).
 *
 * The schedule (`SportsGame`, TheSportsDB) stores full names ("Los Angeles Clippers"); NBA draft
 * pool rows carry codes ("LAC", "GSW", "NYK"); NHL and MLB rows carry full names; ESPN-style tables
 * use "GS", "NY", "SA", "UTAH". Every spelling maps to the team's full name, lower-cased, so a
 * player's team and a game's team compare equal. Unknown input returns null — never a guess.
 */
import { COPY_LEAGUE_MLB_TEAMS, COPY_LEAGUE_NBA_TEAMS, COPY_LEAGUE_NHL_TEAMS } from '@/lib/league/copyLeagueTeamTables'

type Table = readonly { code: string; name: string }[]

/** Other codes feeds use for the same club, keyed by the table's code. */
const ALIASES: Record<'NBA' | 'NHL' | 'MLB', Record<string, string[]>> = {
  NBA: {
    BKN: ['BRK', 'BRO'], CHA: ['CHO'], GS: ['GSW'], NO: ['NOP', 'NOR'], NY: ['NYK'], PHX: ['PHO'],
    SA: ['SAS'], UTAH: ['UTA'], WSH: ['WAS'],
  },
  NHL: {
    LA: ['LAK'], NJ: ['NJD'], SJ: ['SJS'], TB: ['TBL'], UTAH: ['UTA', 'UTM'], VGK: ['VEG', 'LV'],
    WSH: ['WAS'], MTL: ['MON'], CGY: ['CAL'], CBJ: ['CLB'], NSH: ['NAS'],
  },
  MLB: {
    ARI: ['AZ'], ATH: ['OAK'], CHW: ['CWS'], KC: ['KCR'], SD: ['SDP'], SF: ['SFG'], TB: ['TBR'],
    WSH: ['WSN', 'WAS'],
  },
}

/** Full names a table writes differently from the schedule. */
const NAME_ALIASES: Record<string, string> = {
  'la clippers': 'los angeles clippers',
  'oakland athletics': 'athletics',
  'arizona coyotes': 'utah mammoth',
  'utah hockey club': 'utah mammoth',
}

const TABLES: Record<'NBA' | 'NHL' | 'MLB', Table> = {
  NBA: COPY_LEAGUE_NBA_TEAMS,
  NHL: COPY_LEAGUE_NHL_TEAMS,
  MLB: COPY_LEAGUE_MLB_TEAMS,
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '')

const INDEX = new Map<string, Map<string, string>>()
function indexFor(sport: 'NBA' | 'NHL' | 'MLB'): Map<string, string> {
  let idx = INDEX.get(sport)
  if (idx) return idx
  idx = new Map()
  for (const team of TABLES[sport]) {
    const key = NAME_ALIASES[norm(team.name)] ?? norm(team.name)
    idx.set(key, key)
    idx.set(norm(team.name), key)
    idx.set(team.code.toLowerCase(), key)
    for (const alt of ALIASES[sport][team.code] ?? []) idx.set(alt.toLowerCase(), key)
  }
  for (const [from, to] of Object.entries(NAME_ALIASES)) if (idx.has(to)) idx.set(from, to)
  INDEX.set(sport, idx)
  return idx
}

export function scheduleSport(sport: string | null | undefined): 'NBA' | 'NHL' | 'MLB' | null {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NBA' || s === 'NHL' || s === 'MLB' ? s : null
}

/** The team's full name, lower-cased; null when the sport has no table or the team is unknown. */
export function proTeamKey(sport: string | null | undefined, team: string | null | undefined): string | null {
  const s = scheduleSport(sport)
  if (!s || !team) return null
  const raw = norm(team)
  return raw ? indexFor(s).get(raw) ?? null : null
}

/** The table's short code for a key, for "vs BOS". */
export function proTeamShortCode(sport: string | null | undefined, key: string | null | undefined): string | null {
  const s = scheduleSport(sport)
  if (!s || !key) return null
  const hit = TABLES[s].find((t) => (NAME_ALIASES[norm(t.name)] ?? norm(t.name)) === key)
  return hit?.code ?? null
}
