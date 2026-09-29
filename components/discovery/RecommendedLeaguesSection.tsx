"use client"

import { useCallback, useEffect, useState } from "react"
import { Sparkles, Loader2, Wand2 } from "lucide-react"
import { LeagueDiscoveryCard } from "./LeagueDiscoveryCard"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

export interface RecommendedLeaguesSectionProps {
  sport?: string | null
  limit?: number
}

interface RecommendationItem {
  league: DiscoveryCard
  explanation: string | null
  reasons?: string[]
  matchedSignals?: string[]
  explanationSource?: "deterministic" | "ai"
}

interface RecommendationProfileSignals {
  favoriteSports?: string[]
  historicalSports?: string[]
  pastLeagueCount?: number
  hasDraftParticipation?: boolean
  leagueTypesJoined?: string[]
  aiUsageLevel?: "low" | "medium" | "high"
}

export function RecommendedLeaguesSection({ sport = null, limit = 6 }: RecommendedLeaguesSectionProps) {
  const [items, setItems] = useState<RecommendationItem[]>([])
  const [personalized, setPersonalized] = useState(false)
  const [aiExplainEnabled, setAiExplainEnabled] = useState(false)
  const [profileSignals, setProfileSignals] = useState<RecommendationProfileSignals | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchRecommended = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (sport) params.set("sport", sport)
    params.set("limit", String(limit))
    if (aiExplainEnabled) params.set("aiExplain", "1")
    fetch(`/api/discover/recommendations?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.leagues)) {
          setItems(
            d.leagues.map(
              (x: {
                league: DiscoveryCard
                explanation?: string | null
                reasons?: string[]
                matchedSignals?: string[]
                explanationSource?: "deterministic" | "ai"
              }) => ({
              league: x.league,
              explanation: x.explanation ?? null,
              reasons: Array.isArray(x.reasons) ? x.reasons.slice(0, 3) : [],
              matchedSignals: Array.isArray(x.matchedSignals) ? x.matchedSignals : [],
              explanationSource: x.explanationSource ?? "deterministic",
            })
            )
          )
          setPersonalized(!!d.personalized)
          setProfileSignals((d.profileSignals ?? null) as RecommendationProfileSignals | null)
        } else {
          setItems([])
          setProfileSignals(null)
        }
      })
      .catch(() => {
        setItems([])
        setProfileSignals(null)
      })
      .finally(() => setLoading(false))
  }, [sport, limit, aiExplainEnabled])

  useEffect(() => {
    fetchRecommended()
  }, [fetchRecommended])

  if (loading) {
    return (
      <section
        className="rounded-xl border p-6"
        style={{ borderColor: "var(--border)" }}
        data-testid="recommended-leagues-section"
      >
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text)" }}>
          <Sparkles className="h-5 w-5" style={{ color: "var(--muted)" }} />
          Recommended for you
        </h2>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--muted)" }} />
        </div>
      </section>
    )
  }

  if (items.length === 0) return null

  return (
    <section
      className="rounded-xl border p-6"
      style={{ borderColor: "var(--border)" }}
      data-testid="recommended-leagues-section"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Sparkles className="h-5 w-5" style={{ color: "var(--muted)" }} />
            Recommended for you
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Deterministic-first matching from your favorite sports, past leagues, draft behavior, league types, and AI usage.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAiExplainEnabled((value) => !value)}
          data-testid="recommended-leagues-ai-toggle"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"
          style={{
            borderColor: "var(--border)",
            color: "var(--text)",
            background: aiExplainEnabled
              ? "color-mix(in srgb, var(--accent) 18%, transparent)"
              : "color-mix(in srgb, var(--panel2) 35%, transparent)",
          }}
        >
          <Wand2 className="h-3.5 w-3.5" />
          {aiExplainEnabled ? "AI explanations on" : "Enable AI explanations"}
        </button>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        {personalized
          ? "Based on your favorite sports, past leagues, and league types."
          : "Leagues filling up — join before they're full."}
      </p>
      {personalized && profileSignals ? (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="recommended-leagues-signals">
          {Array.isArray(profileSignals.favoriteSports) && profileSignals.favoriteSports.length > 0 ? (
            <span className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              Favorite sports: {profileSignals.favoriteSports.slice(0, 3).join(", ")}
            </span>
          ) : null}
          {typeof profileSignals.pastLeagueCount === "number" ? (
            <span className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              Past leagues: {profileSignals.pastLeagueCount}
            </span>
          ) : null}
          {profileSignals.hasDraftParticipation ? (
            <span className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              Draft participant
            </span>
          ) : null}
          {profileSignals.aiUsageLevel ? (
            <span className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              AI usage: {profileSignals.aiUsageLevel}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ league, explanation, reasons, explanationSource }) => (
          <div key={`${league.source}-${league.id}`} className="flex flex-col gap-2">
            <LeagueDiscoveryCard league={league} />
            <div className="px-1">
              {explanation && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {explanation}
                </p>
              )}
              {Array.isArray(reasons) && reasons.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {reasons.slice(0, 2).map((reason) => (
                    <span
                      key={`${league.id}-${reason}`}
                      className="rounded-full border px-2 py-0.5 text-[11px]"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--muted)" }}>
                {explanationSource === "ai" ? "AI-enhanced explanation" : "Deterministic explanation"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
