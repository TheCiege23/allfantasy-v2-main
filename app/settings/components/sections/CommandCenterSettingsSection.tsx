"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { LayoutGrid, HeartPulse, AlertTriangle, CalendarClock, ArrowRight, Sparkles } from "lucide-react"

/**
 * Command Center — READ-ONLY daily brief.
 *
 * Real data via GET /api/decision-os/manager-command-center: a no-params,
 * current-user endpoint that resolves the caller's leagues server-side and
 * degrades to an empty snapshot (never 500s). This is the "daily-briefing"
 * framing from the design handoff — deliberately distinct from the Notifications
 * tab (granular per-event control). The handoff's digest toggles / send-time /
 * discord matrix have NO backend, so they're intentionally not rendered here.
 * See memory `settings-panels-data-backing`.
 */

type AttentionSignal = {
  id: string
  leagueId?: string
  severity?: string
  title?: string
  explanation?: string
  recommendedAction?: string | null
}

type Snapshot = {
  totalLeagues?: number
  healthyLeagueCount?: number
  atRiskLeagueCount?: number
  unavailableLeagueCount?: number
  draftsApproachingCount?: number
  attentionQueue?: AttentionSignal[]
  recommendations?: Array<{ leagueId?: string }>
}

function severityColor(sev?: string): string {
  const s = (sev ?? "").toLowerCase()
  if (s.includes("crit") || s.includes("high") || s.includes("urgent")) return "var(--accent-red-strong)"
  if (s.includes("med") || s.includes("warn")) return "#e0a55a"
  return "var(--accent-cyan-strong)"
}

export function CommandCenterSettingsSection() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)

  // Load-on-demand: composing the brief fans out across every league the user
  // belongs to, so it only runs on an explicit click — never automatically on
  // tab open. Keeps a casual settings visit from triggering a heavy aggregation.
  const load = useCallback(async () => {
    setStarted(true)
    setLoading(true)
    const data = await fetch("/api/decision-os/manager-command-center", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    if (data && typeof data === "object") setSnap(data as Snapshot)
    setLoading(false)
  }, [])

  const total = snap?.totalLeagues ?? 0
  const attention = (snap?.attentionQueue ?? []).slice(0, 6)
  const recCount = snap?.recommendations?.length ?? 0

  const tiles = [
    { key: "leagues", label: "Leagues", icon: LayoutGrid, value: snap?.totalLeagues ?? 0 },
    { key: "healthy", label: "Healthy", icon: HeartPulse, value: snap?.healthyLeagueCount ?? 0 },
    { key: "attention", label: "Need attention", icon: AlertTriangle, value: snap?.atRiskLeagueCount ?? 0 },
    { key: "drafts", label: "Drafts soon", icon: CalendarClock, value: snap?.draftsApproachingCount ?? 0 },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Command Center</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Your daily brief — what needs a decision across your leagues.
        </p>
      </div>

      {!started ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <Sparkles className="mx-auto h-5 w-5" style={{ color: "var(--accent-cyan-strong)" }} />
          <p className="mx-auto mt-2 max-w-sm text-xs" style={{ color: "var(--muted)" }}>
            Your daily brief pulls live health and attention signals across every league you&apos;re in.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
          >
            Load today&apos;s brief
          </button>
        </div>
      ) : loading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Building your brief…</p>
      ) : total === 0 ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>No leagues yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs" style={{ color: "var(--muted)" }}>
            Import or join a league and your daily brief will show what needs your attention here.
          </p>
          <Link
            href="/import"
            className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
          >
            Import a league
          </Link>
        </div>
      ) : (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map(({ key, label, icon: Icon, value }) => (
              <div key={key} className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
                <Icon className="h-4 w-4" style={{ color: "var(--accent-cyan-strong)" }} />
                <div className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>{value}</div>
                <div className="text-[10.5px]" style={{ color: "var(--muted)" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Attention queue */}
          <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
              Needs your attention
            </p>
            {attention.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>You&apos;re all caught up — nothing needs a decision right now.</p>
            ) : (
              <ul className="space-y-3">
                {attention.map((s) => (
                  <li key={s.id} className="flex gap-3">
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: severityColor(s.severity) }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      {s.title ? (
                        <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.title}</div>
                      ) : null}
                      {s.explanation ? (
                        <div className="text-xs" style={{ color: "var(--muted)" }}>{s.explanation}</div>
                      ) : null}
                      {s.recommendedAction ? (
                        <div className="mt-0.5 text-xs font-medium" style={{ color: "var(--accent-cyan-strong)" }}>
                          {s.recommendedAction}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Full view link */}
          <Link
            href="/manager-hub"
            className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Open the full command center
            {recCount > 0 ? <span style={{ color: "var(--muted)" }}>· {recCount} recommendations</span> : null}
            <ArrowRight className="h-4 w-4" style={{ color: "var(--accent-cyan-strong)" }} />
          </Link>
        </>
      )}
    </div>
  )
}
