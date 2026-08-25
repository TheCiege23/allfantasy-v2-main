import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Which real-world week a roster screen should be showing.
 *
 * ⚠ THE BUG THIS EXISTS FOR. My Team picked each player's next game as "the
 * earliest game whose startTime is in the future", ignoring season and week
 * entirely. On a production account that resolved to a game in late NOVEMBER
 * and the lineup-lock banner counted down to it — 2,321 hours, rendered as
 * hours because the countdown had no day component either. Both halves were
 * wrong: the wrong game, formatted wrongly.
 *
 * "Earliest future game" is only the right answer when the schedule table is
 * complete. It is not: ingestion is partial, and a gap anywhere between today
 * and the end of the season silently moves the answer months out. Nothing about
 * the result looks wrong — it is a real game, at a real time.
 *
 * The rule here is the week of the earliest future REGULAR-season game. That is
 * self-correcting through the season without a calendar: after Sunday's games
 * it is still this week because Monday night has not kicked off; after Monday
 * night it rolls to next week's Thursday on its own. And it cannot drift into
 * November unless November really is the next thing on the schedule — in which
 * case the gap is in the data and `coverage` says so rather than the screen
 * quietly counting down to it.
 */

/** The vocabulary this repo writes. Rolling Insights sends `season_type`. */
const REGULAR = 'regular'

export type SportsWeek = {
  season: number
  week: number
  /**
   * The season type of the week this resolved to.
   *
   * ⚠ CALLERS MUST FILTER ON THIS. `season + week` is NOT a unique key —
   * preseason week 1 and regular-season week 1 of the same year are the same
   * pair, and the schema says so in as many words. A lookup without it returns
   * both and takes whichever kicks off first, which in August is always the
   * exhibition game. That is how a lineup lock ended up reading "Locked" against
   * a date in the middle of the preseason.
   */
  seasonType: string
  /** Kickoff of the first game of that week. The honest lineup-lock anchor. */
  firstKickoff: Date
  /**
   * True when a PRESEASON game kicks off before this week's first regular game.
   *
   * The screen needs this to answer "is the game I'm looking at exhibition or
   * real", which changes whether a projection means anything at all.
   */
  preseasonFirst: boolean
  /**
   * How far ahead the schedule actually reaches, in days. A small number here
   * with a distant `firstKickoff` is the signature of partial ingestion, and
   * the caller should say so rather than present the week as settled.
   */
  daysUntilFirstKickoff: number
}

function normaliseType(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * Is this row a regular-season game?
 *
 * Written as a predicate over several spellings on purpose. `seasonType` is
 * nullable and arrives from more than one provider path, so matching only the
 * exact string this repo happens to write today would make the whole resolver
 * return nothing the day an importer writes "REG" instead.
 */
export function isRegularSeason(seasonType: string | null | undefined): boolean {
  const t = normaliseType(seasonType)
  return t === REGULAR || t === 'reg' || t === 'regular_season' || t === 'regularseason'
}

export function isPreseason(seasonType: string | null | undefined): boolean {
  const t = normaliseType(seasonType)
  return t === 'preseason' || t === 'pre' || t === 'pre_season' || t === 'exhibition'
}

/**
 * Resolve the upcoming week for a sport, or null when the schedule cannot
 * answer.
 *
 * Null is a real outcome and must be rendered as one. It means the games table
 * holds no future regular-season row — either the season is over or nothing has
 * been ingested — and both are better said out loud than papered over with the
 * nearest row that happens to exist.
 */
export async function resolveSportsWeek(
  sport: string,
  now: Date = new Date(),
): Promise<SportsWeek | null> {
  /*
   * A small grace window, so a game that kicked off in the last few hours still
   * counts as "the current week" rather than rolling the screen forward while
   * the user's players are on the field.
   */
  const from = new Date(now.getTime() - 6 * 3600 * 1000)

  const next = await prisma.sportsGame
    .findFirst({
      where: { sport, startTime: { gte: from }, season: { not: null }, week: { not: null } },
      orderBy: { startTime: 'asc' },
      select: { season: true, week: true, seasonType: true, startTime: true },
    })
    .catch(() => null)

  if (!next?.startTime || next.season == null || next.week == null) return null

  /*
   * The earliest future game may itself be preseason — which it is right now,
   * in August. Take the earliest future REGULAR game as the anchor and record
   * that an exhibition game comes first, rather than pretending August is
   * week 1 or hiding the preseason game the user can plainly see.
   */
  const anchor = isRegularSeason(next.seasonType)
    ? next
    : await prisma.sportsGame
        .findFirst({
          where: {
            sport,
            startTime: { gte: from },
            season: { not: null },
            week: { not: null },
            seasonType: { in: [REGULAR, 'REG', 'reg', 'Regular', 'regular_season'] },
          },
          orderBy: { startTime: 'asc' },
          select: { season: true, week: true, seasonType: true, startTime: true },
        })
        .catch(() => null)

  if (!anchor?.startTime || anchor.season == null || anchor.week == null) return null

  // The first kickoff OF THAT WEEK, which is not necessarily the row we found:
  // the anchor is the next game from now, and by Sunday that is no longer the
  // week's opener.
  const opener = await prisma.sportsGame
    .findFirst({
      where: {
        sport,
        season: anchor.season,
        week: anchor.week,
        // Same collision: without this the "opener" can be a preseason kickoff.
        seasonType: anchor.seasonType,
        startTime: { not: null },
      },
      orderBy: { startTime: 'asc' },
      select: { startTime: true },
    })
    .catch(() => null)

  const firstKickoff = opener?.startTime ?? anchor.startTime

  return {
    season: anchor.season,
    week: anchor.week,
    seasonType: anchor.seasonType ?? REGULAR,
    firstKickoff,
    preseasonFirst: !isRegularSeason(next.seasonType) && next.startTime < firstKickoff,
    daysUntilFirstKickoff: Math.round(
      (firstKickoff.getTime() - now.getTime()) / 86_400_000,
    ),
  }
}
