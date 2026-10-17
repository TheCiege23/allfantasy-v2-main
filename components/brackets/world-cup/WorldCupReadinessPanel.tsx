"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Loader2, RefreshCw, X } from "lucide-react"

type ReadinessStatus = "ready" | "pending" | "blocked" | "warning"

type WorldCupReadiness = {
  provider: {
    name: string
    configured: boolean
    apiKeyPresent: boolean
    leagueId: string | null
    leagueIdConfigured: boolean
    cronSecretPresent: boolean
    missingEnvVars: string[]
  }
  challenge?: {
    bracketTeamsSeeded?: number
  } | null
  data: {
    groupsComplete: boolean
    assignedTeams: number
    incompleteGroups: Array<{ groupName: string; teamCount: number; missingTeams: number }>
    fixtureCount: number
    groupStageFixtureCount: number
    knockoutFixtureCount: number
    knockoutFixturesAvailable: boolean
    venueKnownCount: number
    venueTbdCount: number
    kickoffKnownCount: number
    kickoffMissingCount: number
    standingsRowCount: number
    standingsSynced: boolean
    standingsState: "unavailable" | "pre_tournament" | "live" | "final"
    thirdPlaceRankingPresent: boolean
    bestThirdMappingConfigured: boolean
    groupStageReady: boolean
    knockoutsReady: boolean
    productionStatus: "ready" | "partial_ready" | "not_ready"
    warnings: string[]
  }
}

type ReadinessResponse = {
  ok: boolean
  readiness: WorldCupReadiness
  checkedAt?: string
}

type Props = {
  challengeId: string
  seasonYear?: number
}

function providerLabel(name: string) {
  if (name === "apifootball") return "API-Football"
  if (name === "sportsdata") return "SportsData.io"
  if (name === "manual") return "Manual"
  return "Mock"
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No"
}

function statusClass(status: ReadinessStatus) {
  if (status === "ready") return "border-cyan-300/30 bg-cyan-300/10 text-white/90"
  if (status === "pending") return "border-amber-300/30 bg-amber-400/10 text-white/80"
  if (status === "blocked") return "border-rose-300/35 bg-rose-400/10 text-white/85"
  return "border-white/10 bg-white/[0.05] text-white/70"
}

