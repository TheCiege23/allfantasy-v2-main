import "server-only"

import {
  getFantasyValueSnapshot,
  type FantasyValueSnapshot,
  type FantasyValueSnapshotRequest,
} from "@/lib/sports-reporting/FantasyValueSnapshotService"

export type TokenChargePolicy = {
  canCharge: boolean
  reason: string
}

export type GroundedTradeAsset = {
  playerId?: string | null
  playerName: string
}

export type GroundedTradeAnalysis = {
  status: "ready" | "partial" | "unsupported"
  recommendation: "accept" | "reject" | "close" | "insufficient_data"
  sideAValue: number | null
  sideBValue: number | null
  delta: number | null
  confidence: number
  missingData: string[]
  snapshots: {
    sideA: FantasyValueSnapshot[]
    sideB: FantasyValueSnapshot[]
  }
  summary: string
  tokenCharge: TokenChargePolicy
}

export type GroundedDraftCandidate = {
  playerId?: string | null
  playerName: string
}

export type GroundedDraftRecommendation = {
  playerName: string
  playerId: string | null
  rank: number
  score: number
  why: string[]
  avoid: boolean
  snapshot: FantasyValueSnapshot
}

export type GroundedDraftAdvice = {
  status: "ready" | "partial" | "unsupported"
  recommendations: GroundedDraftRecommendation[]
  avoidList: GroundedDraftRecommendation[]
  confidence: number
  missingData: string[]
  summary: string
  tokenCharge: TokenChargePolicy
}

export type CommissionerAccess = {
  isAdmin?: boolean
  isFounder?: boolean
  isPoolOwner?: boolean
  hasAfCommissioner?: boolean
  tokenFallbackConfigured?: boolean
}

export type CommissionerPoolSnapshot = {
  poolName: string
  memberCount: number
  finalizedEntryCount: number
  inviteSentCount: number
  inviteAcceptedCount: number
  chatMessageCount?: number | null
  leaderboard?: Array<{ username: string; rank: number; points: number }>
  incompleteBrackets?: Array<{ username: string }>
  staleDataWarnings?: string[]
}

export type GroundedCommissionerReport = {
  status: "ready" | "partial" | "blocked"
  accessReason: string
  metrics: {
    memberCount: number
    finalizedEntryCount: number
    inviteAcceptedCount: number
    inviteAcceptanceRate: number | null
    incompleteBracketCount: number
    chatMessageCount: number | null
  }
  lines: string[]
  alerts: string[]
  suggestedAnnouncement: string | null
  missingData: string[]
  tokenCharge: TokenChargePolicy
}

type SnapshotLoader = (request: FantasyValueSnapshotRequest) => Promise<FantasyValueSnapshot>

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatLabel(value: string | null | undefined): string {
  return String(value ?? "unknown").replace(/_/g, " ")
}

function isDynastyLike(value: string | null | undefined): boolean {
  const v = String(value ?? "").toLowerCase()
  return v.includes("dynasty") || v.includes("keeper") || v.includes("rookie") || v.includes("devy") || v.includes("c2c")
}

function valueForSnapshot(snapshot: FantasyValueSnapshot, leagueFormat: string | null | undefined): number | null {
  if (snapshot.shortTermValue == null && snapshot.longTermValue == null) return null
  const dynasty = isDynastyLike(leagueFormat)
  const shortTerm = snapshot.shortTermValue ?? snapshot.longTermValue ?? 0
  const longTerm = snapshot.longTermValue ?? snapshot.shortTermValue ?? 0
  const base = dynasty ? shortTerm * 0.45 + longTerm * 0.55 : shortTerm * 0.8 + longTerm * 0.2
  const riskPenalty = snapshot.riskScore == null ? 0 : snapshot.riskScore * 0.12
  return Math.max(0, Math.round((base - riskPenalty) * 10) / 10)
}

function sumValues(snapshots: FantasyValueSnapshot[], leagueFormat: string | null | undefined): number | null {
  const values = snapshots.map((snapshot) => valueForSnapshot(snapshot, leagueFormat)).filter((value): value is number => value != null)
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 10) / 10
}

