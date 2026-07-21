/**
 * Admin — World Cup Manual Actions
 * POST /api/admin/world-cup/actions
 *
 * Exposes one-click admin operations for World Cup data and scoring.
 * All actions are idempotent and safe to run while the tournament is live.
 *
 * Body: { action: AdminWorldCupAction }
 *
 * Actions:
 *   sync-fixtures      — Sync provider fixtures into the WC bracket matches
 *   sync-live-scores   — Pull live score updates for all active challenges
 *   sync-standings     — Refresh group standings from the data provider
 *   recompute-scores   — Re-evaluate all picks against final match results
 *   rebuild-grounding  — Check AI grounding readiness (no mutation, diagnostic only)
 *
 * Response: AdminWorldCupActionResult
 *
 * Admin-only. Guarded by requireAdmin().
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { syncWorldCupFixtures, syncWorldCupLiveScores, syncWorldCupProviderGroupStandings } from "@/lib/world-cup/worldCupDataSyncService"
import { recalculateWorldCupChallenge } from "@/lib/world-cup/worldCupScoringService"
import { getWorldCupOperationsReadiness } from "@/lib/world-cup/worldCupOperationsReadiness"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export type AdminWorldCupAction =
  | "sync-fixtures"
  | "sync-live-scores"
  | "sync-standings"
  | "recompute-scores"
  | "rebuild-grounding"

export type AdminWorldCupActionResult = {
  action: AdminWorldCupAction
  ok: boolean
  timestamp: string
  counts: Record<string, number>
  challengesProcessed: number
  warnings: string[]
  error?: string
}

const ACTIVE_CHALLENGE_STATUSES = ["open", "locked", "live"] as const

async function getActiveChallengeIds(): Promise<string[]> {
  const rows = await prisma.worldCupBracketChallenge.findMany({
    where: { status: { in: ACTIVE_CHALLENGE_STATUSES as unknown as string[] } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

async function runSyncFixtures(): Promise<AdminWorldCupActionResult> {
  const timestamp = new Date().toISOString()
  try {
    const result = await syncWorldCupFixtures({})
    return {
      action: "sync-fixtures",
      ok: true,
      timestamp,
      counts: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        officialFixturesCreated: result.officialFixturesCreated,
        officialFixturesUpdated: result.officialFixturesUpdated,
        bracketMatchesUpdated: result.bracketMatchesUpdated,
      },
      challengesProcessed: 0,
      warnings: result.warnings ?? [],
    }
  } catch (err) {
    return {
      action: "sync-fixtures",
      ok: false,
      timestamp,
      counts: {},
      challengesProcessed: 0,
      warnings: [],
      error: err instanceof Error ? err.message : "Unknown error syncing fixtures",
    }
  }
}

async function runSyncLiveScores(): Promise<AdminWorldCupActionResult> {
  const timestamp = new Date().toISOString()
  const challengeIds = await getActiveChallengeIds()
  if (challengeIds.length === 0) {
    return {
      action: "sync-live-scores",
      ok: true,
      timestamp,
      counts: { updated: 0, skipped: 0, finalMatches: 0 },
      challengesProcessed: 0,
      warnings: ["No active challenges found."],
    }
  }

  const counts = { updated: 0, skipped: 0, finalMatches: 0 }
  const warnings: string[] = []
  let processed = 0
  let lastError: string | undefined

  for (const challengeId of challengeIds) {
    try {
      const result = await syncWorldCupLiveScores({ challengeId })
      counts.updated += result.updated
      counts.skipped += result.skipped
      counts.finalMatches += result.finalMatches
      warnings.push(...(result.warnings ?? []))
      processed++
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Error on challenge ${challengeId}`
      warnings.push(`Challenge ${challengeId}: ${lastError}`)
    }
  }

  return {
    action: "sync-live-scores",
    ok: processed > 0 || challengeIds.length === 0,
    timestamp,
    counts,
    challengesProcessed: processed,
    warnings,
    error: lastError,
  }
}

async function runSyncStandings(): Promise<AdminWorldCupActionResult> {
  const timestamp = new Date().toISOString()
  const challengeIds = await getActiveChallengeIds()
  if (challengeIds.length === 0) {
    return {
      action: "sync-standings",
      ok: true,
      timestamp,
      counts: { created: 0, updated: 0, skipped: 0 },
      challengesProcessed: 0,
      warnings: ["No active challenges found."],
    }
  }

  const counts = { created: 0, updated: 0, skipped: 0 }
  const warnings: string[] = []
  let processed = 0
  let lastError: string | undefined

  for (const challengeId of challengeIds) {
    try {
      const result = await syncWorldCupProviderGroupStandings({ challengeId })
      counts.created += result.created
      counts.updated += result.updated
      counts.skipped += result.skipped
      warnings.push(...(result.warnings ?? []))
      processed++
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Error on challenge ${challengeId}`
      warnings.push(`Challenge ${challengeId}: ${lastError}`)
    }
  }

  return {
    action: "sync-standings",
    ok: processed > 0 || challengeIds.length === 0,
    timestamp,
    counts,
    challengesProcessed: processed,
    warnings,
    error: lastError,
  }
}

async function runRecomputeScores(): Promise<AdminWorldCupActionResult> {
  const timestamp = new Date().toISOString()
  const challengeIds = await getActiveChallengeIds()
  if (challengeIds.length === 0) {
    return {
      action: "recompute-scores",
      ok: true,
      timestamp,
      counts: { entriesUpdated: 0 },
      challengesProcessed: 0,
      warnings: ["No active challenges found."],
    }
  }

  const counts = { entriesUpdated: 0 }
  const warnings: string[] = []
  let processed = 0
  let lastError: string | undefined

  for (const challengeId of challengeIds) {
    try {
      const result = await recalculateWorldCupChallenge(challengeId)
      // recalculateWorldCupChallenge returns a leaderboard snapshot with rows
      counts.entriesUpdated += Array.isArray(result) ? result.length : 0
      processed++
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Error on challenge ${challengeId}`
      warnings.push(`Challenge ${challengeId}: ${lastError}`)
    }
  }

  return {
    action: "recompute-scores",
    ok: processed > 0 || challengeIds.length === 0,
    timestamp,
    counts,
    challengesProcessed: processed,
    warnings,
    error: lastError,
  }
}

async function runRebuildGrounding(): Promise<AdminWorldCupActionResult> {
  const timestamp = new Date().toISOString()
  try {
    const ops = await getWorldCupOperationsReadiness({})
    const aiGroundingReady =
      ops.data.fixtureCount > 0 && ops.data.standingsSynced && ops.data.groupStageReady
    return {
      action: "rebuild-grounding",
      ok: true,
      timestamp,
      counts: {
        fixtureCount: ops.data.fixtureCount,
        standingsRowCount: ops.data.standingsRowCount,
        groupStageFixtureCount: ops.data.groupStageFixtureCount,
        knockoutFixtureCount: ops.data.knockoutFixtureCount,
        aiGroundingReady: aiGroundingReady ? 1 : 0,
      },
      challengesProcessed: 0,
      warnings: ops.data.warnings ?? [],
    }
  } catch (err) {
    return {
      action: "rebuild-grounding",
      ok: false,
      timestamp,
      counts: {},
      challengesProcessed: 0,
      warnings: [],
      error: err instanceof Error ? err.message : "Unknown error checking AI grounding readiness",
    }
  }
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  let body: { action?: unknown }
  try {
    body = (await request.json()) as { action?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const action = body.action as string | undefined
  if (!action) {
    return NextResponse.json({ error: "Missing action in request body" }, { status: 400 })
  }

  const VALID_ACTIONS: AdminWorldCupAction[] = [
    "sync-fixtures",
    "sync-live-scores",
    "sync-standings",
    "recompute-scores",
    "rebuild-grounding",
  ]
  if (!VALID_ACTIONS.includes(action as AdminWorldCupAction)) {
    return NextResponse.json(
      { error: `Unknown action: ${action}. Valid actions: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 }
    )
  }

  let result: AdminWorldCupActionResult

  switch (action as AdminWorldCupAction) {
    case "sync-fixtures":
      result = await runSyncFixtures()
      break
    case "sync-live-scores":
      result = await runSyncLiveScores()
      break
    case "sync-standings":
      result = await runSyncStandings()
      break
    case "recompute-scores":
      result = await runRecomputeScores()
      break
    case "rebuild-grounding":
      result = await runRebuildGrounding()
      break
  }

  // Single choke point for all five actions — every one writes World Cup fixture,
  // score, standings or grounding data. Audited after dispatch so the recorded
  // outcome reflects what actually happened, not just what was requested.
  await logAdminAudit({
    adminUserId: resolveAdminAuditActor(gate.user),
    action: `admin_world_cup_${action.replace(/-/g, "_")}`,
    targetType: "world_cup",
    targetId: action,
    details: { action, succeeded: result.ok },
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
