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
import { AlertTriangle, Loader2, ShieldQuestion, Skull } from 'lucide-react'
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
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { WarRoomTradeAnalysisView } from '@/lib/decision-os/trade/warRoomTradeView'
import { WarRoomTradeGradeLine } from '../WarRoomTradeGradeLine'

type Tool = 'roster-risk' | 'lineup-safety' | 'faab-plan' | 'waivers' | 'dropped-players' | 'trade-analyze' | null

/*
 * Colour from the workspace tokens only (2026-11-23): the panel was hard-coded dark (#0a0820 / #07071a, white
 * text, rose and violet tints), so in light mode its title, plan and buttons vanished and the question box was
 * solid black. --text, --muted, --surface, --line, --good/--warn/--bad switch with the mode.
 */
const RISK_COLOR: Record<string, string> = {
  critical: 'text-[var(--bad)]',
  high: 'text-[var(--bad)]',
  moderate: 'text-[var(--warn)]',
  safe: 'text-[var(--good)]',
  eliminated: 'text-[var(--muted)]',
  limited: 'text-[var(--muted)]',
}
const TIER_BADGE: Record<string, string> = {
  chop_zone: 'bg-[var(--bad-soft)] text-[var(--bad)]',
  danger: 'bg-[var(--warn-soft)] text-[var(--warn)]',
  safe: 'bg-[var(--good-soft)] text-[var(--good)]',
  unknown: 'bg-[var(--surface2)] text-[var(--muted)]',
}
const TIER_WORD: Record<string, string> = { chop_zone: 'Chop zone', danger: 'Danger', safe: 'Safe', unknown: '—' }

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[12px] text-[var(--warn)]">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
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
  const [tradeAnalysis, setTradeAnalysis] = useState<WarRoomTradeAnalysisView<GuillotineTradeAnalysis> | null>(null)
  const [tradeGrade, setTradeGrade] = useState<SuggestionGrade | null>(null)
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
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'The Guilly War Room did not load.'))
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
          const analyzed = await analyzeGuillotineWarRoomTrade(leagueId, { outgoingPlayerIds: outgoing ? [outgoing] : [], incomingPlayerIds: incoming })
          setTradeAnalysis(analyzed.tradeAnalysis)
          setTradeGrade(analyzed.tradeGrade ?? null)
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
        setAskNote('Chimmy is temporarily unavailable — showing grounded facts only.')
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
      <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4 text-[13px] text-[var(--muted)]" data-testid="guillotine-war-room-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the Guilly War Room…
      </div>
    )
  }
  if (error || !context) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--warn-soft)] px-3 py-2 text-[13px] text-[var(--warn)]" data-testid="guillotine-war-room-error">
        {error ?? 'The Guilly War Room is not available for this league.'}
      </div>
    )
  }

  const tradesEnabled = context.guillotine.tradesEnabled

  return (
    <section className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[var(--text)]" data-testid="guillotine-war-room-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Skull className="h-4 w-4 text-[var(--bad)]" />
        {/* Named for where it lives (the War Room tab), not "AF Legacy — Guilly". */}
        <h2 className="text-[15px] font-bold">Guilly War Room</h2>
        <span className="rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[12px] font-semibold text-[var(--muted)]">
          {context.sport} · week {context.currentWeek}
        </span>
      </div>

      {/* Survival risk hero + rules */}
      <div className="grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 sm:grid-cols-2" data-testid="guillotine-war-room-survival-card">
        <div>
          <p className="text-[12px] font-semibold text-[var(--muted)]">Your chop risk</p>
          <p className={`text-[18px] font-bold capitalize ${RISK_COLOR[survival?.riskLevel ?? 'limited']}`}>
            {(survival?.riskLevel ?? 'limited').replace('_', ' ')}
          </p>
          <p className="text-[12px] text-[var(--muted)]">
            {survival?.safetyMargin != null ? `${survival.safetyMargin >= 0 ? '+' : ''}${survival.safetyMargin} points over the cut` : 'No cut line yet this week'}
          </p>
        </div>
        <div>
          <p className="text-[12px] font-semibold text-[var(--muted)]">This league</p>
          <p className="text-[13px] text-[var(--text2)]">{context.activeTeamCount} teams alive · {context.eliminatedTeamCount} chopped</p>
          <p className="text-[12px] text-[var(--muted)]">
            {context.guillotine.teamsPerChop === 1 ? '1 team' : `${context.guillotine.teamsPerChop} teams`} chopped each week · danger within {context.guillotine.dangerMarginPoints} points of the cut
          </p>
        </div>
      </div>

      {/* Weekly survival plan */}
      {weeklyPlan && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3" data-testid="guillotine-war-room-weekly-plan">
          <p className="text-[12px] font-semibold text-[var(--muted)]">Weekly survival plan</p>
          <p className="mt-1 text-[12px] font-semibold text-[var(--text)]">{weeklyPlan.headline}</p>
          <div className="mt-1 space-y-0.5">
            {weeklyPlan.steps.map((s) => (
              <p key={s.order} className="text-[12px] text-[var(--text2)]">{s.order}. <span className="text-[var(--text)]">{s.action}</span> — {s.detail}</p>
            ))}
          </div>
        </div>
      )}

      {/* Survival standings (public to league) */}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3" data-testid="guillotine-war-room-standings">
        <p className="text-[12px] font-semibold text-[var(--muted)]">Survival standings</p>
        <div className="mt-1 space-y-0.5">
          {context.standings.slice(0, 12).map((s) => (
            <p key={s.rosterId} className={`text-[12px] ${s.isUserTeam ? 'font-semibold text-[var(--text)]' : 'text-[var(--text2)]'}`}>
              {s.eliminated ? (
                <span className="text-[var(--muted)]">☠ {s.teamName ?? s.ownerName}{s.choppedInPeriod != null ? ` · chopped in week ${s.choppedInPeriod}` : ''}</span>
              ) : (
                <>
                  <span className={`mr-1 rounded px-1 py-0.5 text-[12px] font-semibold ${TIER_BADGE[s.tier] ?? TIER_BADGE.unknown}`}>{TIER_WORD[s.tier] ?? s.tier.replace('_', ' ')}</span>
                  {s.teamName ?? s.ownerName}{s.isUserTeam ? ' (you)' : ''}
                  <span className="text-[var(--muted)]"> · {s.seasonPointsCumul.toFixed(0)} pts{s.pointsFromChopZone != null ? ` · ${s.pointsFromChopZone >= 0 ? '+' : ''}${s.pointsFromChopZone.toFixed(0)} over the cut` : ''}</span>
                </>
              )}
            </p>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div className="flex flex-wrap gap-2">
        {/* No "Lineup safety" in a best ball Guilly league: lineups set themselves (featureAvailability). */}
        {(['roster-risk', 'lineup-safety', 'faab-plan', 'waivers', 'dropped-players'] as const)
          .filter((t) => t !== 'lineup-safety' || context?.featureAvailability?.lineupSafety !== false)
          .map((t) => (
          <button key={t} type="button" onClick={() => void runTool(t)} disabled={toolBusy} data-testid={`guillotine-war-room-tool-${t}`}
            className="rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--accent-line)] disabled:opacity-50">
            {t === 'roster-risk' ? 'Roster risk' : t === 'lineup-safety' ? 'Lineup safety' : t === 'faab-plan' ? 'FAAB plan' : t === 'waivers' ? 'Waivers' : 'Chopped teams’ players'}
          </button>
        ))}
        {tradesEnabled ? (
          <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy} data-testid="guillotine-war-room-tool-trade-analyze"
            className="min-h-[40px] rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 text-[13px] font-semibold text-[var(--text)] transition hover:border-[var(--accent-line)] disabled:opacity-50">Trade analyzer</button>
        ) : null}
      </div>

      {toolBusy && <p className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]"><Loader2 className="h-3 w-3 animate-spin" /> Running…</p>}

      {tool === 'roster-risk' && rosterRisk && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="guillotine-war-room-roster-risk-result">
          <p className="mb-1 font-semibold text-[var(--text)]">Floor risk: {rosterRisk.floorRiskScore}/100</p>
          {rosterRisk.weaknesses.map((w) => (<p key={w.position}>⚠ {w.position} ({w.severity}) — {w.reason}</p>))}
          {rosterRisk.injuredStarters.map((p) => (<p key={p.playerId} className="text-[var(--bad)]">🚑 {p.playerName} ({p.position}) {p.status}</p>))}
          {rosterRisk.weaknesses.length === 0 && rosterRisk.injuredStarters.length === 0 && <p className="text-[var(--muted)]">No structural holes or injured starters.</p>}
        </div>
      )}

      {tool === 'lineup-safety' && lineupSafety && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="guillotine-war-room-lineup-safety-result">
          <p className="mb-1 font-semibold text-[var(--text)]">Safest lineup ({lineupSafety.posture.replace('_', ' ')}, confidence {lineupSafety.confidence})</p>
          {lineupSafety.suggestedStarters.map((s, i) => (<p key={`${s.position}-${i}`}><span className="text-[var(--muted)]">{s.position}:</span> {s.playerName ?? '—'}{s.value != null && <span className="text-[var(--muted)]"> ({s.value})</span>}</p>))}
          {lineupSafety.ceilingSwing && <p className="mt-1 text-[var(--warn)]">Ceiling swing: {lineupSafety.ceilingSwing.playerName} ({lineupSafety.ceilingSwing.position})</p>}
        </div>
      )}

      {tool === 'faab-plan' && faab && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="guillotine-war-room-faab-plan-result">
          <p className="mb-1 font-semibold text-[var(--text)]">FAAB: {faab.posture}{faab.suggestedMaxBid != null ? ` · max bid ~${faab.suggestedMaxBid}` : ''}</p>
          {faab.explanationFacts.map((f) => (<p key={f}>{f}</p>))}
        </div>
      )}

      {tool === 'waivers' && waivers && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="guillotine-war-room-waivers-result">
          <p className="mb-1 font-semibold text-[var(--text)]">Waivers ({waivers.urgency} urgency) · target {waivers.targetPositions.join(', ') || 'none'}</p>
          {waivers.recommendedAdds.map((a) => (<p key={a.playerId}>+ {a.playerName} ({a.position}) — {a.reason}</p>))}
          {waivers.dropCandidates.map((d) => (<p key={d.playerId} className="text-[var(--muted)]">– {d.playerName} ({d.position}) — {d.reason}</p>))}
          {waivers.needsPoolData && <p className="mt-1 text-[var(--warn)]">No players from chopped teams yet — the target positions still apply.</p>}
        </div>
      )}

      {tool === 'dropped-players' && dropped && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="guillotine-war-room-dropped-players-result">
          {!dropped.available ? <p className="text-[var(--warn)]">No players from chopped teams are on waivers yet.</p> : (
            <>
              <p className="mb-1 font-semibold text-[var(--text)]">Players from chopped teams ({dropped.poolSize})</p>
              {dropped.targets.map((t) => (<p key={t.playerId}>{t.playerName} ({t.position}){t.atNeed ? <span className="text-[var(--good)]"> · need</span> : null} — {t.note}</p>))}
            </>
          )}
        </div>
      )}

      {tool === 'trade-analyze' && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]">
          {!tradesEnabled ? <p className="text-[var(--warn)]">Trades are disabled in this Guilly league.</p> : (
            <>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <select value={tradeOutgoingId} onChange={(e) => setTradeOutgoingId(e.target.value)} data-testid="guillotine-war-room-trade-outgoing-select"
                  className="min-w-0 rounded-md border border-[var(--line2)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)] focus:border-[var(--accent-line)] focus:outline-none">
                  <option value="">Outgoing player</option>
                  {(context?.teams.find((t) => t.isUserTeam)?.players ?? []).map((p) => (<option key={p.playerId} value={p.playerId}>{p.playerName} ({p.position})</option>))}
                </select>
                <input value={tradeIncomingIds} onChange={(e) => setTradeIncomingIds(e.target.value)} placeholder="Incoming player ID" data-testid="guillotine-war-room-trade-incoming-input"
                  className="min-w-0 rounded-md border border-[var(--line2)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent-line)] focus:outline-none" />
                <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy} data-testid="guillotine-war-room-trade-analyze-submit"
                  className="rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--accent-line)] disabled:opacity-50">Analyze</button>
              </div>
              {tradeAnalysis && (
                <div className="mt-2 space-y-1" data-testid="guillotine-war-room-trade-analyze-result">
                  {/* 🛑 THE GRADE IS THE VERDICT (2026-09-29). The engine's own accept/reject/neutral is never shown. */}
                  <WarRoomTradeGradeLine grade={tradeGrade} testId="guillotine-war-room-trade-grade" />
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
        <ul className="space-y-1 rounded-lg border border-[var(--line)] bg-[var(--warn-soft)] p-2">{context.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>
      )}

      {/* Ask War Room */}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--muted)]"><ShieldQuestion className="h-3.5 w-3.5" /> Ask Chimmy about surviving the chop</p>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Am I at risk of elimination, and should I spend FAAB?" rows={2} data-testid="guillotine-war-room-ask-input"
          className="w-full resize-none rounded-md border border-[var(--line2)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent-line)] focus:outline-none" />
        <button type="button" onClick={() => void onAsk()} disabled={askBusy || !question.trim()} data-testid="guillotine-war-room-ask-submit"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1.5 text-[13px] font-semibold text-[var(--accent)] transition disabled:opacity-50">
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} Ask
        </button>
        {askNote && <p className="mt-2 text-[12px] text-[var(--warn)]" data-testid="guillotine-war-room-ask-note">{askNote}</p>}
        {answer && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text)]" data-testid="guillotine-war-room-answer">{answer}</p>}
      </div>
    </section>
  )
}
