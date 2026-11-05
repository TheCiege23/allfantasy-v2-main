/**
 * The ONE batched read behind the dynasty age / rookie / prospect markers, for every screen that shows
 * them (My Team, the Waivers "Worth adding" board, Player Finder results). The rules live in the pure
 * builder (./dynastyRosterMarkers.ts); this only fetches the rows it needs, in a single query.
 *
 * ⚠ ONE QUERY PER SCREEN, NEVER PER ROW. Every player on the screen goes into one `findMany`. A college
 * prospect's own rows live under the college sport (an NCAAF row for an NFL devy league's prospect), so
 * when there are prospects the same query also asks that sport for THEIR ids — an `OR`, not a second
 * read. The builder still matches every row on id AND normalised name, so a widened read cannot attach
 * another player's age.
 *
 * Postgres only (`SportsPlayer`): no provider is called here or anywhere on these paths.
 */
import type { PrismaClient } from '@prisma/client'
import {
  buildDynastyRosterMarkers,
  collegeSportFor,
  isCollegeProspect,
  isDevyFormatLeague,
  markerKeyFor,
  type DynastyRosterMarker,
  type MarkerPlayer,
  type MarkerRow,
} from './dynastyRosterMarkers'

type SportsPlayerReader = Pick<PrismaClient, 'sportsPlayer'>

export async function readDynastyMarkers(
  db: SportsPlayerReader,
  input: {
    /** The league's sport — the rows' sport, and the aging table the tones read. */
    sport: string | null | undefined
    players: readonly MarkerPlayer[]
    /** College prospects among `players` (devy / C2C leagues only). */
    prospectIds?: ReadonlySet<string> | null
  },
): Promise<Record<string, DynastyRosterMarker> | null> {
  const players = [...new Map(input.players.filter((p) => p.sleeperId).map((p) => [p.sleeperId, p])).values()]
  if (players.length === 0) return null
  const sport = String(input.sport ?? 'NFL').trim().toUpperCase() || 'NFL'
  const ids = players.map((p) => p.sleeperId)
  const prospectIds = input.prospectIds && input.prospectIds.size > 0 ? ids.filter((id) => input.prospectIds!.has(id)) : []
  const college = prospectIds.length > 0 ? collegeSportFor(sport) : null
  const rows: MarkerRow[] = await db.sportsPlayer.findMany({
    where: college
      ? { OR: [{ sport, sleeperId: { in: ids } }, { sport: college, sleeperId: { in: prospectIds } }] }
      : { sport, sleeperId: { in: ids } },
    select: { sleeperId: true, name: true, position: true, age: true, yearsExp: true },
  })
  return buildDynastyRosterMarkers(players, rows, sport, { prospectIds: input.prospectIds ?? null })
}

/**
 * Player Finder results inside a held dynasty league: one read for every match.
 *
 * A match of the league's sport with a Sleeper id is marked from its sport's rows (age, ROOKIE). In a
 * devy / C2C league a match of the league's COLLEGE sport is a prospect (`isCollegeProspect`) and is
 * looked up by its own catalog id, since a college player has no Sleeper id. Both halves are one
 * `findMany` (an `OR`), and every marker is filed under `markerKeyFor(match)`.
 */
export async function readFinderDynastyMarkers(
  db: SportsPlayerReader,
  input: {
    league: { sport?: string | null; leagueVariant?: string | null; leagueType?: string | null }
    matches: ReadonlyArray<{ sleeperId: string | null; externalId: string; sport: string; name: string; position: string | null }>
  },
): Promise<Record<string, DynastyRosterMarker> | null> {
  const sport = String(input.league.sport ?? 'NFL').trim().toUpperCase() || 'NFL'
  const pro = input.matches.filter((m) => m.sleeperId && String(m.sport).toUpperCase() === sport)
  const college = isDevyFormatLeague(input.league) ? input.matches.filter((m) => isCollegeProspect(m.sport, sport)) : []
  if (pro.length === 0 && college.length === 0) return null
  const collegeSport = collegeSportFor(sport)
  const or = [
    ...(pro.length ? [{ sport, sleeperId: { in: pro.map((m) => m.sleeperId!) } }] : []),
    ...(college.length && collegeSport ? [{ sport: collegeSport, externalId: { in: college.map((m) => m.externalId) } }] : []),
  ]
  const raw = await db.sportsPlayer.findMany({
    where: or.length === 1 ? or[0] : { OR: or },
    select: { sleeperId: true, externalId: true, sport: true, name: true, position: true, age: true, yearsExp: true },
  })
  const rows: MarkerRow[] = raw.map((r) => ({
    ...r,
    // A pro row is filed under its Sleeper id; a college row under its own sport-qualified id.
    sleeperId: String(r.sport).toUpperCase() === sport ? r.sleeperId : markerKeyFor({ sport: r.sport, externalId: r.externalId }),
  }))
  const players: MarkerPlayer[] = [...pro, ...college].map((m) => ({ sleeperId: markerKeyFor(m), name: m.name, position: m.position }))
  return buildDynastyRosterMarkers(players, rows, sport, { prospectIds: new Set(college.map((m) => markerKeyFor(m))) })
}
