"use client"

/**
 * Player Command Center (Slice 4) — the panic-proof cross-league view.
 * Layer 1 (always visible, fast): player, status, exposure, urgency, next lock.
 * Layer 2 (expand): per-league cards — roster slot, reasons, record, waiver
 * state (mode / FAAB / priority / next run), projection, freshness.
 * Data comes exclusively from /api/player-command-center (session-derived).
 */

import React from "react"

type UrgencyLevel = "critical" | "high" | "medium" | "low" | "none"

interface AppearanceUrgency {
  canonicalLeagueId: string
  leagueName: string
  level: UrgencyLevel
  reasons: string[]
  actionRequired: boolean
}

interface WaiverWorld {
  leagueId: string
  waiverType: string | null
  claimMode: "faab" | "priority" | "first_come" | "unknown"
  faabBudget: number | null
  userFaabRemaining: number | null
  userWaiverPriority: number | null
  instantFaAfterClear: boolean | null
  lastRunAt: string | null
  nextRunAt: string | null
  processingLocked: boolean | null
  ranWithinLastDay: boolean | null
  userPendingClaimCount: number
}

interface Appearance {
  canonicalLeagueId: string
  leagueName: string
  provider: string
  playerId: string
  rosterStatus: string
  record: string | null
  standing: number | null
  recommendation: { title?: string; summary?: string; priority?: string } | null
  syncFreshness: { state: string; lastSyncedAt: string | null }
}

interface Item {
  canonicalPlayerId: string
  displayName: string
  sport: string
  position: string | null
  professionalTeam: string | null
  headshotUrl: string | null
  injury: { status: string } | null
  schedule: { byeWeek: number | null; nextOpponent: string | null; nextGameAt: string | null; gamesNext7Days: number | null } | null
  projection: { projectedPoints: number; week: number; season: string; source: string } | null
  exposure: { leagueCount: number; starterCount: number; benchCount: number }
  leagueAppearances: Appearance[]
  urgency: {
    overall: UrgencyLevel
    urgentLeagueCount: number
    nextLockAt: string | null
    minutesToLock: number | null
    appearances: AppearanceUrgency[]
  }
}

interface ApiResponse {
  ok: boolean
  error?: string
  generatedAt?: string
  connectedLeagueCount?: number
  waiverWorldByLeague?: Record<string, WaiverWorld>
  totalPlayers?: number
  urgentPlayerCount?: number
  items?: Item[]
}

interface ReplacementCandidate {
  playerId: string
  name: string
  position: string | null
  projectedPoints: number
  delta: number | null
}

type ClaimTarget =
  | { kind: "native"; url: string }
  | { kind: "provider"; provider: string; url: string }
  | { kind: "none" }

interface ReplacementsResponse {
  ok: boolean
  error?: string
  affectedProjection?: number | null
  projectionWeek?: number | null
  benchOptions?: ReplacementCandidate[]
  freeAgentOptions?: ReplacementCandidate[]
  claimTarget?: ClaimTarget
  lineupTarget?: ClaimTarget
  limitation?: string | null
}

const URGENCY_STYLES: Record<UrgencyLevel, string> = {
  critical: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  high: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  medium: "bg-yellow-500/10 text-yellow-200 border-yellow-500/30",
  low: "bg-white/10 text-white/60 border-white/20",
  none: "bg-white/5 text-white/40 border-white/10",
}

const INJURY_STYLES: Record<string, string> = {
  out: "bg-rose-500/20 text-rose-300",
  ir: "bg-rose-500/20 text-rose-300",
  suspended: "bg-rose-500/20 text-rose-300",
  doubtful: "bg-amber-500/20 text-amber-300",
  questionable: "bg-yellow-500/15 text-yellow-200",
  day_to_day: "bg-yellow-500/15 text-yellow-200",
}

function lockLabel(minutes: number | null): string | null {
  if (minutes == null) return null
  if (minutes < 60) return `${minutes}m to lock`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h < 24) return `${h}h ${m}m to lock`
  return `${Math.floor(h / 24)}d ${h % 24}h to lock`
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function CandidateChipBody({ c }: { c: ReplacementCandidate }) {
  return (
    <>
      {c.name}
      {c.position ? ` (${c.position})` : ""} · {c.projectedPoints.toFixed(1)}
      {c.delta != null && (
        <span className={c.delta >= 0 ? "text-emerald-300" : "text-rose-300"}>
          {" "}
          {c.delta >= 0 ? "+" : ""}
          {c.delta.toFixed(1)}
        </span>
      )}
    </>
  )
}

const CHIP_CLASS =
  "rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-100"
const LINK_CHIP_CLASS = `${CHIP_CLASS} hover:bg-emerald-400/20 hover:border-emerald-400/40 cursor-pointer`

