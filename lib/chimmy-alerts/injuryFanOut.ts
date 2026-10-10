import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueCall } from '@/lib/core-app/leagueCall'
import { lineupFixLink, waiverClaimLink, type LinkLeague } from '@/lib/core-app/platformLinks'
import { weekKickoffs } from '@/lib/core-app/playerGame'
import { getPlayerImpact } from '@/lib/core-app/playerImpact'
import { resolveSportsWeek } from '@/lib/core-app/sportsWeek'
import type { FanOutAlert, FanOutLeague } from './injuryFanOutCopy'
import { pickFreeAgent, type FreeAgentPick } from './freeAgentFallback'

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
/** The free-agent fallback: at most this many leagues per player, inside this budget (one roster scan each). */
const FREE_AGENT_LEAGUE_CAP = 3
const FREE_AGENT_TIMEOUT_MS = 8_000

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
  const nfl = Boolean(sleeperId && (sport == null || sport.toUpperCase() === 'NFL'))
  // This week's kickoffs, read once: the bench picker's locks and the free-agent fallback's both.
  const kickoffs: Record<string, string> = nfl
    ? ((await withTimeout(
        (async () => {
          const week = await resolveSportsWeek('NFL').catch(() => null)
          if (!week) return {}
          const games = await prisma.sportsGame
            .findMany({
              where: { sport: 'NFL', season: week.season, week: week.week, seasonType: week.seasonType },
              select: { homeTeam: true, awayTeam: true, startTime: true, seasonType: true, venue: true },
              take: 400,
            })
            .catch(() => [])
          return weekKickoffs(games)
        })().catch(() => ({})),
        IMPACT_TIMEOUT_MS,
      )) ?? {})
    : {}
  if (nfl && sleeperId) {
    const picked = await withTimeout(
      (async () => {
        const [impacts, player] = await Promise.all([
          getPlayerImpact(sleeperId, userId, { leagueIds }),
          prisma.sportsPlayer.findFirst({ where: { sleeperId }, select: { team: true } }).catch(() => null),
        ])
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
    const link: LinkLeague = { id: l.id, platform: l.platform, platformLeagueId: l.platformLeagueId, season: l.season, name: l.name, teamId: teamIdByLeague.get(l.id) ?? null }
    const fix = fixLinkFor(link)
    out.push({
      leagueId: l.id,
      leagueName: l.name ?? 'your league',
      startName,
      fixHref: fix?.href ?? null,
      fixLabel: fix?.label ?? null,
      // No bench player can come in: where to claim one (a VERIFIED waiver screen or the native wire).
      claimHref: startName ? null : (waiverClaimLink(link)?.href ?? null),
    })
  }

  /*
   * ⚠ THE DEAD END, CLOSED (2026-10-09). Where no bench player can come in, name the free agent who
   * can — but only for a viewer with AF Pro player depth: the Finder gates its pickup options there
   * (playerFinder `includeMoves`), and an alert must not hand out what the card withholds. Everyone
   * else keeps the claim link and "check free agents". Bounded: FREE_AGENT_LEAGUE_CAP leagues, one
   * engine call each, inside FREE_AGENT_TIMEOUT_MS; anything that fails or runs long just leaves the
   * claim link, and the sweep still sends.
   */
  const holes = nfl && sleeperId ? out.filter((l) => !l.startName).slice(0, FREE_AGENT_LEAGUE_CAP) : []
  if (holes.length > 0) {
    const picks = await withTimeout(freeAgentPicks(userId, sleeperId!, holes.map((l) => l.leagueId), kickoffs, now), FREE_AGENT_TIMEOUT_MS).catch(() => null)
    if (picks) {
      for (const l of out) {
        const pick = picks.get(l.leagueId)
        if (pick) l.freeAgent = { name: pick.name, projectedPoints: pick.projectedPoints }
      }
    }
  }
  return out
}

/** The free agent to add per league, for a viewer with player depth; empty for everyone else. */
async function freeAgentPicks(
  userId: string,
  sleeperId: string,
  leagueIds: readonly string[],
  kickoffs: Readonly<Record<string, string>>,
  now: Date,
): Promise<Map<string, FreeAgentPick>> {
  const out = new Map<string, FreeAgentPick>()
  const [{ resolveCoreDepth }, { resolveReplacementOptions }, { resolveInjuryFacts }, { normalizeMatchName }, { normalizeTeamAbbrev }] = await Promise.all([
    import('@/lib/core-app/corePaywall'),
    import('@/lib/shared-services/league-hub/replacementOptions'),
    import('@/lib/injuries/injuryReadPort'),
    import('@/lib/player-match/verifiedNameMatch'),
    import('@/lib/team-abbrev'),
  ])
  const depth = await resolveCoreDepth(userId, 'player_depth').catch(() => null)
  if (!depth?.unlocked) return out

  const options = await Promise.all(
    leagueIds.map((leagueId) =>
      resolveReplacementOptions({ appUserId: userId, leagueId, affectedPlayerId: sleeperId })
        // Null when the engine cannot answer for that league (no roster of yours, unreadable ids): no pick there.
        .then((r) => ({ leagueId, candidates: r?.freeAgentOptions ?? [] }))
        .catch(() => ({ leagueId, candidates: [] })),
    ),
  )
  const all = options.flatMap((o) => o.candidates)
  if (all.length === 0) return out
  // Their designations, by name like every other injury read here; an unreadable feed filters nobody out.
  const facts = await resolveInjuryFacts({
    sport: 'NFL',
    players: all.map((c) => ({ name: c.name, position: c.position, team: c.team })),
    now,
  }).catch(() => null)
  const statusById = new Map<string, string>()
  for (const c of all) {
    const fact = facts?.byPlayer.get(normalizeMatchName(c.name))
    if (fact?.status) statusById.set(c.playerId, String(fact.status))
  }
  for (const o of options) {
    const pick = pickFreeAgent(o.candidates, {
      kickoffs,
      club: (team) => normalizeTeamAbbrev(team) ?? null,
      statusById,
      now,
    })
    if (pick) out.set(o.leagueId, pick)
  }
  return out
}
