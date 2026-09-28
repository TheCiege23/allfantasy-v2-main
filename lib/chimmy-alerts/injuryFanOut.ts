import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueCall } from '@/lib/core-app/leagueCall'
import { lineupFixLink, type LinkLeague } from '@/lib/core-app/platformLinks'
import { weekKickoffs } from '@/lib/core-app/playerGame'
import { getPlayerImpact } from '@/lib/core-app/playerImpact'
import { resolveSportsWeek } from '@/lib/core-app/sportsWeek'
import type { FanOutAlert, FanOutLeague } from './injuryFanOutCopy'

/**
 * The per-league facts for one injured player's fan-out: the backup to start in each league, and
 * where to make the change.
 *
 * ⚠ THE BACKUP IS THE PLAYER FINDER'S, NOT A SECOND GUESS. The sweep used to name "a bench player at
 * the same position" ranked on a generic projection — no league scoring, no flex or superflex, so a
 * WR hole could never be filled by the RB who actually outscores him there. `getPlayerImpact` +
 * `leagueCall` are the finder's league-scored, slot-eligible, lock- and injury-aware picker (#1404),
 * so the alert and the card say the same thing.
 *
 * ⚠ THE LINK IS A VERIFIED ONE OR NOTHING. `verifiedHandoff` lands on the platform's lineup screen
 * or returns null (MFL / Fantrax / Fleaflicker cannot be deep-linked from stored fields); a native
 * league's is the in-app team tab. A button that promises "your lineup" and opens a homepage is
 * worse than none.
 *
 * Bounded: ONE impact read per player (it covers all his leagues), only for the player about to be
 * sent, under a time cap. Anything that fails or runs long falls back to the hydrate's own backup
 * name, and the sweep still sends.
 */

const IMPACT_TIMEOUT_MS = 8_000

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The lineup screen to fix it on — the one rule, shared with the finder's per-league calls. */
export function fixLinkFor(league: LinkLeague): { href: string; label: string } | null {
  const link = lineupFixLink(league)
  return link ? { href: link.href, label: link.label } : null
}

export async function buildFanOutLeagues(userId: string, group: readonly FanOutAlert[], now: Date = new Date()): Promise<FanOutLeague[]> {
  const leagueIds = [...new Set(group.map((a) => a.leagueId).filter((id): id is string => Boolean(id)))]
  if (leagueIds.length === 0) return []

  const [leagues, teams] = await Promise.all([
    prisma.league.findMany({
      where: { id: { in: leagueIds } },
      select: { id: true, name: true, platform: true, platformLeagueId: true, season: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: leagueIds }, claimedByUserId: userId },
      select: { leagueId: true, externalId: true },
    }),
  ])
  const teamIdByLeague = new Map(teams.map((t) => [t.leagueId, t.externalId]))

  // The league-scored backup per league, from the finder's picker. Only for a player with a Sleeper
  // id in the NFL — the picker is keyed on it; anything else keeps the hydrate's name.
  const top = group[0]!
  const sleeperId = str(top.metadata?.sleeperId)
  const sport = str(top.metadata?.sport)
  const name = str(top.metadata?.playerName) ?? top.title.split(' is ')[0] ?? ''
  const startByLeague = new Map<string, string | null>()
  if (sleeperId && (sport == null || sport.toUpperCase() === 'NFL')) {
    const picked = await withTimeout(
      (async () => {
        const [impacts, player, week] = await Promise.all([
          getPlayerImpact(sleeperId, userId, { leagueIds }),
          prisma.sportsPlayer.findFirst({ where: { sleeperId }, select: { team: true } }).catch(() => null),
          resolveSportsWeek('NFL').catch(() => null),
        ])
        const games = week
          ? await prisma.sportsGame
              .findMany({
                where: { sport: 'NFL', season: week.season, week: week.week, seasonType: week.seasonType },
                select: { homeTeam: true, awayTeam: true, startTime: true, seasonType: true, venue: true },
                take: 400,
              })
              .catch(() => [])
          : []
        const kickoffs = weekKickoffs(games)
        const out = new Map<string, string | null>()
        for (const impact of impacts) {
          if (!impact.isStarting) continue
          // 'bad' asks the picker for the swap; the alert writes its own sentence from the real designation.
          const call = leagueCall({ impact, player: { sleeperId, name, team: player?.team ?? null }, readinessTone: 'bad', kickoffs, nowIso: now.toISOString() })
          out.set(impact.leagueId, call.swap?.startName ?? null)
        }
        return out
      })().catch(() => null),
      IMPACT_TIMEOUT_MS,
    )
    if (picked) for (const [k, v] of picked) startByLeague.set(k, v)
  }

  const byId = new Map(leagues.map((l) => [l.id, l]))
  const out: FanOutLeague[] = []
  for (const a of group) {
    const l = a.leagueId ? byId.get(a.leagueId) : undefined
    if (!l) continue
    const fallback = (a.metadata?.replacement as { playerName?: unknown } | null | undefined)?.playerName
    const startName = startByLeague.has(l.id) ? startByLeague.get(l.id)! : str(fallback)
    const fix = fixLinkFor({ id: l.id, platform: l.platform, platformLeagueId: l.platformLeagueId, season: l.season, name: l.name, teamId: teamIdByLeague.get(l.id) ?? null })
    out.push({ leagueId: l.id, leagueName: l.name ?? 'your league', startName, fixHref: fix?.href ?? null, fixLabel: fix?.label ?? null })
  }
  return out
}
