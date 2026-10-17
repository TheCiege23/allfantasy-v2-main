/**
 * Resolve headshots for Start A vs B UI.
 *
 * 🛑 NO PHOTO BEATS THE WRONG PHOTO. This used to bind by NAME, trying `team equals
 * args.team` first — but the engine's team is a code ("BUF") while `SportsPlayer.team` is
 * a display name ("Buffalo Bills"), so that branch never matched and the name-only
 * fallback took the newest "Josh Allen" row: retired guard Josh Allen (Sleeper 2212),
 * whose Sleeper row is refreshed most often. Every Start A vs B card with QB Josh Allen
 * showed the guard's photo.
 *
 * Now: a Sleeper id, when the caller has one, resolves through that id's authoritative
 * row. Otherwise every candidate athlete answering to the name is collapsed to ONE row per
 * Sleeper id (lib/player-match/authoritativePlayerRow.ts), team is folded through
 * `normalizeTeamAbbrev` on BOTH sides, and the bind must survive `resolveVerifiedMatch` —
 * position, then team — or it is refused.
 */

import { toImageUrl } from '@/lib/media/imageUrl'
import { prisma } from '@/lib/prisma'
import { buildPlayerMedia } from '@/lib/player-media'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import {
  authoritativeRowsBySleeperId,
  positionGroupsAgree,
  selectAuthoritativePlayerRow,
} from '@/lib/player-match/authoritativePlayerRow'

const SLEEPER_THUMB = 'https://sleepercdn.com/content/nfl/players/thumb'
const FOOTBALL = new Set(['NFL', 'NCAAF'])

function sleeperThumb(sleeperId: string): string {
  return `${SLEEPER_THUMB}/${sleeperId}.jpg`
}

type HeadshotRow = {
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  sleeperId: string | null
  source: string
  fetchedAt: Date
}

const ROW_SELECT = {
  name: true,
  position: true,
  team: true,
  imageUrl: true,
  sleeperId: true,
  source: true,
  fetchedAt: true,
} as const

export interface StartVsDisplayPlayer {
  name: string
  team: string | null
  position?: string | null
  sleeperId?: string | null
}

/** Pick the one row this display player is, or null when it cannot be told apart. */
async function findPlayerRow(sportKey: string, args: StartVsDisplayPlayer): Promise<HeadshotRow | null> {
  const sleeperId = args.sleeperId?.trim()
  if (sleeperId) {
    const rows: HeadshotRow[] = await prisma.sportsPlayer.findMany({
      where: { sport: sportKey, sleeperId: { equals: sleeperId, mode: 'insensitive' } },
      select: ROW_SELECT,
      orderBy: { fetchedAt: 'desc' },
    })
    const picked = selectAuthoritativePlayerRow(rows)?.row
    if (picked) return picked
  }

  const name = args.name.trim()
  if (!name) return null
  const rows: HeadshotRow[] = await prisma.sportsPlayer.findMany({
    where: { sport: sportKey, name: { equals: name, mode: 'insensitive' } },
    select: ROW_SELECT,
    orderBy: { fetchedAt: 'desc' },
    take: 50,
  })

  // One candidate per athlete. Rows with no Sleeper id are only candidates when no row
  // has one — otherwise they are duplicates of an id'd athlete and would make every
  // lookup look ambiguous.
  const byId = [...authoritativeRowsBySleeperId(rows).values()]
  const pool = byId.length > 0 ? byId : rows
  const candidates = pool.map((row) => ({ ...row, team: normalizeTeamAbbrev(row.team), original: row }))

  const result = resolveVerifiedMatch(
    buildNameIndex(candidates),
    { name, position: args.position ?? null, team: normalizeTeamAbbrev(args.team) },
    // The name index is the whole catalog for this name, but a lone row that names a
    // different club or side of the ball is still someone else.
    { refuseContradictedSingle: true },
  )
  const match = result.match
  if (!match) return null
  // `resolveVerifiedMatch` only knows side of the ball, so a lone retired G would still
  // pass for a QB. In football, a stated position from another group is someone else.
  if (
    FOOTBALL.has(sportKey) &&
    args.position &&
    match.position &&
    !positionGroupsAgree(args.position, match.position)
  ) {
    return null
  }
  return match.original
}


async function lookupHeadshot(args: StartVsDisplayPlayer & { sport: string }): Promise<{
  headshotUrl: string | null
  teamLogoUrl: string | null
}> {
  const sport = normalizeToSupportedSport(args.sport)
  const sportKey = sport.toUpperCase()

  try {
    const row = await findPlayerRow(sportKey, args)

    const headshotUrl =
      toImageUrl(row?.imageUrl) ||
      (row?.sleeperId ? sleeperThumb(row.sleeperId) : null) ||
      null

    const media = buildPlayerMedia(row?.sleeperId ?? null, row?.team ?? args.team, sport)
    return {
      headshotUrl,
      teamLogoUrl: media.teamLogoUrl,
    }
  } catch {
    const media = buildPlayerMedia(null, args.team, sport)
    return { headshotUrl: null, teamLogoUrl: media.teamLogoUrl }
  }
}

export async function resolveStartVsDisplayMedia(args: {
  sport: string
  playerA: StartVsDisplayPlayer
  playerB: StartVsDisplayPlayer
}): Promise<{
  playerA: { headshotUrl: string | null; teamLogoUrl: string | null }
  playerB: { headshotUrl: string | null; teamLogoUrl: string | null }
}> {
  const [playerA, playerB] = await Promise.all([
    lookupHeadshot({ sport: args.sport, ...args.playerA }),
    lookupHeadshot({ sport: args.sport, ...args.playerB }),
  ])
  return { playerA, playerB }
}
