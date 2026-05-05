"use client"

import { useEffect, useMemo, useState } from "react"
import { Clock, ListChecks, Loader2 } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

type Props = {
  entryId: string
  status: string
  totalPicks: number
  totalGames: number
  lockAtIso?: string | null
  isLocked: boolean
}

export function BracketSubmitBar({
  entryId,
  status,
  totalPicks,
  totalGames,
  lockAtIso,
  isLocked,
}: Props) {
  const { t } = useLanguage()
  const [now, setNow] = useState(() => Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const completionPct = useMemo(
    () => (totalGames > 0 ? Math.round((totalPicks / totalGames) * 100) : 0),
    [totalPicks, totalGames],
  )
  const missing = Math.max(0, totalGames - totalPicks)

  const lockCountdown = useMemo(() => {
    if (!lockAtIso) return null
    const lockMs = new Date(lockAtIso).getTime()
    const diff = lockMs - now
    if (diff <= 0) return "Locked"
    const totalSeconds = Math.floor(diff / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, "0")}m`
    }
    return `${minutes.toString().padStart(2, "0")}m ${seconds
      .toString()
      .padStart(2, "0")}s`
  }, [lockAtIso, now])

  const normalizedStatus = useMemo(() => {
    const raw = (status || "").toUpperCase()
    if (isLocked) return "LOCKED"
    if (raw === "DRAFT" || raw === "SUBMITTED" || raw === "LOCKED" || raw === "SCORED" || raw === "INVALIDATED") {
      return raw
    }
    return "SUBMITTED"
  }, [status, isLocked])

  const canSubmit =
    !submitting &&
    !isLocked &&
    missing === 0 &&
    normalizedStatus !== "LOCKED" &&
    normalizedStatus !== "SCORED" &&
    normalizedStatus !== "INVALIDATED"

  async function handleSubmit() {
    setError(null)
    setSuccess(false)
    if (missing > 0) {
      setError(
        t("bracket.entry.submit.error") ||
          "Please complete all picks before submitting.",
      )
      return
    }
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/bracket/entries/${entryId}/submit`, {
        method: "POST",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setError(
          data?.message ||
            data?.error ||
            t("bracket.entry.submit.error"),
        )
        return
      }
      setSuccess(true)
    } catch {
      setError(t("bracket.entry.submit.error"))
    } finally {
      setSubmitting(false)
    }
  }

  function statusLabel(code: string): string {
    switch (code) {
      case "DRAFT":
        return t("bracket.status.draft")
      case "SUBMITTED":
        return t("bracket.status.submitted")
      case "LOCKED":
        return t("bracket.status.locked")
      case "SCORED":
        return t("bracket.status.scored")
      case "INVALIDATED":
        return t("bracket.status.invalidated")
      default:
        return code
    }
  }

  function statusColor(code: string): string {
    switch (code) {
      case "DRAFT":
        return "rgba(148,163,184,0.9)"
      case "SUBMITTED":
        return "rgba(251,191,36,0.95)"
      case "LOCKED":
        return "rgba(52,211,153,0.95)"
      case "SCORED":
        return "rgba(59,130,246,0.95)"
      case "INVALIDATED":
        return "rgba(248,113,113,0.95)"
      default:
        return "rgba(148,163,184,0.9)"
    }
  }

  return (
    <div
      className="fixed inset-x-0 z-[45] flex justify-center pointer-events-none max-lg:bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6"
      data-testid="bracket-submit-bar"
    >
      <div className="pointer-events-auto w-full max-w-5xl px-3 sm:px-4">
        <div
          className="rounded-2xl border shadow-lg shadow-black/40 px-3.5 py-2.5 sm:px-4 sm:py-3 flex items-center gap-3 sm:gap-4 bg-[#020617]/95"
          style={{ borderColor: "rgba(148,163,184,0.45)" }}
        >
          {/* Left: status + picks */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="hidden sm:flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(148,163,184,0.9)" }}>
                  Bracket Status
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: "rgba(15,23,42,0.9)",
                    border: "1px solid rgba(148,163,184,0.6)",
                    color: statusColor(normalizedStatus),
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: statusColor(normalizedStatus) }}
                  />
                  {statusLabel(normalizedStatus)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span style={{ color: "rgba(148,163,184,0.9)" }}>
                  {totalPicks}/{totalGames} picks made
                </span>
                {missing > 0 && (
                  <span style={{ color: "rgba(248,113,113,0.95)" }}>
                    · {missing} remaining
                  </span>
                )}
              </div>
            </div>

            <div className="flex sm:hidden flex-col gap-0.5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(148,163,184,0.9)" }}>
                  Status
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: "rgba(15,23,42,0.9)",
                    border: "1px solid rgba(148,163,184,0.6)",
                    color: statusColor(normalizedStatus),
                  }}
                >
                  {statusLabel(normalizedStatus)}
                </span>
              </div>
              <div className="text-[10px]" style={{ color: "rgba(148,163,184,0.9)" }}>
                {totalPicks}/{totalGames} picks · {completionPct}%
              </div>
            </div>
          </div>

          {/* Center: progress + lock countdown */}
          <div className="hidden sm:flex flex-col gap-1 flex-1 max-w-xs">
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: "rgba(148,163,184,0.9)" }}>Completion</span>
              <span style={{ color: "rgba(226,232,240,0.9)" }}>{completionPct}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,1)" }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${completionPct}%`,
                  background:
                    completionPct >= 100 ? "#22c55e" : "#fb923c",
                }}
              />
            </div>
            {lockAtIso && (
              <div className="flex items-center gap-1 text-[10px]" style={{ color: "rgba(148,163,184,0.9)" }}>
                <Clock className="w-3 h-3" />
                <span>
                  {lockCountdown === "Locked"
                    ? "Bracket lock reached"
                    : `Locks in ${lockCountdown}`}
                </span>
              </div>
            )}
          </div>

          {/* Right: CTA */}
          <div className="flex items-center gap-2">
            {error && (
              <span className="hidden sm:inline text-[10px]" style={{ color: "rgba(248,113,113,0.95)" }} data-testid="bracket-submit-error">
                {error}
              </span>
            )}
            {success && !error && (
              <span className="hidden sm:inline text-[10px]" style={{ color: "rgba(52,211,153,0.95)" }} data-testid="bracket-submit-success">
                {t("bracket.entry.submit.success")}
              </span>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex min-h-[44px] shrink-0 touch-manipulation items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-semibold shadow-sm disabled:opacity-50 sm:min-h-0 sm:px-3.5 sm:py-1.5"
              style={{
                background: canSubmit
                  ? "linear-gradient(to right, #f97316, #fb923c)"
                  : "rgba(15,23,42,0.8)",
                color: canSubmit ? "#0f172a" : "rgba(148,163,184,0.9)",
                border: canSubmit
                  ? "1px solid rgba(248,250,252,0.5)"
                  : "1px solid rgba(30,64,175,0.7)",
              }}
              data-testid="bracket-submit-button"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("bracket.entry.submit.loading")}
                </>
              ) : (
                <>
                  <ListChecks className="w-3.5 h-3.5" />
                  {missing > 0
                    ? "Finish picks"
                    : t("bracket.entry.submit.cta")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

