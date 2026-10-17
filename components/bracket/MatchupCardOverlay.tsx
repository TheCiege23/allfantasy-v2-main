"use client"

import { useState, useEffect } from "react"
import { X, ChevronRight, Zap, Shield, TrendingUp } from "lucide-react"
import { useUserTimezone } from "@/hooks/useUserTimezone"

type Node = {
  id: string
  slot: string
  round: number
  region: string | null
  seedHome: number | null
  seedAway: number | null
  homeTeamName: string | null
  awayTeamName: string | null
  sportsGameId: string | null
  nextNodeId: string | null
  nextNodeSide: string | null
  game: {
    id: string
    homeTeam: string
    awayTeam: string
    homeScore: number | null
    awayScore: number | null
    status: string | null
    startTime: string | null
  } | null
}

type Props = {
  node: Node
  effective: { home: string | null; away: string | null }
  picked: string | null
  seedMap: Map<string, number>
  locked: boolean
  readOnly?: boolean
  onPick: (node: Node, team: string) => void
  onClose: () => void
  entryId: string
  tournamentId: string
  leagueId?: string
}

const ROUND_LABELS: Record<number, string> = {
  1: "Round of 64",
  2: "Round of 32",
  3: "Sweet 16",
  4: "Elite 8",
  5: "Final Four",
  6: "Championship",
}

