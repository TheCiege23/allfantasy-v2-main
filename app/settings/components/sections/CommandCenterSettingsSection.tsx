"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { LayoutGrid, HeartPulse, AlertTriangle, CalendarClock, ArrowRight, Sparkles } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

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
  /** Row id → navigable league id (manager-command-center route). Absent on an older response. */
  leagueLinks?: Record<string, string>
}

function severityColor(sev?: string): string {
  const s = (sev ?? "").toLowerCase()
  if (s.includes("crit") || s.includes("high") || s.includes("urgent")) return "var(--accent-red-strong)"
  if (s.includes("med") || s.includes("warn")) return "#e0a55a"
  return "var(--accent-cyan-strong)"
}

export function CommandCenterSettingsSection() {
  const { t, tInterpolate } = useLanguage()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)

  // Load-on-demand: composing the brief fans out across every league the user
  // belongs to, so it only runs on an explicit click — never automatically on
  // tab open. Keeps a casual settings visit from triggering a heavy aggregation.
  const load = useCallback(async () => {
    setStarted(true)
    setLoading(true)
    setFailed(false)
    const data = await fetch("/api/decision-os/manager-command-center", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    // A failed load used to fall through to "No leagues yet", which reads as a fact about the
    // account rather than a request that did not come back.
    if (data && typeof data === "object") setSnap(data as Snapshot)
    else setFailed(true)
    setLoading(false)
  }, [])

  const total = snap?.totalLeagues ?? 0
  const attention = (snap?.attentionQueue ?? []).slice(0, 6)
  const recCount = snap?.recommendations?.length ?? 0

  const tiles = [
    { key: "leagues", label: t("settings.command.tileLeagues"), icon: LayoutGrid, value: snap?.totalLeagues ?? 0 },
    { key: "healthy", label: t("settings.command.tileHealthy"), icon: HeartPulse, value: snap?.healthyLeagueCount ?? 0 },
    { key: "attention", label: t("settings.command.tileAttention"), icon: AlertTriangle, value: snap?.atRiskLeagueCount ?? 0 },
    { key: "drafts", label: t("settings.command.tileDrafts"), icon: CalendarClock, value: snap?.draftsApproachingCount ?? 0 },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("settings.nav.command")}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {t("settings.hub.desc.command")}
        </p>
      </div>

      {!started ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <Sparkles className="mx-auto h-5 w-5" style={{ color: "var(--accent-cyan-strong)" }} />
          <p className="mx-auto mt-2 max-w-sm text-xs" style={{ color: "var(--muted)" }}>
            {t("settings.command.intro")}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
          >
            {t("settings.command.loadBrief")}
          </button>
        </div>
      ) : loading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.command.building")}</p>
      ) : failed ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--panel2)" }} role="alert">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{t("settings.command.loadFailedTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs" style={{ color: "var(--muted)" }}>
            {t("settings.command.loadFailedBody")}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
          >
            {t("settings.tryAgain")}
          </button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{t("settings.command.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs" style={{ color: "var(--muted)" }}>
            {t("settings.command.emptyBody")}
          </p>
          <Link
            href="/import"
            className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
          >
            {t("settings.command.importLeague")}
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
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Attention queue */}
          <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
              {t("settings.command.needsAttention")}
            </p>
            {attention.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.command.caughtUp")}</p>
            ) : (
              <ul className="space-y-3">
                {attention.map((s) => {
                  /*
                   * Each item opens its league. They were plain text before 2026-10-02 — a list of
                   * things needing a decision with no way to go and make it.
                   */
                  const navId = s.leagueId ? snap?.leagueLinks?.[s.leagueId] : undefined
                  const body = (
                    <div className="min-w-0">
                      {/* The dot's colour is the only other severity cue; say it for screen readers. */}
                      {s.severity ? (
                        <span className="sr-only">
                          {tInterpolate("settings.command.severityPriority", { severity: s.severity })}
                        </span>
                      ) : null}
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
                  )
                  return (
                    <li key={s.id} className="flex gap-3">
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: severityColor(s.severity) }}
                        aria-hidden="true"
                      />
                      {navId ? (
                        <Link
                          href={`/league/${encodeURIComponent(navId)}`}
                          className="min-w-0 flex-1 rounded-md hover:underline"
                          data-testid={`command-center-item-${s.id}`}
                        >
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Full view link */}
          <Link
            href="/manager-hub"
            className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {t("settings.command.openFull")}
            {recCount > 0 ? (
              <span style={{ color: "var(--muted)" }}>
                {tInterpolate("settings.command.recommendations", { count: recCount })}
              </span>
            ) : null}
            <ArrowRight className="h-4 w-4" style={{ color: "var(--accent-cyan-strong)" }} />
          </Link>
        </>
      )}
    </div>
  )
}