function CandidateRow({
  label,
  options,
  claimTarget,
}: {
  label: string
  options: ReplacementCandidate[]
  /** When set, chips link to the claim surface (Slice 7). */
  claimTarget?: ClaimTarget
}) {
  if (options.length === 0) return null
  const hint =
    claimTarget?.kind === "native"
      ? label.toLowerCase().includes("bench")
        ? "open your lineup"
        : "tap to claim"
      : claimTarget?.kind === "provider"
        ? `opens ${claimTarget.provider}`
        : null
  return (
    <div className="mt-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
        {label}
        {hint && <span className="ml-1.5 normal-case tracking-normal text-cyan-200/60">({hint})</span>}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((c) => {
          if (claimTarget?.kind === "native") {
            return (
              <a
                key={c.playerId}
                href={`${claimTarget.url}&playerId=${encodeURIComponent(c.playerId)}`}
                className={LINK_CHIP_CLASS}
                title={`Open the waiver wire with ${c.name} preselected`}
              >
                <CandidateChipBody c={c} />
              </a>
            )
          }
          if (claimTarget?.kind === "provider") {
            return (
              <a
                key={c.playerId}
                href={claimTarget.url}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CHIP_CLASS}
                title={`Open this league on ${claimTarget.provider} to claim ${c.name}`}
              >
                <CandidateChipBody c={c} />
              </a>
            )
          }
          return (
            <span key={c.playerId} className={CHIP_CLASS}>
              <CandidateChipBody c={c} />
            </span>
          )
        })}
      </div>
    </div>
  )
}

function ReplacementPanel({
  leagueId,
  playerId,
  rosterPlayerId,
}: {
  leagueId: string
  playerId: string
  rosterPlayerId: string
}) {
  const [state, setState] = React.useState<"idle" | "loading" | "done" | "error">("idle")
  const [reps, setReps] = React.useState<ReplacementsResponse | null>(null)

  const load = React.useCallback(async () => {
    setState("loading")
    try {
      const res = await fetch(
        `/api/player-command-center/replacements?leagueId=${encodeURIComponent(leagueId)}&playerId=${encodeURIComponent(rosterPlayerId)}`,
      )
      const json = (await res.json()) as ReplacementsResponse
      if (!res.ok || !json.ok) {
        setState("error")
      } else {
        setReps(json)
        setState("done")
      }
    } catch {
      setState("error")
    }
  }, [leagueId, rosterPlayerId])

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => void load()}
        className="mt-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-400/20"
      >
        Show replacement options
      </button>
    )
  }
  if (state === "loading") return <div className="mt-2 text-[11px] text-white/40">Finding replacements…</div>
  if (state === "error" || !reps) return <div className="mt-2 text-[11px] text-rose-300/70">Could not load replacements.</div>
  if (reps.limitation === "no_projection_data") {
    return <div className="mt-2 text-[11px] text-white/40">No projection data available for this league yet.</div>
  }
  const empty = (reps.benchOptions?.length ?? 0) === 0 && (reps.freeAgentOptions?.length ?? 0) === 0
  return (
    <div key={playerId}>
      {reps.projectionWeek != null && (
        <div className="mt-2 text-[10px] text-white/35">Week {reps.projectionWeek} projections</div>
      )}
      <CandidateRow label="Best on your bench" options={reps.benchOptions ?? []} claimTarget={reps.lineupTarget} />
      <CandidateRow label="Best available" options={reps.freeAgentOptions ?? []} claimTarget={reps.claimTarget} />
      {empty && <div className="mt-1.5 text-[11px] text-white/40">No clearly better options found at this position.</div>}
    </div>
  )
}

function WaiverLine({ world }: { world: WaiverWorld | undefined }) {
  if (!world) return null
  const bits: string[] = []
  if (world.claimMode === "faab") {
    bits.push(
      world.userFaabRemaining != null
        ? `FAAB $${world.userFaabRemaining}${world.faabBudget != null ? `/$${world.faabBudget}` : ""}`
        : "FAAB league",
    )
  } else if (world.claimMode === "priority" && world.userWaiverPriority != null) {
    bits.push(`Waiver priority #${world.userWaiverPriority}`)
  }
  if (world.nextRunAt) {
    bits.push(`next run ${new Date(world.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`)
  } else if (world.ranWithinLastDay) {
    bits.push("waivers ran in the last 24h")
  }
  if (world.userPendingClaimCount > 0) bits.push(`${world.userPendingClaimCount} pending claim${world.userPendingClaimCount > 1 ? "s" : ""}`)
  if (bits.length === 0) return null
  return <div className="mt-1 text-[11px] text-cyan-200/70">{bits.join(" · ")}</div>
}

