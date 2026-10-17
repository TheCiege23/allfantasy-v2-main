'use client'

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

type ChaosResponse = {
  ok: boolean
  chaosScore: number
  label: "predictable" | "moderate" | "high" | "madness"
}

type Props = {
  tournamentId: string
}

export function ChaosMeter({ tournamentId }: Props) {
  const { t } = useLanguage()
  const [data, setData] = useState<ChaosResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tournamentId) return
    setLoading(true)
    setError(null)
    fetch(`/api/bracket/chaos?tournamentId=${encodeURIComponent(tournamentId)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })).catch(() => ({ ok: false, data: {} })))
      .then(({ ok, data }) => {
        if (!ok || !data?.ok) {
          setError(data?.error || t("bracket.chaos.error"))
          return
        }
        setData(data)
      })
      .catch(() => setError(t("bracket.chaos.error")))
      .finally(() => setLoading(false))
  }, [tournamentId, t])

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-100">
        {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] text-white/70">
        {loading ? t("bracket.chaos.loading") : t("bracket.chaos.empty")}
      </div>
    )
  }

  const score = data.chaosScore
  const labelKey = `bracket.chaos.label.${data.label}`

  let barColor = "#22c55e"
  if (score >= 80) barColor = "#ef4444"
  else if (score >= 50) barColor = "#eab308"

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-white/80">
          {t("bracket.chaos.title")}
        </div>
        {loading && (
          <span className="text-[11px] text-white/60">
            {t("bracket.chaos.loading")}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-white">
          {score}
        </div>
        <div className="text-[11px] text-white/65">
          {t("bracket.chaos.scoreLabel")}
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
      <p className="text-[11px] text-white/80">
        {t(labelKey)}
      </p>
    </div>
  )
}

