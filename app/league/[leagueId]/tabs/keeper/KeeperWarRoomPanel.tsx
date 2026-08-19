'use client'

/**
 * Keeper AF War Room panel — grounded in the league's OWN data via
 * /api/leagues/[leagueId]/keeper-war-room. Every button is wired to a real route.
 * Surfaces keeper rules, best keepers (value surplus), cut list, roster needs after
 * keepers, draft plan, trade analyzer/finder, in-season waivers/lineup, and a grounded
 * "ask". Honestly shows limited-data states (e.g. missing keeper costs) — never faked.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, Loader2, ShieldQuestion, Sparkles } from 'lucide-react'
import {
  analyzeKeeperWarRoomTrade,
  askKeeperWarRoom,
  fetchKeeperCutList,
  fetchKeeperDraftPlan,
  fetchKeeperLineup,
  fetchKeeperWaivers,
  fetchKeeperWarRoomState,
  findKeeperWarRoomTrades,
} from '@/lib/keeper-war-room/client'
import type { KeeperWarRoomContext } from '@/lib/keeper-war-room/types'
import type { KeeperRecommendationResult } from '@/lib/keeper-war-room/keeperRecommendationEngine'
import type { KeeperNeedsResult } from '@/lib/keeper-war-room/keeperRosterNeedsEngine'
import type { KeeperCutListResult } from '@/lib/keeper-war-room/keeperCutListEngine'
import type { KeeperDraftPlanResult } from '@/lib/keeper-war-room/keeperDraftPlanEngine'
import type { KeeperWaiverResult } from '@/lib/keeper-war-room/keeperWaiverEngine'
import type { KeeperLineupResult } from '@/lib/keeper-war-room/keeperLineupEngine'
import type { KeeperTradeAnalysis } from '@/lib/keeper-war-room/keeperTradeEngine'
import type { KeeperTradeFinderResult } from '@/lib/keeper-war-room/keeperTradeFinderEngine'

type Tool = 'cut-list' | 'draft-plan' | 'waivers' | 'lineup' | 'trade-analyze' | 'trade-find' | null

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[11px] text-amber-200/80">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" />
      <span>{children}</span>
    </li>
  )
}

const VERDICT_COLOR: Record<string, string> = {
  definite_keep: 'text-emerald-300/90',
  keep: 'text-emerald-300/70',
  borderline: 'text-white/60',
  let_go: 'text-rose-300/85',
  ineligible: 'text-white/35',
  no_cost: 'text-amber-200/70',
}

export function KeeperWarRoomPanel({ leagueId }: { leagueId: string }) {
  const [context, setContext] = useState<KeeperWarRoomContext | null>(null)
  const [recs, setRecs] = useState<KeeperRecommendationResult | null>(null)
  const [needs, setNeeds] = useState<KeeperNeedsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tool, setTool] = useState<Tool>(null)
  const [toolBusy, setToolBusy] = useState(false)
  const [cutList, setCutList] = useState<KeeperCutListResult | null>(null)
  const [draftPlan, setDraftPlan] = useState<KeeperDraftPlanResult | null>(null)
  const [waivers, setWaivers] = useState<KeeperWaiverResult | null>(null)
  const [lineup, setLineup] = useState<KeeperLineupResult | null>(null)
  const [tradeAnalysis, setTradeAnalysis] = useState<KeeperTradeAnalysis | null>(null)
  const [tradeFinder, setTradeFinder] = useState<KeeperTradeFinderResult | null>(null)
  const [tradeOutgoingId, setTradeOutgoingId] = useState('')
  const [tradeIncomingIds, setTradeIncomingIds] = useState('')

  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [askNote, setAskNote] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchKeeperWarRoomState(leagueId)
      .then((res) => {
        if (!active) return
        setContext(res.context)
        setRecs(res.recommendations)
        setNeeds(res.needs)
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
        if (which === 'cut-list') setCutList((await fetchKeeperCutList(leagueId)).cutList)
        else if (which === 'draft-plan') setDraftPlan((await fetchKeeperDraftPlan(leagueId)).draftPlan)
        else if (which === 'waivers') setWaivers((await fetchKeeperWaivers(leagueId)).waivers)
        else if (which === 'lineup') setLineup((await fetchKeeperLineup(leagueId)).lineup)
        else if (which === 'trade-analyze') {
          const own = context?.teams.find((t) => t.isUserTeam)?.players ?? []
          const fallback = own.find((p) => !p.isStarterSlot)?.playerId ?? own[0]?.playerId ?? ''
          const outgoing = (tradeOutgoingId || fallback).trim()
          const incoming = tradeIncomingIds.split(',').map((id) => id.trim()).filter(Boolean)
          setTradeAnalysis((await analyzeKeeperWarRoomTrade(leagueId, { outgoingPlayerIds: outgoing ? [outgoing] : [], incomingPlayerIds: incoming })).tradeAnalysis)
          if (!tradeOutgoingId && fallback) setTradeOutgoingId(fallback)
        } else if (which === 'trade-find') setTradeFinder((await findKeeperWarRoomTrades(leagueId)).tradeFinder)
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
      const res = await askKeeperWarRoom(leagueId, q)
      if (res.aiUnavailable) {
        setAskNote('AI is temporarily unavailable — showing grounded facts only.')
        setAnswer(null)
      } else {
        setAnswer(res.answer)
      }
    } catch (e) {
      setAskNote(e instanceof Error ? e.message : 'Ask failed.')
    } finally {
      setAskBusy(false)
    }
  }, [leagueId, question])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#07071a] p-4 text-[12px] text-white/50" data-testid="keeper-war-room-loading">
        <Loader2 className="h-4 w-4 animate-spin text-violet-300" /> Loading AF Legacy — Keeper…
      </div>
    )
  }
  if (error || !context) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/90" data-testid="keeper-war-room-error">
        {error ?? 'AF Legacy — Keeper is unavailable for this league.'}
      </div>
    )
  }

  const k = context.keeper
  const seasonActive = context.seasonActive

  return (
    <section className="space-y-3 rounded-xl border border-violet-400/20 bg-[#0a0820] p-4" data-testid="keeper-war-room-panel">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-300" />
        <h2 className="text-sm font-bold text-white">AF Legacy — Keeper</h2>
        <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
          {context.sport} · {context.scoring.scoringPreset}
        </span>
      </div>

      {/* Keeper rules + deadline + data status */}
      <div className="grid gap-2 rounded-lg border border-white/[0.06] bg-[#07071a] p-3 sm:grid-cols-3" data-testid="keeper-war-room-rules-card">
        <div>
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
            <ClipboardList className="h-3 w-3" /> Keeper rules
          </p>
          <p className="text-[11px] text-white/70">
            max {k.maxKeepers} · {k.costSystem.replace('_', ' ')}
            {k.costSystem === 'round_based' || k.costSystem === 'inflation' ? ` · −${k.roundPenalty} rd` : ''}
            {k.maxYears > 0 ? ` · ${k.maxYears}yr max` : ''}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Deadline / phase</p>
          <p className="text-[11px] text-white/70">
            {k.selectionDeadline ? new Date(k.selectionDeadline).toLocaleDateString() : k.keeperPhaseActive ? 'Keeper phase open' : 'No deadline set'}
            {seasonActive ? ' · season active' : ''}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Data</p>
          <p className="text-[11px] text-white/60">
            ADP {context.availability.playerValues === 'available' ? '✓' : '—'} · costs{' '}
            {context.availability.keeperCosts === 'available' ? '✓' : '—'} · elig{' '}
            {context.availability.eligibility === 'available' ? '✓' : '—'}
          </p>
        </div>
      </div>

      {/* Best keepers (value surplus) */}
      {recs && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3" data-testid="keeper-war-room-recommendations">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Best keepers · keep up to {recs.maxKeepers}</p>
          {recs.needsMoreData ? (
            <p className="mt-2 text-[11px] text-amber-200/80" data-testid="keeper-war-room-recs-limited">
              Keeper recommendations need both ADP/value and keeper cost data. Set keeper costs or compute eligibility to unlock value-surplus ranking.
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {recs.recommended.map((r) => (
                <p key={r.playerId} className="text-[11px] text-white/70">
                  <span className={`font-semibold ${VERDICT_COLOR[r.verdict]}`}>KEEP</span> {r.playerName} ({r.position})
                  {r.surplusRounds != null ? <span className="text-emerald-300/70"> +{r.surplusRounds}rd</span> : null}
                  {r.keeperCostLabel ? <span className="text-white/40"> · {r.keeperCostLabel}</span> : null}
                </p>
              ))}
              {recs.bubble.map((r) => (
                <p key={r.playerId} className="text-[11px] text-white/45">BUBBLE {r.playerName} ({r.position}) — {r.reason}</p>
              ))}
              {recs.avoid.map((r) => (
                <p key={r.playerId} className="text-[11px] text-rose-300/70">AVOID {r.playerName} ({r.position}) — {r.reason}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Roster needs after keepers */}
      {needs && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Roster needs after keepers</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold text-rose-300/80">DRAFT TARGETS</p>
              {needs.needs.length ? needs.needs.map((n) => (
                <p key={n.position} className="text-[11px] text-white/70">{n.position} <span className="text-white/40">({n.severity})</span></p>
              )) : <p className="text-[11px] text-white/40">All starting needs covered by keepers</p>}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-emerald-300/80">COVERED BY KEEPERS</p>
              {needs.strengths.length ? needs.strengths.slice(0, 4).map((s) => (
                <p key={s} className="text-[11px] text-white/60">{s}</p>
              )) : <p className="text-[11px] text-white/40">—</p>}
            </div>
          </div>
        </div>
      )}

      {/* Tool buttons — every one wired to a real route (waivers/lineup only when active) */}
      <div className="flex flex-wrap gap-2">
        {(['cut-list', 'draft-plan', 'trade-analyze', 'trade-find'] as const).map((t) => (
          <button key={t} type="button" onClick={() => void runTool(t)} disabled={toolBusy} data-testid={`keeper-war-room-tool-${t}`}
            className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-50">
            {t === 'cut-list' ? 'Cut list' : t === 'draft-plan' ? 'Draft plan' : t === 'trade-analyze' ? 'Trade analyzer' : 'Trade finder'}
          </button>
        ))}
        {(['waivers', 'lineup'] as const).map((t) => (
          <button key={t} type="button" onClick={() => void runTool(t)} disabled={toolBusy || !seasonActive}
            title={seasonActive ? undefined : 'Available once the season is active'}
            data-testid={`keeper-war-room-tool-${t}`}
            className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-40">
            {t === 'waivers' ? 'Waivers' : 'Start/Sit'}
          </button>
        ))}
      </div>

      {toolBusy && <p className="flex items-center gap-1.5 text-[11px] text-white/50"><Loader2 className="h-3 w-3 animate-spin" /> Running…</p>}

      {tool === 'cut-list' && cutList && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="keeper-war-room-cut-list-result">
          {cutList.cutList.map((c) => (<p key={c.playerId}>– {c.playerName} ({c.position}) — {c.reason}</p>))}
          {cutList.riskFlags.length > 0 && <ul className="mt-2 space-y-1">{cutList.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
        </div>
      )}

      {tool === 'draft-plan' && draftPlan && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="keeper-war-room-draft-plan-result">
          <p className="mb-1 font-semibold text-white/80">Consumed rounds: {draftPlan.consumedRounds.join(', ') || 'none'} · {draftPlan.remainingRounds.length}/{draftPlan.totalRounds} remain</p>
          {draftPlan.roundPlan.map((rp) => (<p key={rp.round}><span className="text-white/40">R{rp.round}:</span> {rp.focus} — {rp.note}</p>))}
          {draftPlan.missingDataFlags.length > 0 && <ul className="mt-2 space-y-1">{draftPlan.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
        </div>
      )}

      {tool === 'waivers' && waivers && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="keeper-war-room-waivers-result">
          {waivers.needsProviderIntegration && <p className="text-amber-200/80">Add targets unavailable (season inactive or no pool). Drop-side analysis is grounded in your roster:</p>}
          {waivers.recommendedAdds.map((a) => (<p key={a.playerId}>+ {a.playerName} ({a.position}) — {a.reason}</p>))}
          {waivers.recommendedDrops.map((d) => (<p key={d.playerId} className="text-white/55">– {d.playerName} ({d.position})</p>))}
        </div>
      )}

      {tool === 'lineup' && lineup && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="keeper-war-room-lineup-result">
          <p className="mb-1 font-semibold text-white/80">Suggested starters (confidence: {lineup.confidence})</p>
          {lineup.suggestedStarters.map((s, i) => (<p key={`${s.position}-${i}`}><span className="text-white/40">{s.position}:</span> {s.playerName ?? '—'}{s.value != null && <span className="text-white/40"> ({s.value})</span>}</p>))}
        </div>
      )}

      {tool === 'trade-analyze' && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <select value={tradeOutgoingId} onChange={(e) => setTradeOutgoingId(e.target.value)} data-testid="keeper-war-room-trade-outgoing-select"
              className="min-w-0 rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[11px] text-white/80 focus:border-violet-400/40 focus:outline-none">
              <option value="">Outgoing player</option>
              {(context?.teams.find((t) => t.isUserTeam)?.players ?? []).map((p) => (<option key={p.playerId} value={p.playerId}>{p.playerName} ({p.position})</option>))}
            </select>
            <input value={tradeIncomingIds} onChange={(e) => setTradeIncomingIds(e.target.value)} placeholder="Incoming player ID" data-testid="keeper-war-room-trade-incoming-input"
              className="min-w-0 rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none" />
            <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy} data-testid="keeper-war-room-trade-analyze-submit"
              className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-50">Analyze</button>
          </div>
          {tradeAnalysis ? (
            <div className="mt-2 space-y-1" data-testid="keeper-war-room-trade-analyze-result">
              <p className="font-semibold text-white/80">Verdict: {tradeAnalysis.verdict.replace(/_/g, ' ')}{tradeAnalysis.valueDelta != null ? <span className="text-white/40"> · value {tradeAnalysis.valueDelta}</span> : null}</p>
              {tradeAnalysis.explanationFacts.map((f) => (<p key={f}>{f}</p>))}
              {tradeAnalysis.keeperImpact.map((f) => (<p key={f} className="text-emerald-300/70">{f}</p>))}
              {tradeAnalysis.riskFlags.length > 0 && <ul className="mt-2 space-y-1">{tradeAnalysis.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
            </div>
          ) : <p className="mt-2 text-white/40">No trade analysis loaded.</p>}
        </div>
      )}

      {tool === 'trade-find' && tradeFinder && !toolBusy && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70" data-testid="keeper-war-room-trade-find-result">
          {tradeFinder.needsMoreData ? <ul className="space-y-1">{tradeFinder.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>
            : tradeFinder.targets.length ? tradeFinder.targets.slice(0, 5).map((t) => (<p key={t.rosterId}><span className="font-semibold text-white/80">{t.teamName ?? t.rosterId}</span> (fit {t.fitScore}): {t.reasons.join(' ')}</p>))
              : <p className="text-white/40">No complementary keeper-trade partners found right now.</p>}
        </div>
      )}

      {/* Global missing-data flags */}
      {context.missingDataFlags.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] p-2">
          {context.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}
        </ul>
      )}

      {/* Ask War Room */}
      <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40"><ShieldQuestion className="h-3.5 w-3.5" /> Ask AF Legacy</p>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Who are my best keepers and who should I cut?" rows={2} data-testid="keeper-war-room-ask-input"
          className="w-full resize-none rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[12px] text-white/85 placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none" />
        <button type="button" onClick={() => void onAsk()} disabled={askBusy || !question.trim()} data-testid="keeper-war-room-ask-submit"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-50">
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} Ask
        </button>
        {askNote && <p className="mt-2 text-[11px] text-amber-200/80" data-testid="keeper-war-room-ask-note">{askNote}</p>}
        {answer && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-white/80" data-testid="keeper-war-room-answer">{answer}</p>}
      </div>
    </section>
  )
}
