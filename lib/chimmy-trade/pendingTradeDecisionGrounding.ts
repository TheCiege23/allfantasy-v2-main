import 'server-only'

import { prisma } from '@/lib/prisma'
import { evaluateStoredTrade } from '@/lib/decision-os/trade/evaluateStoredTrade'
import type { ChimmyTradeGrade } from '@/lib/chimmy/tradeGradeCheck'

/**
 * PENDING INCOMING TRADES -> CHIMMY, each with the ONE grade attached.
 *
 * ⚠ WHY THIS EXISTS. `buildTradeContextForChimmy` already knows how to describe a
 * proposal, but only when it is HANDED a `proposalId` — and the chat route calls
 * it with none, so the proposal branch was unreachable on every request. Chimmy
 * could not see a trade sitting in the user's inbox, which is the single question
 * people open it to ask during a season.
 *
 * 🛑 THE LETTER IS THE ONE GRADE (design step 7, 2026-09-27). This used to print the
 * proposal-time `valueSnapshot.grade` — `canonicalFairnessGrade`, an A+..F scale of its
 * own that every other screen had retired — or, with `DECISION_OS_TRADE_LIVE` on, the
 * Decision OS shadow card's letter. Each proposal now goes through `evaluateStoredTrade`,
 * the path the trade screens and the commissioner review use, from the asker's side:
 * the same letter, a saved receipt, and this week's lineup effect while it is pending.
 *
 * ⚠ AllFantasy EVALUATES, IT NEVER ACTS. No create/accept/reject/counter/veto, no roster
 * or FAAB mutation. This module reads, grades, and explains.
 *
 * ⚠ NO NEW ROUTE. Composed into the existing `/api/chat/chimmy` alongside the
 * other `build*ContextForChimmy` adapters.
 */

/** More than a few and the prompt block crowds out the rest of the grounding. */
const MAX_PROPOSALS = 3

type PendingProposal = {
  id: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  status: string
  vetoMode: string
  expiresAt: Date | null
  createdAt: Date
  proposerRoster: { teamName: string | null; ownerName: string } | null
  assets: Array<{
    fromRosterId: string
    toRosterId: string
    assetType: string
    playerId: string | null
    playerName: string | null
    metadata: unknown
  }>
}

function assetLabel(a: PendingProposal['assets'][number]): string {
  if (a.playerName) return a.playerName
  if (a.assetType === 'faab') {
    const amount = Number((a.metadata as Record<string, unknown> | null)?.amount ?? 0) || 0
    return `${amount} FAAB`
  }
  return a.assetType
}

function describeAssets(p: PendingProposal): string {
  const incoming = p.assets.filter((a) => a.toRosterId === p.receiverRosterId).map(assetLabel)
  const outgoing = p.assets.filter((a) => a.toRosterId === p.proposerRosterId).map(assetLabel)
  return `you receive [${incoming.join(', ') || 'nothing'}], you send [${outgoing.join(', ') || 'nothing'}]`
}

/**
 * Trades awaiting THIS user's answer in THIS league, each with the Decision OS
 * evaluation when it can be produced. Returns null when there is nothing
 * pending, so the prompt gains no empty section.
 */
export type PendingTradeDeps = {
  findProposals: (leagueId: string, userId: string) => Promise<PendingProposal[]>
  evaluate: typeof evaluateStoredTrade
  /** Told the letters the one trade engine gave, so the chat route can hold the answer to them. */
  onGrade?: (grade: ChimmyTradeGrade) => void
}

