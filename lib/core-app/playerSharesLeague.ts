import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { teamForRoster } from '@/lib/trade-block/importedTradeBlock'
import { loadLeagueValueMap, type LeagueValue } from './playerDepth'
import { componentStats } from './playerSeason'
import { collectRosterIds, loadEspnToSleeperMap, rosterIdSpaceOf } from './rosterIdSpace'
import type { ShareRow } from './playerShares'

/**
 * "Your shares" IN ONE LEAGUE (Phase 2, ?league=X on the finder home): for each of the players you
 * roster most across all your leagues, who has him in THIS league, what this league's format makes
 * him worth, and what he has scored this season under this league's own scoring.
 *
 * ⚠ OWNERSHIP GOES THROUGH `teamForRoster`, NOT THE platformUserId/externalId JOIN. The weaker join
 * named no team for 5 of 12 rosters in one production league (see importedTradeBlock.ts); the
 * shared rule is what every /core ownership read should use.
 *
 * ⚠ ESPN ROSTERS ARE TRANSLATED AND AN UNLINKED ID IS DROPPED, so an ESPN number can never be read
 * as a different Sleeper player "owned" by someone. A league on a platform with no id link at all
 * (Yahoo / MFL / Fantrax / Fleaflicker) answers `unknown` for every player rather than "free agent".
 *
 * ⚠ SEASON POINTS ARE RE-SCORED FROM STAT LINES under the league's `scoring_settings` (the same
 * ruler as the card's season view, playerDepth.ts) — every week he has a stat line, whichever
 * roster he was on. `league_player_weekly_scores` was measured and not used: it is Sleeper-only and
 * holds only weeks a player sat on a roster in that league.
 */

export type LeagueHolder =
  | { kind: 'you'; slot: 'STARTER' | 'BENCH' | 'IR' | 'TAXI' }
  | { kind: 'other'; teamName: string | null; ownerName: string | null }
  | { kind: 'free' }
  | { kind: 'unknown' }

export type LeagueShareCell = {
  holder: LeagueHolder
  /** Null when not computed (a viewer without AF Pro) or not priced (kickers, defenders). */
  value: LeagueValue | null
  season: { points: number; games: number } | null
}

export type LeagueShareView = {
  leagueId: string
  leagueName: string
  /** False when the league's scoring could not be read — season points are then absent, not zero. */
  scoringKnown: boolean
  season: number
  cells: Record<string, LeagueShareCell>
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function slotOf(pd: Record<string, unknown>, id: string): 'STARTER' | 'BENCH' | 'IR' | 'TAXI' | null {
  const has = (key: string) => Array.isArray(pd[key]) && (pd[key] as unknown[]).some((x) => x != null && String(x) === id)
  if (has('starters')) return 'STARTER'
  if (has('reserve')) return 'IR'
  if (has('taxi')) return 'TAXI'
  if (has('players')) return 'BENCH'
  return null
}

export async function loadLeagueShareView(
  userId: string,
  leagueId: string,
  rows: readonly ShareRow[],
  opts: { includeValues?: boolean; season: number },
): Promise<LeagueShareView | null> {
  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { id: true, name: true, platform: true, settings: true } })
    .catch(() => null)
  if (!league) return null
  const sleeperIds = rows.map((r) => r.player.sleeperId)
  const idSpace = rosterIdSpaceOf(league.platform)

  const [rosters, teams, stats, values] = await Promise.all([
    idSpace === 'other'
      ? Promise.resolve([] as Array<{ platformUserId: string; playerData: unknown }>)
      : prisma.roster
          .findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
          .catch(() => [] as Array<{ platformUserId: string; playerData: unknown }>),
    prisma.leagueTeam
      .findMany({ where: { leagueId }, select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, ownerName: true, teamName: true } })
      .catch(() => [] as Array<{ id: string; externalId: string; platformUserId: string | null; claimedByUserId: string | null; ownerName: string | null; teamName: string | null }>),
    prisma.playerGameStat
      .findMany({ where: { sportType: 'NFL', season: opts.season, playerId: { in: sleeperIds } }, select: { playerId: true, weekOrRound: true, normalizedStatMap: true } })
      .catch(() => [] as Array<{ playerId: string; weekOrRound: number; normalizedStatMap: unknown }>),
    opts.includeValues !== false ? loadLeagueValueMap(sleeperIds, [leagueId]).catch(() => null) : Promise.resolve(null),
  ])

  // Rosters in Sleeper ids: ESPN translated, an unlinked id dropped.
  const espnMap = idSpace === 'espn' ? await loadEspnToSleeperMap(collectRosterIds(rosters.map((r) => r.playerData))) : null
  const translated = rosters.map((r) => {
    const pd = asRecord(r.playerData) ?? {}
    if (!espnMap) return { ...r, pd }
    const out: Record<string, unknown> = { ...pd }
    for (const key of ['players', 'starters', 'reserve', 'taxi']) {
      const arr = pd[key]
      if (!Array.isArray(arr)) continue
      out[key] = arr.map((x) => (x == null ? '' : espnMap.get(String(x)) ?? '')).filter(Boolean)
    }
    return { ...r, pd: out }
  })

  const yourTeam = teams.find((t) => t.claimedByUserId === userId) ?? null
  const yourIds = new Set([yourTeam?.platformUserId, yourTeam?.externalId, userId].filter((x): x is string => Boolean(x)))

  // Season points under this league's scoring, one stat line per player-week (the richest if a week repeats).
  const scoring = extractScoringSettings(league.settings)
  const bestLine = new Map<string, Record<string, unknown>>()
  for (const s of stats) {
    const key = `${s.playerId}:${s.weekOrRound}`
    const line = asRecord(s.normalizedStatMap)
    if (!line) continue
    const cur = bestLine.get(key)
    if (!cur || Object.keys(line).length > Object.keys(cur).length) bestLine.set(key, line)
  }
  const seasonBy = new Map<string, { points: number; games: number }>()
  if (scoring) {
    for (const [key, line] of bestLine) {
      const id = key.slice(0, key.lastIndexOf(':'))
      const scored = computeLeagueProjectedPoints(componentStats(line), scoring)
      if (!scored) continue
      const cur = seasonBy.get(id) ?? { points: 0, games: 0 }
      cur.points += scored.points
      cur.games += 1
      seasonBy.set(id, cur)
    }
  }

  const perLeagueValues = values?.get(leagueId) ?? null
  const cells: Record<string, LeagueShareCell> = {}
  for (const id of sleeperIds) {
    // No rosters on file is "we cannot tell", never "nobody has him".
    const readable = idSpace !== 'other' && translated.length > 0
    let holder: LeagueHolder = readable ? { kind: 'free' } : { kind: 'unknown' }
    if (readable) {
      for (const r of translated) {
        const slot = slotOf(r.pd, id)
        if (!slot) continue
        if (yourIds.has(r.platformUserId)) holder = { kind: 'you', slot }
        else {
          const team = teamForRoster({ platformUserId: r.platformUserId, playerData: r.playerData }, teams)
          holder = { kind: 'other', teamName: team?.teamName ?? null, ownerName: team?.ownerName ?? null }
        }
        break
      }
    }
    const s = seasonBy.get(id)
    cells[id] = {
      holder,
      value: perLeagueValues?.get(id) ?? null,
      season: s ? { points: Math.round(s.points * 10) / 10, games: s.games } : null,
    }
  }

  return { leagueId, leagueName: league.name ?? 'League', scoringKnown: Boolean(scoring), season: opts.season, cells }
}