function chargePolicyFromMissing(input: {
  status: "ready" | "partial" | "unsupported"
  missingData: string[]
  usefulOutput: boolean
}): TokenChargePolicy {
  if (!input.usefulOutput) {
    return {
      canCharge: false,
      reason: "No useful grounded output was produced, so tokens must not be deducted.",
    }
  }
  if (input.status === "unsupported") {
    return {
      canCharge: false,
      reason: "Critical data is missing. Refuse the paid action instead of charging tokens.",
    }
  }
  return {
    canCharge: true,
    reason:
      input.missingData.length > 0
        ? "Partial grounded output is available; show missing data before any confirmed token spend."
        : "Grounded output is available. Tokens may be committed after the response is produced.",
  }
}

async function loadSnapshots(
  sport: string,
  assets: GroundedTradeAsset[],
  leagueFormat: string | null | undefined,
  scoringFormat: string | null | undefined,
  loader: SnapshotLoader
): Promise<FantasyValueSnapshot[]> {
  return Promise.all(
    assets.map((asset) =>
      loader({
        sport,
        playerId: asset.playerId ?? null,
        playerName: asset.playerName,
        leagueFormat,
        scoringFormat,
      })
    )
  )
}

export async function analyzeGroundedTrade(input: {
  sport: string
  sideA: GroundedTradeAsset[]
  sideB: GroundedTradeAsset[]
  leagueFormat?: string | null
  scoringFormat?: string | null
  snapshotLoader?: SnapshotLoader
}): Promise<GroundedTradeAnalysis> {
  const loader = input.snapshotLoader ?? getFantasyValueSnapshot
  const [sideA, sideB] = await Promise.all([
    loadSnapshots(input.sport, input.sideA, input.leagueFormat, input.scoringFormat, loader),
    loadSnapshots(input.sport, input.sideB, input.leagueFormat, input.scoringFormat, loader),
  ])
  const sideAValue = sumValues(sideA, input.leagueFormat)
  const sideBValue = sumValues(sideB, input.leagueFormat)
  const missingData = unique([...sideA, ...sideB].flatMap((snapshot) => snapshot.missingData))
  const confidence =
    [...sideA, ...sideB].length === 0
      ? 0
      : Math.round((sideA.concat(sideB).reduce((sum, snapshot) => sum + snapshot.confidence, 0) / (sideA.length + sideB.length)) * 100) / 100
  const unsupported = sideAValue == null || sideBValue == null
  const status = unsupported ? "unsupported" : missingData.length > 0 ? "partial" : "ready"
  const delta = sideAValue == null || sideBValue == null ? null : Math.round((sideBValue - sideAValue) * 10) / 10
  const recommendation =
    delta == null
      ? "insufficient_data"
      : Math.abs(delta) <= 5
        ? "close"
        : delta > 0
          ? "accept"
          : "reject"
  const summary =
    recommendation === "insufficient_data"
      ? "I do not have enough cached value data to make a paid trade claim."
      : `${formatLabel(input.leagueFormat)} trade leans ${recommendation}; value delta is ${delta}.`
  return {
    status,
    recommendation,
    sideAValue,
    sideBValue,
    delta,
    confidence,
    missingData,
    snapshots: { sideA, sideB },
    summary,
    tokenCharge: chargePolicyFromMissing({
      status,
      missingData,
      usefulOutput: recommendation !== "insufficient_data",
    }),
  }
}

