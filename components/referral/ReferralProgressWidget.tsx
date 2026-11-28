"use client"

import { useCallback, useEffect, useState } from "react"
import { Target, Trophy } from "lucide-react"
import type { ReferralProgress } from "@/lib/referral"

interface ReferralProgressWidgetProps {
  progress?: ReferralProgress | null
}

export function ReferralProgressWidget({ progress: providedProgress }: ReferralProgressWidgetProps) {
  const [progress, setProgress] = useState<ReferralProgress | null>(providedProgress ?? null)
  const [loading, setLoading] = useState(!providedProgress)

  const fetchProgress = useCallback(() => {
    if (providedProgress) return
    setLoading(true)
    fetch("/api/referral/progress")
      .then((response) => response.json())
      .then((data) => {
        if (data.ok && data.progress) setProgress(data.progress)
        else setProgress(null)
      })
      .catch(() => setProgress(null))
      .finally(() => setLoading(false))
  }, [providedProgress])

  useEffect(() => {
    if (providedProgress) {
      setProgress(providedProgress)
      setLoading(false)
      return
    }
    fetchProgress()
  }, [fetchProgress, providedProgress])

  if (loading) {
    return (
      <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
        <div className="h-24 animate-pulse rounded-xl bg-black/10" />
      </div>
    )
  }

  if (!progress) return null

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--panel) 64%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Target className="h-4 w-4" style={{ color: "var(--muted)" }} />
            Referral progress
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {progress.audience === "creator" ? "Creator" : "User"} tier tracking and onboarding conversion
          </p>
        </div>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: "var(--accent)", color: "var(--bg)" }}
        >
          <Trophy className="h-5 w-5" />
        </div>
      </div>

      {/* Side by side on a phone too (2026-11-25, the simplify pass): the tier and its rate are one line. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold" style={{ color: "var(--text)" }}>
            {progress.tier.label}
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {progress.signups} signup{progress.signups === 1 ? "" : "s"} • {progress.claimableRewards} reward
            {progress.claimableRewards === 1 ? "" : "s"} ready
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {progress.onboardingCompletionRate}%
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            onboarding completion
          </p>
        </div>
      </div>

      {progress.nextMilestone ? (
        <div className="mt-4 space-y-1">
          <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}>
            <span>Next: {progress.nextMilestone.label}</span>
            <span>
              {progress.signups} / {progress.nextMilestone.signups}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--panel2)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress.progressPct}%`, background: "var(--accent)" }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
          Top tier reached.
        </p>
      )}
    </div>
  )
}
