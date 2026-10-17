'use client'

import { useState } from 'react'
import type { MatchupSimResult, SwingPlayer, WinLoseCondition, ScenarioResult } from '@/lib/matchup-intelligence'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function winColor(pct: number): string {
  if (pct >= 60) return 'text-emerald-400'
  if (pct >= 45) return 'text-amber-400'
  return 'text-red-400'
}

function winBg(pct: number): string {
  if (pct >= 60) return 'bg-emerald-500'
  if (pct >= 45) return 'bg-amber-500'
  return 'bg-red-500'
}

function leverageBg(score: number): string {
  if (score >= 70) return 'bg-red-500/15 border-red-500/25'
  if (score >= 45) return 'bg-amber-500/15 border-amber-500/25'
  return 'bg-zinc-800 border-zinc-700'
}

// ---------------------------------------------------------------------------
// Win Probability Bar
// ---------------------------------------------------------------------------

function WinProbBar({ pctA, pctB, nameA, nameB }: { pctA: number; pctB: number; nameA: string; nameB: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className={winColor(pctA)}>{nameA}: {pctA}%</span>
        <span className={winColor(pctB)}>{nameB}: {pctB}%</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-zinc-800">
        <div className={`${winBg(pctA)} transition-all`} style={{ width: `${pctA}%` }} />
        <div className={`${winBg(pctB)} transition-all`} style={{ width: `${pctB}%` }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Score Range Visual
// ---------------------------------------------------------------------------

function ScoreRange({ label, range, color }: {
  label: string
  range: { p10: number; p25: number; p50: number; p75: number; p90: number }
  color: string
}) {
  const width = range.p90 - range.p10
  const barLeft = ((range.p25 - range.p10) / width) * 100
  const barWidth = ((range.p75 - range.p25) / width) * 100
  const medianPos = ((range.p50 - range.p10) / width) * 100

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px] text-zinc-500">
        <span>{label}</span>
        <span>{range.p10} — {range.p90}</span>
      </div>
      <div className="relative h-4 bg-zinc-800 rounded-full overflow-hidden">
        {/* IQR bar (p25-p75) */}
        <div
          className={`absolute h-full rounded-full ${color} opacity-40`}
          style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
        />
        {/* Median marker */}
        <div
          className={`absolute top-0 h-full w-0.5 ${color}`}
          style={{ left: `${medianPos}%` }}
        />
        {/* Median label */}
        <span
          className="absolute top-0.5 text-[11px] text-white font-bold"
          style={{ left: `${medianPos + 2}%` }}
        >
          {range.p50}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Swing Player Card
// ---------------------------------------------------------------------------

function SwingPlayerCard({ player }: { player: SwingPlayer }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${leverageBg(player.leverageScore)}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-white">{player.name}</span>
          <span className="text-[11px] text-zinc-500 ml-1">{player.position} ({player.team === 'A' ? 'You' : 'Opp'})</span>
        </div>
        <div className="flex items-center gap-1.5">
          {player.boomProbability >= 0.2 && (
            <span className="text-[11px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Boom {Math.round(player.boomProbability * 100)}%
            </span>
          )}
          {player.bustProbability >= 0.25 && (
            <span className="text-[11px] px-1 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
              Bust {Math.round(player.bustProbability * 100)}%
            </span>
          )}
          <span className={`text-[11px] font-bold ${player.leverageScore >= 60 ? 'text-red-400' : 'text-zinc-400'}`}>
            {player.leverageScore}
          </span>
        </div>
      </div>
      <p className="text-[11px] text-zinc-500 mt-0.5">{player.impactDescription}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Condition List
// ---------------------------------------------------------------------------

function ConditionList({ title, items, icon }: {
  title: string
  items: WinLoseCondition[]
  icon: string
}) {
  if (items.length === 0) return null
  return (
    <div>
      <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">{icon} {title}</h4>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="text-xs text-zinc-400 flex justify-between gap-2">
            <span className="flex-1">{item.description}</span>
            <span className="text-zinc-500 whitespace-nowrap">{item.probability}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scenario Bar
// ---------------------------------------------------------------------------

function ScenarioBar({ scenario }: { scenario: ScenarioResult }) {
  const labels: Record<string, string> = {
    standard: 'Standard',
    underdog_path: 'Underdog Path',
    favored_path: 'Favored Path',
    ceiling_path: 'Ceiling Path',
    safe_floor_path: 'Safe Floor',
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-zinc-500 w-20 text-right">{labels[scenario.mode] ?? scenario.mode}</span>
      <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-zinc-800">
        <div className="bg-emerald-500/60 transition-all" style={{ width: `${scenario.winPctA}%` }} />
        <div className="bg-red-500/60 transition-all" style={{ width: `${scenario.winPctB}%` }} />
      </div>
      <span className="text-zinc-400 w-12 text-right">{scenario.winPctA}%</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function MatchupSimPanel({
  result,
  teamAName,
  teamBName,
  onRerun,
}: {
  result: MatchupSimResult
  teamAName?: string
  teamBName?: string
  onRerun?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const nameA = teamAName ?? 'Team A'
  const nameB = teamBName ?? 'Team B'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden space-y-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Matchup Simulator</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">{result.simulationCount.toLocaleString()} sims | {result.confidencePct}% conf</span>
          {onRerun && (
            <button
              onClick={onRerun}
              className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors border border-zinc-700"
            >
              Re-run
            </button>
          )}
        </div>
      </div>

      {/* Win Probability */}
      <WinProbBar pctA={result.teamAWinPct} pctB={result.teamBWinPct} nameA={nameA} nameB={nameB} />

      {/* Median scores */}
      <div className="flex justify-between text-xs text-zinc-400">
        <span>Median: {result.medianOutcome.teamA}</span>
        <span className="text-zinc-600">vs</span>
        <span>Median: {result.medianOutcome.teamB}</span>
      </div>

      {/* Score Ranges */}
      <div className="space-y-2">
        <ScoreRange label={nameA} range={result.scoreRanges.teamA} color="bg-emerald-500" />
        <ScoreRange label={nameB} range={result.scoreRanges.teamB} color="bg-red-500" />
      </div>

      {/* Volatility badge */}
      <div className="flex gap-1.5">
        <span className={`text-[11px] px-1.5 py-0.5 rounded border ${
          result.volatilityTag === 'high' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
          result.volatilityTag === 'medium' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
          'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        }`}>
          {result.volatilityTag} volatility
        </span>
        {result.xFactors.slice(0, 2).map((xf, i) => (
          <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            {xf.slice(0, 50)}
          </span>
        ))}
      </div>

      {/* Swing Players */}
      {result.keySwingPlayers.length > 0 && (
        <div>
          <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">Key Swing Players</h4>
          <div className="space-y-1">
            {result.keySwingPlayers.slice(0, 4).map((sp) => (
              <SwingPlayerCard key={sp.name} player={sp} />
            ))}
          </div>
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors py-1"
      >
        {expanded ? '▲ Show less' : '▼ How you win / danger zones / scenarios'}
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="space-y-3 pt-1 border-t border-zinc-800">
          {/* How you win / Danger zones */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2">
              <ConditionList title="How You Win" items={result.mustWinConditions} icon="✅" />
            </div>
            <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2">
              <ConditionList title="Danger Zones" items={result.loseScenarios} icon="⚠️" />
            </div>
          </div>

          {/* Scenarios */}
          {result.scenarioResults.length > 0 && (
            <div>
              <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1.5">Scenario Analysis</h4>
              <div className="space-y-1">
                {result.scenarioResults.map((sc) => (
                  <ScenarioBar key={sc.mode} scenario={sc} />
                ))}
              </div>
            </div>
          )}

          {/* Risk notes */}
          {result.riskNotes.length > 0 && (
            <div>
              <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">Risk Notes</h4>
              {result.riskNotes.map((note, i) => (
                <p key={i} className="text-xs text-zinc-400">• {note}</p>
              ))}
            </div>
          )}

          {/* Remaining swing players */}
          {result.keySwingPlayers.length > 4 && (
            <div>
              <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">More Leverage Players</h4>
              <div className="space-y-1">
                {result.keySwingPlayers.slice(4).map((sp) => (
                  <SwingPlayerCard key={sp.name} player={sp} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
