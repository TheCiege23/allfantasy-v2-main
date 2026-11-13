"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { X, TrendingUp, RefreshCw, BookOpen, Users, Calendar, Zap, Loader2, MessageCircle } from "lucide-react"
import type { RetentionNudge } from "@/lib/onboarding-retention"

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  recap: BookOpen,
  return_nudge: RefreshCw,
  unfinished_reminder: Zap,
  weekly_summary: TrendingUp,
  ai_check_in: MessageCircle,
  creator_recommendation: Users,
  sport_season_prompt: Calendar,
}

const SAFE_HREF_PREFIXES = [
  "/dashboard",
  "/feed",
  "/onboarding/funnel",
  "/leagues",
  "/chimmy",
  "/creators",
  "/app",
] as const

function getSafeHref(href: string): string {
  if (!href || typeof href !== "string") return "/dashboard"
  if (href.startsWith("http://") || href.startsWith("https://")) return href
  if (!href.startsWith("/")) return "/dashboard"
  if (SAFE_HREF_PREFIXES.some((prefix) => href === prefix || href.startsWith(`${prefix}/`))) {
    return href
  }
  return "/dashboard"
}

interface ReturnPromptCardsProps {
  initialNudges?: RetentionNudge[] | null
  onDismiss?: (nudgeId: string) => void
  className?: string
}

export function ReturnPromptCards({
  initialNudges,
  onDismiss,
  className = "",
}: ReturnPromptCardsProps) {
  const [nudges, setNudges] = useState<RetentionNudge[]>(initialNudges ?? [])
  const [loading, setLoading] = useState(!initialNudges)
  const [dismissingId, setDismissingId] = useState<string | null>(null)

  const fetchNudges = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/retention/nudges", { cache: "no-store" })
      const data = await res.json()
      if (res.ok) setNudges(data.nudges ?? [])
      else setNudges([])
    } catch {
      setNudges([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialNudges) {
      setNudges(initialNudges)
      setLoading(false)
      return
    }
    fetchNudges()
  }, [initialNudges, fetchNudges])

  async function handleDismiss(nudgeId: string) {
    setDismissingId(nudgeId)
    try {
      const res = await fetch("/api/retention/nudges/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nudgeId }),
      })
      if (res.ok) {
        setNudges((prev) => prev.filter((n) => n.id !== nudgeId))
        onDismiss?.(nudgeId)
      }
    } catch {
      // keep card on error
    } finally {
      setDismissingId(null)
    }
  }

  if (loading && nudges.length === 0) {
    return (
      <div className={`rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-center gap-2 text-white/50 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  if (nudges.length === 0) return null

  return (
    <div data-testid="retention-prompt-cards" className={`space-y-3 ${className}`}>
      <h3 className="text-sm font-semibold text-white">For you</h3>
      {nudges.map((nudge) => {
        const Icon = TYPE_ICONS[nudge.type] ?? BookOpen
        const isDismissing = dismissingId === nudge.id
        const safeHref = getSafeHref(nudge.href)
        return (
          <div
            key={nudge.id}
            data-testid={`retention-nudge-card-${nudge.id}`}
            className="rounded-xl border border-white/10 bg-white/5 overflow-hidden hover:bg-white/[0.07] transition"
          >
            <div className="flex gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{nudge.title}</p>
                <p className="text-xs text-white/60 mt-0.5">{nudge.body}</p>
                <Link
                  href={safeHref}
                  data-testid={`retention-nudge-link-${nudge.id}`}
                  className="mt-2 inline-block text-xs font-medium text-cyan-400 hover:text-cyan-300"
                >
                  {nudge.ctaLabel} →
                </Link>
              </div>
              <button
                type="button"
                onClick={() => handleDismiss(nudge.id)}
                disabled={isDismissing}
                data-testid={`retention-nudge-dismiss-${nudge.id}`}
                className="shrink-0 rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white/70 transition disabled:opacity-50"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
