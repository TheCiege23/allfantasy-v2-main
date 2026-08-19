'use client'

/**
 * Guillotine AF War Room panel — grounded in the league's OWN data via
 * /api/leagues/[leagueId]/guillotine-war-room. Every button calls a real route.
 * SURVIVAL-FIRST: surfaces elimination risk, safety margin, survival standings, roster
 * risk, lineup safety, FAAB plan, waivers, eliminated-team dropped pool, and a weekly
 * survival plan. Honest limited states (no elimination line / no pool). Trades only if
 * the league enables them. No dead buttons.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, ShieldQuestion, Skull, Sparkles } from 'lucide-react'
import {
  analyzeGuillotineWarRoomTrade,
  askGuillotineWarRoom,
  fetchGuillotineDroppedPlayers,
  fetchGuillotineFaabPlan,
  fetchGuillotineLineupSafety,
  fetchGuillotineRosterRisk,
  fetchGuillotineWaivers,
  fetchGuillotineWarRoomState,
} from '@/lib/guillotine-war-room/client'
import type { GuillotineWarRoomContext } from '@/lib/guillotine-war-room/types'
import type { GuillotineSurvivalRiskResult } from '@/lib/guillotine-war-room/guillotineSurvivalRiskEngine'
import type { GuillotineWeeklyPlanResult } from '@/lib/guillotine-war-room/guillotineWeeklyPlanEngine'
import type { GuillotineRosterRiskResult } from '@/lib/guillotine-war-room/guillotineRosterRiskEngine'
import type { GuillotineLineupSafetyResult } from '@/lib/guillotine-war-room/guillotineLineupSafetyEngine'
import type { GuillotineFaabPlanResult } from '@/lib/guillotine-war-room/guillotineFaabEngine'
import type { GuillotineWaiverResult } from '@/lib/guillotine-war-room/guillotineWaiverEngine'
import type { GuillotineDroppedPlayerResult } from '@/lib/guillotine-war-room/guillotineDroppedPlayerEngine'
import type { GuillotineTradeAnalysis } from '@/lib/guillotine-war-room/guillotineTradeEngine'

type Tool = 'roster-risk' | 'lineup-safety' | 'faab-plan' | 'waivers' | 'dropped-players' | 'trade-analyze' | null

const RISK_COLOR: Record<string, string> = {
  critical: 'text-rose-300',
  high: 'text-rose-300/80',
  moderate: 'text-amber-200/90',
  safe: 'text-emerald-300/85',
  eliminated: 'text-white/40',
  limited: 'text-white/50',
}
const TIER_BADGE: Record<string, string> = {
  chop_zone: 'bg-rose-500/20 text-rose-200',
  danger: 'bg-amber-500/20 text-amber-200',
  safe: 'bg-emerald-500/15 text-emerald-200',
  unknown: 'bg-white/[0.06] text-white/50',
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[11px] text-amber-200/80">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" />
      <span>{children}</span>
    </li>
  )
}

export function GuillotineWarRoomPanel({ leagueId }: { leagueId: string }) {
  const [context, setContext] = useState<GuillotineWarRoomContext | null>(null)
  const [survival, setSurvival] = useState<GuillotineSurvivalRiskResult | null>(null)
  const [weeklyPlan, setWeeklyPlan] = useState<GuillotineWeeklyPlanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tool, setTool] = useState<Tool>(null)
  const [toolBusy, setToolBusy] = useState(false)
  const [rosterRisk, setRosterRisk] = useState<GuillotineRosterRiskResult | null>(null)
  const [lineupSafety, setLineupSafety] = useState<GuillotineLineupSafetyResult | null>(null)
  const [faab, setFaab] = useState<GuillotineFaabPlanResult | null>(null)
  const [waivers, setWaivers] = useState<GuillotineWaiverResult | null>(null)
  const [dropped, setDropped] = useState<GuillotineDroppedPlayerResult | null>(null)
  const [tradeAnalysis, setTradeAnalysis] = useState<GuillotineTradeAnalysis | null>(null)
  const [tradeOutgoingId, setTradeOutgoingId] = useState('')
  const [tradeIncomingIds, setTradeIncomingIds] = useState('')

  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [askNote, setAskNote] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchGuillotineWarRoomState(leagueId)
      .then((res) => {
        if (!active) return
        setContext(res.context)
        setSurvival(res.survival)
        setWeeklyPlan(res.weeklyPlan)
        setError(null)
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Failed to load AF Legacy.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [leagueId])

  const runTool = useCallback(
    async (which: Exclude<Tool, null>) => {
      setTool(which)
      setToolBusy(true)
      try {
        if (which === 'roster-risk') setRosterRisk((await fetchGuillotineRosterRisk(leagueId)).rosterRisk)
        else if (which === 'lineup-safety') setLineupSafety((await fetchGuillotineLineupSafety(leagueId)).lineupSafety)
        else if (which === 'faab-plan') setFaab((await fetchGuillotineFaabPlan(leagueId)).faab)
        else if (which === 'waivers') setWaivers((await fetchGuillotineWaivers(leagueId)).waivers)
        else if (which === 'dropped-players') setDropped((await fetchGuillotineDroppedPlayers(leagueId)).droppedPlayers)
        else if (which === 'trade-analyze') {
          const own = context?.teams.find((t) => t.isUserTeam)?.players ?? []
          const fallback = own.find((p) => !p.isStarterSlot)?.playerId ?? own[0]?.playerId ?? ''
          const outgoing = (tradeOutgoingId || fallback).trim()
          const incoming = tradeIncomingIds.split(',').map((id) => id.trim()).filter(Boolean)
          setTradeAnalysis((await analyzeGuillotineWarRoomTrade(leagueId, { outgoingPlayerIds: outgoing ? [outgoing] : [], incomingPlayerIds: incoming })).tradeAnalysis)
          if (!tradeOutgoingId && fallback) setTradeOutgoingId(fallback)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Tool failed.')
      } finally {
        setToolBusy(false)
      }
    },
    [context, leagueId, tradeIncomingIds, tradeOutgoingId],
  )

  const onAsk = useCallback(async () => {
    const q = question.trim()
    if (!q) return
    setAskBusy(true)
    setAnswer(null)
    setAskNote(null)
    try {
      const res = await askGuillotineWarRoom(leagueId, q)
      if (res.aiUnavailable) {
        setAskNote('AI is temporarily unavailable — showing grounded facts only.')
        setAnswer(null)
      } else setAnswer(res.answer)
    } catch (e) {
      setAskNote(e instanceof Error ? e.message : 'Ask failed.')
    } finally {
      setAskBusy(false)
    }
  }, [leagueId, question])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#07071a] p-4 text-[12px] text-white/50" data-testid="guillotine-war-room-loading">
        <Loader2 className="h-4 w-4 animate-spin text-violet-300" /> Loading AF Legacy — Guillotine…
      </div>
    )
  }
  if (error || !context) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/90" data-testid="guillotine-war-room-error">
        {error ?? 'AF Legacy — Guillotine is unavailable for this league.'}
      </div>
    )
  }

  const tradesEnabled = context.guillotine.tradesEnabled
  const me = context.standings.find((s) => s.isUserTeam)

  return (
    <section className="space-y-3 rounded-xl border border-violet-400/20 bg-[#0a0820] p-4" data-testid="guillotine-war-room-panel">
      <div className="flex items-center gap-2">
        <Skull className="h-4 w-4 text-rose-300/80" />
        <h2 className="text-sm font-bold text-white">AF Legacy — Guillotine</h2>
        <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
          {context.sport} · W{context.currentWeek}
        </span>
      </div>

      {/* Survival risk hero + rules */}
      <div className="grid gap-2 rounded-lg border border-white/[0.06] bg-[#07071a] p-3 sm:grid-cols-3" data-testid="guillotine-war-room-survival-card">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Survival risk</p>
          <p className={`text-[14px] font-bold ${RISK_COLOR[survival?.riskLevel ?? 'limited']}`}>
            {(survival?.riskLevel ?? 'limited').replace('_', ' ')}
          </p>
          <p className="text-[10px] text-white/45">
            {survival?.safetyMargin != null ? `${survival.safetyMargin >= 0 ? '+' : ''}${survival.safetyMargin} vs chop` : 'no elimination line yet'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Field</p>
          <p className="text-[11px] text-white/70">{context.activeTeamCount} alive · {context.eliminatedTeamCount} chopped</p>
          <p className="text-[10px] text-white/45">{context.guillotine.teamsPerChop}/period · margin {context.guillotine.dangerMarginPoints}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Data</p>
          <p className="text-[11px] text-white/60">
            line {context.availability.eliminationLine === 'available' ? '✓' : '—'} · scores{' '}
            {context.availability.periodScores === 'available' ? '✓' : '—'} · pool{' '}
            {context.availability.droppedPlayerPool === 'available' ? '✓' : '—'}
          </p>
        </div>
      </div>

      {/* Weekly survival plan */}
      {weeklyPlan && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3" data-testid="guillotine-war-room-weekly-plan">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Weekly survival plan</p>
          <p className="mt-1 text-[12px] font-semibold text-violet-100">{weeklyPlan.headline}</p>
          <div className="mt-1 space-y-0.5">
            {weeklyPlan.steps.map((s) => (
              <p key={s.order} className="text-[11px] text-white/70">{s.order}. <span className="text-white/80">{s.action}</span> — {s.detail}</p>
            ))}
          </div>
        </div>
      )}

      {/* Survival standings (public to league) */}
      <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3" data-testid="guillotine-war-room-standings">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Survival standings</p>
        <div className="mt-1 space-y-0.5">
          {context.standings.slice(0, 12).map((s) => (
            <p key={s.rosterId} className={`text-[11px] ${s.isUserTeam ? 'text-white' : 'text-white/60'}`}>
              {s.eliminated ? (
                <span className="text-white/35">☠ {s.teamName ?? s.ownerName}{s.choppedInPeriod != null ? ` (P${s.choppedInPeriod})` : ''}</span>
              ) : (
                <>
                  <span className={`mr-1 rounded px-1 py-0.5 text-[9px] font-semibold ${TIER_BADGE[s.tier] ?? TIER_BADGE.unknown}`}>{s.tier.replace('_', ' ')}</span>
                  {s.teamName ?? s.ownerName}{s.isUserTeam ? ' (you)' : ''}
                  <span className="text-white/40"> · {s.seasonPointsCumul.toFixed(0)} PF{s.pointsFromChopZone != null ? ` · ${s.pointsFromChopZone >= 0 ? '+' : ''}${s.pointsFromChopZone.toFixed(0)}` : ''}</span>
                </>
              )}
            </p>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div className="flex flex-wrap gap-2">
        {(['roster-risk', 'lineup-safety', 'faab-plan', 'waivers', 'dropped-players'] as const).map((t) => (
          <button key={t} type="button" onClick={() => void runTool(t)} disabled={toolBusy} data-testid={`guillotine-war-room-tool-${t}`}
            className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-50">
            {t === 'roster-risk' ? 'Roster risk' : t === 'lineup-safety' ? 'Lineup safety' : t === 'faab-plan' ? 'FAAB plan' : t === 'waivers' ? 'Waivers' : 'Dropped pool'}
          </button>
        ))}
        <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy || !tradesEnabled}
          title={tradesEnabled ? undefined : 'Trades are disabled in this guillotine league'} data-testid="guillotine-war-room-tool-trade-analyze"
          className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-40">Trade analyzer</button>
      </div>

      {toolBusy && <p className="flex items-center gap-1.5 text-[11px] text-white/50"><Loader2 className="h-3 w-3 animate-spin" /> Running…</p>}

      {tool === 'roster-risk' && rosterRisk && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="guillotine-war-room-roster-risk-result">
          <p className="mb-1 font-semibold text-white/80">Floor risk: {rosterRisk.floorRiskScore}/100</p>
          {rosterRisk.weaknesses.map((w) => (<p key={w.position}>⚠ {w.position} ({w.severity}) — {w.reason}</p>))}
          {rosterRisk.injuredStarters.map((p) => (<p key={p.playerId} className="text-rose-300/70">🚑 {p.playerName} ({p.position}) {p.status}</p>))}
          {rosterRisk.weaknesses.length === 0 && rosterRisk.injuredStarters.length === 0 && <p className="text-white/40">No structural holes or injured starters.</p>}
        </div>
      )}

      {tool === 'lineup-safety' && lineupSafety && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="guillotine-war-room-lineup-safety-result">
          <p className="mb-1 font-semibold text-white/80">Lineup ({lineupSafety.posture.replace('_', ' ')}, confidence {lineupSafety.confidence})</p>
          {lineupSafety.suggestedStarters.map((s, i) => (<p key={`${s.position}-${i}`}><span className="text-white/40">{s.position}:</span> {s.playerName ?? '—'}{s.value != null && <span className="text-white/40"> ({s.value})</span>}</p>))}
          {lineupSafety.ceilingSwing && <p className="mt-1 text-amber-200/80">Ceiling swing: {lineupSafety.ceilingSwing.playerName} ({lineupSafety.ceilingSwing.position})</p>}
        </div>
      )}

      {tool === 'faab-plan' && faab && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="guillotine-war-room-faab-plan-result">
          <p className="mb-1 font-semibold text-white/80">FAAB: {faab.posture}{faab.suggestedMaxBid != null ? ` · max bid ~${faab.suggestedMaxBid}` : ''}</p>
          {faab.explanationFacts.map((f) => (<p key={f}>{f}</p>))}
        </div>
      )}

      {tool === 'waivers' && waivers && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="guillotine-war-room-waivers-result">
          <p className="mb-1 font-semibold text-white/80">Waivers ({waivers.urgency} urgency) · target {waivers.targetPositions.join(', ') || 'none'}</p>
          {waivers.recommendedAdds.map((a) => (<p key={a.playerId}>+ {a.playerName} ({a.position}) — {a.reason}</p>))}
          {waivers.dropCandidates.map((d) => (<p key={d.playerId} className="text-white/55">– {d.playerName} ({d.position}) — {d.reason}</p>))}
          {waivers.needsPoolData && <p className="mt-1 text-amber-200/80">No eliminated-team pool yet — target positions still apply.</p>}
        </div>
      )}

      {tool === 'dropped-players' && dropped && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="guillotine-war-room-dropped-players-result">
          {!dropped.available ? <p className="text-amber-200/80">No eliminated-team dropped-player pool available yet.</p> : (
            <>
              <p className="mb-1 font-semibold text-white/80">Eliminated-team pool ({dropped.poolSize})</p>
              {dropped.targets.map((t) => (<p key={t.playerId}>{t.playerName} ({t.position}){t.atNeed ? <span className="text-emerald-300/80"> · need</span> : null} — {t.note}</p>))}
            </>
          )}
        </div>
      )}

      {tool === 'trade-analyze' && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70">
          {!tradesEnabled ? <p className="text-amber-200/80">Trades are disabled in this guillotine league.</p> : (
            <>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <select value={tradeOutgoingId} onChange={(e) => setTradeOutgoingId(e.target.value)} data-testid="guillotine-war-room-trade-outgoing-select"
                  className="min-w-0 rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[11px] text-white/80 focus:border-violet-400/40 focus:outline-none">
                  <option value="">Outgoing player</option>
                  {(context?.teams.find((t) => t.isUserTeam)?.players ?? []).map((p) => (<option key={p.playerId} value={p.playerId}>{p.playerName} ({p.position})</option>))}
                </select>
                <input value={tradeIncomingIds} onChange={(e) => setTradeIncomingIds(e.target.value)} placeholder="Incoming player ID" data-testid="guillotine-war-room-trade-incoming-input"
                  className="min-w-0 rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none" />
                <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy} data-testid="guillotine-war-room-trade-analyze-submit"
                  className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-50">Analyze</button>
              </div>
              {tradeAnalysis && (
                <div className="mt-2 space-y-1" data-testid="guillotine-war-room-trade-analyze-result">
                  <p className="font-semibold text-white/80">Verdict: {tradeAnalysis.verdict.replace(/_/g, ' ')}{tradeAnalysis.valueDelta != null ? <span className="text-white/40"> · value {tradeAnalysis.valueDelta}</span> : null}</p>
                  {tradeAnalysis.explanationFacts.map((f) => (<p key={f}>{f}</p>))}
                  {tradeAnalysis.riskFlags.length > 0 && <ul className="mt-2 space-y-1">{tradeAnalysis.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Global missing-data flags */}
      {context.missingDataFlags.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] p-2">{context.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>
      )}

      {/* Ask War Room */}
      <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40"><ShieldQuestion className="h-3.5 w-3.5" /> Ask AF Legacy</p>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Am I at risk of elimination, and should I spend FAAB?" rows={2} data-testid="guillotine-war-room-ask-input"
          className="w-full resize-none rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[12px] text-white/85 placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none" />
        <button type="button" onClick={() => void onAsk()} disabled={askBusy || !question.trim()} data-testid="guillotine-war-room-ask-submit"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-50">
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} Ask
        </button>
        {askNote && <p className="mt-2 text-[11px] text-amber-200/80" data-testid="guillotine-war-room-ask-note">{askNote}</p>}
        {answer && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-white/80" data-testid="guillotine-war-room-answer">{answer}</p>}
      </div>
    </section>
  )
}
