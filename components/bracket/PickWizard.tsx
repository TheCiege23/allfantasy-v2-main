"use client"

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react"
import { X, ChevronLeft, ChevronRight, Zap, TrendingUp, Sparkles, Shield, Trophy } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

type Game = {
  id: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: string | null
}

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
  game: Game | null
}

type Props = {
  nodes: Node[]
  startNode: Node
  picks: Record<string, string | null>
  seedMap: Map<string, number>
  effective: Map<string, { home: string | null; away: string | null }>
  entryId: string
  onPick: (node: Node, team: string) => void
  onClose: () => void
}

const ROUND_LABELS: Record<number, string> = {
  1: "Round of 64",
  2: "Round of 32",
  3: "Sweet 16",
  4: "Elite 8",
  5: "Final Four",
  6: "Championship",
}

const AF_BLUE = "#3b82f6"
const AF_BLUE_BG = "rgba(59,130,246,0.12)"
const AF_BLUE_BORDER = "rgba(59,130,246,0.4)"
const AF_BLUE_LIGHT = "rgba(59,130,246,0.2)"

function isPickLocked(node: Node) {
  if (!node.game?.startTime) return false
  return new Date(node.game.startTime) <= new Date()
}

function getTopSeed(node: Node, seedMap: Map<string, number>, effective: Map<string, { home: string | null; away: string | null }>): number {
  const eff = effective.get(node.id)
  const homeName = eff?.home ?? node.homeTeamName
  const awayName = eff?.away ?? node.awayTeamName
  const hSeed = homeName ? (seedMap.get(homeName) ?? node.seedHome ?? 99) : (node.seedHome ?? 99)
  const aSeed = awayName ? (seedMap.get(awayName) ?? node.seedAway ?? 99) : (node.seedAway ?? 99)
  return Math.min(hSeed, aSeed)
}

