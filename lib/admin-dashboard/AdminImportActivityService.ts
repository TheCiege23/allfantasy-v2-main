/**
 * Fantasy league import activity — distinct from sports-data provider ingestion
 * (see AdminProviderHealthService). Sourced from ImportRun, which is written on
 * every real user-initiated league import (importPersistenceService.ts) but was
 * previously never read by any admin surface.
 */
import { prisma } from "@/lib/prisma"
import { IMPORT_PROVIDER_UI_OPTIONS, getImportProviderLabel } from "@/lib/league-import/provider-ui-config"
import type { ImportProvider } from "@/lib/league-import/types"

export type FantasyImportProviderActivity = {
  provider: ImportProvider
  label: string
  /** From provider-ui-config's own maintained availability flag — not inferred from row counts. */
  availableToUsers: boolean
  attempts: number
  successes: number
  failures: number
  successRatePct: number | null
  avgCompletionMs: number | null
  recentFailureReason: string | null
  uniqueImportingUsers: number
  importedLeagues: number
}

export type FantasyImportActivitySummary = {
  generatedAt: string
  windowDays: number
  byProvider: FantasyImportProviderActivity[]
  totals: {
    attempts: number
    successes: number
    failures: number
    uniqueImportingUsers: number
    importedLeagues: number
  }
  unavailable: boolean
  unavailableReason?: string
}

const ALL_PROVIDERS = IMPORT_PROVIDER_UI_OPTIONS.map((o) => o.provider)
const AVAILABLE_PROVIDERS = new Set(IMPORT_PROVIDER_UI_OPTIONS.filter((o) => o.available).map((o) => o.provider))

type RunRow = {
  provider: string
  status: string
  error: string | null
  userId: string
  leagueId: string | null
  startedAt: Date
  completedAt: Date | null
}

function summarizeProvider(provider: ImportProvider, rows: RunRow[]): FantasyImportProviderActivity {
  const attempts = rows.length
  const successes = rows.filter((r) => r.status === "completed").length
  const failures = rows.filter((r) => r.status === "failed").length
  const completedWithDuration = rows.filter((r) => r.status === "completed" && r.completedAt)
  const avgCompletionMs =
    completedWithDuration.length > 0
      ? Math.round(
          completedWithDuration.reduce((sum, r) => sum + (r.completedAt!.getTime() - r.startedAt.getTime()), 0) /
            completedWithDuration.length
        )
      : null
  const mostRecentFailure = rows.find((r) => r.status === "failed" && r.error)
  const uniqueImportingUsers = new Set(rows.map((r) => r.userId)).size
  const importedLeagues = new Set(
    rows.filter((r) => r.status === "completed" && r.leagueId).map((r) => r.leagueId as string)
  ).size

  return {
    provider,
    label: getImportProviderLabel(provider),
    availableToUsers: AVAILABLE_PROVIDERS.has(provider),
    attempts,
    successes,
    failures,
    successRatePct: attempts > 0 ? Math.round((successes / attempts) * 100) : null,
    avgCompletionMs,
    recentFailureReason: mostRecentFailure?.error ?? null,
    uniqueImportingUsers,
    importedLeagues,
  }
}

/** Real fantasy-league import activity per provider, from ImportRun. Bounded to a recent window
 * (default 30 days) so this stays a small, cheap query as import volume grows — this is a real
 * user-action log, not a page-view mirror, so row counts are orders of magnitude smaller than
 * AnalyticsEvent. */
export async function getFantasyImportActivity(windowDays = 30): Promise<FantasyImportActivitySummary> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  try {
    const runs = await prisma.importRun.findMany({
      where: { startedAt: { gte: since } },
      select: {
        provider: true,
        status: true,
        error: true,
        userId: true,
        leagueId: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { startedAt: "desc" },
    })

    const byProvider = ALL_PROVIDERS.map((provider) =>
      summarizeProvider(provider, runs.filter((r) => r.provider === provider))
    )

    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      byProvider,
      totals: {
        attempts: runs.length,
        successes: runs.filter((r) => r.status === "completed").length,
        failures: runs.filter((r) => r.status === "failed").length,
        uniqueImportingUsers: new Set(runs.map((r) => r.userId)).size,
        importedLeagues: new Set(
          runs.filter((r) => r.status === "completed" && r.leagueId).map((r) => r.leagueId as string)
        ).size,
      },
      unavailable: false,
    }
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      byProvider: [],
      totals: { attempts: 0, successes: 0, failures: 0, uniqueImportingUsers: 0, importedLeagues: 0 },
      unavailable: true,
      unavailableReason: "ImportRun query failed — do not read as zero import activity",
    }
  }
}
