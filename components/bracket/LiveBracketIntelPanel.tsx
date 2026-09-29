'use client'

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

type Props = {
  entryId: string
}

type LiveIntelResponse = {
  ok: boolean
  survival?: {
    survivalProbability: number
    alivePct: number
    championAlive: boolean
    maxPossiblePoints: number
    currentPoints: number
  }
  liveGames?: Array<{
    id: string
    round: number
    homeTeam: string
    awayTeam: string
    status: string
    isUpsetWatch: boolean
    upsetProbability: number | null
    momentumScore: number | null
  }>
  upsetAlerts?: Array<{
    id: string
    round: number
    homeTeam: string
    awayTeam: string
    upsetProbability: number | null
  }>
}

export function LiveBracketIntelPanel({ entryId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intel, setIntel] = useState<LiveIntelResponse | null>(null)

  useEffect(() => {
    if (!entryId) return
    setLoading(true)
    setError(null)
    fetch("/api/bracket/intelligence/live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })).catch(() => ({ ok: false, data: {} })))
      .then(({ ok, data }) => {
        if (!ok || !data?.ok) {
          setError(data?.error || t("bracket.live.error"))
          return
        }
        setIntel(data)
      })
      .catch(() => {
        setError(t("bracket.live.error"))
      })
      .finally(() => setLoading(false))
  }, [entryId, t])

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-white/80">
          {t("bracket.live.title")}
        </h3>
        {loading && (
          <span className="text-[11px] text-white/55">
            {t("bracket.live.loading")}
          </span>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-red-300">
          {error}
        </p>
      )}
      {intel?.survival && !error && (
        <div className="space-y-1 text-[11px] text-white/80">
          <div>
            <span className="text-white/60">
              {t("bracket.live.survival.label")}:{" "}
            </span>
            <span>
              {Math.round(intel.survival.survivalProbability * 1000) / 10}%
            </span>
          </div>
          <div>
            <span className="text-white/60">
              {t("bracket.live.survival.alivePct")}:{" "}
            </span>
            <span>
              {Math.round((intel.survival.alivePct || 0) * 1000) / 10}%
            </span>
          </div>
          <div>
            <span className="text-white/60">
              {t("bracket.live.survival.championAlive")}:{" "}
            </span>
            <span>
              {intel.survival.championAlive ? t("bracket.live.survival.yes") : t("bracket.live.survival.no")}
            </span>
          </div>
        </div>
      )}
      {intel?.upsetAlerts && intel.upsetAlerts.length > 0 && (
        <div className="pt-2 border-t border-white/10 space-y-1.5 text-[11px] text-white/80">
          <div className="text-[11px] font-semibold text-amber-300">
            {t("bracket.live.upset.title")}
          </div>
          <ul className="list-disc pl-4 space-y-0.5">
            {intel.upsetAlerts.slice(0, 3).map((g) => {
              const prob = g.upsetProbability != null ? Math.round(g.upsetProbability * 100) : null
              const template = t("bracket.live.upset.item")
              const text =
                template
                  ?.replace("{round}", String(g.round))
                  .replace("{home}", g.homeTeam)
                  .replace("{away}", g.awayTeam) ?? `${g.homeTeam} vs ${g.awayTeam} (R${g.round})`
              return (
                <li key={g.id}>
                  {text}
                  {prob != null && (
                    <span className="ml-1 text-amber-200/80">
                      · {prob}%
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {!loading && !error && !intel?.survival && (
        <p className="text-[11px] text-white/55">
          {t("bracket.live.empty")}
        </p>
      )}
    </div>
  )
}

