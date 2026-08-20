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

type Tool = 'upside' | 'draft-plan' | 'stacks' | 'risk' | 'waivers' | 'trade-analyze' | 'trade-find' | null

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[11px] text-amber-200/80">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" />
      <span>{children}</span>
    </li>
  )
}

const STATE_COLOR: Record<string, string> = { thin: 'text-rose-300/85', balanced: 'text-white/60', heavy: 'text-amber-200/80' }

export function BestBallWarRoomPanel({ leagueId }: { leagueId: string }) {
  const [context, setContext] = useState<BestBallWarRoomContext | null>(null)
  const [construction, setConstruction] = useState<BestBallConstructionResult | null>(null)
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
  const [tradeAnalysis, setTradeAnalysis] = useState<BestBallTradeAnalysis | null>(null)
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
        setDepth(res.depth)
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
          setTradeAnalysis((await analyzeBestBallWarRoomTrade(leagueId, { outgoingPlayerIds: outgoing ? [outgoing] : [], incomingPlayerIds: incoming })).tradeAnalysis)
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
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#07071a] p-4 text-[12px] text-white/50" data-testid="best-ball-war-room-loading">
        <Loader2 className="h-4 w-4 animate-spin text-violet-300" /> Loading AF Legacy — Best Ball…
      </div>
    )
  }
  if (error || !context) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/90" data-testid="best-ball-war-room-error">
        {error ?? 'AF Legacy — Best Ball is unavailable for this league.'}
      </div>
    )
  }

  const waiversEnabled = context.bestBall.waiversEnabled
  const tradesEnabled = context.bestBall.tradesEnabled

  return (
    <section className="space-y-3 rounded-xl border border-violet-400/20 bg-[#0a0820] p-4" data-testid="best-ball-war-room-panel">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-300" />
        <h2 className="text-sm font-bold text-white">AF Legacy — Best Ball</h2>
        <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
          {context.sport} · {context.bestBall.mode}
        </span>
      </div>

      {/* Automatic lineup explanation — best ball has NO manual start/sit. */}
      <div className="flex items-start gap-2 rounded-lg border border-[#ff3d81]/15 bg-[#ff3d81]/[0.05] p-3" data-testid="best-ball-war-room-auto-lineup">
        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9ec0]/80" />
        <p className="text-[11px] leading-relaxed text-white/70">
          <span className="font-semibold text-[#ffd7e5]">Automatic lineup.</span> Best ball auto-selects your highest-scoring valid
          lineup every {context.scoring.scoringPeriod} period — there is no manual start/sit. Win by drafting DEPTH, CEILING, and
          smart roster construction.
        </p>
      </div>

      {/* Rules + construction grade + data status */}
      <div className="grid gap-2 rounded-lg border border-white/[0.06] bg-[#07071a] p-3 sm:grid-cols-3" data-testid="best-ball-war-room-rules-card">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Build grade</p>
          <p className="text-[14px] font-bold text-violet-100">{construction?.grade ?? '—'}</p>
          <p className="text-[10px] text-white/45">roster {construction?.rosterSize ?? 0}/{context.roster.recommendedRosterSize}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Rules</p>
          <p className="text-[11px] text-white/70">
            {context.roster.startingSlots} auto-start · waivers {waiversEnabled ? 'on' : 'off'} · trades {tradesEnabled ? 'on' : 'off'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Data</p>
          <p className="text-[11px] text-white/60">
            ADP {context.availability.playerValues === 'available' ? '✓' : '—'} · scores{' '}
            {context.availability.weeklyScores === 'available' ? '✓' : '—'} · team{' '}
            {context.availability.teamData === 'available' ? '✓' : '—'}
          </p>
        </div>
      </div>

      {/* Roster construction by position */}
      {construction && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3" data-testid="best-ball-war-room-construction">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Roster construction</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {construction.byPosition.map((b) => (
              <span key={b.position} className="rounded-md bg-white/[0.04] px-2 py-1 text-[11px]">
                <span className="text-white/70">{b.position} {b.count}</span>
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
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3" data-testid="best-ball-war-room-depth">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Depth</p>
          <p className="mt-1 text-[11px] text-white/70">Fragile positions: <span className="text-rose-300/85">{depth.fragilePositions.join(', ') || 'none'}</span></p>
        </div>
      )}

      {/* Tools — no start/sit button (auto lineup). Waivers/trades only when enabled. */}
      <div className="flex flex-wrap gap-2">
        {(['upside', 'draft-plan', 'stacks', 'risk'] as const).map((t) => (
          <button key={t} type="button" onClick={() => void runTool(t)} disabled={toolBusy} data-testid={`best-ball-war-room-tool-${t}`}
            className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-50">
            {t === 'upside' ? 'Upside' : t === 'draft-plan' ? 'Draft plan' : t === 'stacks' ? 'Stacks' : 'Risk'}
          </button>
        ))}
        <button type="button" onClick={() => void runTool('waivers')} disabled={toolBusy || !waiversEnabled}
          title={waiversEnabled ? undefined : 'Waivers are disabled in this best-ball league'} data-testid="best-ball-war-room-tool-waivers"
          className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-40">Waivers</button>
        <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy || !tradesEnabled}
          title={tradesEnabled ? undefined : 'Trades are disabled in this best-ball league'} data-testid="best-ball-war-room-tool-trade-analyze"
          className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-40">Trade analyzer</button>
        <button type="button" onClick={() => void runTool('trade-find')} disabled={toolBusy || !tradesEnabled}
          title={tradesEnabled ? undefined : 'Trades are disabled in this best-ball league'} data-testid="best-ball-war-room-tool-trade-find"
          className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-40">Trade finder</button>
      </div>

      {toolBusy && <p className="flex items-center gap-1.5 text-[11px] text-white/50"><Loader2 className="h-3 w-3 animate-spin" /> Running…</p>}

      {tool === 'upside' && upside && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="best-ball-war-room-upside-result">
          <p className="mb-1 font-semibold text-white/80">Spike-week upside (confidence: {upside.confidence})</p>
          {upside.topUpside.map((u) => (<p key={u.playerId}>↑ {u.playerName} ({u.position}) — {u.reason}</p>))}
        </div>
      )}

      {tool === 'draft-plan' && draftPlan && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="best-ball-war-room-draft-plan-result">
          <p className="mb-1 font-semibold text-white/80">{draftPlan.draftComplete ? 'Post-draft gaps' : `${draftPlan.picksRemaining} picks remaining`}</p>
          {draftPlan.targets.length ? draftPlan.targets.map((t) => (<p key={t.position}>TARGET {t.position} ({t.priority}) — {t.reason}</p>)) : <p className="text-white/40">Depth targets met.</p>}
        </div>
      )}

      {tool === 'stacks' && stacks && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="best-ball-war-room-stacks-result">
          <div className="flex items-center gap-1.5 font-semibold text-white/80"><Layers className="h-3.5 w-3.5" /> Stacks / correlation ({stacks.teamDataState})</div>
          {stacks.stacks.length ? stacks.stacks.map((s) => (
            <p key={s.team} className="mt-1">{s.team}: {s.players.map((p) => `${p.playerName} (${p.position})`).join(', ')}{s.hasQbStack ? <span className="text-emerald-300/80"> · QB stack</span> : null}</p>
          )) : <p className="mt-1 text-white/40">No same-team stacks.</p>}
          {stacks.byeClusters.map((c) => (<p key={c.week} className="text-amber-200/80">Bye cluster W{c.week}: {c.count} players</p>))}
          {stacks.explanationFacts.map((f) => (<p key={f} className="text-white/45">{f}</p>))}
        </div>
      )}

      {tool === 'risk' && risk && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="best-ball-war-room-risk-result">
          <p className="mb-1 font-semibold text-white/80">Construction risk: {risk.riskScore}/100</p>
          {risk.riskFlags.length ? <ul className="space-y-1">{risk.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul> : <p className="text-white/40">No major construction risks detected.</p>}
        </div>
      )}

      {tool === 'waivers' && waivers && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="best-ball-war-room-waivers-result">
          {!waivers.enabled ? <p className="text-amber-200/80">Waivers are disabled in this best-ball league (draft-only).</p> : (
            <>
              <p className="mb-1 font-semibold text-white/80">Target positions: {waivers.targetPositions.join(', ') || 'none'}</p>
              {waivers.dropCandidates.map((d) => (<p key={d.playerId} className="text-white/55">– {d.playerName} ({d.position}) — {d.reason}</p>))}
            </>
          )}
        </div>
      )}

      {tool === 'trade-analyze' && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70">
          {!tradesEnabled ? <p className="text-amber-200/80">Trades are disabled in this best-ball league (draft-only).</p> : (
            <>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <select value={tradeOutgoingId} onChange={(e) => setTradeOutgoingId(e.target.value)} data-testid="best-ball-war-room-trade-outgoing-select"
                  className="min-w-0 rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[11px] text-white/80 focus:border-violet-400/40 focus:outline-none">
                  <option value="">Outgoing player</option>
                  {(context?.teams.find((t) => t.isUserTeam)?.players ?? []).map((p) => (<option key={p.playerId} value={p.playerId}>{p.playerName} ({p.position})</option>))}
                </select>
                <input value={tradeIncomingIds} onChange={(e) => setTradeIncomingIds(e.target.value)} placeholder="Incoming player ID" data-testid="best-ball-war-room-trade-incoming-input"
                  className="min-w-0 rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none" />
                <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy} data-testid="best-ball-war-room-trade-analyze-submit"
                  className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-50">Analyze</button>
              </div>
              {tradeAnalysis && (
                <div className="mt-2 space-y-1" data-testid="best-ball-war-room-trade-analyze-result">
                  <p className="font-semibold text-white/80">Verdict: {tradeAnalysis.verdict.replace(/_/g, ' ')}{tradeAnalysis.valueDelta != null ? <span className="text-white/40"> · value {tradeAnalysis.valueDelta}</span> : null}</p>
                  {tradeAnalysis.explanationFacts.map((f) => (<p key={f}>{f}</p>))}
                  {tradeAnalysis.riskFlags.length > 0 && <ul className="mt-2 space-y-1">{tradeAnalysis.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tool === 'trade-find' && tradeFinder && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="best-ball-war-room-trade-find-result">
          {!tradeFinder.enabled ? <p className="text-amber-200/80">Trades are disabled in this best-ball league (draft-only).</p>
            : tradeFinder.needsMoreData ? <ul className="space-y-1">{tradeFinder.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>
              : tradeFinder.targets.length ? tradeFinder.targets.slice(0, 5).map((t) => (<p key={t.rosterId}><span className="font-semibold text-white/80">{t.teamName ?? t.rosterId}</span> (fit {t.fitScore}): {t.reasons.join(' ')}</p>))
                : <p className="text-white/40">No complementary trade partners found.</p>}
        </div>
      )}

      {/* Global missing-data flags */}
      {context.missingDataFlags.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] p-2">{context.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>
      )}

      {/* Ask War Room */}
      <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40"><ShieldQuestion className="h-3.5 w-3.5" /> Ask AF Legacy</p>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What position am I weak at, and do I have enough upside?" rows={2} data-testid="best-ball-war-room-ask-input"
          className="w-full resize-none rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[12px] text-white/85 placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none" />
        <button type="button" onClick={() => void onAsk()} disabled={askBusy || !question.trim()} data-testid="best-ball-war-room-ask-submit"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-50">
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} Ask
        </button>
        {askNote && <p className="mt-2 text-[11px] text-amber-200/80" data-testid="best-ball-war-room-ask-note">{askNote}</p>}
        {answer && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-white/80" data-testid="best-ball-war-room-answer">{answer}</p>}
      </div>
    </section>
  )
}
