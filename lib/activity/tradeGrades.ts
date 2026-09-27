import 'server-only'

import { prisma } from '@/lib/prisma'
import { completedTradeGraderFor, gradeArchivedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import type { SleeperTransaction } from '@/lib/sleeper-client'
import type { ActivityTradeGrade } from '@/lib/activity/types'

/**
 * THE grade on a League Buzz trade (2026-09-27).
 *
 * The activity feed — /core's Comms drawer and the league feed page, both via
 * `/api/shared/activity` — listed a trade as "A gets X · B gets Y" and nothing else, while every
 * other surface showed each team's letter.
 *
 * 🛑 THIS ENDPOINT IS POLLED EVERY ~90s AND ONCE EXHAUSTED PRODUCTION POSTGRES (53200). So grading
 * here is bounded twice: `MAX_GRADED_PER_REQUEST` trades per request, and a per-transaction memo so
 * a poll does not regrade what it graded a minute ago. The grader itself is memoised per league.
 * A failure is a trade with no grade line, never a failed feed.
 */

const GRADE_MEMO_TTL_MS = 10 * 60 * 1000
export const MAX_GRADED_PER_REQUEST = 8
const memo = new Map<string, { at: number; grade: ActivityTradeGrade | null }>()

const LETTERS = new Set(['A', 'B', 'C', 'D', 'F'])
type Letter = 'A' | 'B' | 'C' | 'D' | 'F'

/** Test seam: the memo is process-wide on purpose, so a test must be able to clear it. */
export function clearActivityTradeGradeMemo(): void {
  memo.clear()
}

/**
 * A completed two-team Sleeper trade, graded from its own transaction: players by name, picks by
 * season and round keyed on `owner_id` — the RECEIVER. (`roster_id` on a Sleeper pick is its
 * ORIGINAL owner; reading it as the receiver hands the pick to the wrong side.)
 *
 * Withheld, never guessed: a player Sleeper cannot name, a trade with FAAB in it (the chart does not
 * price FAAB, and grading the rest would call a sweetened deal a steal), three teams.
 */
export async function gradeSleeperActivityTrade(args: {
  afLeagueId: string
  tx: SleeperTransaction
  rosterNames: ReadonlyMap<number, string>
  players: Record<string, { full_name?: string | null; first_name?: string | null; last_name?: string | null } | undefined>
  now?: number
}): Promise<ActivityTradeGrade | null> {
  const { tx } = args
  const now = args.now ?? Date.now()
  const key = `${args.afLeagueId}:${tx.transaction_id}`
  const hit = memo.get(key)
  if (hit && now - hit.at < GRADE_MEMO_TTL_MS) return hit.grade

  const grade = await (async (): Promise<ActivityTradeGrade | null> => {
    if (tx.roster_ids.length !== 2) {
      return { graded: false, reason: 'only two-team trades are graded' }
    }
    if ((tx.waiver_budget ?? []).some((w) => w.amount > 0)) {
      return { graded: false, reason: 'FAAB in this trade is not priced on the league chart' }
    }
    const [a, b] = tx.roster_ids as [number, number]
    const nameOf = (pid: string): string | null => {
      const p = args.players[pid]
      const name = p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim()
      return name || null
    }
    const playersTo = (rid: number) =>
      Object.entries(tx.adds ?? {}).filter(([, to]) => to === rid).map(([pid]) => nameOf(pid))
    const picksTo = (rid: number) =>
      (tx.draft_picks ?? [])
        .filter((p) => p.owner_id === rid)
        .map((p) => ({ season: Number(p.season), round: p.round, label: `${p.season} round ${p.round}` }))
    const g = await gradeArchivedTrade(await completedTradeGraderFor(args.afLeagueId), {
      received: playersTo(a),
      gave: playersTo(b),
      picksIn: picksTo(a),
      picksOut: picksTo(b),
      currentSeason: new Date(now).getUTCFullYear(),
    })
    if (!g.graded) return { graded: false, reason: g.reason }
    return {
      graded: true,
      basis: 'today',
      sides: [
        { name: args.rosterNames.get(a) ?? `Team ${a}`, letter: g.letter },
        { name: args.rosterNames.get(b) ?? `Team ${b}`, letter: g.partnerLetter },
      ],
    }
  })().catch(() => null)

  memo.set(key, { at: now, grade })
  return grade
}

/**
 * Native trades: the letter each side was given AT PROPOSAL, from the trade's frozen receipt — one
 * query for every trade in the feed. A missing or unreadable receipt table means no grade, never a
 * throw.
 */
export async function nativeTradeReceiptGrades(
  tradeIds: string[],
  managerNameOf: (rosterId: string) => string,
): Promise<Map<string, ActivityTradeGrade>> {
  const out = new Map<string, ActivityTradeGrade>()
  if (tradeIds.length === 0) return out
  try {
    // Absent on a client or test double without the model — the same guard `recentTrades.ts` uses.
    if (!prisma.tradeDecisionSnapshot) return out
    const rows = await prisma.tradeDecisionSnapshot.findMany({ where: { tradeId: { in: tradeIds } } })
    for (const row of rows) {
      const decisions = publicTradeDecisionReceipt(row).participantDecisions
      if (decisions.length !== 2 || !decisions.every((d) => d.grade && LETTERS.has(d.grade))) continue
      out.set(row.tradeId, {
        graded: true,
        basis: 'at-proposal',
        sides: decisions.map((d) => ({ name: managerNameOf(d.rosterId), letter: d.grade as Letter })),
      })
    }
  } catch {
    /* A receipt the feed cannot read is a trade without a grade line, never a failed feed. */
  }
  return out
}
