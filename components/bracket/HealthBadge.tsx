'use client'

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

type HealthResponse = {
  ok: boolean
  health?: {
    healthScore: number
    statusLabel: string
    alivePct: number
    teamsAlive: number
    teamsTotal: number
  }
}

type Props = {
  entryId: string
}

export function HealthBadge({ entryId }: Props) {
  const { t } = useLanguage()
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!entryId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch("/api/bracket/intelligence/dashboard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json?.ok || cancelled) return
        setData(json)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [entryId])

  if (!data?.health) return null

  const h = data.health
  const score = h.healthScore
  const labelKey = `bracket.intel.dashboard.health.status.${h.statusLabel}`
  const barColor =
    score >= 75 ? "#22c55e" : score >= 50 ? "#eab308" : score >= 25 ? "#f97316" : "#ef4444"

  return (
    <div className="rounded-2xl border border-white/12 bg-white/5 p-4 space-y-2 mode-panel-soft">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-white/85">
          {t("bracket.review.health.title")}
        </div>
        {loading && (
          <div className="text-[11px] text-white/60">
            {t("bracket.review.health.loading")}
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-white">
          {score}
        </div>
        <div className="text-[11px] text-white/65">
          {t("bracket.review.health.label")}
        </div>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.9)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, score))}%`,
            background: barColor,
            transition: "width 200ms ease-out",
          }}
        />
      </div>
      <p className="text-[11px] text-white/70">
        {t(labelKey)}
      </p>
    </div>
  )
}

