import 'server-only'

import { prisma } from '@/lib/prisma'
import { recordAdvice } from '@/lib/chimmy-advice/adviceStore'
import { asIds, rosterCandidates } from '@/lib/core-app/dash3aPanels'
import { resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import type { WaiverClaimRecommendation } from '@/lib/decision-os/waiver/decision'

/**
 * Record the waiver claim Chimmy's chat grounded on as "add" advice, so the home Receipts card can
 * later say whether you added him and what he did for you (retention item 6, user decision
 * 2026-09-14: "Waiver claims only").
 *
 * Called fire-and-forget from the waiver bridge's `onClaims` side channel during a Chimmy chat
 * turn; it never changes that turn. Every refusal returns a reason instead of throwing.
 *
 * 🛑 THE ENGINE'S PLAYER ID IS NOT A SLEEPER ID. `addPlayerId` is the waiver pool's `player_id` —
 * a `SportsPlayer` row id, or a `PlayerIdentityMap` row id for the IDP fallback. Receipts join on
 * Sleeper ids, so it is mapped through that row, and the row's name must match the claim's
 * `addPlayerName` (canonical normalizer) — a mismatch records nothing rather than attributing
 * one player's advice to another. A synthetic team defense (`nfl:def:KC`) has no row and is not
 * recorded.
 *
 * ⚠ ONLY THE TOP CLAIM. "Chimmy said add X" is one call; the engine's lower-ranked list is its
 * working, not its advice. A player already on YOUR roster is not an add. The week is the
 * league's current week — a claim is advice for the waivers about to run. Sleeper leagues only:
 * nothing else could ever resolve the receipt.
 */

export type ChatWaiverAdviceOutcome =
  | 'recorded'
  | 'unavailable'
  | 'invalid'
  | 'no_claim'
  | 'not_sleeper'
  | 'unresolved'
  | 'no_team'
  | 'already_yours'
  | 'no_week'

export async function recordChatWaiverAdvice(args: {
  userId: string
  leagueId: string
  claims: readonly WaiverClaimRecommendation[]
  confidencePct: number | null
}): Promise<ChatWaiverAdviceOutcome> {
  const top = [...(args.claims ?? [])]
    .filter((c) => c && c.addPlayerId && c.addPlayerName?.trim())
    .sort((a, b) => (a.priorityRank ?? Number.POSITIVE_INFINITY) - (b.priorityRank ?? Number.POSITIVE_INFINITY))[0]
  if (!top) return 'no_claim'

  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, platform: true, platformLeagueId: true, sport: true },
  })
  if (!league || String(league.platform ?? '').toLowerCase() !== 'sleeper' || !league.platformLeagueId) {
    return 'not_sleeper'
  }

  // The pool's id is a row id in one of two tables; a malformed id is "not found", never an error.
  const player =
    (await prisma.sportsPlayer
      .findUnique({ where: { id: top.addPlayerId }, select: { sleeperId: true, name: true } })
      .catch(() => null)) ??
    (await prisma.playerIdentityMap
      .findUnique({ where: { id: top.addPlayerId }, select: { sleeperId: true, canonicalName: true } })
      .then((r) => (r ? { sleeperId: r.sleeperId, name: r.canonicalName } : null))
      .catch(() => null))
  const sleeperId = player?.sleeperId?.trim()
  if (!sleeperId || !player?.name || normalizePlayerName(player.name) !== normalizePlayerName(top.addPlayerName)) {
    return 'unresolved'
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: league.id, claimedByUserId: args.userId },
    select: { externalId: true, platformUserId: true },
  })
  if (teams.length !== 1) return 'no_team'
  const roster = await prisma.roster.findFirst({
    where: { leagueId: league.id, platformUserId: { in: rosterCandidates(teams[0]!, args.userId) } },
    select: { playerData: true },
  })
  if (!roster) return 'no_team'
  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  const yours = new Set([...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)])
  if (yours.has(sleeperId)) return 'already_yours'

  const current = await resolveCurrentWeekForLeague(league.platformLeagueId).catch(() => null)
  if (!current) return 'no_week'

  return recordAdvice({
    userId: args.userId,
    leagueId: league.id,
    sport: String(league.sport ?? 'NFL'),
    season: current.seasonYear,
    week: current.week,
    adviceType: 'add',
    surface: 'chimmy_chat_waiver',
    rec: { key: sleeperId, name: top.addPlayerName.trim() },
    alt: null,
    slot: null,
    confidencePct: args.confidencePct,
  })
}