function draftScore(snapshot: FantasyValueSnapshot, input: {
  leagueFormat?: string | null
  draftType?: string | null
  rosterNeeds?: string[]
}): number | null {
  const value = valueForSnapshot(snapshot, input.leagueFormat)
  if (value == null) return null
  const rookie = String(input.draftType ?? "").toLowerCase().includes("rookie")
  const needs = new Set((input.rosterNeeds ?? []).map((need) => need.toUpperCase()))
  const needBonus = snapshot.position && needs.has(snapshot.position.toUpperCase()) ? 8 : 0
  const longTermBonus = rookie || isDynastyLike(input.leagueFormat) ? (snapshot.longTermValue ?? 0) * 0.18 : 0
  const riskPenalty = snapshot.riskScore == null ? 0 : snapshot.riskScore * (rookie ? 0.08 : 0.12)
  return Math.max(0, Math.round((value + needBonus + longTermBonus - riskPenalty) * 10) / 10)
}

export async function recommendGroundedDraftPicks(input: {
  sport: string
  candidates: GroundedDraftCandidate[]
  leagueFormat?: string | null
  scoringFormat?: string | null
  draftType?: string | null
  rosterNeeds?: string[]
  snapshotLoader?: SnapshotLoader
}): Promise<GroundedDraftAdvice> {
  const loader = input.snapshotLoader ?? getFantasyValueSnapshot
  const snapshots = await Promise.all(
    input.candidates.map((candidate) =>
      loader({
        sport: input.sport,
        playerId: candidate.playerId ?? null,
        playerName: candidate.playerName,
        leagueFormat: input.leagueFormat,
        scoringFormat: input.scoringFormat,
      })
    )
  )
  const scored = snapshots.map((snapshot) => ({
    snapshot,
    score: draftScore(snapshot, input),
  }))
  const ranked = scored
    .filter((row): row is { snapshot: FantasyValueSnapshot; score: number } => row.score != null)
    .sort((a, b) => b.score - a.score)
    .map((row, index): GroundedDraftRecommendation => {
      const why = [
        row.snapshot.shortTermValue != null ? `Short-term value ${row.snapshot.shortTermValue}` : null,
        row.snapshot.longTermValue != null && isDynastyLike(input.leagueFormat) ? `Long-term value ${row.snapshot.longTermValue}` : null,
        row.snapshot.position && input.rosterNeeds?.map((need) => need.toUpperCase()).includes(row.snapshot.position.toUpperCase())
          ? `Fills roster need at ${row.snapshot.position}`
          : null,
        row.snapshot.injuryRisk !== "unknown" ? `Injury risk ${row.snapshot.injuryRisk}` : null,
      ].filter((item): item is string => Boolean(item))
      return {
        playerName: row.snapshot.playerName,
        playerId: row.snapshot.playerId,
        rank: index + 1,
        score: row.score,
        why,
        avoid: row.snapshot.injuryRisk === "high" || row.snapshot.confidence < 0.35,
        snapshot: row.snapshot,
      }
    })
  const recommendations = ranked.filter((row) => !row.avoid).slice(0, 3)
  const avoidList = ranked.filter((row) => row.avoid).slice(0, 3)
  const missingData = unique(snapshots.flatMap((snapshot) => snapshot.missingData))
  const status = recommendations.length === 0 ? "unsupported" : missingData.length > 0 ? "partial" : "ready"
  const confidence =
    snapshots.length === 0
      ? 0
      : Math.round((snapshots.reduce((sum, snapshot) => sum + snapshot.confidence, 0) / snapshots.length) * 100) / 100
  return {
    status,
    recommendations,
    avoidList,
    confidence,
    missingData,
    summary:
      recommendations.length === 0
        ? "No grounded draft recommendations are available from cached data yet."
        : `${formatLabel(input.draftType ?? input.leagueFormat)} draft recommendations are grounded in ${recommendations.length} ranked candidates.`,
    tokenCharge: chargePolicyFromMissing({
      status,
      missingData,
      usefulOutput: recommendations.length > 0,
    }),
  }
}

function canUseCommissionerReport(access: CommissionerAccess): { ok: boolean; reason: string } {
  if (access.isAdmin || access.isFounder) return { ok: true, reason: "admin/founder override" }
  if (access.hasAfCommissioner) return { ok: true, reason: "AF Commissioner active" }
  if (access.tokenFallbackConfigured) return { ok: true, reason: "token fallback configured" }
  if (access.isPoolOwner) return { ok: false, reason: "Pool ownership allows basic tools only; advanced reports require AF Commissioner or token fallback." }
  return { ok: false, reason: "Commissioner report access is not available for this user." }
}

