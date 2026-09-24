import 'server-only'

import { prisma } from '@/lib/prisma'
import { recordAdvice, type RecordAdviceResult } from '@/lib/chimmy-advice/adviceStore'
import { asIds, rosterCandidates } from '@/lib/core-app/dash3aPanels'
import { answerMentions } from '@/lib/chimmy/chimmyPlayerCards'
import type { ChatStartCall } from '@/lib/chimmy/tools/chimmyTools'

/**
 * Record the start/sit calls Chimmy's CHAT made, so they are graded against real weekly scores like
 * the comparison tool's — Chimmy's track record (owner's call 2026-09-24: "start on the Chimmy track
 * record").
 *
 * Until now only the start/sit comparison screen recorded a call. "Start A or B?" asked in chat —
 * `compare_start_options` — and the lineup optimizer's swap were answered, and forgotten, so the
 * record could only ever describe a screen most people never open.
 *
 * Called fire-and-forget after a tool-loop answer; it never changes that answer. Every refusal is a
 * reason in the returned list, so a test can see WHY nothing was recorded.
 *
 * 🛑 "CHIMMY SAID START X" MUST BE SOMETHING CHIMMY SAID. The engine's call is what the answer was
 * GROUNDED on — the model can decline it, hedge, or answer another question. A call is recorded only
 * when the answer names BOTH players; one that names neither was not advice the user read, and a
 * receipt for it would be fabricated. (`chatWaiverAdvice.ts` applies the same rule to adds.)
 *
 * ⚠ SLEEPER LEAGUES, ONE CLAIMED TEAM, BOTH PLAYERS ON IT. Grading reads
 * `league_player_weekly_scores`, which only the Sleeper sync writes, by Sleeper id — a call anywhere
 * else could never be graded, and a call about players not on your roster was not yours to follow.
 * Checking the roster also proves the engine's ids are the Sleeper ids grading joins on.
 */

/** A chat answer makes a handful of calls at most; anything past this is not one answer's advice. */
export const MAX_CHAT_START_CALLS = 3

export type ChatStartSitOutcome =
  | RecordAdviceResult
  | 'not_in_answer'
  | 'duplicate'
  | 'not_sleeper'
  | 'no_team'
  | 'not_on_roster'

export async function recordChatStartSitAdvice(args: {
  userId: string
  calls: readonly ChatStartCall[]
  /** The answer as the user saw it. */
  answer: string
  /** The confidence the user was SHOWN for this answer, when there was one. */
  confidencePct?: number | null
}): Promise<ChatStartSitOutcome[]> {
  const outcomes: ChatStartSitOutcome[] = []
  const seen = new Set<string>()
  const rosters = new Map<string, YourRoster | 'not_sleeper' | 'no_team'>()

  for (const call of args.calls.slice(0, MAX_CHAT_START_CALLS)) {
    const key = `${call.leagueId}:${call.season}:${call.week}:${call.rec.key}:${call.alt.key}`
    if (seen.has(key)) {
      outcomes.push('duplicate')
      continue
    }
    seen.add(key)
    // Free, and decides whether anything below is worth a query.
    if (!answerMentions(args.answer ?? '', call.rec.name) || !answerMentions(args.answer ?? '', call.alt.name)) {
      outcomes.push('not_in_answer')
      continue
    }

    let roster = rosters.get(call.leagueId)
    if (roster === undefined) {
      roster = await yourSleeperRoster(call.leagueId, args.userId)
      rosters.set(call.leagueId, roster)
    }
    if (roster === 'not_sleeper' || roster === 'no_team') {
      outcomes.push(roster)
      continue
    }
    if (!roster.ids.has(call.rec.key) || !roster.ids.has(call.alt.key)) {
      outcomes.push('not_on_roster')
      continue
    }

    outcomes.push(
      await recordAdvice({
        userId: args.userId,
        leagueId: call.leagueId,
        sport: roster.sport,
        season: call.season,
        week: call.week,
        adviceType: 'start_sit',
        surface: 'chimmy_chat_lineup',
        rec: call.rec,
        alt: call.alt,
        slot: call.slot,
        confidencePct: args.confidencePct ?? null,
      }),
    )
  }
  return outcomes
}

type YourRoster = { ids: Set<string>; sport: string }

/** Every player id on your one claimed roster in a Sleeper league — or why there is none. */
async function yourSleeperRoster(leagueId: string, userId: string): Promise<YourRoster | 'not_sleeper' | 'no_team'> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, platform: true, platformLeagueId: true, sport: true },
  })
  if (!league || String(league.platform ?? '').toLowerCase() !== 'sleeper' || !league.platformLeagueId) return 'not_sleeper'
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: league.id, claimedByUserId: userId },
    select: { externalId: true, platformUserId: true },
  })
  if (teams.length !== 1) return 'no_team'
  const roster = await prisma.roster.findFirst({
    where: { leagueId: league.id, platformUserId: { in: rosterCandidates(teams[0]!, userId) } },
    select: { playerData: true },
  })
  if (!roster) return 'no_team'
  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  return {
    ids: new Set([...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)]),
    sport: String(league.sport ?? 'NFL'),
  }
}
