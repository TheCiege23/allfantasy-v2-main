import 'server-only'

import { prisma } from '@/lib/prisma'
import { runTradeShadowForProposal, shouldRunTradeLive } from '@/lib/decision-os/trade/shadow'
import { toTradeCard } from '@/lib/decision-os/trade/tradeCardAdapter'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'

/**
 * PENDING INCOMING TRADES -> CHIMMY, with the Decision OS evaluation attached.
 *
 * ⚠ WHY THIS EXISTS. `buildTradeContextForChimmy` already knows how to describe a
 * proposal, but only when it is HANDED a `proposalId` — and the chat route calls
 * it with none, so the proposal branch was unreachable on every request. Chimmy
 * could not see a trade sitting in the user's inbox, which is the single question
 * people open it to ask during a season.
 *
 * ⚠ DECISION OS EVALUATES, IT NEVER ACTS. Same standing constraint the trade
 * route runs under: no create/accept/reject/counter/veto, no roster or FAAB
 * mutation. This module reads, grades, and explains.
 *
 * ⚠ NO NEW ROUTE. Composed into the existing `/api/chat/chimmy` alongside the
 * other `build*ContextForChimmy` adapters — the repo is at Vercel's route
 * ceiling.
 */

/** More than a few and the prompt block crowds out the rest of the grounding. */
const MAX_PROPOSALS = 3

/**
 * Below this, a letter grade is not a verdict — it is the absence of one.
 * Surfacing "C" off thin data reads as a considered judgement and is the known
 * way this surface lies; the block says so in words instead.
 */
const LOW_COMPLETENESS = 60

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
  valueSnapshot: { payload: unknown; grade: string; confidenceScore: number } | null
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

function toAssetSummaries(p: PendingProposal): TradeAssetSummary[] {
  return p.assets.map((a) => ({
    fromRosterId: a.fromRosterId,
    toRosterId: a.toRosterId,
    assetType: a.assetType,
    playerId: a.playerId ?? null,
    playerName: a.playerName ?? null,
    faabAmount:
      a.assetType === 'faab'
        ? Number((a.metadata as Record<string, unknown> | null)?.amount ?? 0) || null
        : null,
  }))
}

/**
 * Trades awaiting THIS user's answer in THIS league, each with the Decision OS
 * evaluation when it can be produced. Returns null when there is nothing
 * pending, so the prompt gains no empty section.
 */
export async function buildPendingTradeDecisionContext(
  leagueId: string,
  userId: string
): Promise<string | null> {
  if (!leagueId || !userId) return null

  let proposals: PendingProposal[]
  try {
    proposals = (await prisma.redraftTradeProposal.findMany({
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
        valueSnapshot: { select: { payload: true, grade: true, confidenceScore: true } },
      },
    })) as unknown as PendingProposal[]
  } catch {
    /*
     * Unreadable is not "none". Staying silent would let Chimmy answer "you have
     * no pending trades" off a failed query — the same shape of confident-wrong
     * that the league-grounding work closed.
     */
    return 'PENDING TRADES: could not be read just now. Do NOT tell the user whether they have trades waiting; say the trade inbox could not be reached.'
  }

  if (proposals.length === 0) return null

  const live = shouldRunTradeLive(process.env)
  const lines: string[] = [
    `PENDING INCOMING TRADES (${proposals.length}) — awaiting this user's answer. Use ONLY these numbers.`,
  ]

  for (const p of proposals) {
    const from = p.proposerRoster?.teamName ?? p.proposerRoster?.ownerName ?? 'another manager'
    lines.push(
      `- Proposal ${p.id} from ${from}: ${describeAssets(p)}.` +
        (p.expiresAt ? ` Expires ${p.expiresAt.toISOString()}.` : '') +
        ` Veto mode: ${p.vetoMode}.`
    )

    if (!p.valueSnapshot) {
      /*
       * The Decision OS path is fed the persisted snapshot; without one it
       * returns `missing_snapshot` rather than a grade, and so do we.
       */
      lines.push(
        '  Decision OS: NOT AVAILABLE for this proposal (no value snapshot was captured when it was created). State that it has not been evaluated rather than grading it yourself.'
      )
      continue
    }

    if (!live) {
      /*
       * `DECISION_OS_TRADE_LIVE` is the kill switch the trade route runs under.
       * Honouring it here keeps one flag in charge of whether Decision OS output
       * reaches users, instead of this path quietly becoming a second door.
       */
      lines.push(
        `  Decision OS: not enabled in this environment. Historical snapshot only: grade ${p.valueSnapshot.grade}, confidence ${p.valueSnapshot.confidenceScore}/100, taken when the proposal was created and possibly stale. Present it as a past snapshot, never as a current recommendation.`
      )
      continue
    }

    try {
      const run = await runTradeShadowForProposal({
        userId,
        leagueId,
        seasonId: p.seasonId,
        proposal: {
          proposalId: p.id,
          proposerRosterId: p.proposerRosterId,
          receiverRosterId: p.receiverRosterId,
          status: p.status,
          vetoMode: p.vetoMode,
        },
        assets: toAssetSummaries(p),
        snapshotPayload: p.valueSnapshot.payload,
        snapshotConfidenceScore: p.valueSnapshot.confidenceScore,
      })

      if (run.ran && run.result) {
        const { decision } = run.result
        const card = toTradeCard(decision)
        lines.push(`  Decision OS (decision ${decision.decision_id}):`)
        lines.push(`    what happened: ${card.title}`)
        lines.push(`    why it matters: ${card.subtitle}`)
        lines.push(`    what to do: ${card.detail}`)
        lines.push(
          `    legal under league rules: ${card.legal ? 'yes' : 'NO — this trade violates a league rule'}`
        )
        lines.push(
          `    data completeness ${decision.data_completeness}/100` +
            (decision.uncertainty_sources.length
              ? `; unknown: ${decision.uncertainty_sources.join(', ')}`
              : '')
        )
        if (decision.data_completeness < LOW_COMPLETENESS) {
          /*
           * The known failure mode on this surface: a letter produced from almost
           * nothing, read by the user as a considered verdict.
           */
          lines.push(
            `    ⚠ LOW DATA (${decision.data_completeness}/100). Do NOT lead with the grade or present it as a verdict. Say what is missing and let the user decide.`
          )
        } else if (card.grade) {
          lines.push(
            `    grade ${card.grade}` +
              (card.fairnessScore != null ? `, fairness ${card.fairnessScore}/100` : '')
          )
        }
      } else {
        lines.push(
          `  Decision OS: could not evaluate (${run.error ?? 'no result'}). Do not substitute your own grade.`
        )
      }
    } catch {
      // Never let the evaluator take down the whole grounding block.
      lines.push('  Decision OS: evaluation failed. Do not substitute your own grade.')
    }
  }

  lines.push(
    'RULES: AllFantasy never accepts, rejects, counters or vetoes a trade. Explain the evaluation and point the user to their platform to act. Never present a grade as a decision made on their behalf.'
  )

  return lines.join('\n')
}