function StatusPill({ label, status }: { label: string; status: ReadinessStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusClass(status)}`}>
      {status === "ready" ? <Check className="h-3 w-3" aria-hidden /> : status === "blocked" ? <X className="h-3 w-3" aria-hidden /> : null}
      {label}
    </span>
  )
}

function missingEnvMessage(name: string, readiness: WorldCupReadiness) {
  if (name === "API_FOOTBALL_WORLD_CUP_LEAGUE_ID" && readiness.provider.leagueId) {
    return "Using fallback/default league ID because API_FOOTBALL_WORLD_CUP_LEAGUE_ID is not set."
  }
  return name
}

function ReadinessMetric({
  label,
  value,
  status = "warning",
}: {
  label: string
  value: string
  status?: ReadinessStatus
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-white/35">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs font-black text-white">{value}</span>
        <StatusPill label={status === "ready" ? "Ready" : status === "pending" ? "Pending" : status === "blocked" ? "Blocked" : "Warning"} status={status} />
      </div>
    </div>
  )
}

export default function WorldCupReadinessPanel({ challengeId, seasonYear = 2026 }: Props) {
  const [readiness, setReadiness] = useState<WorldCupReadiness | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReadiness = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ seasonYear: String(seasonYear) })
      if (challengeId) params.set("challengeId", challengeId)
      const response = await fetch(`/api/brackets/world-cup/admin/readiness?${params.toString()}`, {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("Readiness check failed")
      const payload = (await response.json()) as ReadinessResponse
      setReadiness(payload.readiness)
      setCheckedAt(payload.checkedAt ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Readiness check failed")
    } finally {
      setIsLoading(false)
    }
  }, [challengeId, seasonYear])

  useEffect(() => {
    void loadReadiness()
  }, [loadReadiness])

  // True when the operator is intentionally running mock/dev mode (no live data provider configured)
  const isDevMode = readiness != null && readiness.provider.name === "mock"

  const overall = useMemo(() => {
    if (!readiness) return { label: "Checking", status: "warning" as ReadinessStatus }
    if (readiness.data.productionStatus === "ready") return { label: "Production Ready", status: "ready" as ReadinessStatus }
    if (readiness.data.productionStatus === "partial_ready") return { label: "Partial Ready", status: "pending" as ReadinessStatus }
    // Mock provider → intentional dev/test mode, not a production blocker
    if (readiness.provider.name === "mock") return { label: "Dev / Test Mode", status: "warning" as ReadinessStatus }
    return { label: "Not Fully Ready", status: "blocked" as ReadinessStatus }
  }, [readiness])

  return (
    <section data-testid="world-cup-readiness-panel" className="mx-4 mb-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-white/65">World Cup Production Readiness</div>
          <p className="mt-1 text-[11px] leading-5 text-white/50">
            Safe admin view of provider configuration, imported data counts, and launch blockers. Secrets are never displayed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label={overall.label} status={overall.status} />
          <button
            type="button"
            onClick={() => void loadReadiness()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            Run readiness check
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-xs text-white/85">{error}</p>
      ) : null}

      {readiness ? (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <ReadinessMetric label="Provider" value={providerLabel(readiness.provider.name)} status={isDevMode ? "warning" : readiness.provider.configured ? "ready" : "blocked"} />
            <ReadinessMetric label="League ID" value={readiness.provider.leagueId ?? "Not set"} status={isDevMode ? "warning" : readiness.provider.leagueId ? "ready" : "blocked"} />
            <ReadinessMetric label="Data provider configured" value={yesNo(readiness.provider.configured)} status={isDevMode ? "warning" : readiness.provider.configured ? "ready" : "blocked"} />
            <ReadinessMetric label="API key configured" value={yesNo(readiness.provider.apiKeyPresent)} status={isDevMode ? "warning" : readiness.provider.apiKeyPresent ? "ready" : "blocked"} />
            <ReadinessMetric label="Cron secret configured" value={yesNo(readiness.provider.cronSecretPresent)} status={isDevMode ? "warning" : readiness.provider.cronSecretPresent ? "ready" : "blocked"} />
            <ReadinessMetric label="Provider teams grouped" value={`${readiness.data.assignedTeams}/48`} status={isDevMode ? "warning" : readiness.data.assignedTeams >= 48 ? "ready" : "blocked"} />
            {readiness.challenge ? (
              <ReadinessMetric
                label="App bracket teams seeded"
                value={`${readiness.challenge.bracketTeamsSeeded ?? 0}/48`}
                status={(readiness.challenge.bracketTeamsSeeded ?? 0) >= 48 ? "ready" : "warning"}
              />
            ) : null}
            <ReadinessMetric label="Group-stage fixtures" value={`${readiness.data.groupStageFixtureCount}/72`} status={isDevMode ? "warning" : readiness.data.groupStageFixtureCount >= 72 ? "ready" : "blocked"} />
            <ReadinessMetric label="Knockout fixtures" value={readiness.data.knockoutFixtureCount > 0 ? `${readiness.data.knockoutFixtureCount}` : "0 / pending"} status={readiness.data.knockoutFixturesAvailable ? "ready" : "pending"} />
            <ReadinessMetric label="Venue coverage" value={`${readiness.data.venueKnownCount} known / ${readiness.data.venueTbdCount} TBD`} status={readiness.data.venueTbdCount === 0 ? "ready" : "warning"} />
            <ReadinessMetric label="Kickoff coverage" value={`${readiness.data.kickoffKnownCount} known / ${readiness.data.kickoffMissingCount} missing`} status={readiness.data.kickoffMissingCount === 0 ? "ready" : "warning"} />
            <ReadinessMetric label="Standings rows" value={`${readiness.data.standingsRowCount}/48`} status={isDevMode ? "warning" : readiness.data.standingsSynced ? "ready" : "blocked"} />
            <ReadinessMetric label="Third-place ranking" value={yesNo(readiness.data.thirdPlaceRankingPresent)} status={readiness.data.thirdPlaceRankingPresent ? "ready" : "pending"} />
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">Teams / Groups</p>
              <p className="mt-1 text-xs font-black text-white">
                {readiness.data.groupsComplete ? "A-L complete" : "Missing groups listed below"}
              </p>
              {readiness.data.incompleteGroups.length > 0 ? (
                <p className="mt-1 text-[11px] text-white/80">
                  {readiness.data.incompleteGroups.map((group) => `${group.groupName}: ${group.teamCount}/4`).join(", ")}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">Standings State</p>
              <p className="mt-1 text-xs font-black text-white">
                {readiness.data.standingsState === "pre_tournament"
                  ? "Pre-tournament"
                  : readiness.data.standingsState === "live"
                    ? "Live"
                    : readiness.data.standingsState === "final"
                      ? "Final"
                      : "Unavailable"}
              </p>
              <p className="mt-1 text-[11px] text-white/45">0-played / 0-point rows are expected before kickoff.</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">Overall Readiness</p>
              <p className="mt-1 text-xs font-black text-white">
                Group Stage: {readiness.data.groupStageReady ? "Ready" : "Blocked"}
              </p>
              <p className="mt-1 text-xs font-black text-white">
                Knockouts: {readiness.data.knockoutsReady ? "Ready" : "Pending official fixtures/mapping"}
              </p>
              <p className="mt-1 text-[11px] text-white/45">
                Production status: {overall.label}
              </p>
            </div>
          </div>

          {isDevMode ? (
            <div className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 p-3 text-[11px] text-white/90">
              <p className="font-bold">Dev / Test Mode — not a production blocker</p>
              <p className="mt-1">
                This pool is using the <code className="rounded bg-black/20 px-1 font-mono">mock</code> data provider. Fixture counts, standings, and team assignments show 0 because no live data sync is configured — this is expected in local and staging environments. All amber metrics above are informational only.
              </p>
              <p className="mt-1">
                To enable live data: set{" "}
                <code className="rounded bg-black/20 px-1 font-mono">WORLD_CUP_DATA_PROVIDER=apifootball</code>{" "}
                (or <code className="rounded bg-black/20 px-1 font-mono">sportsdata</code>) and configure the matching API key env var, then re-run this check.
              </p>
            </div>
          ) : null}

          <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 text-[11px] text-white/80">
            <p className="font-bold">Best-third Round of 32 mapping</p>
            <p className="mt-1">
              Confirmed: {yesNo(readiness.data.bestThirdMappingConfigured)}
            </p>
            {!readiness.data.bestThirdMappingConfigured ? (
              <p className="mt-1">
                Best-third Round of 32 mapping is gated until FIFA confirms the official table.
              </p>
            ) : null}
          </div>

          {readiness.provider.missingEnvVars.length > 0 ? (
            <div className={`rounded-lg border p-3 text-[11px] ${isDevMode ? "border-cyan-300/20 bg-cyan-400/10 text-white/90" : "border-rose-300/20 bg-rose-400/10 text-white/85"}`}>
              <p className="font-bold">{isDevMode ? "Environment notes (dev mode — informational)" : "Environment configuration notes"}</p>
              <div className="mt-1 space-y-1">
                {readiness.provider.missingEnvVars.map((name) => (
                  <p key={name}>{missingEnvMessage(name, readiness)}</p>
                ))}
              </div>
            </div>
          ) : null}

          {readiness.data.warnings.length > 0 ? (
            <div className="space-y-1">
              {readiness.data.warnings.map((warning) => (
                <p key={warning} className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[11px] text-white/80">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          {checkedAt ? (
            <p className="text-[11px] text-white/35">Last checked {new Date(checkedAt).toLocaleString()}</p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">
          {isLoading ? "Checking World Cup readiness..." : "Run readiness check to load provider status."}
        </div>
      )}
    </section>
  )
}
