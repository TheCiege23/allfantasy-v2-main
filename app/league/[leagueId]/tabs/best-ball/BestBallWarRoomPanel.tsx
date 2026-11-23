'use client'

/**
 * Best Ball AF War Room panel — grounded in the league's OWN data via
 * /api/leagues/[leagueId]/best-ball-war-room. Every button calls a real route.
 * Best ball is DRAFT-ONLY with an AUTOMATIC lineup — there is NO start/sit button.
 * Surfaces roster construction, depth, spike-week upside, draft plan, stack/correlation,
 * risk, and (only when league rules allow) waivers/trades. Honest limited/disabled states.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Layers, Loader2, ShieldQuestion, Sparkles, Zap } from 'lucide-react'
import {
  analyzeBestBallWarRoomTrade,
  askBestBallWarRoom,
  fetchBestBallDraftPlan,
  fetchBestBallRisk,
  fetchBestBallStacks,
  fetchBestBallUpside,
  fetchBestBallWaivers,
  fetchBestBallWarRoomState,
  findBestBallWarRoomTrades,
} from '@/lib/best-ball-war-room/client'
import type { BestBallWarRoomContext } from '@/lib/best-ball-war-room/types'
import type { BestBallConstructionResult } from '@/lib/best-ball-war-room/bestBallRosterConstructionEngine'
import type { BestBallDepthResult } from '@/lib/best-ball-war-room/bestBallDepthEngine'
import type { BestBallUpsideResult } from '@/lib/best-ball-war-room/bestBallUpsideEngine'
import type { BestBallDraftPlanResult } from '@/lib/best-ball-war-room/bestBallDraftPlanEngine'
import type { BestBallStackResult } from '@/lib/best-ball-war-room/bestBallStackCorrelationEngine'
import type { BestBallRiskResult } from '@/lib/best-ball-war-room/bestBallRiskEngine'
import type { BestBallWaiverResult } from '@/lib/best-ball-war-room/bestBallWaiverEngine'
import type { BestBallTradeAnalysis, BestBallTradeFinderResult } from '@/lib/best-ball-war-room/bestBallTradeEngine'
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { WarRoomTradeAnalysisView } from '@/lib/decision-os/trade/warRoomTradeView'
import { WarRoomTradeGradeLine } from '../WarRoomTradeGradeLine'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import './best-ball.css'

type Tool = 'upside' | 'draft-plan' | 'stacks' | 'risk' | 'waivers' | 'trade-analyze' | 'trade-find' | null

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[12px] text-[var(--warn)]">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </li>
  )
}

const STATE_COLOR: Record<string, string> = { thin: 'text-[var(--bad)]', balanced: 'text-[var(--muted)]', heavy: 'text-[var(--warn)]' }

/** The context's notes that a league has waivers or trades off: said once, in one plain line, instead. */
const RULE_OFF_FLAG = /(waivers|trades) are disabled in this best-ball league/i

