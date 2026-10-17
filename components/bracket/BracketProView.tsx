"use client"

import { useMemo, useState, useCallback, useRef, useEffect, type JSX } from "react"
import { Timer, Trophy, Sparkles } from "lucide-react"
import { useBracketLive } from "@/lib/hooks/useBracketLive"
import { PickWizard } from "./PickWizard"
import { PickAssistCard } from "./PickAssistCard"
import { useUserTimezone } from "@/hooks/useUserTimezone"

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
  tournamentId: string
  leagueId?: string
  entryId: string
  nodes: Node[]
  initialPicks: Record<string, string | null>
}

const ALL_REGIONS = ["West", "East", "South", "Midwest"]

const CW = 120
const CH = 36
const TH = 18
const VG = 6
const CG = 22
const REGION_H = 8 * CH + 7 * VG
const REGION_W = 4 * CW + 3 * CG
const REGION_V_GAP = 40
const CENTER_W = 200
const FULL_H = 2 * REGION_H + REGION_V_GAP
const FULL_W = 2 * REGION_W + CENTER_W

function calcCenters(count: number): number[] {
  const c: number[] = []
  for (let i = 0; i < count; i++) c.push(i * (CH + VG) + TH)
  return c
}

function mergedCenters(prev: number[]): number[] {
  const c: number[] = []
  for (let i = 0; i < prev.length; i += 2) {
    c.push((prev[i] + prev[i + 1]) / 2)
  }
  return c
}

const POS = (() => {
  const r1 = calcCenters(8)
  const r2 = mergedCenters(r1)
  const r3 = mergedCenters(r2)
  const r4 = mergedCenters(r3)
  return { 1: r1, 2: r2, 3: r3, 4: r4 } as Record<number, number[]>
})()

function isPickLocked(node: Node) {
  if (!node.game?.startTime) return false
  return new Date(node.game.startTime) <= new Date()
}

function buildSeedMap(nodes: Node[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const n of nodes) {
    if (n.round === 1) {
      if (n.homeTeamName && n.seedHome != null) map.set(n.homeTeamName, n.seedHome)
      if (n.awayTeamName && n.seedAway != null) map.set(n.awayTeamName, n.seedAway)
    }
  }
  return map
}

function computeEffectiveTeams(
  nodes: Node[],
  picks: Record<string, string | null>
): Map<string, { home: string | null; away: string | null }> {
  const effective = new Map<string, { home: string | null; away: string | null }>()
  for (const n of nodes) {
    effective.set(n.id, { home: n.homeTeamName, away: n.awayTeamName })
  }
  const sorted = [...nodes].sort((a, b) => a.round - b.round)
  for (const n of sorted) {
    const picked = picks[n.id]
    if (!picked || !n.nextNodeId || !n.nextNodeSide) continue
    const current = effective.get(n.nextNodeId)
    if (!current) continue
    if (n.nextNodeSide === "home") {
      effective.set(n.nextNodeId, { ...current, home: picked })
    } else {
      effective.set(n.nextNodeId, { ...current, away: picked })
    }
  }
  return effective
}

function cascadeClearInvalidPicks(
  nodes: Node[],
  basePicks: Record<string, string | null>
): Record<string, string | null> {
  let current = { ...basePicks }
  let maxIter = 10
  while (maxIter-- > 0) {
    const recomputed = computeEffectiveTeams(nodes, current)
    let changed = false
    for (const n of nodes) {
      const pick = current[n.id]
      if (!pick) continue
      const eff = recomputed.get(n.id)
      if (!eff) continue
      if (pick !== eff.home && pick !== eff.away) {
        current[n.id] = null
        changed = true
      }
    }
    if (!changed) break
  }
  return current
}

function isBracketReleased(nodes: Node[]): boolean {
  const r1 = nodes.filter(n => n.round === 1)
  const seeded = r1.filter(n => n.homeTeamName || n.awayTeamName).length
  return seeded >= 8
}