const defaultDeps: PendingTradeDeps = {
  findProposals: (leagueId, userId) =>
    prisma.redraftTradeProposal.findMany({
      where: {
        leagueId,
        status: 'pending',
        // Incoming only: a proposal this user SENT is not awaiting their answer.
        // Keyed through the roster relation because proposals carry roster ids,
        // never user ids.
        receiverRoster: { ownerId: userId },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_PROPOSALS,
      select: {
        id: true,
        seasonId: true,
        proposerRosterId: true,
        receiverRosterId: true,
        status: true,
        vetoMode: true,
        expiresAt: true,
        createdAt: true,
        proposerRoster: { select: { teamName: true, ownerName: true } },
        assets: {
          select: {
            fromRosterId: true,
            toRosterId: true,
            assetType: true,
            playerId: true,
            playerName: true,
            metadata: true,
          },
        },
      },
    }) as unknown as Promise<PendingProposal[]>,
  evaluate: evaluateStoredTrade,
}

const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`

export async function buildPendingTradeDecisionContext(
  leagueId: string,
  userId: string,
  deps: Partial<PendingTradeDeps> = {},
): Promise<string | null> {
  if (!leagueId || !userId) return null
  const d: PendingTradeDeps = { ...defaultDeps, ...deps }

  let proposals: PendingProposal[]
  try {
    proposals = await d.findProposals(leagueId, userId)
  } catch {
    /*
     * Unreadable is not "none". Staying silent would let Chimmy answer "you have
     * no pending trades" off a failed query — the same shape of confident-wrong
     * that the league-grounding work closed.
     */
    return 'PENDING TRADES: could not be read just now. Do NOT tell the user whether they have trades waiting; say the trade inbox could not be reached.'
  }

  if (proposals.length === 0) return null

  const lines: string[] = [
    `PENDING INCOMING TRADES (${proposals.length}) — awaiting this user's answer. Use ONLY these numbers and letters.`,
  ]

  for (const p of proposals) {
    const from = p.proposerRoster?.teamName ?? p.proposerRoster?.ownerName ?? 'another manager'
    lines.push(
      `- Proposal ${p.id} from ${from}: ${describeAssets(p)}.` +
        (p.expiresAt ? ` Expires ${p.expiresAt.toISOString()}.` : '') +
        ` Veto mode: ${p.vetoMode}.`
    )

    try {
      const r = await d.evaluate({ leagueId, ref: { kind: 'redraft', proposalId: p.id }, userId, surface: 'chimmy-pending' })
      if (!r.ok) {
        lines.push(`  Grade: NOT AVAILABLE — ${r.refusal.reason} Do not grade it yourself.`)
        continue
      }
      const g = r.receipt.grade
      const partner = r.receipt.partnerGrade
      if (g.graded) {
        lines.push(
          `  Grade (the one AllFantasy grade, the same the Trade Center and the offer card give it): you ${g.letter} — ${g.label}; ${from} ${partner.graded ? partner.letter : 'not graded'}. ` +
            `League value: you send ${g.giveValue.toLocaleString()}, you receive ${g.getValue.toLocaleString()}.`
        )
        d.onGrade?.({
          letters: [g.letter, ...(partner.graded ? [partner.letter] : [])],
          summary: `AllFantasy grades the offer from ${from} (${describeAssets(p)}): ${g.letter} for you${partner.graded ? `, ${partner.letter} for ${from}` : ''}.`,
        })
      } else {
        lines.push(`  Grade: NOT GRADED — ${g.reason} Do not grade it yourself.`)
      }
      const mine = r.receipt.canonical?.participants.find((x) => x.rosterId === r.receipt.canonical?.proposerRosterId)?.rosterImpact
      if (mine && mine.startingPointsBefore != null && mine.startingPointsAfter != null && mine.startingPointsDelta != null) {
        lines.push(
          `  Your starting lineup, week ${mine.week ?? '(unknown)'} projections under this league's rules: ${mine.startingPointsBefore.toFixed(1)} before, ${mine.startingPointsAfter.toFixed(1)} after (${signed(mine.startingPointsDelta)}). One week, not the season.`
        )
      }
      if (r.receipt.receiptId) lines.push(`  Evaluation receipt: ${r.receipt.receiptId}.`)
    } catch {
      // Never let the evaluator take down the whole grounding block.
      lines.push('  Grade: evaluation failed. Do not substitute your own grade.')
    }
  }

  lines.push(
    'RULES: AllFantasy never accepts, rejects, counters or vetoes a trade. Explain the evaluation and point the user to their platform to act. Never present a grade as a decision made on their behalf. ' +
      /*
       * R4b.7 (P4) — same policy the packet's own serializer states for lineup/commissioner-health
       * decisions, restated here because this block is composed into the chat prompt separately
       * from the packet (see the file header) rather than through it — a rule stated only in one
       * surface does not reach a turn built from the other.
       */
      'If manager psychology is available elsewhere in this context, you may use it to explain WHY a manager might want this trade — never to argue the grade above should be different than it is.'
  )

  return lines.join('\n')
}
