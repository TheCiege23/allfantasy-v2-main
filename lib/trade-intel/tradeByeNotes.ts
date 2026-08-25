import 'server-only'

import { prisma } from '@/lib/prisma'
import { getByeWeeks } from '@/lib/core-app/byeWeeks'
import { byeCollisionDelta, readSlotRequirements } from './rosterNeed'

/**
 * The bye-week sentence on a trade.
 *
 * ⚠ ADVISORY, AND IT DOES NOT TOUCH THE VERDICT. The console's own value maths
 * decides whether a trade is fair. This adds what the maths cannot see: that
 * the quarterback coming back is off the same week as the one you already have,
 * so the deal you are about to accept does not fix the hole it looks like it
 * fixes. The manager may take it anyway — two years of a player of that calibre
 * can be worth one unstartable Sunday — and that call is theirs to make on
 * purpose rather than by accident.
 *
 * Returns an empty array whenever anything it needs is missing. A trade screen
 * that guesses at bye collisions trains managers to ignore the warning, which
 * costs them the week it was actually about.
 */

/** Byes run into the teens, so the whole remaining season is in scope. */
const SEASON_HORIZON = 18

type Line = { name: string; position: string | null; team: string | null }

export async function buildTradeByeNotes(args: {
  leagueId: string
  userId: string
  /** Players leaving the viewer's roster. */
  give: Line[]
  /** Players arriving on the viewer's roster. */
  get: Line[]
}): Promise<string[]> {
  const { leagueId, userId, give, get } = args
  if (get.length === 0) return []

  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { id: true, starters: true, season: true, sport: true },
    })
    .catch(() => null)

  const requirements = readSlotRequirements(league?.starters)
  if (!league || !requirements || league.season == null) return []

  /*
   * The viewer's own roster in this league. Matched through LeagueTeam because
   * `Roster.platformUserId` is the PLATFORM's id for them, not ours — the same
   * two-id-space trap the scoreboard hit.
   */
  const team = await prisma.leagueTeam
    .findFirst({
      where: { leagueId, claimedByUserId: userId },
      select: { platformUserId: true, externalId: true },
    })
    .catch(() => null)
  if (!team?.platformUserId) return []

  const roster = await prisma.roster
    .findFirst({
      where: { leagueId, platformUserId: team.platformUserId },
      select: { playerData: true },
    })
    .catch(() => null)
  if (!roster) return []

  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  const rosterIds = Array.isArray(pd.players)
    ? pd.players.map((x) => String(x)).filter((x) => x && x !== '0')
    : []
  if (rosterIds.length === 0) return []

  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: rosterIds } },
      select: { sleeperId: true, position: true, team: true, name: true },
    })
    .catch(() => [])

  const byId = new Map(players.filter((p) => p.sleeperId).map((p) => [p.sleeperId as string, p]))

  /*
   * Byes are resolved from TEAMS, so incoming players ride along under synthetic
   * ids. They are not on any roster yet and have no sleeper id in this context.
   */
  const playerTeams = new Map<string, string | null>()
  for (const id of rosterIds) playerTeams.set(id, byId.get(id)?.team ?? null)
  get.forEach((g, i) => playerTeams.set(`in:${i}`, g.team ?? null))

  const byes = await getByeWeeks({
    sport: league.sport ?? 'NFL',
    season: league.season,
    playerTeams,
    // From the start of the season: a trade in week 2 still cares about week 11.
    fromWeek: 1,
    horizon: SEASON_HORIZON,
  }).catch(() => null)
  if (!byes) return []

  /** id -> the week they are off, inverted from the week-keyed map. */
  const byeOf = new Map<string, number>()
  for (const [week, ids] of byes.byWeek) for (const id of ids) byeOf.set(id, week)

  const rosterLines = rosterIds.map((id) => ({
    id,
    position: byId.get(id)?.position ?? '',
    byeWeek: byeOf.get(id) ?? null,
  }))

  /*
   * What is leaving, matched by name against the roster we just read. Names are
   * the only handle the console gives us; an unmatched give simply does not
   * count as outgoing, which errs toward reporting FEWER collisions.
   */
  const outgoingIds = give
    .map((g) => {
      const hit = players.find((p) => p.name?.toLowerCase() === g.name.toLowerCase())
      return hit?.sleeperId ?? null
    })
    .filter((x): x is string => Boolean(x))

  const notes: string[] = []
  get.forEach((g, i) => {
    const d = byeCollisionDelta({
      requirements,
      roster: rosterLines,
      incoming: { position: g.position, byeWeek: byeOf.get(`in:${i}`) ?? null },
      outgoingIds,
    })
    if (!d) return
    if (d.created.length > 0 || d.unrelieved.length > 0) {
      notes.push(`${g.name}: ${d.basis}`)
    }
  })

  return notes
}
