import { prisma } from '@/lib/prisma'
import { findSportsPlayersByLeagueIds } from '@/lib/player-identity/findSportsPlayerByLeagueId'

export type PlayerStatusUpdate = {
  playerId: string
  playerName: string
  sport: string
  newStatus: string
  source: string
  detectedAt: Date
  gameStartsAt?: Date
}

function sportKey(sport: string): string {
  return sport.trim().toUpperCase()
}

/** True if any game for this sport on the given calendar day (US Eastern) has kickoff in the past. */
export async function isGameSlateStarted(sport: string, slateDate: string): Promise<boolean> {
  const sk = sportKey(sport)
  const d = new Date(`${slateDate}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return false

  const start = new Date(d)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  const now = new Date()
  const games = await prisma.sportsGame.findMany({
    where: {
      sport: sk,
      startTime: { gte: start, lt: end },
    },
    select: { startTime: true },
    take: 200,
  })

  for (const g of games) {
    if (g.startTime && g.startTime < now) return true
  }
  return false
}

/** YYYY-MM-DD in UTC from Date */
export function toSlateDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Latest injury/status rows from `SportsPlayer` for the given external IDs.
 * Optional Sleeper confirmation can be layered on later; DB is the hot path for cron.
 */
export async function fetchLatestPlayerStatuses(
  sport: string,
  playerIds: string[]
): Promise<PlayerStatusUpdate[]> {
  if (playerIds.length === 0) return []
  const sk = sportKey(sport)
  /*
   * ⚠ `playerIds` ARE ROSTER IDS, SO SLEEPER IDS, AND THE ROW CARRIES `status`.
   * Matched against `externalId` these hit Rolling Insights rows for other players, so the cron
   * reported one player's injury under another's id. Resolved through the Sleeper space first.
   */
  const byLeagueId = await findSportsPlayersByLeagueIds(sk, playerIds)
  const out: PlayerStatusUpdate[] = []
  for (const [leagueId, r] of byLeagueId) {
    const st = (r.status ?? '').trim()
    if (!st) continue
    out.push({
      // The id the caller asked with, not the provider id of the row we matched — the caller
      // reads this back against its own roster.
      playerId: leagueId,
      playerName: r.name,
      sport: r.sport,
      newStatus: st,
      source: 'sports_player_db',
      detectedAt: r.updatedAt ?? new Date(),
    })
  }
  return out
}