function MiniCell({
  node, picks, seedMap, effective, x, y, bracketReleased, onClick,
}: {
  node: Node
  picks: Record<string, string | null>
  seedMap: Map<string, number>
  effective: Map<string, { home: string | null; away: string | null }>
  x: number
  y: number
  bracketReleased: boolean
  onClick: () => void
}) {
  const picked = picks[node.id] ?? null
  const eff = effective.get(node.id)
  const homeName = eff?.home ?? node.homeTeamName
  const awayName = eff?.away ?? node.awayTeamName
  const homeSeed = homeName ? (seedMap.get(homeName) ?? node.seedHome) : node.seedHome
  const awaySeed = awayName ? (seedMap.get(awayName) ?? node.seedAway) : node.seedAway
  const homePicked = !!homeName && picked === homeName
  const awayPicked = !!awayName && picked === awayName
  const isR1 = node.round === 1
  const hasBothTeams = !!homeName && !!awayName

  let borderColor = 'rgba(255,255,255,0.08)'
  if (homePicked || awayPicked) borderColor = 'rgba(59,130,246,0.4)'

  function TeamRow({ name, seed, isPicked, side }: {
    name: string | null; seed: number | null; isPicked: boolean; side: 'home' | 'away'
  }) {
    const showSeedOnly = !bracketReleased && isR1 && !name && seed != null
    return (
      <div style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        height: TH,
        background: isPicked ? 'rgba(59,130,246,0.12)' : 'transparent',
        borderBottom: side === 'home' ? '1px solid rgba(255,255,255,0.04)' : undefined,
        paddingLeft: 5,
        paddingRight: 5,
        gap: 4,
      }}>
        {seed != null && (
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', width: 14, flexShrink: 0, textAlign: 'right' }}>
            {seed}
          </span>
        )}
        <span style={{
          fontSize: 10,
          fontWeight: isPicked ? 600 : 400,
          color: showSeedOnly ? 'rgba(255,255,255,0.15)' : !name ? 'rgba(255,255,255,0.1)' : isPicked ? '#3b82f6' : 'rgba(255,255,255,0.6)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          fontStyle: !name && !showSeedOnly ? 'italic' : undefined,
        }}>
          {showSeedOnly ? '---' : name || ''}
        </span>
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: CW,
        height: CH,
        background: '#2a3348',
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      <TeamRow name={homeName} seed={homeSeed} isPicked={homePicked} side="home" />
      <TeamRow name={awayName} seed={awaySeed} isPicked={awayPicked} side="away" />
    </div>
  )
}

