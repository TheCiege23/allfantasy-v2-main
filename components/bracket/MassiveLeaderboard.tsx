'use client'

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

type LeaderboardRow = {
  entryId: string
  rank: number
  previousRank: number | null
  tieGroup: number
  score: number
  username: string | null
  avatarUrl: string | null
  leagueName?: string | null
  healthScore?: number | null
}

type Props = {
  tournamentId: string
  leagueId?: string | null
  aroundEntryId?: string | null
  variant?: "global" | "league" | "friends"
}

export function MassiveLeaderboard({
  tournamentId,
  leagueId,
  aroundEntryId,
  variant = "global",
}: Props) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        params.set("tournamentId", tournamentId)
        params.set("limit", "50")
        if (aroundEntryId) params.set("aroundEntryId", aroundEntryId)
        const path =
          variant === "league"
            ? `/api/bracket/leaderboard/league/${leagueId}?${params.toString()}`
            : variant === "friends"
            ? `/api/bracket/leaderboard/friends?${params.toString()}`
            : `/api/bracket/leaderboard/global?${params.toString()}`
        const res = await fetch(path, { method: "GET" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.ok) {
          setError(data?.error || t("bracket.leaderboard.error"))
          return
        }
        setRows(data.rows || [])
      } catch {
        setError(t("bracket.leaderboard.error"))
      } finally {
        setLoading(false)
      }
    }
    if (tournamentId && (variant !== "league" || leagueId)) {
      load()
    }
  }, [tournamentId, leagueId, aroundEntryId, variant, t])

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-white/80">
          {t("bracket.leaderboard.title")}
        </h3>
        {loading && (
          <span className="text-[11px] text-white/55">
            {t("bracket.leaderboard.loading")}
          </span>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-red-300">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="text-[11px] text-white/60">
          {t("bracket.leaderboard.empty")}
        </p>
      )}
      {rows.length > 0 && (
        <div className="space-y-1">
          {rows.map((row) => {
            const delta =
              row.previousRank != null ? row.previousRank - row.rank : null
            const deltaLabel =
              delta == null || delta === 0
                ? "–"
                : delta > 0
                ? `↑${delta}`
                : `↓${Math.abs(delta)}`
            return (
              <div
                key={row.entryId}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px]"
                style={{ background: "rgba(15,23,42,0.75)" }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 text-right font-semibold text-white/85">
                    {row.rank}
                  </div>
                  <div className="w-10 text-[11px] text-white/60">
                    {deltaLabel}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    {row.avatarUrl && (
                      <img
                        src={row.avatarUrl}
                        alt={row.username || ""}
                        className="h-5 w-5 rounded-full object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-white/90">
                        {row.username || t("bracket.leaderboard.unknownUser")}
                      </div>
                      {row.leagueName && (
                        <div className="truncate text-[11px] text-white/45">
                          {row.leagueName}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right space-y-0.5">
                  <div className="text-xs font-semibold text-white">
                    {row.score}
                  </div>
                  {typeof row.healthScore === "number" && (
                    <div className="flex items-center justify-end gap-1 text-[11px]">
                      <span
                        className="inline-flex h-2 w-2 rounded-full"
                        style={{
                          background:
                            row.healthScore >= 75
                              ? "#22c55e"
                              : row.healthScore >= 50
                              ? "#eab308"
                              : "#ef4444",
                        }}
                      />
                      <span className="text-white/60">
                        {row.healthScore}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

