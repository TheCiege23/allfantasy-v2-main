import "server-only"

// PRIVACY BOUNDARY: This module never reads chat data.
// Monitoring is based solely on on-field actions and trade data.

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { explainTrade } from "@/lib/decision-os/trade/explainTrade"
import { reviewStoredTrade, type StoredTradeReview } from "@/lib/decision-os/trade/tradeReviewContext"
import type { ReviewCheck, ReviewSeverity } from "@/lib/decision-os/trade/tradeReview"
import { ELIMINATED_PLAYOFF_PCT } from "@/lib/decision-os/trade/tradeReview"

import { notifyCommissionerOfFlag } from "./integrityNotifier"
import { collusionFlagsAtSensitivity, normalizeSensitivity } from "./sensitivity"

/**
 * The post-trade collusion scan — commissioner review mode, run by the integrity worker once a trade
 * settles (Guap, 2026-09-27: "convert it").
 *
 * It used to be a second trade engine: its own value scale (a curve over ADP), its own flags, and its
 * own AI verdict ("clean" / "suspicious" / "likely_collusion") from a direct Anthropic call, over a
 * legacy mirror table that only redraft trades were ever copied into. Now:
 *
 *   - the trade is the REAL trade (`AfLeagueTrade` or `RedraftTradeProposal`), read by `loadTrade`;
 *   - the values are the one grade, and the flags are the review's six checks, computed in code by
 *     `buildTradeReview` — exactly what a commissioner sees in the trade's review panel;
 *   - the commissioner's sensitivity picks which of those flags open an integrity flag
 *     (`collusionFlagsAtSensitivity`); it never moves a threshold, so the panel and the scan agree;
 *   - the AI only writes the neutral note (`explainTrade`, through the provider router and the spend
 *     guard), held to the same validator as the panel's note; with no model, the template writes it.
 *
 * Nothing here decides anything. A flag asks a commissioner to look.
 */

export type ScanTradeRef = { kind: "af"; tradeId: string } | { kind: "redraft"; proposalId: string }

type TradeAsset = { name: string; position: string; estimatedValue: number }

export type CollusionEvidence = {
  tradeTransactionId: string
  team1: { rosterId: string; teamName: string }
  team2: { rosterId: string; teamName: string }
  assetsTeam1Gave: TradeAsset[]
  assetsTeam2Gave: TradeAsset[]
  team1TotalValue: number
  team2TotalValue: number
  valueDifferential: number
  valueDifferentialPct: number
  /** Earlier trades between the pair this season; absent when history could not be read. */
  priorTradesBetweenPair?: number
  /** Only when a current season forecast exists: false means eliminated. */
  isPlayoffContender?: { team1: boolean; team2: boolean }
  /** The raised review checks, in the review's own words. */
  redFlags: string[]
  /** What made this flag: the review, not a model. */
  reviewModel: string
  receiptId: string | null
  recommendation: string
  flags: Array<{ code: string; severity: ReviewSeverity; explanation: string }>
  notComputed: Array<{ code: string; reason: string }>
}

export type CollusionScanResult = {
  leagueId: string
  flags: {
    severity: ReviewSeverity
    summary: string
    evidence: CollusionEvidence
  }[]
  scannedAt: string
}

export type CollusionScanDeps = {
  review: typeof reviewStoredTrade
  explain: typeof explainTrade
  notify: typeof notifyCommissionerOfFlag
  now: () => Date
}