export function buildGroundedCommissionerReport(input: {
  access: CommissionerAccess
  pool: CommissionerPoolSnapshot
}): GroundedCommissionerReport {
  const access = canUseCommissionerReport(input.access)
  const inviteAcceptanceRate =
    input.pool.inviteSentCount > 0
      ? Math.round((input.pool.inviteAcceptedCount / input.pool.inviteSentCount) * 100)
      : null
  const incompleteBracketCount = input.pool.incompleteBrackets?.length ?? Math.max(0, input.pool.memberCount - input.pool.finalizedEntryCount)
  const missingData = [
    input.pool.leaderboard?.length ? null : "leaderboard snapshot",
    input.pool.chatMessageCount == null ? "pool activity/chat count" : null,
    inviteAcceptanceRate == null ? "invite acceptance rate" : null,
    ...(input.pool.staleDataWarnings ?? []),
  ].filter((item): item is string => Boolean(item))

  if (!access.ok) {
    return {
      status: "blocked",
      accessReason: access.reason,
      metrics: {
        memberCount: input.pool.memberCount,
        finalizedEntryCount: input.pool.finalizedEntryCount,
        inviteAcceptedCount: input.pool.inviteAcceptedCount,
        inviteAcceptanceRate,
        incompleteBracketCount,
        chatMessageCount: input.pool.chatMessageCount ?? null,
      },
      lines: [],
      alerts: [],
      suggestedAnnouncement: null,
      missingData,
      tokenCharge: {
        canCharge: false,
        reason: "Blocked users must not be charged for commissioner report attempts.",
      },
    }
  }

  const alerts = [
    incompleteBracketCount > 0 ? `${incompleteBracketCount} member(s) still need to finalize brackets.` : null,
    inviteAcceptanceRate != null && inviteAcceptanceRate < 40 ? `Invite acceptance is low at ${inviteAcceptanceRate}%.` : null,
    ...(input.pool.staleDataWarnings ?? []),
  ].filter((item): item is string => Boolean(item))
  const leader = input.pool.leaderboard?.find((row) => row.rank === 1) ?? input.pool.leaderboard?.[0] ?? null
  const lines = [
    `${input.pool.poolName} has ${input.pool.memberCount} member(s) and ${input.pool.finalizedEntryCount} finalized bracket(s).`,
    inviteAcceptanceRate == null
      ? "Invite acceptance is not tracked for this pool yet."
      : `${input.pool.inviteAcceptedCount}/${input.pool.inviteSentCount} invite(s) accepted (${inviteAcceptanceRate}%).`,
    leader ? `Current leader: @${leader.username} with ${leader.points} points.` : "Leaderboard snapshot is not available yet.",
    input.pool.chatMessageCount == null ? "Pool chat activity is not tracked yet." : `Pool chat has ${input.pool.chatMessageCount} message(s).`,
  ]

  return {
    status: missingData.length > 0 ? "partial" : "ready",
    accessReason: access.reason,
    metrics: {
      memberCount: input.pool.memberCount,
      finalizedEntryCount: input.pool.finalizedEntryCount,
      inviteAcceptedCount: input.pool.inviteAcceptedCount,
      inviteAcceptanceRate,
      incompleteBracketCount,
      chatMessageCount: input.pool.chatMessageCount ?? null,
    },
    lines,
    alerts,
    suggestedAnnouncement:
      incompleteBracketCount > 0
        ? `Reminder: finalize your ${input.pool.poolName} bracket before locks hit.`
        : `Thanks for keeping ${input.pool.poolName} active. Check the leaderboard and keep the debate going.`,
    missingData,
    tokenCharge: chargePolicyFromMissing({
      status: missingData.length > 0 ? "partial" : "ready",
      missingData,
      usefulOutput: true,
    }),
  }
}
