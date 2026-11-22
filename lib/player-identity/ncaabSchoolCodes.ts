/**
 * College basketball school codes -> schools, with the code collisions in `SportsTeam` resolved.
 *
 * 🛑 A CODE IS NOT A SCHOOL IN THIS TABLE. Measured on production 2026-11-20, seven NCAAB short codes carry
 * two rows, and they fail in two different ways:
 *
 *   one school, two rows   NOVA  Villanova (TheSportsDB) / Villanova University (Rolling Insights)
 *                          UALR  Arkansas-Little Rock / University of Arkansas at Little Rock
 *                          UWG   West Georgia / University of West Georgia
 *                          UMKC  University of Missouri-Kansas City / …Missouri–Kansas City (two RI ids, hyphen vs en dash)
 *                          RGV   UT Rio Grande Valley / UT Rio Grande Valley Vaqueros (both TheSportsDB)
 *   two schools, one code  MER   Mercer University (RI 285) / Merrimack College (RI 354)
 *                          UNH   University of New Hampshire (RI 7) / University of New Haven (RI 369)
 *
 * Read naively (code -> set of names, ambiguous when the set has two), every one of the seven reads as
 * ambiguous, so their players can never be placed: the Fantrax identity matcher and the current-appearance
 * school learner both dropped them. The fix is in how a code is READ, not in the rows — TheSportsDB's ingest
 * recreates its rows, and the MER/UNH collisions are Rolling Insights' own abbreviations.
 *
 *   - Within a code, Rolling Insights rows win: the registry's `currentTeam` is written in RI's naming.
 *   - Names that differ only in dash style, case or spacing are one school (`schoolKey`).
 *   - A code that still names two schools is resolved per GAME: a Rolling Insights game id is
 *     `YYYYMMDD-<teamId>-<teamId>`, so the school is the one RI team in that game carrying the code.
 *     Measured: every MER/UNH appearance row's game names exactly one of the two schools.
 */

export type NcaabTeamRow = { name: string; shortName: string | null; source?: string | null; externalId?: string | null }

/** One school however its name is punctuated: case, spacing, and the hyphen / en dash / em dash family. */
export function schoolKey(value: string | null | undefined): string {
  return String(value ?? '').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toUpperCase()
}

const codeKey = (value: string | null | undefined) => String(value ?? '').trim().toUpperCase()

export type NcaabSchoolIndex = {
  /** Code -> the distinct schools it can mean (one, or more when the code itself is shared). */
  byCode: ReadonlyMap<string, ReadonlySet<string>>
  /** Rolling Insights team id -> its code and school, for per-game resolution. */
  riTeams: ReadonlyMap<string, { code: string; school: string }>
}

export function buildNcaabSchoolIndex(rows: readonly NcaabTeamRow[]): NcaabSchoolIndex {
  const groups = new Map<string, NcaabTeamRow[]>()
  const riTeams = new Map<string, { code: string; school: string }>()
  for (const row of rows) {
    const code = codeKey(row.shortName)
    if (!code) continue
    groups.set(code, [...(groups.get(code) ?? []), row])
    if (row.source === 'rolling_insights' && row.externalId) riTeams.set(String(row.externalId), { code, school: schoolKey(row.name) })
  }
  const byCode = new Map<string, Set<string>>()
  for (const [code, group] of groups) {
    const ri = group.filter((row) => row.source === 'rolling_insights')
    byCode.set(code, new Set((ri.length ? ri : group).map((row) => schoolKey(row.name))))
  }
  return { byCode, riTeams }
}

/** The one school a code names, or '' when it names none or several (resolve those per game). */
export function schoolForCode(index: NcaabSchoolIndex, code: string | null | undefined): string {
  const schools = index.byCode.get(codeKey(code))
  return schools?.size === 1 ? [...schools][0]! : ''
}

/** The school a box-score row was played for: by code, else by the one RI team in its game holding the code. */
export function schoolForAppearance(index: NcaabSchoolIndex, team: string | null | undefined, gameId?: string | null): string {
  const direct = schoolForCode(index, team)
  if (direct) return direct
  const schools = index.byCode.get(codeKey(team))
  if (!schools?.size || !gameId) return ''
  const hits = new Set<string>()
  for (const id of String(gameId).split('-').slice(1)) {
    const teamRow = index.riTeams.get(id)
    if (teamRow && teamRow.code === codeKey(team) && schools.has(teamRow.school)) hits.add(teamRow.school)
  }
  return hits.size === 1 ? [...hits][0]! : ''
}