const defaultDeps: CollusionScanDeps = {
  review: reviewStoredTrade,
  explain: explainTrade,
  notify: notifyCommissionerOfFlag,
  now: () => new Date(),
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = { low: 1, medium: 2, high: 3 }

function topSeverity(checks: readonly Pick<ReviewCheck, "severity">[]): ReviewSeverity {
  return checks.reduce<ReviewSeverity>((top, c) => (SEVERITY_RANK[c.severity] > SEVERITY_RANK[top] ? c.severity : top), "low")
}

/** The evidence the integrity flag card renders, taken from the review and its receipt — nothing estimated. */
export function collusionEvidence(tradeTransactionId: string, r: Extract<StoredTradeReview, { ok: true }>): CollusionEvidence {
  const { receipt, review, sides, sideNames, facts } = r
  const positionOf = (name: string) => {
    for (const s of sides) for (const g of s.gives) if (g.kind === "player" && g.name === name) return g.position ?? "UNK"
    return "UNK"
  }
  const lines = (side: "give" | "get"): TradeAsset[] =>
    receipt.assets
      .filter((l) => l.side === side)
      .map((l) => ({
        name: l.name,
        position: l.kind === "player" ? positionOf(l.name) : l.kind.toUpperCase(),
        estimatedValue: l.leagueValue ?? 0,
      }))
  const g = receipt.grade
  const give = g.graded ? g.giveValue : 0
  const get = g.graded ? g.getValue : 0
  const eliminated = (pct: number) => pct < ELIMINATED_PLAYOFF_PCT
  return {
    tradeTransactionId,
    team1: { rosterId: sides[0].rosterId ?? sides[0].teamId, teamName: sideNames[0] },
    team2: { rosterId: sides[1].rosterId ?? sides[1].teamId, teamName: sideNames[1] },
    // Side A gives what the receipt calls `give`; side B gives what side A gets.
    assetsTeam1Gave: lines("give"),
    assetsTeam2Gave: lines("get"),
    team1TotalValue: give,
    team2TotalValue: get,
    valueDifferential: Math.abs(give - get),
    valueDifferentialPct: g.graded ? Math.abs(g.percentDiff) : 0,
    ...(facts.history.ok ? { priorTradesBetweenPair: Math.max(0, facts.history.value.length - 1) } : {}),
    ...(facts.playoffPct.ok
      ? { isPlayoffContender: { team1: !eliminated(facts.playoffPct.value[0]), team2: !eliminated(facts.playoffPct.value[1]) } }
      : {}),
    redFlags: review.flags.map((f) => f.explanation),
    reviewModel: review.model,
    receiptId: receipt.receiptId,
    recommendation: review.recommendation,
    flags: review.flags.map((f) => ({ code: f.code, severity: f.severity, explanation: f.explanation })),
    notComputed: review.checks.filter((c) => c.status === "not_computed").map((c) => ({ code: c.code, reason: c.explanation })),
  }
}

export async function scanTradeForCollusion(
  leagueId: string,
  tradeTransactionId: string,
  ref?: ScanTradeRef,
  deps: Partial<CollusionScanDeps> = {},
): Promise<CollusionScanResult> {
  const d = { ...defaultDeps, ...deps }
  const scannedAt = d.now().toISOString()
  if (!ref) {
    // A job queued before the scan read real trades names only a legacy mirror row. Nothing to review.
    console.warn(`[integrity] collusion scan for ${tradeTransactionId} carries no trade reference — skipped`)
    return { leagueId, flags: [], scannedAt }
  }

  const [league, settings] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
    prisma.leagueIntegritySettings.findUnique({ where: { leagueId } }),
  ])
  if (!league?.userId) return { leagueId, flags: [], scannedAt }

  // Reviewed as the league's commissioner — the one viewer every trade in the league is visible to.
  const r = await d.review({ leagueId, ref, userId: league.userId, surface: "integrity-scan" })
  const flags: CollusionScanResult["flags"] = []

  if (r.ok) {
    const raised = collusionFlagsAtSensitivity(r.review.flags, normalizeSensitivity(settings?.collusionSensitivity))
    if (raised.length > 0) {
      const evidence = collusionEvidence(tradeTransactionId, r)
      const severity = topSeverity(raised)
      const explained = await d
        .explain({ receipt: r.receipt, teamNames: { teamA: r.sideNames[0], teamB: r.sideNames[1] }, commissionerReview: r.review })
        .catch(() => null)
      const summary =
        explained?.verdict.commissioner?.noteToLeague?.trim() ||
        `Flagged for the commissioner: ${raised.map((f) => f.explanation).join(" ")}`
      const existing = await prisma.integrityFlag.findFirst({
        where: { leagueId, tradeTransactionId, status: "open" },
      })
      if (!existing) {
        const row = await prisma.integrityFlag.create({
          data: {
            leagueId,
            flagType: "collusion",
            severity,
            status: "open",
            affectedRosterIds: [evidence.team1.rosterId, evidence.team2.rosterId],
            affectedTeamNames: [evidence.team1.teamName, evidence.team2.teamName],
            summary,
            evidenceJson: evidence as unknown as Prisma.InputJsonValue,
            // The review has no confidence of its own; the card reads `reviewModel` and hides this.
            aiConfidence: 0,
            tradeTransactionId,
          },
        })
        await d.notify(row.id)
      }
      flags.push({ severity, summary, evidence })
    }
  } else {
    console.warn(`[integrity] collusion scan could not review ${tradeTransactionId}: ${r.refusal.reason}`)
  }

  const at = d.now()
  await prisma.leagueIntegritySettings.upsert({
    where: { leagueId },
    create: { leagueId, lastCollusionScanAt: at },
    update: { lastCollusionScanAt: at },
  })

  return { leagueId, flags, scannedAt }
}

/** Every trade settled in the league in the last 30 days that has not been flagged already. */
export async function fullLeagueCollusionScan(leagueId: string, deps: Partial<CollusionScanDeps> = {}): Promise<CollusionScanResult> {
  const d = { ...defaultDeps, ...deps }
  const since = new Date(d.now().getTime() - 30 * 24 * 60 * 60 * 1000)
  const [native, redraft] = await Promise.all([
    prisma.afLeagueTrade.findMany({ where: { leagueId, status: "processed", updatedAt: { gte: since } }, select: { id: true } }),
    prisma.redraftTradeProposal.findMany({ where: { leagueId, status: "accepted", updatedAt: { gte: since } }, select: { id: true } }),
  ])
  const refs: Array<{ id: string; ref: ScanTradeRef }> = [
    ...native.map((t) => ({ id: t.id, ref: { kind: "af" as const, tradeId: t.id } })),
    ...redraft.map((t) => ({ id: t.id, ref: { kind: "redraft" as const, proposalId: t.id } })),
  ]

  const flags: CollusionScanResult["flags"] = []
  let scannedAt = d.now().toISOString()
  for (const { id, ref } of refs) {
    const dup = await prisma.integrityFlag.findFirst({ where: { leagueId, tradeTransactionId: id } })
    if (dup) continue
    const r = await scanTradeForCollusion(leagueId, id, ref, deps)
    scannedAt = r.scannedAt
    flags.push(...r.flags)
  }
  return { leagueId, flags, scannedAt }
}
