import { prisma } from '@/lib/prisma'

/**
 * The best game anyone on a roster had this week — the moment worth showing
 * back to a manager.
 *
 * ⚠ NOT GATED ON WINNING, DELIBERATELY. Losing managers are the ones who stop
 * opening the app. Gating the reward on a win hands the retention boost to the
 * people who least need it and shows a blank space to everyone who needs a
 * reason to come back. "Bijan went for 187 and 3 scores" softens a loss and is
 * a victory lap for a win — the same card, twice the surface.
 *
 * ⚠ THE VIDEO IS GARNISH, NOT THE FEATURE. TheSportsDB's `strVideo` is a
 * GAME-level highlight reel, not a cut of the player's own snaps — no provider
 * we have sells per-play video. So the card leads with the stat line, which we
 * own outright, and offers the game reel underneath. It has to read correctly
 * with `highlightUrl: null`, because a YouTube link can rot or be pulled and
 * the moment is still true without it.
 */

export type PlayerOfTheWeek = {
  playerId: string
  playerName: string
  team: string | null
  position: string | null
  fantasyPoints: number
  week: number
  season: number
  /** Pre-composed, e.g. "187 rushing yards, 3 TD". Empty when stats are thin. */
  statLine: string
  /** The game they played in, when we can identify it. */
  game: { externalId: string; homeTeam: string; awayTeam: string } | null
  /** Game highlight reel. Null is normal and must render. */
  highlightUrl: string | null
  /** False until the week's scores are final — label it as provisional. */
  isFinal: boolean
}

/** Turn a raw stat map into something a person reads. */
export function composeStatLine(stats: Record<string, unknown>): string {
  const n = (k: string): number => {
    const v = stats?.[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const parts: string[] = []

  const passYds = n('passing_yards')
  const passTd = n('passing_touchdowns')
  if (passYds) parts.push(`${Math.round(passYds)} passing yards`)
  if (passTd) parts.push(`${passTd} passing TD`)

  const rushYds = n('rushing_yards')
  const rushTd = n('rushing_touchdowns')
  if (rushYds) parts.push(`${Math.round(rushYds)} rushing yards`)
  if (rushTd) parts.push(`${rushTd} rushing TD`)

  const recYds = n('receiving_yards')
  const rec = n('receptions')
  const recTd = n('receiving_touchdowns')
  if (rec) parts.push(`${rec} rec`)
  if (recYds) parts.push(`${Math.round(recYds)} receiving yards`)
  if (recTd) parts.push(`${recTd} receiving TD`)

  // Defensive lines, for an IDP roster's best week.
  const sacks = n('idp_sack')
  const ints = n('idp_interception')
  const defTd = n('idp_defensive_touchdown')
  const tackles = n('idp_solo_tackle') + n('idp_assist_tackle')
  if (sacks) parts.push(`${sacks} sack${sacks > 1 ? 's' : ''}`)
  if (ints) parts.push(`${ints} INT`)
  if (tackles) parts.push(`${tackles} tackles`)
  if (defTd) parts.push(`${defTd} defensive TD`)

  return parts.join(', ')
}

/**
 * Find the highlight reel for a game.
 *
 * ⚠ RETURNS NULL FREELY. Highlights publish AFTER a game ends, TheSportsDB may
 * not carry every fixture, and a YouTube URL can be taken down. Every one of
 * those is a normal Tuesday, not an error — the caller renders the stat line
 * either way.
 */
async function highlightFor(gameExternalId: string | null): Promise<string | null> {
  if (!gameExternalId) return null
  try {
    const row = await prisma.sportsDataCache.findUnique({
      where: { cacheKey: `tsdb:highlight:${gameExternalId}` },
    })
    if (!row || row.expiresAt.getTime() < Date.now()) return null
    const url = (row.data as { url?: unknown } | null)?.url
    return typeof url === 'string' && url.startsWith('http') ? url : null
  } catch {
    return null
  }
}

/**
 * The standout performance on one roster for one week.
 *
 * Returns null rather than a placeholder when the roster has no scored player
 * yet — an empty state the caller can hide beats a card reading "0.0 pts",
 * which looks like a bug on a Tuesday morning.
 */
export async function playerOfTheWeekForRoster(opts: {
  rosterId: string
  week: number
  season: number
  sport?: string
}): Promise<PlayerOfTheWeek | null> {
  const sport = opts.sport ?? 'NFL'

  const roster = await prisma.redraftRosterPlayer
    .findMany({
      where: { rosterId: opts.rosterId, droppedAt: null },
      select: { playerId: true, playerName: true, position: true, team: true },
    })
    .catch(() => [])
  if (roster.length === 0) return null

  const scores = await prisma.playerWeeklyScore
    .findMany({
      where: {
        sport,
        week: opts.week,
        season: opts.season,
        playerId: { in: roster.map((r) => r.playerId) },
      },
      orderBy: { fantasyPts: 'desc' },
      take: 1,
    })
    .catch(() => [])

  const best = scores[0]
  // A roster whose best player scored nothing has no moment to show. Saying so
  // is better than celebrating a zero.
  if (!best || best.fantasyPts <= 0) return null

  const who = roster.find((r) => r.playerId === best.playerId)
  const stats = (best.stats ?? {}) as Record<string, unknown>

  /*
   * Find the game from the player's team. Matched on either side of the
   * fixture because a player's team is just as often the away side, and a
   * home-only match would silently drop half the league every week.
   */
  const game = who?.team
    ? await prisma.sportsGame
        .findFirst({
          where: {
            sport,
            week: opts.week,
            season: opts.season,
            OR: [{ homeTeam: who.team }, { awayTeam: who.team }],
          },
          select: { externalId: true, homeTeam: true, awayTeam: true },
        })
        .catch(() => null)
    : null

  return {
    playerId: best.playerId,
    playerName: who?.playerName ?? 'Unknown player',
    team: who?.team ?? null,
    position: who?.position ?? null,
    fantasyPoints: Math.round(best.fantasyPts * 10) / 10,
    week: opts.week,
    season: opts.season,
    statLine: composeStatLine(stats),
    game: game ? { externalId: game.externalId, homeTeam: game.homeTeam, awayTeam: game.awayTeam } : null,
    highlightUrl: await highlightFor(game?.externalId ?? null),
    isFinal: best.isFinalized,
  }
}
