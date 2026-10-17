import { resolveCollegeTeam, type CollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIdentity'
import { resolveFantraxCollegeTeam } from '@/lib/sport-teams/fantraxCollegeTeam'
import { buildNextGameMap, type FixtureRow, type NextGameCandidate } from './nextGameMap'

/**
 * This week's fixture for each college team a roster names, joined through the CFBD
 * team directory rather than the NFL fold.
 *
 * 🛑 COLLEGE STARTERS HAD NO GAME AT ALL. My Team joins players to fixtures on the
 * club string, folded by `normalizeTeamAbbrev`. That fold is NFL-only, and college
 * rosters never reached it anyway: measured on production 2026-09-30, the one college
 * league is on Fantrax, its 465 roster ids are Fantrax's own, and the Fantrax branch of
 * `resolvePlayers` hard-coded `gameContext: null, kickoff: null`. No opponent, no
 * kickoff, no lineup lock and no weather for any college starter.
 *
 * The two sides also spell teams differently. The same measurement found the week's 549
 * NCAAF game rows in four conventions at once — `MISSISSIPPI STATE` (api_sports),
 * `Rutgers` (cfbd), `UNLV` (thesportsdb), `LSU Tigers` (espn) — while a Fantrax player
 * carries a CFBD school name or a Fantrax code (`wisc`). So BOTH sides go through the
 * directory, and the join key is the canonical CFBD `school`.
 *
 * ⚠ AN UNRESOLVED OR AMBIGUOUS NAME JOINS NOTHING. The directory drops any alias two
 * teams claim ("San Diego" vs "San Diego State"), and this inherits that: a player whose
 * school cannot be named keeps a null fixture rather than borrowing a stranger's game.
 */
export type CollegeFixture = NextGameCandidate & {
  /** The player's team as the directory names it — the left side of `gameContext`. */
  team: string
}

export function collegeFixturesByPlayerTeam(
  games: readonly FixtureRow[],
  playerTeams: Iterable<string>,
  index: CollegeTeamIndex,
): Map<string, CollegeFixture> {
  /*
   * The player side goes through the Fantrax resolver, which knows Fantrax's short
   * codes and falls through to the plain directory lookup for anything else, so an
   * already-resolved school name ("Wisconsin") still lands on the same record.
   */
  const keyByPlayerTeam = new Map<string, string>()
  for (const raw of playerTeams) {
    const school = resolveFantraxCollegeTeam(raw, index)?.school
    if (school) keyByPlayerTeam.set(raw, school)
  }
  if (keyByPlayerTeam.size === 0) return new Map()

  // Feed strings go through the plain directory only: Fantrax's short codes are
  // scoped to Fantrax on purpose, so they cannot collide with a feed's abbreviation.
  const fold = (team: string | null) => resolveCollegeTeam(team, index)?.school ?? null
  const bySchool = buildNextGameMap(games, new Set(keyByPlayerTeam.values()), fold)

  const out = new Map<string, CollegeFixture>()
  for (const [raw, school] of keyByPlayerTeam) {
    const fixture = bySchool.get(school)
    if (fixture) out.set(raw, { ...fixture, team: school })
  }
  return out
}