export function BestBallWarRoomPanel({ leagueId }: { leagueId: string }) {
  const [context, setContext] = useState<BestBallWarRoomContext | null>(null)
  const [construction, setConstruction] = useState<BestBallConstructionResult | null>(null)
  const [constructionLocked, setConstructionLocked] = useState(false)
  const [depth, setDepth] = useState<BestBallDepthResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tool, setTool] = useState<Tool>(null)
  const [toolBusy, setToolBusy] = useState(false)
  const [upside, setUpside] = useState<BestBallUpsideResult | null>(null)
  const [draftPlan, setDraftPlan] = useState<BestBallDraftPlanResult | null>(null)
  const [stacks, setStacks] = useState<BestBallStackResult | null>(null)
  const [risk, setRisk] = useState<BestBallRiskResult | null>(null)
  const [waivers, setWaivers] = useState<BestBallWaiverResult | null>(null)
  const [tradeAnalysis, setTradeAnalysis] = useState<WarRoomTradeAnalysisView<BestBallTradeAnalysis> | null>(null)
  const [tradeGrade, setTradeGrade] = useState<SuggestionGrade | null>(null)
  const [tradeFinder, setTradeFinder] = useState<BestBallTradeFinderResult | null>(null)
  const [tradeOutgoingId, setTradeOutgoingId] = useState('')
  const [tradeIncomingIds, setTradeIncomingIds] = useState('')

  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [askNote, setAskNote] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchBestBallWarRoomState(leagueId)
      .then((res) => {
        if (!active) return
        setContext(res.context)
        setConstruction(res.construction)
        setConstructionLocked(res.constructionLocked === true)
        setDepth(res.depth)
        setError(null)
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'The Best Ball War Room did not load.'))
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
        if (which === 'upside') setUpside((await fetchBestBallUpside(leagueId)).upside)
        else if (which === 'draft-plan') setDraftPlan((await fetchBestBallDraftPlan(leagueId)).draftPlan)
        else if (which === 'stacks') setStacks((await fetchBestBallStacks(leagueId)).stacks)
        else if (which === 'risk') setRisk((await fetchBestBallRisk(leagueId)).risk)
        else if (which === 'waivers') setWaivers((await fetchBestBallWaivers(leagueId)).waivers)
        else if (which === 'trade-analyze') {
          const own = context?.teams.find((t) => t.isUserTeam)?.players ?? []
          const fallback = own[own.length - 1]?.playerId ?? ''
          const outgoing = (tradeOutgoingId || fallback).trim()
          const incoming = tradeIncomingIds.split(',').map((id) => id.trim()).filter(Boolean)
          const analyzed = await analyzeBestBallWarRoomTrade(leagueId, { outgoingPlayerIds: outgoing ? [outgoing] : [], incomingPlayerIds: incoming })
          setTradeAnalysis(analyzed.tradeAnalysis)
          setTradeGrade(analyzed.tradeGrade ?? null)
          if (!tradeOutgoingId && fallback) setTradeOutgoingId(fallback)
        } else if (which === 'trade-find') setTradeFinder((await findBestBallWarRoomTrades(leagueId)).tradeFinder)
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
      const res = await askBestBallWarRoom(leagueId, q)
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
      <div className="bb-panel flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4 text-[13px] text-[var(--muted)]" data-testid="best-ball-war-room-loading">
        <Loader2 className="bb-accent h-4 w-4 animate-spin" /> Loading the Best Ball War Room…
      </div>
    )
  }
  if (error || !context) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--warn-soft)] px-3 py-2 text-[13px] text-[var(--warn)]" data-testid="best-ball-war-room-error">
        {error ?? 'The Best Ball War Room is not available for this league.'}
      </div>
    )
  }

  const waiversEnabled = context.bestBall.waiversEnabled
  const tradesEnabled = context.bestBall.tradesEnabled
  const period = context.scoring.scoringPeriod === 'daily' ? 'day' : 'week'
  // The waivers/trades-off notes are said once, in the rules line; the rest of the flags still show.
  const dataFlags = context.missingDataFlags.filter((f) => !RULE_OFF_FLAG.test(f))
  const toolButton = 'min-h-[40px] rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 text-[13px] font-semibold text-[var(--text)] transition hover:border-[var(--bb-accent-line)] disabled:opacity-50'

  return (
    <section className="bb-panel space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[var(--text)]" data-testid="best-ball-war-room-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="bb-accent h-4 w-4" />
        {/* Named for where it lives (the War Room tab), not "AF Legacy — Best Ball". */}
        <h2 className="text-[15px] font-bold">Best Ball War Room</h2>
        <span className="rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[12px] font-semibold text-[var(--muted)]">
          {context.sport}{context.bestBall.mode === 'underdog' ? ' · Underdog style' : ''}
        </span>
      </div>

      {/* Automatic lineup explanation — best ball has NO manual start/sit. */}
      <div className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3" data-testid="best-ball-war-room-auto-lineup">
        <Zap className="bb-accent mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-[13px] leading-relaxed text-[var(--text2)]">
          <span className="bb-accent font-semibold">Lineups set themselves.</span> Each {period} your highest-scoring legal lineup counts
          automatically, so there is nothing to start or sit. You win by drafting depth, players with big weeks in them, and a well-built roster.
        </p>
      </div>

      {/* Build grade and the league's rules */}
      <div className="grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 sm:grid-cols-2" data-testid="best-ball-war-room-rules-card">
        <div>
          <p className="text-[12px] font-semibold text-[var(--muted)]">Build grade</p>
          {constructionLocked ? (
            <p className="text-[13px] font-semibold text-[var(--warn)]" data-testid="best-ball-war-room-grade-locked">🔒 AF Legacy</p>
          ) : (
            <>
              <p className="bb-accent text-[18px] font-bold">{construction?.grade ?? '—'}</p>
              <p className="text-[12px] text-[var(--muted)]">{construction?.rosterSize ?? 0} of {context.roster.recommendedRosterSize} players drafted</p>
            </>
          )}
        </div>
        <div>
          <p className="text-[12px] font-semibold text-[var(--muted)]">This league</p>
          <p className="text-[13px] text-[var(--text2)]">
            {context.roster.startingSlots} starters count each {period}.{' '}
            {!waiversEnabled && !tradesEnabled ? 'No waivers or trades: the draft is the whole game.' : `Waivers ${waiversEnabled ? 'on' : 'off'} · trades ${tradesEnabled ? 'on' : 'off'}.`}
          </p>
        </div>
      </div>

      {/* Roster construction by position — AF Legacy (roster_construction_planning) */}
      {constructionLocked && (
        <div data-testid="best-ball-war-room-construction-locked">
          <FeatureGate featureId="roster_construction_planning" featureNameOverride="Roster construction">
            <span />
          </FeatureGate>
        </div>
      )}
      {construction && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3" data-testid="best-ball-war-room-construction">
          <p className="text-[12px] font-semibold text-[var(--muted)]">Roster by position</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {construction.byPosition.map((b) => (
              <span key={b.position} className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[12px]">
                <span className="text-[var(--text)]">{b.position} {b.count}</span>
                <span className={`ml-1 ${STATE_COLOR[b.state]}`}>{b.state}</span>
              </span>
            ))}
          </div>
          {construction.weaknesses.length > 0 && (
            <ul className="mt-2 space-y-1">{construction.weaknesses.map((w) => (<Flag key={w}>{w}</Flag>))}</ul>
          )}
        </div>
      )}

      {/* Depth fragility */}
      {depth && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3" data-testid="best-ball-war-room-depth">
          <p className="text-[12px] font-semibold text-[var(--muted)]">Depth</p>
          <p className="mt-1 text-[13px] text-[var(--text2)]">
            {depth.fragilePositions.length
              ? <>One injury away from an empty slot at <span className="font-semibold text-[var(--bad)]">{depth.fragilePositions.join(', ')}</span>.</>
              : 'Every position has a backup.'}
          </p>
        </div>
      )}

      {/* Tools — no start/sit (lineups set themselves). Waivers and trade tools only in a league that allows them. */}
      <div className="flex flex-wrap gap-2">
        {(['upside', 'draft-plan', 'stacks', 'risk'] as const).map((t) => (
          <button key={t} type="button" onClick={() => void runTool(t)} disabled={toolBusy} data-testid={`best-ball-war-room-tool-${t}`} className={toolButton}>
            {t === 'upside' ? 'Upside' : t === 'draft-plan' ? 'Draft plan' : t === 'stacks' ? 'Stacks' : 'Risk'}
          </button>
        ))}
        {waiversEnabled ? (
          <button type="button" onClick={() => void runTool('waivers')} disabled={toolBusy} data-testid="best-ball-war-room-tool-waivers" className={toolButton}>Waivers</button>
        ) : null}
        {tradesEnabled ? (
          <>
            <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy} data-testid="best-ball-war-room-tool-trade-analyze" className={toolButton}>Trade analyzer</button>
            <button type="button" onClick={() => void runTool('trade-find')} disabled={toolBusy} data-testid="best-ball-war-room-tool-trade-find" className={toolButton}>Trade finder</button>
          </>
        ) : null}
      </div>

      {toolBusy && <p className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]"><Loader2 className="h-3 w-3 animate-spin" /> Running…</p>}

      {tool === 'upside' && upside && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="best-ball-war-room-upside-result">
          <p className="mb-1 font-semibold text-[var(--text)]">Players with big weeks in them (confidence: {upside.confidence})</p>
          {upside.topUpside.map((u) => (<p key={u.playerId}>↑ {u.playerName} ({u.position}) — {u.reason}</p>))}
        </div>
      )}

      {tool === 'draft-plan' && draftPlan && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="best-ball-war-room-draft-plan-result">
          <p className="mb-1 font-semibold text-[var(--text)]">{draftPlan.draftComplete ? 'Post-draft gaps' : `${draftPlan.picksRemaining} picks remaining`}</p>
          {draftPlan.targets.length ? draftPlan.targets.map((t) => (<p key={t.position}>Target {t.position} ({t.priority}) — {t.reason}</p>)) : <p className="text-[var(--muted)]">Depth targets met.</p>}
        </div>
      )}

      {tool === 'stacks' && stacks && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="best-ball-war-room-stacks-result">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--text)]"><Layers className="h-3.5 w-3.5" /> Teammates who score together</div>
          {stacks.stacks.length ? stacks.stacks.map((s) => (
            <p key={s.team} className="mt-1">{s.team}: {s.players.map((p) => `${p.playerName} (${p.position})`).join(', ')}{s.hasQbStack ? <span className="text-[var(--good)]"> · QB stack</span> : null}</p>
          )) : <p className="mt-1 text-[var(--muted)]">No same-team stacks.</p>}
          {stacks.byeClusters.map((c) => (<p key={c.week} className="text-[var(--warn)]">Week {c.week} bye: {c.count} of your players are off</p>))}
          {stacks.explanationFacts.map((f) => (<p key={f} className="text-[var(--muted)]">{f}</p>))}
        </div>
      )}

      {tool === 'risk' && risk && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="best-ball-war-room-risk-result">
          <p className="mb-1 font-semibold text-[var(--text)]">Construction risk: {risk.riskScore}/100</p>
          {risk.riskFlags.length ? <ul className="space-y-1">{risk.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul> : <p className="text-[var(--muted)]">No major construction risks detected.</p>}
        </div>
      )}

      {tool === 'waivers' && waivers && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="best-ball-war-room-waivers-result">
          {!waivers.enabled ? <p className="text-[var(--warn)]">Waivers are disabled in this best-ball league (draft-only).</p> : (
            <>
              <p className="mb-1 font-semibold text-[var(--text)]">Target positions: {waivers.targetPositions.join(', ') || 'none'}</p>
              {waivers.dropCandidates.map((d) => (<p key={d.playerId} className="text-[var(--muted)]">– {d.playerName} ({d.position}) — {d.reason}</p>))}
            </>
          )}
        </div>
      )}

      {tool === 'trade-analyze' && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]">
          {!tradesEnabled ? <p className="text-[var(--warn)]">Trades are disabled in this best-ball league (draft-only).</p> : (
            <>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <select value={tradeOutgoingId} onChange={(e) => setTradeOutgoingId(e.target.value)} data-testid="best-ball-war-room-trade-outgoing-select"
                  className="min-w-0 rounded-md border border-[var(--line2)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)] focus:border-[var(--bb-accent-line)] focus:outline-none">
                  <option value="">Outgoing player</option>
                  {(context?.teams.find((t) => t.isUserTeam)?.players ?? []).map((p) => (<option key={p.playerId} value={p.playerId}>{p.playerName} ({p.position})</option>))}
                </select>
                <input value={tradeIncomingIds} onChange={(e) => setTradeIncomingIds(e.target.value)} placeholder="Incoming player ID" data-testid="best-ball-war-room-trade-incoming-input"
                  className="min-w-0 rounded-md border border-[var(--line2)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--bb-accent-line)] focus:outline-none" />
                <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy} data-testid="best-ball-war-room-trade-analyze-submit"
                  className="rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--bb-accent-line)] disabled:opacity-50">Analyze</button>
              </div>
              {tradeAnalysis && (
                <div className="mt-2 space-y-1" data-testid="best-ball-war-room-trade-analyze-result">
                  {/* 🛑 THE GRADE IS THE VERDICT (2026-09-29). The engine's own accept/reject/neutral is never shown. */}
                  <WarRoomTradeGradeLine grade={tradeGrade} testId="best-ball-war-room-trade-grade" />
                  {tradeAnalysis.explanationFacts.map((f) => (<p key={f}>{f}</p>))}
                  {tradeAnalysis.riskFlags.length > 0 && <ul className="mt-2 space-y-1">{tradeAnalysis.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tool === 'trade-find' && tradeFinder && !toolBusy && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-[12px] text-[var(--text2)]" data-testid="best-ball-war-room-trade-find-result">
          {!tradeFinder.enabled ? <p className="text-[var(--warn)]">Trades are disabled in this best-ball league (draft-only).</p>
            : tradeFinder.needsMoreData ? <ul className="space-y-1">{tradeFinder.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>
              : tradeFinder.targets.length ? tradeFinder.targets.slice(0, 5).map((t) => (<p key={t.rosterId}><span className="font-semibold text-[var(--text)]">{t.teamName ?? t.rosterId}</span> (fit {t.fitScore}): {t.reasons.join(' ')}</p>))
                : <p className="text-[var(--muted)]">No complementary trade partners found.</p>}
        </div>
      )}

      {/* Global missing-data flags */}
      {dataFlags.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-[var(--line)] bg-[var(--warn-soft)] p-2">{dataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>
      )}

      {/* Ask War Room */}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--muted)]"><ShieldQuestion className="h-3.5 w-3.5" /> Ask Chimmy about your build</p>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What position am I weak at, and do I have enough upside?" rows={2} data-testid="best-ball-war-room-ask-input"
          className="w-full resize-none rounded-md border border-[var(--line2)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--bb-accent-line)] focus:outline-none" />
        <button type="button" onClick={() => void onAsk()} disabled={askBusy || !question.trim()} data-testid="best-ball-war-room-ask-submit"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--bb-accent-line)] bg-[var(--bb-accent-soft)] px-3 py-1.5 text-[13px] font-semibold text-[var(--bb-accent)] transition disabled:opacity-50">
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} Ask
        </button>
        {askNote && <p className="mt-2 text-[12px] text-[var(--warn)]" data-testid="best-ball-war-room-ask-note">{askNote}</p>}
        {answer && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text)]" data-testid="best-ball-war-room-answer">{answer}</p>}
      </div>
    </section>
  )
}
