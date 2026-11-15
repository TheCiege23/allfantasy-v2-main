import 'server-only'

import { prisma } from '@/lib/prisma'
import { asIds, rosterCandidates } from '@/lib/core-app/dash3aPanels'
import { resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import type { WaiverClaimRecommendation } from '@/lib/decision-os/waiver/decision'

/**
 * Who a waiver claim is FOR, in the ids the receipts and the advice ledger grade on — shared by
 * Chimmy's chat waiver advice (./chatWaiverAdvice.ts) and the waiver panel's (./panelWaiverAdvice.ts),
 * so both apply the same refusals. Moved here unchanged from chatWaiverAdvice.ts on 2026-11-15.
 *
 * 🛑 THE ENGINE'S PLAYER ID IS NOT A SLEEPER ID. `addPlayerId` is the waiver pool's `player_id` — a
 * `SportsPlayer` row id, or a `PlayerIdentityMap` row id for the IDP fallback. It is mapped through
 * that row, and the row's name must match the claim's `addPlayerName` (canonical normalizer): a
 * mismatch records nothing rather than attributing one player's advice to another. A synthetic team
 * defense (`nfl:def:KC`) has no row and is not recorded.
 */

/** The engine's top claim — "add X" is one call; the lower-ranked list is its working, not its advice. */
export function topWaiverClaim(claims: readonly WaiverClaimRecommendation[] | null | undefined): WaiverClaimRecommendation | null {
  return (
    [...(claims ?? [])]
      .filter((c) => c && c.addPlayerId && c.addPlayerName?.trim())
      .sort((a, b) => (a.priorityRank ?? Number.POSITIVE_INFINITY) - (b.priorityRank ?? Number.POSITIVE_INFINITY))[0] ?? null
  )
}

export type WaiverTargetRefusal = 'not_sleeper' | 'unresolved' | 'no_team' | 'already_yours' | 'no_week'

export type WaiverTarget = {
  ok: true
  league: { id: string; sport: string }
  sleeperId: string
  playerName: string
  season: number
  week: number
  /** Every Sleeper id on the user's roster (players, starters, reserve, taxi). */
  rosterIds: ReadonlySet<string>
}

/**
 * Resolve a claim to a Sleeper id on a Sleeper league, for the one team the user has claimed there, for
 * the league's current week — or say which of those failed. A player already on the user's roster is
 * not an add. Sleeper leagues only: nothing else can grade the call.
 */
export async function resolveWaiverAddTarget(args: {
  userId: string
  leagueId: string
  top: WaiverClaimRecommendation
}): Promise<WaiverTarget | { ok: false; reason: WaiverTargetRefusal }> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, platform: true, platformLeagueId: true, sport: true },
  })
  if (!league || String(league.platform ?? '').toLowerCase() !== 'sleeper' || !league.platformLeagueId) {
    return { ok: false, reason: 'not_sleeper' }
  }

  // The pool's id is a row id in one of two tables; a malformed id is "not found", never an error.
  const player =
    (await prisma.sportsPlayer
      .findUnique({ where: { id: args.top.addPlayerId }, select: { sleeperId: true, name: true } })
      .catch(() => null)) ??
    (await prisma.playerIdentityMap
      .findUnique({ where: { id: args.top.addPlayerId }, select: { sleeperId: true, canonicalName: true } })
      .then((r) => (r ? { sleeperId: r.sleeperId, name: r.canonicalName } : null))
      .catch(() => null))
  const sleeperId = player?.sleeperId?.trim()
  if (!sleeperId || !player?.name || normalizePlayerName(player.name) !== normalizePlayerName(args.top.addPlayerName)) {
    return { ok: false, reason: 'unresolved' }
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: league.id, claimedByUserId: args.userId },
    select: { externalId: true, platformUserId: true },
  })
  if (teams.length !== 1) return { ok: false, reason: 'no_team' }
  const roster = await prisma.roster.findFirst({
    where: { leagueId: league.id, platformUserId: { in: rosterCandidates(teams[0]!, args.userId) } },
    select: { playerData: true },
  })
  if (!roster) return { ok: false, reason: 'no_team' }
  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  const rosterIds = new Set([...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)])
  if (rosterIds.has(sleeperId)) return { ok: false, reason: 'already_yours' }

  const current = await resolveCurrentWeekForLeague(league.platformLeagueId).catch(() => null)
  if (!current) return { ok: false, reason: 'no_week' }

  return {
    ok: true,
    league: { id: league.id, sport: String(league.sport ?? 'NFL') },
    sleeperId,
    playerName: args.top.addPlayerName.trim(),
    season: current.seasonYear,
    week: current.week,
    rosterIds,
  }
}

/**
 * The claim's suggested drop, which the engine names by NAME only, placed on the user's roster: the
 * one rostered player whose canonical name matches. Two matches or none is null — a drop that cannot be
 * placed is left off rather than guessed, and the call is graded as a plain add.
 */
export async function resolveDropOnRoster(args: {
  dropName: string | null | undefined
  rosterIds: ReadonlySet<string>
  sport: string
}): Promise<{ key: string; name: string } | null> {
  const want = normalizePlayerName(args.dropName ?? '')
  if (!want || args.rosterIds.size === 0) return null
  const rows = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: [...args.rosterIds] }, sport: args.sport },
      select: { sleeperId: true, name: true },
    })
    .catch(() => [])
  const ids = new Set(rows.filter((r) => r.sleeperId && normalizePlayerName(r.name) === want).map((r) => r.sleeperId!.trim()))
  if (ids.size !== 1) return null
  return { key: [...ids][0]!, name: String(args.dropName).trim() }
}
