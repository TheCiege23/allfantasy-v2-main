import 'server-only'

import { prisma } from '@/lib/prisma'
import { summarizeEvidenceRecords } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import type { ProfileLabel } from '@/lib/psychological-profiles/types'

/**
 * tradePsychologyLoader — how the managers in a trade have behaved before.
 *
 * DESCRIBES, NEVER SCORES. Nothing here feeds the trade grade. The grade is
 * arithmetic on player values; how someone has traded in the past is context for
 * reading the trade, not evidence about whether it was fair. Folding psychology
 * into the letter would move a number the recipient believes is objective, and
 * they would have no way to see it happened.
 *
 * Silence is a real answer. A manager with too little recorded trade behaviour
 * returns `labels: []` with a plain statement of what is missing, and the surface
 * is expected to print that instead of implying an unremarkable trader.
 */

export type SideTradePsychology = {
  rosterId: number
  managerName: string
  labels: ProfileLabel[]
  /** Countable trade actions behind the labels. */
  tradeEvidenceCount: number
  confidence: 'high' | 'moderate' | 'low' | null
  /** Present when there is not enough to characterise this manager. */
  shortfall: string | null
}

export type TradePsychologyContext = {
  available: boolean
  sides: SideTradePsychology[]
}

const EVIDENCE_COUNT_TYPES = [
  'trade_evidence_count',
  'draft_evidence_count',
  'roster_evidence_count',
]

/**
 * Load trade psychology for the managers on a trade.
 *
 * `leagueId` is the canonical League.id. Profiles are keyed by the roster id as a
 * string (LeagueTeam.externalId), which is the same space TradeSideGrade.rosterId
 * uses as a number.
 */
export async function loadTradePsychology(input: {
  leagueId: string
  sides: Array<{ rosterId: number; managerName: string }>
}): Promise<TradePsychologyContext> {
  const unavailable: TradePsychologyContext = { available: false, sides: [] }
  if (!input.leagueId || input.sides.length === 0) return unavailable

  const managerIds = input.sides.map((s) => String(s.rosterId))
  const profiles = await prisma.managerPsychProfile
    .findMany({
      where: { leagueId: input.leagueId, managerId: { in: managerIds } },
      include: {
        evidence: {
          where: { evidenceType: { in: EVIDENCE_COUNT_TYPES } },
          select: { evidenceType: true, value: true },
        },
      },
    })
    .catch(() => [])

  if (profiles.length === 0) return unavailable

  const byManager = new Map(profiles.map((p) => [p.managerId, p]))
  const sides: SideTradePsychology[] = input.sides.map((side) => {
    const profile = byManager.get(String(side.rosterId))
    if (!profile) {
      return {
        rosterId: side.rosterId,
        managerName: side.managerName,
        labels: [],
        tradeEvidenceCount: 0,
        confidence: null,
        shortfall: 'No trading history on file for this manager yet.',
      }
    }

    const evidence = summarizeEvidenceRecords(profile.evidence)
    const trade = evidence.dimensions.trade
    const labels = Array.isArray(profile.profileLabels)
      ? (profile.profileLabels as ProfileLabel[]).filter((l): l is ProfileLabel => typeof l === 'string')
      : []

    return {
      rosterId: side.rosterId,
      managerName: side.managerName,
      // Only trade-dimension labels belong in a trade email. How someone drafts
      // is a real observation but says nothing about how they deal.
      labels: labels.filter((l) => TRADE_LABELS.has(l)),
      tradeEvidenceCount: trade.evidenceCount,
      confidence: trade.confidence,
      shortfall: trade.sufficient
        ? null
        : trade.evidenceCount === 0
          ? 'No trades recorded for this manager yet.'
          : `Only ${trade.evidenceCount} trade action${trade.evidenceCount === 1 ? '' : 's'} on record — not enough to call a pattern.`,
    }
  })

  // If nobody has an observed trade pattern there is nothing to say, and an empty
  // section is better than a section full of disclaimers.
  const anyObserved = sides.some((s) => s.labels.length > 0)
  return { available: anyObserved, sides }
}

const TRADE_LABELS = new Set<ProfileLabel>([
  'trade-heavy',
  'aggressive',
  'conservative',
  'value-first',
  'win-now',
  'patient rebuilder',
])