export function BracketProView({ tournamentId, leagueId, entryId, nodes, initialPicks }: Props) {
  const { formatInTimezone } = useUserTimezone()
  const { data: live } = useBracketLive({ tournamentId, leagueId, enabled: true, intervalMs: 12000 })
  const [picks, setPicks] = useState<Record<string, string | null>>(initialPicks)
  const [wizardNode, setWizardNode] = useState<Node | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  const seedMap = useMemo(() => buildSeedMap(nodes), [nodes])

  const nodesWithLive = useMemo(() => {
    const gameById = new Map((live?.games ?? []).map((g: any) => [g.id, g]))
    return nodes.map((n) => {
      const g = n.sportsGameId ? gameById.get(n.sportsGameId) : null
      return { ...n, game: (g as Game) ?? n.game ?? null }
    })
  }, [nodes, live?.games])

  const effective = useMemo(() => computeEffectiveTeams(nodesWithLive, picks), [nodesWithLive, picks])
  const bracketReleased = useMemo(() => isBracketReleased(nodesWithLive), [nodesWithLive])

  const { byRegion, finals, firstFour } = useMemo(() => {
    const reg: Record<string, Node[]> = {}
    const fin: Node[] = []
    const ff: Node[] = []
    ALL_REGIONS.forEach((r) => (reg[r] = []))
    for (const n of nodesWithLive) {
      if (n.round === 0) ff.push(n)
      else if (!n.region) fin.push(n)
      else reg[n.region]?.push(n)
    }
    for (const r of ALL_REGIONS) reg[r].sort((a, b) => a.round - b.round || a.slot.localeCompare(b.slot))
    ff.sort((a, b) => a.slot.localeCompare(b.slot))
    fin.sort((a, b) => a.round - b.round || a.slot.localeCompare(b.slot))
    return { byRegion: reg, finals: fin, firstFour: ff }
  }, [nodesWithLive])

  const openDate = useMemo(() => {
    const starts = nodesWithLive
      .map((n) => (n.game?.startTime ? new Date(n.game.startTime).getTime() : null))
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b)
    if (!starts.length) return "TBD"
    return formatInTimezone(starts[0], { month: "long", day: "numeric" })
  }, [formatInTimezone, nodesWithLive])

  const totalPicks = Object.values(picks).filter(Boolean).length
  const totalGames = nodesWithLive.filter(n => n.round >= 1).length

  const submitPick = useCallback(async (node: Node, teamName: string) => {
    if (!teamName) return
    if (isPickLocked(node)) return
    const prev = picks[node.id] ?? null
    const tentative = { ...picks, [node.id]: teamName }
    const cleaned = cascadeClearInvalidPicks(nodesWithLive, tentative)
    setPicks(cleaned)
    const res = await fetch(`/api/bracket/entries/${entryId}/pick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: node.id, pickedTeamName: teamName }),
    })
    if (!res.ok) {
      setPicks((p) => ({ ...p, [node.id]: prev }))
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? "Pick failed")
    }
  }, [picks, nodesWithLive, entryId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const cw = el.clientWidth
      if (cw > 0 && cw < FULL_W) {
        setScale(cw / FULL_W)
      } else {
        setScale(1)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function renderRegionCells(region: string, direction: 'ltr' | 'rtl', offsetX: number, offsetY: number) {
    const regionNodes = byRegion[region] || []
    const byRound: Record<number, Node[]> = { 1: [], 2: [], 3: [], 4: [] }
    for (const n of regionNodes) {
      if (byRound[n.round]) byRound[n.round].push(n)
    }
    Object.values(byRound).forEach(arr => arr.sort((a, b) => a.slot.localeCompare(b.slot)))

    const cells: JSX.Element[] = []
    for (let r = 1; r <= 4; r++) {
      const roundNodes = byRound[r]
      const centers = POS[r]
      for (let i = 0; i < roundNodes.length && i < centers.length; i++) {
        const x = direction === 'ltr'
          ? offsetX + (r - 1) * (CW + CG)
          : offsetX + (4 - r) * (CW + CG)
        const y = offsetY + centers[i] - TH
        cells.push(
          <MiniCell
            key={roundNodes[i].id}
            node={roundNodes[i]}
            picks={picks}
            seedMap={seedMap}
            effective={effective}
            x={x}
            y={y}
            bracketReleased={bracketReleased}
            onClick={() => {
              const e = effective.get(roundNodes[i].id)
              const h = e?.home ?? roundNodes[i].homeTeamName
              const a = e?.away ?? roundNodes[i].awayTeamName
              if (h && a) setWizardNode(roundNodes[i])
            }}
          />
        )
      }
    }
    return cells
  }

  function renderRegionLines(direction: 'ltr' | 'rtl', offsetX: number, offsetY: number) {
    const lines: JSX.Element[] = []
    for (let ri = 0; ri < 3; ri++) {
      const r = ri + 1
      const centers = POS[r]
      const nextCenters = POS[r + 1]
      for (let i = 0; i < centers.length; i++) {
        const pairIdx = Math.floor(i / 2)
        const cy = offsetY + centers[i]
        const ny = offsetY + nextCenters[pairIdx]
        let sx: number, ex: number
        if (direction === 'ltr') {
          sx = offsetX + ri * (CW + CG) + CW
          ex = offsetX + (ri + 1) * (CW + CG)
        } else {
          sx = offsetX + (3 - ri) * (CW + CG)
          ex = offsetX + (3 - ri - 1) * (CW + CG) + CW
        }
        const mx = (sx + ex) / 2
        lines.push(<line key={`${direction}-${r}-${i}-h1`} x1={sx} y1={cy} x2={mx} y2={cy} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />)
        lines.push(<line key={`${direction}-${r}-${i}-v`} x1={mx} y1={cy} x2={mx} y2={ny} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />)
        if (i % 2 === 0) {
          lines.push(<line key={`${direction}-${r}-${i}-h2`} x1={mx} y1={ny} x2={ex} y2={ny} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />)
        }
      }
    }
    return lines
  }

  const leftX = 0
  const rightX = REGION_W + CENTER_W
  const topY = 0
  const botY = REGION_H + REGION_V_GAP
  const e8TopCy = topY + POS[4][0]
  const e8BotCy = botY + POS[4][0]
  const centerX = REGION_W
  const centerMidY = FULL_H / 2
  const ffNodes = finals.filter(n => n.round === 5)
  const champNodes = finals.filter(n => n.round === 6)
  const ff0Y = centerMidY - CH - 28
  const ff1Y = centerMidY + 28
  const champY = centerMidY - TH

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.06)',
        background: '#252d40',
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Timer style={{ width: 18, height: 18, color: 'rgba(255,255,255,0.5)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
            {bracketReleased ? `Brackets open \u2022 ${openDate}` : `Brackets open on ${openDate}`}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
            {bracketReleased ? "Tap any matchup to make your pick" : "Waiting for Selection Sunday"}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fb923c' }}>{totalPicks}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>/ {totalGames}</div>
        </div>
      </div>

      <PickAssistCard entryId={entryId} />

      <div
        ref={containerRef}
        style={{
          borderRadius: 14,
          background: '#1a1f2e',
          border: '1px solid rgba(255,255,255,0.05)',
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          height: Math.ceil(FULL_H * scale) + 2,
        }}
      >
        <div style={{
          width: FULL_W,
          height: FULL_H,
          position: 'relative',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}>
          <svg width={FULL_W} height={FULL_H} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {renderRegionLines('ltr', leftX, topY)}
            {renderRegionLines('ltr', leftX, botY)}
            {renderRegionLines('rtl', rightX, topY)}
            {renderRegionLines('rtl', rightX, botY)}
            <line x1={leftX + REGION_W} y1={e8TopCy} x2={centerX + (CENTER_W - CW) / 2} y2={ff0Y + TH} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
            <line x1={leftX + REGION_W} y1={e8BotCy} x2={centerX + (CENTER_W - CW) / 2} y2={ff1Y + TH} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
            <line x1={rightX} y1={e8TopCy} x2={centerX + (CENTER_W + CW) / 2} y2={ff0Y + TH} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
            <line x1={rightX} y1={e8BotCy} x2={centerX + (CENTER_W + CW) / 2} y2={ff1Y + TH} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
            <line x1={centerX + CENTER_W / 2} y1={ff0Y + CH} x2={centerX + CENTER_W / 2} y2={champY} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
            <line x1={centerX + CENTER_W / 2} y1={ff1Y} x2={centerX + CENTER_W / 2} y2={champY + CH} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
          </svg>

          <div style={{ position: 'absolute', left: leftX + REGION_W * 0.45, top: topY + REGION_H * 0.42, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
            <span style={{ fontSize: 60, fontWeight: 900, color: 'rgba(255,255,255,0.03)', letterSpacing: 6 }}>W</span>
          </div>
          <div style={{ position: 'absolute', left: leftX + REGION_W * 0.45, top: botY + REGION_H * 0.42, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
            <span style={{ fontSize: 60, fontWeight: 900, color: 'rgba(255,255,255,0.03)', letterSpacing: 6 }}>E</span>
          </div>
          <div style={{ position: 'absolute', left: rightX + REGION_W * 0.55, top: topY + REGION_H * 0.42, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
            <span style={{ fontSize: 60, fontWeight: 900, color: 'rgba(255,255,255,0.03)', letterSpacing: 6 }}>S</span>
          </div>
          <div style={{ position: 'absolute', left: rightX + REGION_W * 0.55, top: botY + REGION_H * 0.42, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
            <span style={{ fontSize: 52, fontWeight: 900, color: 'rgba(255,255,255,0.03)', letterSpacing: 6 }}>MW</span>
          </div>

          {renderRegionCells('West', 'ltr', leftX, topY)}
          {renderRegionCells('East', 'ltr', leftX, botY)}
          {renderRegionCells('South', 'rtl', rightX, topY)}
          {renderRegionCells('Midwest', 'rtl', rightX, botY)}

          {ffNodes.map((n, i) => (
            <MiniCell
              key={n.id}
              node={n}
              picks={picks}
              seedMap={seedMap}
              effective={effective}
              x={centerX + (CENTER_W - CW) / 2}
              y={i === 0 ? ff0Y : ff1Y}
              bracketReleased={bracketReleased}
              onClick={() => setWizardNode(n)}
            />
          ))}

          {champNodes.map((n) => (
            <MiniCell
              key={n.id}
              node={n}
              picks={picks}
              seedMap={seedMap}
              effective={effective}
              x={centerX + (CENTER_W - CW) / 2}
              y={champY}
              bracketReleased={bracketReleased}
              onClick={() => setWizardNode(n)}
            />
          ))}

          <div style={{
            position: 'absolute',
            left: centerX + (CENTER_W - 80) / 2,
            top: centerMidY - 40,
            width: 80, height: 80,
            borderRadius: 18,
            background: 'linear-gradient(135deg, #2a3348, #1e2740)',
            border: '1px solid rgba(255,255,255,0.10)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 3,
            pointerEvents: 'none',
          }}>
            <Trophy style={{ width: 22, height: 22, color: 'rgba(251,146,60,0.6)' }} />
            <img src="/af-crest.svg" alt="AF" style={{ width: 24, height: 24, objectFit: 'contain', opacity: 0.5 }} />
          </div>
        </div>

      </div>

      {wizardNode && (
        <PickWizard
          nodes={nodesWithLive}
          startNode={wizardNode}
          picks={picks}
          seedMap={seedMap}
          effective={effective}
          entryId={entryId}
          onPick={submitPick}
          onClose={() => setWizardNode(null)}
        />
      )}
    </div>
  )
}
