import 'server-only'

import { prisma } from '@/lib/prisma'
import { completedTradeGraderFor, gradeArchivedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { PUBLIC_RECEIPT_SELECT, publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import type { TradeCardGrade } from '@/lib/league-chat/tradeCardGradeView'

/**
 * Reading THE grade for a league chat trade card (see `tradeCardGradeView.ts` for why). The same two
 * reads League Buzz uses (`lib/activity/tradeGrades.ts`), so a trade reads the same letter in the
 * chat and in the feed:
 *   - an IMPORTED trade (a `LeagueTrade` row) — graded on the league's values today by the archived-trade
 *     grader, from the row's own side;
 *   - a NATIVE AllFantasy trade — the letters frozen into its receipt when it was proposed.
 *
 * Never throws: null means there is no grade to show, and the writer posts exactly what it did before.
 */

type ArchivedPickIn = { season?: unknown; round?: unknown }

function picks(raw: unknown): Array<{ season: number | null; round: number | null; label: string }> {
  return (Array.isArray(raw) ? raw : []).map((p) => {
    const pick = (p && typeof p === 'object' ? p : {}) as ArchivedPickIn
    const season = typeof pick.season === 'number' ? pick.season : Number(pick.season) || null
    const round = typeof pick.round === 'number' ? pick.round : Number(pick.round) || null
    return { season, round, label: season && round ? `${season} round ${round}` : 'a draft pick' }
  })
}

/**
 * An imported trade, from the side of the `LeagueTrade` row the card is written from: what that
 * manager received against what they gave. Only two-team trades are graded; a player the row names by
 * an id we cannot resolve withholds the grade (the grader says which), never a guess.
 */
export async function gradeImportedTradeCard(args: {
  leagueId: string
  /** Player NAMES, null where the id did not resolve. */
  received: ReadonlyArray<string | null>
  gave: ReadonlyArray<string | null>
  picksReceived: unknown
  picksGiven: unknown
  teams: number
  now: Date
}): Promise<TradeCardGrade | null> {
  if (args.teams > 2) return { graded: false, reason: 'only two-team trades are graded' }
  try {
    const g = await gradeArchivedTrade(await completedTradeGraderFor(args.leagueId), {
      received: args.received,
      gave: args.gave,
      picksIn: picks(args.picksReceived),
      picksOut: picks(args.picksGiven),
      currentSeason: args.now.getUTCFullYear(),
    })
    if (!g.graded) return { graded: false, reason: g.reason }
    return {
      graded: true,
      letter: g.letter,
      partnerLetter: g.partnerLetter,
      basis: 'today',
      valueGave: g.giveValue,
      valueGot: g.getValue,
    }
  } catch {
    return null
  }
}

const LETTERS = new Set(['A', 'B', 'C', 'D', 'F'])

/**
 * A native trade: each side's letter from the receipt frozen when it was proposed, oriented so
 * `letter` is the PROPOSER's (the card's `manager`). No receipt, a table this database lacks, or an
 * unreadable row: null.
 */
export async function nativeTradeCardGrade(args: {
  tradeId: string
  proposerRosterId: string
  receiverRosterId: string
}): Promise<TradeCardGrade | null> {
  try {
    // Absent on a client or test double without the model — the guard `lib/activity/tradeGrades.ts` uses.
    if (!prisma.tradeDecisionSnapshot) return null
    const row = await prisma.tradeDecisionSnapshot.findFirst({ where: { tradeId: args.tradeId }, select: PUBLIC_RECEIPT_SELECT })
    if (!row) return null
    const decisions = publicTradeDecisionReceipt(row).participantDecisions
    const proposer = decisions.find((d) => d.rosterId === args.proposerRosterId)
    const letter = proposer?.grade ?? null
    const partnerLetter = decisions.find((d) => d.rosterId === args.receiverRosterId)?.grade ?? null
    if (!letter || !partnerLetter || !LETTERS.has(letter) || !LETTERS.has(partnerLetter)) return null
    return {
      graded: true,
      letter,
      partnerLetter,
      basis: 'at-proposal',
      // The league values the proposer's letter was taken on, frozen with it — null when the receipt has none.
      valueGave: proposer?.valueGiven ?? null,
      valueGot: proposer?.valueReceived ?? null,
    }
  } catch {
    return null
  }
}