export default function PlayerCommandCenterClient() {
  const [data, setData] = React.useState<ApiResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [urgentOnly, setUrgentOnly] = React.useState(false)
  const [expanded, setExpanded] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/player-command-center")
      const json = (await res.json()) as ApiResponse
      if (!res.ok || !json.ok) {
        setError(json.error ?? (res.status === 401 ? "Sign in to see your players." : "Could not load your players."))
        setData(null)
      } else {
        setData(json)
      }
    } catch {
      setError("Could not load your players. Check your connection and retry.")
      setData(null)
    }
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const items = React.useMemo(() => {
    let list = data?.items ?? []
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((i) => i.displayName.toLowerCase().includes(q))
    if (urgentOnly) list = list.filter((i) => i.urgency.urgentLeagueCount > 0)
    return list
  }, [data, query, urgentOnly])

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Player Command Center</h1>
          <p className="mt-1 text-sm text-white/60">
            One search. Every league where a player matters — status, time left, best move.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your players…"
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-cyan-400/50"
        />
        <button
          type="button"
          onClick={() => setUrgentOnly((v) => !v)}
          className={`whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold ${
            urgentOnly
              ? "border-rose-400/40 bg-rose-500/15 text-rose-200"
              : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          Needs action{data?.urgentPlayerCount ? ` (${data.urgentPlayerCount})` : ""}
        </button>
      </div>

      {loading && (
        <div className="mt-10 text-center text-sm text-white/50">Loading your players across every connected league…</div>
      )}
      {error && !loading && (
        <div className="mt-10 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-center text-sm text-rose-200">
          {error}
        </div>
      )}
      {!loading && !error && data && (data.connectedLeagueCount ?? 0) === 0 && (
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <div className="text-sm font-semibold text-white/90">No connected leagues yet</div>
          <p className="mt-1 text-sm text-white/60">Import a league and your players will show up here automatically.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="mt-6 space-y-3">
          {items.map((item) => {
            const isOpen = expanded === item.canonicalPlayerId
            const urgencyByLeague = new Map(item.urgency.appearances.map((a) => [a.canonicalLeagueId, a]))
            const lock = lockLabel(item.urgency.minutesToLock)
            return (
              <div key={item.canonicalPlayerId} className="rounded-2xl border border-white/10 bg-white/5">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : item.canonicalPlayerId)}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  {item.headshotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.headshotUrl} alt="" className="h-10 w-10 rounded-full bg-white/10 object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/70">
                      {initials(item.displayName)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white/95">{item.displayName}</span>
                      <span className="text-xs text-white/50">
                        {item.position ?? "—"}
                        {item.professionalTeam ? ` · ${item.professionalTeam}` : ""}
                      </span>
                      {item.injury && INJURY_STYLES[item.injury.status] && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${INJURY_STYLES[item.injury.status]}`}>
                          {item.injury.status.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
                      <span>
                        {item.exposure.leagueCount} league{item.exposure.leagueCount !== 1 ? "s" : ""}
                        {item.exposure.starterCount > 0 ? ` · starting in ${item.exposure.starterCount}` : ""}
                      </span>
                      {item.projection && <span>proj {item.projection.projectedPoints.toFixed(1)} (wk {item.projection.week})</span>}
                      {item.schedule?.gamesNext7Days != null && item.schedule.gamesNext7Days > 0 && (
                        <span>{item.schedule.gamesNext7Days} game{item.schedule.gamesNext7Days !== 1 ? "s" : ""} next 7d</span>
                      )}
                      {lock && <span className="text-amber-300/80">{lock}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.urgency.urgentLeagueCount > 0 && (
                      <span className="text-[11px] font-semibold text-rose-300">
                        {item.urgency.urgentLeagueCount} need{item.urgency.urgentLeagueCount === 1 ? "s" : ""} action
                      </span>
                    )}
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${URGENCY_STYLES[item.urgency.overall]}`}>
                      {item.urgency.overall}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="space-y-2 border-t border-white/10 p-4">
                    {item.leagueAppearances.map((a) => {
                      const u = urgencyByLeague.get(a.canonicalLeagueId)
                      const world = data?.waiverWorldByLeague?.[a.canonicalLeagueId]
                      return (
                        <div key={`${item.canonicalPlayerId}:${a.canonicalLeagueId}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white/90">{a.leagueName}</span>
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase text-white/50">{a.provider}</span>
                              <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">{a.rosterStatus}</span>
                            </div>
                            {u && u.level !== "none" && (
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${URGENCY_STYLES[u.level]}`}>
                                {u.level}
                              </span>
                            )}
                          </div>
                          {(a.record || a.standing != null) && (
                            <div className="mt-1 text-[11px] text-white/50">
                              {a.record ?? ""}
                              {a.standing != null ? ` · #${a.standing}` : ""}
                            </div>
                          )}
                          {u && u.reasons.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {u.reasons.map((r, i) => (
                                <li key={i} className="flex items-start gap-1 text-[11px] text-white/70">
                                  <span className="mt-px text-amber-300/70">›</span>
                                  <span>{r}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <WaiverLine world={world} />
                          {u?.actionRequired && (
                            <ReplacementPanel
                              leagueId={a.canonicalLeagueId}
                              playerId={item.canonicalPlayerId}
                              rosterPlayerId={a.playerId}
                            />
                          )}
                          {a.syncFreshness.state === "stale" && (
                            <div className="mt-1 text-[10px] text-amber-300/60">League data may be stale — refresh before acting.</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && !error && data && items.length === 0 && (data.connectedLeagueCount ?? 0) > 0 && (
        <div className="mt-10 text-center text-sm text-white/50">
          {query || urgentOnly ? "No players match this filter." : "No rostered players found in your connected leagues."}
        </div>
      )}
    </div>
  )
}
