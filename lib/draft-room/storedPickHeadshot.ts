/**
 * Server-side photo for a pick that arrived without one.
 *
 * Only a manager's own pick carries the card's photo (the client sends it). Every auto, AI,
 * orphan and expired-clock pick reaches `submitPick` with none, so outside the NFL those picks
 * were saved with a null `playerImageUrl` and the board showed initials. In a zombie league that
 * is nearly every pick. Measured on production 2026-10-29: all NBA picks in the last ten days had
 * a null image while `SportsPlayer` held a photo for each of the players.
 *
 * NFL is left alone on purpose: its board already derives a Sleeper headshot from the verified
 * Sleeper id, and an NFL `playerId` is never a Rolling Insights id.
 */

import { prisma } from '@/lib/prisma'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'

export type StoredPickHeadshotInput = {
  sport: string | null | undefined
  playerId: string | null | undefined
  playerName: string
  team: string | null | undefined
}

type PhotoRow = {
  externalId: string
  source: string
  name: string
  team: string | null
  imageUrl: string | null
}

function teamKey(team: string | null | undefined): string {
  return String(team ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Pick the photo from candidate rows, or null when the answer is not certain.
 *
 * 1. The Rolling Insights row whose id is the pick's id, when its name is the pick's name.
 * 2. Otherwise rows with the pick's name: one distinct photo wins; several are narrowed by team,
 *    and a name still shared by two different photos gets none - a missing face is a gap, a
 *    stranger's face is a false statement.
 */
export function chooseStoredPickHeadshot(input: StoredPickHeadshotInput, rows: PhotoRow[]): string | null {
  const name = canonicalName(input.playerName)
  if (!name) return null
  const named = rows.filter(
    (r) => canonicalName(r.name) === name && classifyAvatarSource(r.imageUrl) === 'headshot',
  )
  const pid = String(input.playerId ?? '').trim()
  if (pid) {
    const byId = named.find((r) => r.source === 'rolling_insights' && r.externalId === pid)
    if (byId?.imageUrl) return byId.imageUrl.trim()
  }
  const distinct = (list: PhotoRow[]) => [...new Set(list.map((r) => r.imageUrl!.trim()))]
  const all = distinct(named)
  if (all.length === 1) return all[0]!
  const team = teamKey(input.team)
  if (!team) return null
  const onTeam = distinct(named.filter((r) => teamKey(r.team) === team))
  return onTeam.length === 1 ? onTeam[0]! : null
}

export async function resolveStoredPickHeadshot(
  input: StoredPickHeadshotInput & { leagueId?: string | null },
): Promise<string | null> {
  const name = input.playerName.trim()
  if (!name) return null
  const pid = String(input.playerId ?? '').trim()
  try {
    // Older sessions carry no sportType; the league knows.
    let sport = String(input.sport ?? '').trim().toUpperCase()
    if (!sport && input.leagueId) {
      const league = await prisma.league.findUnique({ where: { id: input.leagueId }, select: { sport: true } })
      sport = String(league?.sport ?? '').trim().toUpperCase()
    }
    if (!sport || sport === 'NFL') return null
    const rows = await prisma.sportsPlayer.findMany({
      where: {
        sport,
        imageUrl: { not: null },
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          ...(pid ? [{ externalId: pid, source: 'rolling_insights' }] : []),
        ],
      },
      select: { externalId: true, source: true, name: true, team: true, imageUrl: true },
      take: 50,
    })
    return chooseStoredPickHeadshot(input, rows)
  } catch {
    // A photo is decoration; a lookup failure must never fail the pick.
    return null
  }
}
