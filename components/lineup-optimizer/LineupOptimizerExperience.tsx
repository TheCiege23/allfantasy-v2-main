'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { SAMPLE_NFL_ROSTER, SAMPLE_ROSTER_SLOTS } from './sample-roster'
import { useLineupOptimizer } from './hooks/useLineupOptimizer'
import { MatchupHeaderBar } from './MatchupHeaderBar'
import { PlayerLineupCard, mapEngineToCardVariant } from './PlayerLineupCard'
import { AiInsightsPanel } from './AiInsightsPanel'
import { AlertsBanner } from './AlertsBanner'
import { AutoSubSection } from './AutoSubSection'
import { UserPreferencePanel } from './UserPreferencePanel'
import { StickyActionBar } from './StickyActionBar'
import { PlayerDetailModal } from './PlayerDetailModal'
import { ShareLineupModal } from './ShareLineupModal'
import { SportHintStrip } from './SportHintStrip'
import { buildAiPlayerCompareToolUrl } from '@/lib/chimmy-actions/aiPlayerComparisonBridge'
import { LineupModeSwitcher } from './LineupModeSwitcher'
import type { DecisionEngineJson, LineupRosterPlayer, MatchupHeaderModel } from './types'

function findRosterPlayer(roster: LineupRosterPlayer[], id: string, name: string) {
  return roster.find((p) => p.id === id) ?? roster.find((p) => p.name === name)
}

/** Client-side hint: game kickoff passed — treat slot as locked for lineup edits. */
function isGameLikelyStarted(gameTime?: string): boolean {
  if (!gameTime?.trim()) return false
  const t = Date.parse(gameTime)
  if (Number.isNaN(t)) return false
  return Date.now() > t
}

function enrichStarterCard(
  roster: LineupRosterPlayer[],
  row: {
    playerId: string
    playerName: string
    projectedPoints: number
    slotCode: string
    selectedPosition: string
  },
  engineRow: DecisionEngineJson['optimizedLineup'][0] | undefined
): { player: LineupRosterPlayer; variant: ReturnType<typeof mapEngineToCardVariant>; ai: boolean } {
  const base =
    findRosterPlayer(roster, row.playerId, row.playerName) ??
    ({
      id: row.playerId,
      name: row.playerName,
      positions: [row.selectedPosition],
      projectedPoints: row.projectedPoints,
    } as LineupRosterPlayer)
  const merged: LineupRosterPlayer = {
    ...base,
    projectedPoints: row.projectedPoints,
  }
  const variant = engineRow
    ? mapEngineToCardVariant(engineRow.startConfidence, engineRow.volatilityScore, merged.injuryStatus)
    : 'neutral'
  return { player: merged, variant, ai: true }
}

