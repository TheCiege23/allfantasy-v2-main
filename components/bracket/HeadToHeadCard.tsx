'use client'

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

type Props = {
  leagueId: string
  entryId: string
}

type HeadToHeadEntry = {
  entryId: string
  name: string | null
  totalPoints: number
  correctPicks: number
  remainingPoints: number
  currentRank: number
}

type Response = {
  ok: boolean
  entryA: HeadToHeadEntry
  entryB: HeadToHeadEntry
}

export function HeadToHeadCard({ leagueId, entryId }: Props) {
  const { t } = useLanguage()
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)

  // For the first version, compare the user against league leader.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/bracket/leagues/${leagueId}/standings`, {
          cache: "no-store",
        })
        const standings = await res.json().catch(() => ({}))
        const leader = standings?.entries?.[0]
        if (!leader || leader.entryId === entryId) return

        const h2hRes = await fetch("/api/bracket/social/head-to-head", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leagueId,
            entryAId: entryId,
            entryBId: leader.entryId,
          }),
        })
        const data = await h2hRes.json().catch(() => ({}))
        if (!h2hRes.ok || !data?.ok) {
          if (!cancelled) setError(data?.error || t("bracket.social.h2h.error"))
          return
        }
        if (!cancelled) setData(data)
      } catch {
        if (!cancelled) setError(t("bracket.social.h2h.error"))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [leagueId, entryId, t])

  if (!data || error) {
    return null
  }

  const { entryA, entryB } = data

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-white/80">
          {t("bracket.social.h2h.title")}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px] text-white/80">
        <div>
          <div className="text-[11px] text-white/60">{t("bracket.social.h2h.you")}</div>
          <div className="font-semibold text-white">
            {entryA.name || t("bracket.social.h2h.you")}
          </div>
          <div className="mt-1">
            <span className="text-white/60">{t("bracket.intel.dashboard.summary.points")}: </span>
            <span>{entryA.totalPoints}</span>
          </div>
          <div>
            <span className="text-white/60">{t("bracket.intel.dashboard.summary.correct")}: </span>
            <span>{entryA.correctPicks}</span>
          </div>
          <div>
            <span className="text-white/60">
              {t("bracket.intel.dashboard.summary.remaining")}:{" "}
            </span>
            <span>{entryA.remainingPoints}</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-white/60">
            {t("bracket.social.h2h.leader")}
          </div>
          <div className="font-semibold text-white">
            {entryB.name || t("bracket.social.h2h.leader")}
          </div>
          <div className="mt-1">
            <span className="text-white/60">{t("bracket.intel.dashboard.summary.points")}: </span>
            <span>{entryB.totalPoints}</span>
          </div>
          <div>
            <span className="text-white/60">{t("bracket.intel.dashboard.summary.correct")}: </span>
            <span>{entryB.correctPicks}</span>
          </div>
          <div>
            <span className="text-white/60">
              {t("bracket.intel.dashboard.summary.remaining")}:{" "}
            </span>
            <span>{entryB.remainingPoints}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

