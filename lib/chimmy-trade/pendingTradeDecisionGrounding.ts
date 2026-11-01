import 'server-only'

import { prisma } from '@/lib/prisma'
import { evaluateStoredTrade } from '@/lib/decision-os/trade/evaluateStoredTrade'
import type { ChimmyTradeGrade } from '@/lib/chimmy/tradeGradeCheck'
import {
  MULTI_TEAM_GRADE_WITHHELD,
  describeTradeTeamMoves,
  isMultiTeamTrade,
  joinTeamNames,
  tradePartiesPendingAcceptance,
  tradeTeamMoves,
} from '@/lib/redraft/tradeParticipants'

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
  /** Multi-team trades only (3 or 4 teams): the teams beyond proposer + receiver. Empty or absent for two teams. */
  additionalRosterIds?: string[] | null
  acceptedRosterIds?: string[] | null
  /** The asker's team in this trade. Absent means the receiver, which is every two-team row. */
  viewerRosterId?: string
  /** Every team's display name, by roster id. Filled for multi-team rows. */
  teamNames?: Record<string, string>
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

const PENDING_SELECT = {
  id: true,
  seasonId: true,
  proposerRosterId: true,
  receiverRosterId: true,
  additionalRosterIds: true,
  acceptedRosterIds: true,
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
} as const

/**
 * The asker's team ids in this league. A multi-team trade lists its third and fourth teams in
 * `additionalRosterIds`, a plain id list rather than a relation, so finding the offers that wait on
 * the asker as one of those teams needs the ids. Unreadable reads as none, which leaves exactly the
 * receiver offers this block always showed.
 */
async function myRedraftRosterIds(leagueId: string, userId: string): Promise<string[]> {
  return Promise.resolve()
    .then(() => prisma.redraftRoster.findMany({ where: { leagueId, ownerId: userId }, select: { id: true } }))
    .then((rows) => rows.map((r) => r.id))
    .catch(() => [])
}

async function teamNamesFor(rosterIds: string[]): Promise<Record<string, string>> {
  if (rosterIds.length === 0) return {}
  const rows = await Promise.resolve()
    .then(() => prisma.redraftRoster.findMany({ where: { id: { in: rosterIds } }, select: { id: true, teamName: true, ownerName: true } }))
    .catch(() => [] as Array<{ id: string; teamName: string | null; ownerName: string }>)
  return Object.fromEntries(rows.map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'a team']))
}

const defaultDeps: PendingTradeDeps = {
  findProposals: async (leagueId, userId) => {
    const incoming = (await prisma.redraftTradeProposal.findMany({
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
      select: PENDING_SELECT,
    })) as unknown as PendingProposal[]
    // A multi-team offer also waits on its third and fourth teams (lib/redraft/tradeParticipants.ts).
    const mine = incoming.length < MAX_PROPOSALS ? await myRedraftRosterIds(leagueId, userId) : []
    const asExtraTeam = mine.length
      ? ((await prisma.redraftTradeProposal.findMany({
          where: { leagueId, status: 'pending', additionalRosterIds: { hasSome: mine } },
          orderBy: { createdAt: 'desc' },
          take: MAX_PROPOSALS,
          select: PENDING_SELECT,
        })) as unknown as PendingProposal[]).map((p) => ({
          ...p,
          viewerRosterId: (p.additionalRosterIds ?? []).find((id) => mine.includes(id)),
        }))
      : []
    const seen = new Set<string>()
    const merged = [...incoming, ...asExtraTeam]
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .slice(0, MAX_PROPOSALS)
    const multi = merged.filter((p) => isMultiTeamTrade(p))
    if (multi.length === 0) return merged
    const names = await teamNamesFor([
      ...new Set(multi.flatMap((p) => [p.proposerRosterId, p.receiverRosterId, ...(p.additionalRosterIds ?? [])])),
    ])
    return merged.map((p) => (isMultiTeamTrade(p) ? { ...p, teamNames: names } : p))
  },
  evaluate: evaluateStoredTrade,
}

/**
 * A 3- or 4-team offer: every team and what each gives and gets, the asker's own half, and who has
 * still to accept. 🛑 NOT GRADED, ON PURPOSE: the one grade, the league values and the lineup effect
 * all compare two sides, and a multi-team trade has no "other side". It is not sent to the evaluator
 * (which refuses it anyway) and no letter is handed to the answer check.
 */
function describeMultiTeamProposal(p: PendingProposal, from: string): string[] {
  const moves = tradeTeamMoves(p, p.assets)
  const nameOf = (id: string) => p.teamNames?.[id] ?? (id === p.proposerRosterId ? from : 'another team')
  const viewer = p.viewerRosterId ?? p.receiverRosterId
  const mine = moves.find((m) => m.rosterId === viewer)
  const waitingOn = tradePartiesPendingAcceptance(p).map(nameOf)
  return [
    `- Proposal ${p.id} from ${from}: a ${moves.length}-team trade between ${joinTeamNames(moves.map((m) => nameOf(m.rosterId)))}. ` +
      `${describeTradeTeamMoves(moves, nameOf, assetLabel).join('; ')}. ` +
      `Your team is ${nameOf(viewer)}: you receive [${mine?.gets.map(assetLabel).join(', ') || 'nothing'}], you send [${mine?.gives.map(assetLabel).join(', ') || 'nothing'}].` +
      (waitingOn.length ? ` Every team has to accept; still waiting on ${joinTeamNames(waitingOn)}.` : '') +
      (p.expiresAt ? ` Expires ${p.expiresAt.toISOString()}.` : '') +
      ` Veto mode: ${p.vetoMode}.`,
    `  Grade: NOT GRADED — ${MULTI_TEAM_GRADE_WITHHELD} This is a ${moves.length}-team trade, so it has no grade, league-value comparison or lineup effect. Do not grade it yourself.`,
  ]
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
    if (isMultiTeamTrade(p)) {
      lines.push(...describeMultiTeamProposal(p, from))
      continue
    }
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