export function LineupOptimizerExperience() {
  const opt = useLineupOptimizer()
  const [modalPlayer, setModalPlayer] = useState<LineupRosterPlayer | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [lineupLocked, setLineupLocked] = useState(false)
  const [pref, setPref] = useState<{
    activeTraits: string[]
    traitSummary?: Record<string, { confidence: number; sampleSize: number }>
    notes: string[]
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/lineup-preferences')
        if (!res.ok) return
        const data = (await res.json()) as {
          profile?: {
            traitSummary?: Record<string, { confidence: number; sampleSize: number }>
            optimizerProfileInput?: unknown
          }
        }
        if (cancelled || !data.profile) return
        const summary = data.profile.traitSummary ?? {}
        const activeTraits = Object.keys(summary).filter((k) => (summary[k]?.confidence ?? 0) > 0.08)
        setPref({
          activeTraits: activeTraits.slice(0, 8),
          traitSummary: summary,
          notes: ['Preferences reinforce slowly from your actions — never override big projection edges.'],
        })
      } catch {
        /* optional */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadDemo = useCallback(() => {
    opt.setRoster(SAMPLE_NFL_ROSTER)
    opt.setRosterSlots(SAMPLE_ROSTER_SLOTS)
    opt.setSport('NFL')
  }, [opt])

  const matchup: MatchupHeaderModel = useMemo(() => {
    const tc = opt.decisionEngine?.teamContext
    const wp = tc?.projectedWinProbability ?? 0.55
    const tag: MatchupHeaderModel['tag'] =
      wp >= 0.58 ? 'Favorite' : wp <= 0.42 ? 'Underdog' : 'Close Matchup'
    const strat: MatchupHeaderModel['strategyLabel'] =
      tag === 'Favorite' ? 'Play Safe' : tag === 'Underdog' ? 'Chase Upside' : 'Balanced Approach'
    return {
      teamName: 'Your Team',
      opponentName: 'Opponent',
      record: tc?.record ?? '—',
      rank: tc?.rank ?? 0,
      weekLabel: 'Week',
      projectedScore: opt.result?.totalProjectedPoints ?? 0,
      winProbability: wp,
      tag,
      strategyLabel: strat,
    }
  }, [opt.decisionEngine, opt.result])

  const aiConfidencePct = useMemo(() => {
    const rows = opt.decisionEngine?.optimizedLineup ?? []
    if (!rows.length) return 0
    const avg = rows.reduce((s, r) => s + r.startConfidence, 0) / rows.length
    return Math.min(99, Math.round(avg))
  }, [opt.decisionEngine])

  const startersUi = useMemo(() => {
    if (!opt.result?.starters?.length || !opt.decisionEngine) return []
    return opt.result.starters.map((s, idx) => {
      const er = opt.decisionEngine?.optimizedLineup[idx]
      return enrichStarterCard(opt.roster, { ...s, slotCode: s.slotCode }, er)
    })
  }, [opt.result, opt.decisionEngine, opt.roster])

  const benchUi = useMemo(() => {
    if (!opt.result?.bench?.length) return []
    const engBench = opt.decisionEngine?.benchDecisions ?? []
    return opt.result.bench.map((b, i) => {
      const p =
        findRosterPlayer(opt.roster, b.playerId, b.playerName) ??
        ({
          id: b.playerId,
          name: b.playerName,
          positions: b.positions,
          projectedPoints: b.projectedPoints,
        } as LineupRosterPlayer)
      const eb = engBench.find((x) => x.playerName === b.playerName)
      const badge =
        eb && eb.swapPriority > 60 ? 'consider_start' : eb && eb.swapPriority > 40 ? 'high_upside' : 'safe_alt'
      return { player: p, swapPriority: eb?.swapPriority ?? 0, badge: badge as 'consider_start' | 'high_upside' | 'safe_alt' }
    })
  }, [opt.result, opt.decisionEngine, opt.roster])

  const alerts = useMemo(() => {
    const a = opt.decisionEngine?.alerts ?? []
    const extra: string[] = []
    if (opt.roster.some((p) => p.injuryStatus?.toLowerCase().includes('questionable'))) {
      extra.push('At least one player is Questionable — confirm status before lock.')
    }
    if (!opt.result?.bench?.length) {
      extra.push('No bench players — limited flexibility for swaps.')
    }
    return [...extra, ...a]
  }, [opt.decisionEngine, opt.roster, opt.result])

  const autoSubStarterContext = useMemo(() => {
    if (!opt.result?.starters?.length) return null
    const riskyStarterNames: string[] = []
    const starterLockByPlayerId: Record<string, boolean> = {}
    const starterRows = opt.result.starters.map((s) => ({
      playerId: s.playerId,
      playerName: s.playerName,
      slotCode: s.slotCode,
    }))
    opt.result.starters.forEach((s, idx) => {
      const r = findRosterPlayer(opt.roster, s.playerId, s.playerName)
      const eng = opt.decisionEngine?.optimizedLineup[idx]
      const inj = r?.injuryStatus?.toLowerCase() ?? ''
      const riskyInj =
        inj.includes('questionable') ||
        inj.includes('doubtful') ||
        inj.includes('doubt') ||
        inj.includes('game time') ||
        inj.includes('gtd')
      const riskyVol = eng != null && eng.volatilityScore >= 56
      if (riskyInj || riskyVol) riskyStarterNames.push(s.playerName)
      starterLockByPlayerId[s.playerId] = lineupLocked || isGameLikelyStarted(r?.gameTime)
    })
    return { starterRows, riskyStarterNames, starterLockByPlayerId }
  }, [opt.result, opt.roster, opt.decisionEngine, lineupLocked])

  return (
    <div className="pb-24 lg:pb-8" data-testid="lineup-optimizer-experience">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <Link href="/app" className="text-sm text-cyan-400 hover:underline">
          Back to app
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadDemo}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
            data-testid="lineup-optimizer-load-demo"
          >
            Load demo roster
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-white/55">
            <input
              type="checkbox"
              checked={opt.useAiExplain}
              onChange={(e) => opt.setUseAiExplain(e.target.checked)}
              className="rounded border-white/20"
            />
            Chimmy narrative
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        {/* Left / top: matchup */}
        <div className="space-y-3 lg:col-span-3">
          <MatchupHeaderBar model={matchup} />
          <SportHintStrip sport={opt.sport} />
          <LineupModeSwitcher
            value={opt.lineupMode}
            onChange={(m) => {
              opt.setLineupMode(m)
              if (opt.roster.length) void opt.optimize({ mode: m })
            }}
            disabled={opt.loading}
          />
          <AlertsBanner alerts={alerts} />
        </div>

        {/* Center: lineup */}
        <div className="space-y-4 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/55">Starters</h2>
              <Link
                href={buildAiPlayerCompareToolUrl({ sport: opt.sport })}
                className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-500/20"
                data-testid="lineup-optimizer-compare-players"
              >
                Compare players
              </Link>
            </div>
            <AnimatePresence mode="wait">
              <motion.span
                key={opt.result?.totalProjectedPoints ?? 0}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-sm tabular-nums text-cyan-200"
              >
                Total proj: {opt.result?.totalProjectedPoints?.toFixed(1) ?? '—'}
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="space-y-2">
            {startersUi.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 bg-[#0a1228]/50 p-8 text-center text-sm text-white/45">
                Load a roster and run <span className="text-cyan-200">Analyze lineup</span>.
              </div>
            ) : (
              startersUi.map(({ player, variant, ai }, idx) => (
                <motion.div
                  key={`${player.id}-${idx}`}
                  layout
                  initial={{ opacity: 0.85 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <PlayerLineupCard
                    slotLabel={opt.result?.starters[idx]?.slotCode ?? '—'}
                    player={player}
                    variant={variant}
                    aiRecommended={ai}
                    sport={opt.sport}
                    onClick={() => setModalPlayer(player)}
                  />
                </motion.div>
              ))
            )}
          </div>

          <h3 className="pt-2 text-sm font-semibold uppercase tracking-wider text-white/55">Bench</h3>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {benchUi.length === 0 ? (
              <p className="text-xs text-white/40">No bench data yet.</p>
            ) : (
              benchUi.map((b, i) => (
                <div key={`${b.player.id}-bench-${i}`} className="min-w-[240px] shrink-0 lg:min-w-0">
                  <PlayerLineupCard
                    slotLabel="Bench"
                    player={b.player}
                    variant="neutral"
                    swapPriority={b.swapPriority}
                    benchBadge={b.badge}
                    compact
                    sport={opt.sport}
                    onClick={() => setModalPlayer(b.player)}
                  />
                </div>
              ))
            )}
          </div>

          {opt.error ? (
            <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {opt.error}
            </p>
          ) : null}
        </div>

        {/* Right / bottom: AI */}
        <div className="space-y-4 lg:col-span-4">
          <AiInsightsPanel
            engine={opt.decisionEngine}
            aiConfidencePct={aiConfidencePct}
            loading={opt.loading}
          />

          {opt.decisionExplanation ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-white/75">
              <p className="text-xs font-semibold uppercase text-cyan-200/80">Coach summary</p>
              <p className="mt-2 font-medium text-white">{opt.decisionExplanation.summary}</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-white/60">
                {opt.decisionExplanation.bullets.slice(0, 5).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <AutoSubSection
            engine={opt.decisionEngine}
            enabled={opt.autoSubEnabled}
            onEnabledChange={opt.setAutoSubEnabled}
            lineupLocked={lineupLocked}
            starterRows={autoSubStarterContext?.starterRows}
            riskyStarterNames={autoSubStarterContext?.riskyStarterNames}
            starterLockByPlayerId={autoSubStarterContext?.starterLockByPlayerId}
          />

          <UserPreferencePanel
            activeTraits={pref?.activeTraits ?? opt.decisionEngine?.preferenceProfileSummary.activeTraits ?? []}
            traitSummary={pref?.traitSummary}
            notes={
              pref?.notes ??
              opt.decisionEngine?.preferenceProfileSummary.notes ?? [
                'Connect your account history to surface trait confidence.',
              ]
            }
          />
        </div>
      </div>

      <StickyActionBar
        loading={opt.loading}
        canApply={Boolean(opt.result)}
        pulseAnalyze={opt.roster.length > 0 && !opt.result}
        onOptimize={() => void opt.optimize()}
        onReset={() => {
          opt.setRoster([])
          opt.setRosterSlots([])
          opt.setSport('NFL')
        }}
        onLock={() => setLineupLocked((l) => !l)}
        onShare={() => setShareOpen(true)}
      />

      <PlayerDetailModal open={modalPlayer != null} onOpenChange={(o) => !o && setModalPlayer(null)} player={modalPlayer} />
      <ShareLineupModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        engine={opt.decisionEngine}
        projectedScore={opt.result?.totalProjectedPoints ?? matchup.projectedScore}
        winProbability={matchup.winProbability}
      />
    </div>
  )
}