export function MatchupCardOverlay({
  node,
  effective,
  picked,
  seedMap,
  locked,
  readOnly,
  onPick,
  onClose,
  entryId,
  tournamentId,
  leagueId,
}: Props) {
  const { formatInTimezone } = useUserTimezone()
  const [aiData, setAiData] = useState<any>(null)
  const [loadingAi, setLoadingAi] = useState(false)
  const [popularity, setPopularity] = useState<
    | {
        scope: "global" | "league"
        homePct: number | null
        awayPct: number | null
      }
    | null
  >(null)

  const homeName = effective.home ?? node.homeTeamName
  const awayName = effective.away ?? node.awayTeamName
  const homeSeed = homeName ? (seedMap.get(homeName) ?? node.seedHome) : node.seedHome
  const awaySeed = awayName ? (seedMap.get(awayName) ?? node.seedAway) : node.seedAway

  const game = node.game
  const isLive = game?.status === "in_progress"
  const isFinal = game?.status === "final" || game?.status === "completed"
  const canPick = !readOnly && !locked && !isFinal

  useEffect(() => {
    if (!homeName || !awayName) return
    const controller = new AbortController()
    async function loadPopularity() {
      try {
        const params = new URLSearchParams()
        params.set("tournamentId", tournamentId)
        params.set("nodeId", node.id)
        if (leagueId) {
          params.set("scope", "league")
          params.set("leagueId", leagueId)
        } else {
          params.set("scope", "global")
        }
        const res = await fetch(`/api/bracket/popularity?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.ok || !Array.isArray(data.popularity)) return
        const scope = (data.scope === "league" ? "league" : "global") as "global" | "league"
        let homePct: number | null = null
        let awayPct: number | null = null
        for (const row of data.popularity as any[]) {
          if (row.teamName === homeName) homePct = row.pickPct
          if (row.teamName === awayName) awayPct = row.pickPct
        }
        setPopularity({ scope, homePct, awayPct })
      } catch {
        // ignore
      }
    }
    loadPopularity()
    return () => controller.abort()
  }, [tournamentId, leagueId, node.id, homeName, awayName])

  useEffect(() => {
    if (!homeName || !awayName) return
    setLoadingAi(true)
    fetch("/api/bracket/ai/matchup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entryId,
        nodeId: node.id,
        teamA: homeName,
        teamB: awayName,
        round: node.round,
        seedA: homeSeed,
        seedB: awaySeed,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAiData(d))
      .catch(() => {})
      .finally(() => setLoadingAi(false))
  }, [node.id, homeName, awayName, entryId, node.round, homeSeed, awaySeed])

  function TeamCard({
    name,
    seed,
    isPicked,
    side,
    popularityPct,
  }: {
    name: string | null
    seed: number | null
    isPicked: boolean
    side: "home" | "away"
    popularityPct: number | null
  }) {
    if (!name) return null
    const winProb = aiData?.winProbability?.[side === "home" ? "home" : "away"]
    const isUpsetPick = seed != null && (side === "home" ? awaySeed : homeSeed) != null &&
      seed > (side === "home" ? awaySeed! : homeSeed!)

    return (
      <button
        disabled={!canPick}
        onClick={() => onPick(node, name)}
        className="relative w-full rounded-xl p-4 transition-all"
        style={{
          background: isPicked
            ? "rgba(251,146,60,0.15)"
            : "rgba(255,255,255,0.03)",
          border: isPicked
            ? "2px solid rgba(251,146,60,0.4)"
            : "2px solid rgba(255,255,255,0.06)",
          cursor: canPick ? "pointer" : "default",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center font-black text-lg"
            style={{
              background: isPicked ? "rgba(251,146,60,0.2)" : "rgba(255,255,255,0.06)",
              color: isPicked ? "#fb923c" : "rgba(255,255,255,0.4)",
            }}
          >
            {seed ?? "?"}
          </div>
          <div className="flex-1 text-left">
            <div
              className="font-bold text-sm"
              style={{ color: isPicked ? "#fb923c" : "rgba(255,255,255,0.85)" }}
            >
              {name}
            </div>
            {isUpsetPick && isPicked && (
              <div className="flex items-center gap-1 mt-0.5">
                <Zap className="w-3 h-3" style={{ color: "#c084fc" }} />
                <span className="text-[11px] font-bold" style={{ color: "#c084fc" }}>
                  Upset Pick
                </span>
              </div>
            )}
          </div>
          {(winProb != null || popularityPct != null) && (
            <div className="text-right">
              {winProb != null && (
                <>
                  <div
                    className="text-lg font-black"
                    style={{ color: isPicked ? "#fb923c" : "rgba(255,255,255,0.6)" }}
                  >
                    {Math.round(winProb)}%
                  </div>
                  <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    win prob
                  </div>
                </>
              )}
              {popularityPct != null && (
                <div className="mt-1">
                  <div
                    className="text-xs font-semibold"
                    style={{ color: "rgba(148,163,184,0.9)" }}
                  >
                    {Math.round(popularityPct)}%
                  </div>
                  <div className="text-[11px]" style={{ color: "rgba(148,163,184,0.7)" }}>
                    picked
                  </div>
                </div>
              )}
            </div>
          )}
          {isPicked && (
            <ChevronRight className="w-5 h-5" style={{ color: "#fb923c" }} />
          )}
        </div>
        {winProb != null && (
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${winProb}%`,
                background: isPicked ? "#fb923c" : "rgba(255,255,255,0.2)",
              }}
            />
          </div>
        )}
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[85vh] overflow-y-auto"
        style={{ background: "#161b22", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>
              {ROUND_LABELS[node.round] || `Round ${node.round}`}
              {node.region && ` - ${node.region}`}
            </div>
            {isLive && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#ef4444" }} />
                <span className="text-[11px] font-bold" style={{ color: "#ef4444" }}>LIVE</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <X className="w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
        </div>

        {game && (game.homeScore != null || game.awayScore != null) && (
          <div className="flex items-center justify-center gap-6 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-center">
              <div className="text-2xl font-black" style={{ color: "rgba(255,255,255,0.9)" }}>
                {game.homeScore ?? 0}
              </div>
              <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                {homeName?.slice(0, 12)}
              </div>
            </div>
            <div className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.15)" }}>
              {isFinal ? "FINAL" : "vs"}
            </div>
            <div className="text-center">
              <div className="text-2xl font-black" style={{ color: "rgba(255,255,255,0.9)" }}>
                {game.awayScore ?? 0}
              </div>
              <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                {awayName?.slice(0, 12)}
              </div>
            </div>
          </div>
        )}

        <div className="p-4 space-y-3">
          {!canPick && !isFinal && (
            <div className="text-center text-[11px] font-semibold py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
              Picks are locked for this matchup
            </div>
          )}

          <TeamCard
            name={homeName}
            seed={homeSeed}
            isPicked={picked === homeName}
            side="home"
            popularityPct={popularity?.homePct ?? null}
          />
          <div className="text-center text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.12)" }}>VS</div>
          <TeamCard
            name={awayName}
            seed={awaySeed}
            isPicked={picked === awayName}
            side="away"
            popularityPct={popularity?.awayPct ?? null}
          />
        </div>

        {loadingAi && (
          <div className="px-4 pb-4">
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(251,146,60,0.3)", borderTopColor: "transparent" }} />
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>Loading AI analysis...</span>
              </div>
            </div>
          </div>
        )}

        {aiData?.analysis && (
          <div className="px-4 pb-4">
            <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(251,146,60,0.03)", border: "1px solid rgba(251,146,60,0.08)" }}>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5" style={{ color: "#fb923c" }} />
                <span className="text-xs font-bold" style={{ color: "#fb923c" }}>AI Matchup Analysis</span>
                {aiData.confidence && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" }}>
                    {aiData.confidence}% conf
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                {aiData.analysis}
              </p>
              {aiData.sources?.length > 0 && (
                <details className="group">
                  <summary className="text-[11px] font-semibold cursor-pointer" style={{ color: "rgba(255,255,255,0.25)" }}>
                    Sources ({aiData.sources.length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {aiData.sources.map((s: any, i: number) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[11px] underline"
                        style={{ color: "rgba(251,146,60,0.6)" }}
                      >
                        {s.title || s.url}
                      </a>
                    ))}
                  </div>
                </details>
              )}
              {aiData.lastUpdated && (
                <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.15)" }}>
                  Updated: {formatInTimezone(aiData.lastUpdated)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