export function PickWizard({ nodes, startNode, picks, seedMap, effective, entryId, onPick, onClose }: Props) {
  const pickableNodes = useMemo(() =>
    nodes
      .filter(n => n.round >= 1)
      .sort((a, b) => {
        if (a.round !== b.round) return a.round - b.round
        const seedA = getTopSeed(a, seedMap, effective)
        const seedB = getTopSeed(b, seedMap, effective)
        if (seedA !== seedB) return seedA - seedB
        const regionOrder = ["West", "East", "South", "Midwest", null]
        const ra = regionOrder.indexOf(a.region)
        const rb = regionOrder.indexOf(b.region)
        if (ra !== rb) return ra - rb
        return a.slot.localeCompare(b.slot)
      }),
    [nodes, seedMap, effective]
  )

  const [currentIdx, setCurrentIdx] = useState(() => {
    const idx = pickableNodes.findIndex(n => n.id === startNode.id)
    return idx >= 0 ? idx : 0
  })
  const [aiData, setAiData] = useState<Record<string, any>>({})
  const [loadingAi, setLoadingAi] = useState<string | null>(null)
  const [pickAnimating, setPickAnimating] = useState(false)
  const { t } = useLanguage()
  const pendingAdvanceRef = useRef(false)

  useEffect(() => {
    const idx = pickableNodes.findIndex(n => n.id === startNode.id)
    if (idx >= 0) setCurrentIdx(idx)
  }, [startNode.id, pickableNodes])

  const currentNode = pickableNodes[currentIdx]
  const eff = currentNode ? effective.get(currentNode.id) : undefined
  const homeName = eff?.home ?? currentNode?.homeTeamName ?? null
  const awayName = eff?.away ?? currentNode?.awayTeamName ?? null
  const homeSeed =
    currentNode && homeName ? (seedMap.get(homeName) ?? currentNode.seedHome) : currentNode?.seedHome ?? null
  const awaySeed =
    currentNode && awayName ? (seedMap.get(awayName) ?? currentNode.seedAway) : currentNode?.seedAway ?? null
  const picked = currentNode ? (picks[currentNode.id] ?? null) : null
  const locked = currentNode ? isPickLocked(currentNode) : false
  const hasBothTeams = !!homeName && !!awayName
  const canPick = Boolean(currentNode && hasBothTeams && !locked)

  const totalInRound = currentNode
    ? pickableNodes.filter((n) => n.round === currentNode.round && n.region === currentNode.region).length
    : 0
  const pickedInRound = currentNode
    ? pickableNodes.filter(
        (n) => n.round === currentNode.round && n.region === currentNode.region && picks[n.id]
      ).length
    : 0

  useLayoutEffect(() => {
    if (!currentNode) onClose()
  }, [currentNode, onClose])

  useEffect(() => {
    if (!currentNode || !homeName || !awayName || aiData[currentNode.id]) return
    setLoadingAi(currentNode.id)
    fetch("/api/bracket/ai/matchup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entryId,
        nodeId: currentNode.id,
        teamA: homeName,
        teamB: awayName,
        round: currentNode.round,
        seedA: homeSeed,
        seedB: awaySeed,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setAiData((prev) => ({ ...prev, [currentNode.id]: d }))
      })
      .catch(() => {})
      .finally(() => setLoadingAi(null))
  }, [currentNode, homeName, awayName, entryId, homeSeed, awaySeed, aiData])

  const ai = currentNode ? aiData[currentNode.id] : undefined

  const handlePick = useCallback(
    (team: string) => {
      if (!currentNode || !canPick) return
      setPickAnimating(true)
      onPick(currentNode, team)
      pendingAdvanceRef.current = true
      setTimeout(() => setPickAnimating(false), 600)
    },
    [canPick, currentNode, onPick]
  )

  useEffect(() => {
    if (!currentNode) return
    if (!pendingAdvanceRef.current || pickAnimating) return
    pendingAdvanceRef.current = false
    const nextUnpicked = pickableNodes.findIndex((n, i) => {
      if (i <= currentIdx) return false
      const e = effective.get(n.id)
      const h = e?.home ?? n.homeTeamName
      const a = e?.away ?? n.awayTeamName
      return Boolean(h && a && !picks[n.id] && !isPickLocked(n))
    })
    if (nextUnpicked >= 0) {
      setCurrentIdx(nextUnpicked)
    } else if (currentIdx < pickableNodes.length - 1) {
      setCurrentIdx(currentIdx + 1)
    }
  }, [currentNode, picks, pickAnimating, currentIdx, pickableNodes, effective])

  if (!currentNode) return null

  const goPrev = () => setCurrentIdx(Math.max(0, currentIdx - 1))
  const goNext = () => setCurrentIdx(Math.min(pickableNodes.length - 1, currentIdx + 1))

  function TeamCard({ name, seed, isPicked, side }: {
    name: string | null; seed: number | null; isPicked: boolean; side: "home" | "away"
  }) {
    if (!name) {
      return (
        <div className="w-full rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '2px dashed rgba(255,255,255,0.06)' }}>
          <div className="text-center text-sm" style={{ color: 'rgba(255,255,255,0.15)' }}>
            Waiting for previous round winner
          </div>
        </div>
      )
    }

    const winProb = ai?.winProbability?.[side]
    const otherSeed = side === "home" ? awaySeed : homeSeed
    const isUpset = seed != null && otherSeed != null && seed > otherSeed

    return (
      <button
        disabled={!canPick || pickAnimating}
        onClick={() => handlePick(name)}
        className="w-full rounded-2xl p-5 transition-all active:scale-[0.98]"
        style={{
          background: isPicked ? AF_BLUE_BG : 'rgba(255,255,255,0.03)',
          border: isPicked ? `2px solid ${AF_BLUE_BORDER}` : '2px solid rgba(255,255,255,0.08)',
          cursor: canPick ? 'pointer' : 'default',
          opacity: pickAnimating && !isPicked ? 0.4 : 1,
          transform: pickAnimating && isPicked ? 'scale(1.02)' : undefined,
          boxShadow: isPicked ? `0 0 20px rgba(59,130,246,0.15)` : undefined,
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center font-black text-xl"
            style={{
              background: isPicked ? AF_BLUE_LIGHT : 'rgba(255,255,255,0.06)',
              color: isPicked ? AF_BLUE : 'rgba(255,255,255,0.4)',
            }}
          >
            {seed ?? "?"}
          </div>
          <div className="flex-1 text-left">
            <div className="font-bold text-lg" style={{ color: isPicked ? AF_BLUE : 'rgba(255,255,255,0.9)' }}>
              {name}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {isUpset && isPicked && (
                <span className="flex items-center gap-1 text-[11px] font-bold" style={{ color: '#c084fc' }}>
                  <Zap className="w-3 h-3" /> Upset Pick
                </span>
              )}
              {isPicked && (
                <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: AF_BLUE }}>
                  <Trophy className="w-3 h-3" /> WINNER
                </span>
              )}
            </div>
          </div>
          {winProb != null && (
            <div className="text-right">
              <div className="text-2xl font-black" style={{ color: isPicked ? AF_BLUE : 'rgba(255,255,255,0.5)' }}>
                {Math.round(winProb)}%
              </div>
              <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>win prob</div>
            </div>
          )}
        </div>
        {winProb != null && (
          <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${winProb}%`, background: isPicked ? AF_BLUE : 'rgba(255,255,255,0.15)' }} />
          </div>
        )}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div
        className="relative w-full max-w-md mx-4 flex flex-col"
        style={{
          background: '#141a26',
          borderRadius: 20,
          border: '1px solid rgba(59,130,246,0.15)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(59,130,246,0.08)',
          maxHeight: '90vh',
          animation: 'wizardPop 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes wizardPop {
            0% { opacity: 0; transform: scale(0.92) translateY(20px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2">
            <button onClick={goPrev} disabled={currentIdx === 0} className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-20 transition-opacity" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <ChevronLeft className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
            <button onClick={goNext} disabled={currentIdx >= pickableNodes.length - 1} className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-20 transition-opacity" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <ChevronRight className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>
          <div className="text-center flex-1">
            <div className="text-xs font-bold uppercase tracking-wider" style={{ color: AF_BLUE }}>
              {ROUND_LABELS[currentNode.round] || `Round ${currentNode.round}`}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {currentNode.region && `${currentNode.region} Region`}
              {currentNode.region && ` \u2022 `}
              {pickedInRound}/{totalInRound} picked
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3" style={{ maxHeight: 'calc(90vh - 110px)' }}>
          <div className="text-center mb-1">
            <div className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Choose the winner
            </div>
          </div>

          <TeamCard name={homeName} seed={homeSeed} isPicked={picked === homeName} side="home" />

          <div className="flex items-center gap-3 justify-center py-1">
            <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.12)' }}>VS</span>
            <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>

          <TeamCard name={awayName} seed={awaySeed} isPicked={picked === awayName} side="away" />

          {!hasBothTeams && (
            <div className="text-center rounded-xl p-4" style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.08)' }}>
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                This matchup requires winners from previous rounds. Fill out earlier games first.
              </div>
            </div>
          )}

          {locked && hasBothTeams && (
            <div className="text-center rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
              <div className="text-xs font-semibold" style={{ color: '#ef4444' }}>
                Picks are locked for this matchup
              </div>
            </div>
          )}

          {loadingAi === currentNode.id && (
            <div className="rounded-xl p-4" style={{ background: 'rgba(6,182,212,0.03)', border: '1px solid rgba(6,182,212,0.08)' }}>
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'rgba(6,182,212,0.3)', borderTopColor: 'transparent' }} />
                <span className="text-xs" style={{ color: 'rgba(6,182,212,0.6)' }}>
                  {t("bracket.ai.wizard.loading")}
                </span>
              </div>
            </div>
          )}

          {ai?.analysis && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(6,182,212,0.03)', border: '1px solid rgba(6,182,212,0.10)' }}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: '#22d3ee' }} />
                <span className="text-xs font-bold" style={{ color: '#22d3ee' }}>
                  {t("bracket.ai.wizard.analysis.title")}
                </span>
                {ai.confidence && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)' }}>
                    {ai.confidence}% {t("bracket.ai.wizard.analysis.confidenceShort")}
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {ai.analysis}
              </p>

              {ai.keyFactors?.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {t("bracket.ai.wizard.analysis.keyFactors")}
                  </div>
                  {ai.keyFactors.slice(0, 4).map((f: string, i: number) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#22d3ee' }} />
                      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{f}</span>
                    </div>
                  ))}
                </div>
              )}

              {(ai.suggestedLean || ai.upsetWatch || ai.confidenceLabel || ai.dataNotes) && (
                <div className="space-y-1.5">
                  {ai.suggestedLean && (
                    <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      <span className="font-semibold">
                        {t("bracket.ai.wizard.analysis.suggestedLean")}{": "}
                      </span>
                      {ai.suggestedLean}
                    </div>
                  )}
                  {ai.confidenceLabel && (
                    <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      <span className="font-semibold">
                        {t("bracket.ai.wizard.analysis.confidenceLabel")}{": "}
                      </span>
                      {ai.confidenceLabel === "high" && t("bracket.ai.confidence.high")}
                      {ai.confidenceLabel === "medium" && t("bracket.ai.confidence.medium")}
                      {ai.confidenceLabel === "low" && t("bracket.ai.confidence.low")}
                    </div>
                  )}
                  {ai.upsetWatch && (
                    <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      <span className="font-semibold">
                        {t("bracket.ai.wizard.analysis.upsetWatch")}{": "}
                      </span>
                      {ai.upsetWatch}
                    </div>
                  )}
                  {ai.dataNotes && (
                    <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {ai.dataNotes}
                    </div>
                  )}
                </div>
              )}

              {ai.sources?.length > 0 && (
                <details className="group">
                  <summary className="text-[11px] font-semibold cursor-pointer" style={{ color: 'rgba(255,255,255,0.2)' }}>
                    {t("bracket.ai.wizard.analysis.sources")} ({ai.sources.length})
                  </summary>
                  <div className="mt-1 space-y-1">
                    {ai.sources.map((s: any, i: number) => (
                      <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="block text-[11px] underline" style={{ color: 'rgba(6,182,212,0.6)' }}>
                        {s.title || s.url}
                      </a>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          {/* Strategy-based pick recommendation */}
          {ai?.strategy && hasBothTeams && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.10)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4" style={{ color: AF_BLUE }} />
                  <span className="text-xs font-bold" style={{ color: AF_BLUE }}>
                    {t("bracket.ai.wizard.recommendation.title")}
                  </span>
                </div>
                {ai.strategy.style && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                    {ai.strategy.style === "safe" && t("bracket.ai.style.safe")}
                    {ai.strategy.style === "balanced" && t("bracket.ai.style.balanced")}
                    {ai.strategy.style === "upset_heavy" && t("bracket.ai.style.upsetHeavy")}
                    {ai.strategy.style === "chaos" && t("bracket.ai.style.chaos")}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <div style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {t("bracket.ai.wizard.recommendation.recommended")}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>
                      {ai.strategy.recommendedPick}
                    </span>
                    {ai.strategy.leveragePlay && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>
                        <TrendingUp className="w-3 h-3" /> {t("bracket.ai.wizard.recommendation.leverage")}
                      </span>
                    )}
                  </div>
                </div>
                {ai.strategy.confidence != null && (
                  <div className="text-right">
                    <div className="text-xl font-black" style={{ color: AF_BLUE }}>
                      {ai.strategy.confidence}%
                    </div>
                    <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {t("bracket.ai.wizard.recommendation.confidence")}
                    </div>
                  </div>
                )}
              </div>
              {ai.strategy.reasoning && (
                <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {ai.strategy.reasoning}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
            {currentIdx + 1} of {pickableNodes.length}
          </div>
          <div className="flex items-center gap-1.5">
            {pickableNodes.slice(Math.max(0, currentIdx - 3), currentIdx + 4).map((n, i) => {
              const actualIdx = Math.max(0, currentIdx - 3) + i
              const isPicked = !!picks[n.id]
              const isCurrent = actualIdx === currentIdx
              return (
                <button
                  key={n.id}
                  onClick={() => setCurrentIdx(actualIdx)}
                  className="rounded-full transition-all"
                  style={{
                    width: isCurrent ? 16 : 6,
                    height: 6,
                    background: isCurrent ? AF_BLUE : isPicked ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.1)',
                  }}
                />
              )
            })}
          </div>
          <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
            {Object.values(picks).filter(Boolean).length} picked
          </div>
        </div>
      </div>
    </div>
  )
}
