import 'server-only'

import { prisma } from '@/lib/prisma'
import { recordAdvice } from '@/lib/chimmy-advice/adviceStore'
import { addAdviceKey } from '@/lib/chimmy-advice/adviceKeys'
import { asIds, rosterCandidates } from '@/lib/core-app/dash3aPanels'
import { resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { answerMentions } from '@/lib/chimmy/chimmyPlayerCards'
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
  | 'not_in_answer'

export async function recordChatWaiverAdvice(args: {
  userId: string
  leagueId: string
  claims: readonly WaiverClaimRecommendation[]
  /** The confidence the user was SHOWN for this answer — never the engine's own score. */
  confidencePct: number | null
  /** The answer as the user saw it (after the assistant-mode trim). */
  answer: string
  /**
   * Called once the advice is on file, with its key (`addAdviceKey`) and the player's name — what
   * the drawer's "Did it / Not doing it" buttons send back. Never called for a refusal.
   */
  onRecorded?: (advice: { key: string; playerName: string }) => void
}): Promise<ChatWaiverAdviceOutcome> {
  const top = [...(args.claims ?? [])]
    .filter((c) => c && c.addPlayerId && c.addPlayerName?.trim())
    .sort((a, b) => (a.priorityRank ?? Number.POSITIVE_INFINITY) - (b.priorityRank ?? Number.POSITIVE_INFINITY))[0]
  if (!top) return 'no_claim'

  /*
   * 🛑 "CHIMMY SAID ADD X" MUST BE SOMETHING CHIMMY SAID. The engine's top claim is what the answer
   * was GROUNDED on, not what it said — a model can decline it, pick another name, or answer a
   * different question. A receipt for advice the user never read is a fabricated receipt. Checked
   * first because it is free and decides whether any of the queries below are worth running.
   */
  if (!answerMentions(args.answer ?? '', top.addPlayerName)) return 'not_in_answer'

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

  const playerName = top.addPlayerName.trim()
  const outcome = await recordAdvice({
    userId: args.userId,
    leagueId: league.id,
    sport: String(league.sport ?? 'NFL'),
    season: current.seasonYear,
    week: current.week,
    adviceType: 'add',
    surface: 'chimmy_chat_waiver',
    rec: { key: sleeperId, name: playerName },
    alt: null,
    slot: null,
    confidencePct: args.confidencePct,
  })
  if (outcome === 'recorded') {
    args.onRecorded?.({ key: addAdviceKey(league.id, current.seasonYear, current.week, sleeperId), playerName })
  }
  return outcome
}
