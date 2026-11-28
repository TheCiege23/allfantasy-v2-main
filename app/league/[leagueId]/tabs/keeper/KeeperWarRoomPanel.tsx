'use client'

/**
 * Keeper AF War Room panel — grounded in the league's OWN data via
 * /api/leagues/[leagueId]/keeper-war-room. Every button is wired to a real route.
 * Surfaces keeper rules, best keepers (value surplus), cut list, roster needs after
 * keepers, draft plan, trade analyzer/finder, in-season waivers/lineup, and a grounded
 * "ask". Honestly shows limited-data states (e.g. missing keeper costs) — never faked.
 *
 * Colours come from keeper-surfaces.css (tokens), never `text-white*` / `bg-[#…]`: in light mode the global
 * `.mode-readable` rule rewrites the first and only some of the second, which drew dark text on dark panels
 * (keeper audit 2026-11-22). __tests__/keeper/keeperWarRoomReadable.test.tsx holds both lines.
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
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { WarRoomTradeAnalysisView } from '@/lib/decision-os/trade/warRoomTradeView'
import { WarRoomTradeGradeLine } from '../WarRoomTradeGradeLine'
import './keeper-surfaces.css'

type Tool = 'cut-list' | 'draft-plan' | 'waivers' | 'lineup' | 'trade-analyze' | 'trade-find' | null

const TOOL_LABEL: Record<Exclude<Tool, null>, string> = {
  'cut-list': 'Cut list',
  'draft-plan': 'Draft plan',
  'trade-analyze': 'Trade analyzer',
  'trade-find': 'Trade finder',
  waivers: 'Waivers',
  lineup: 'Start/Sit',
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <li className="kp-warn flex items-start gap-1.5 text-[12px]">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </li>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const roundsWord = (n: number) => (n === 1 ? 'one round' : `${n} rounds`)

/** The league's keeper rules as sentences ("Keep up to 3 players", not "max 3 · round based · −1 rd · 3yr max"). */
export function keeperRuleSentences(k: KeeperWarRoomContext['keeper']): string[] {
  const out = [`Keep up to ${plural(k.maxKeepers, 'player')}.`]
  if (k.costSystem === 'round_based' || k.costSystem === 'inflation') {
    out.push(
      k.roundPenalty > 0
        ? `A keeper costs a pick ${roundsWord(k.roundPenalty)} earlier for each season you keep him.`
        : 'A keeper costs the pick he was drafted with.',
    )
  } else if (k.costSystem === 'auction_value') {
    out.push(k.auctionPctIncrease > 0 ? `A keeper costs his auction price plus ${k.auctionPctIncrease}%.` : 'A keeper costs his auction price.')
  } else if (k.costSystem === 'free') {
    out.push('Keepers cost no pick.')
  }
  if (k.maxYears > 0) out.push(`A player can be kept for up to ${plural(k.maxYears, 'season')}.`)
  return out
}

/** Only what is missing, in words; nothing when everything the advice needs is in. */
function missingData(a: KeeperWarRoomContext['availability']): string[] {
  const out: string[] = []
  if (a.playerValues !== 'available') out.push('Player values aren’t loaded yet.')
  if (a.keeperCosts !== 'available') out.push('Keeper costs aren’t set yet.')
  if (a.eligibility !== 'available') out.push('Who is eligible hasn’t been worked out yet.')
  return out
}

const NEED_WORD: Record<string, string> = { high: 'top need', medium: 'need', low: 'nice to have' }
const costWords = (label: string) => label.replace(/^Round (\d+)$/, 'a round $1 pick')

function ToolBox({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return <div className="kp-card rounded-lg p-3 text-[12px]" data-testid={testId}>{children}</div>
}

export function KeeperWarRoomPanel({ leagueId }: { leagueId: string }) {
  const [context, setContext] = useState<KeeperWarRoomContext | null>(null)
  const [recs, setRecs] = useState<KeeperRecommendationResult | null>(null)
  const [needs, setNeeds] = useState<KeeperNeedsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tool, setTool] = useState<Tool>(null)
  const [toolBusy, setToolBusy] = useState(false)
  const [toolError, setToolError] = useState<string | null>(null)
  const [cutList, setCutList] = useState<KeeperCutListResult | null>(null)
  const [draftPlan, setDraftPlan] = useState<KeeperDraftPlanResult | null>(null)
  const [waivers, setWaivers] = useState<KeeperWaiverResult | null>(null)
  const [lineup, setLineup] = useState<KeeperLineupResult | null>(null)
  const [tradeAnalysis, setTradeAnalysis] = useState<WarRoomTradeAnalysisView<KeeperTradeAnalysis> | null>(null)
  const [tradeGrade, setTradeGrade] = useState<SuggestionGrade | null>(null)
  const [tradeFinder, setTradeFinder] = useState<KeeperTradeFinderResult | null>(null)
  const [tradeOutgoingId, setTradeOutgoingId] = useState('')
  const [tradeIncomingId, setTradeIncomingId] = useState('')

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
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Couldn’t load the keeper War Room.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [leagueId])

  const runTool = useCallback(
    async (which: Exclude<Tool, null>) => {
      setTool(which)
      setToolError(null)
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
          const incoming = tradeIncomingId.trim()
          const analyzed = await analyzeKeeperWarRoomTrade(leagueId, { outgoingPlayerIds: outgoing ? [outgoing] : [], incomingPlayerIds: incoming ? [incoming] : [] })
          setTradeAnalysis(analyzed.tradeAnalysis)
          setTradeGrade(analyzed.tradeGrade ?? null)
          if (!tradeOutgoingId && fallback) setTradeOutgoingId(fallback)
        } else if (which === 'trade-find') setTradeFinder((await findKeeperWarRoomTrades(leagueId)).tradeFinder)
      } catch (e) {
        // A failed tool says so under the buttons; it never replaces the whole panel.
        setToolError(e instanceof Error ? e.message : 'That tool didn’t finish.')
      } finally {
        setToolBusy(false)
      }
    },
    [context, leagueId, tradeIncomingId, tradeOutgoingId],
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
        setAskNote('Chimmy is temporarily unavailable — showing grounded facts only.')
        setAnswer(null)
      } else {
        setAnswer(res.answer)
      }
    } catch (e) {
      setAskNote(e instanceof Error ? e.message : 'Chimmy couldn’t answer that.')
    } finally {
      setAskBusy(false)
    }
  }, [leagueId, question])

  if (loading) {
    return (
      <div className="kp-panel kp-muted flex items-center gap-2 rounded-xl p-4 text-[12px]" data-testid="keeper-war-room-loading">
        <Loader2 className="kp-accent h-4 w-4 animate-spin" /> Loading the keeper War Room…
      </div>
    )
  }
  if (error || !context) {
    return (
      <div className="kp-flag kp-warn rounded-xl px-3 py-2 text-[12px]" data-testid="keeper-war-room-error">
        {error ?? 'The keeper War Room isn’t available for this league.'}
      </div>
    )
  }

  const k = context.keeper
  const seasonActive = context.seasonActive
  const missing = missingData(context.availability)
  const myPlayers = context.teams.find((t) => t.isUserTeam)?.players ?? []
  const otherTeams = context.teams.filter((t) => !t.isUserTeam && t.players.length > 0)
  const deadline = k.selectionDeadline
    ? new Date(k.selectionDeadline).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <section className="kp-panel space-y-3 rounded-xl p-4" data-testid="keeper-war-room-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="kp-accent h-4 w-4" />
        {/* Named for where it lives (the War Room tab), as Best Ball's and Guilly's are — not "AF Legacy — Keeper". */}
        <h2 className="kp-text text-sm font-bold">Keeper War Room</h2>
        <span className="kp-chip rounded-full px-2 py-0.5 text-[11px] font-semibold">
          {context.sport} · {context.scoring.scoringPreset}
        </span>
      </div>

      {/* Keeper rules + deadline + what is missing, in sentences */}
      <div className="kp-card grid gap-3 rounded-lg p-3 sm:grid-cols-3" data-testid="keeper-war-room-rules-card">
        <div>
          <p className="kp-label flex items-center gap-1 text-[11px]">
            <ClipboardList className="h-3 w-3" /> Keeper rules
          </p>
          {keeperRuleSentences(k).map((s) => (
            <p key={s} className="kp-text2 text-[12px] leading-snug">{s}</p>
          ))}
        </div>
        <div>
          <p className="kp-label text-[11px]">Deadline</p>
          <p className="kp-text2 text-[12px]">
            {deadline ? `Set keepers by ${deadline}.` : k.keeperPhaseActive ? 'Keepers are open now.' : 'No deadline set yet.'}
            {seasonActive ? ' The season has started.' : ''}
          </p>
        </div>
        <div>
          <p className="kp-label text-[11px]">Advice is based on</p>
          {missing.length ? (
            missing.map((m) => <p key={m} className="kp-warn text-[12px]">{m}</p>)
          ) : (
            <p className="kp-text2 text-[12px]">Player values, keeper costs and eligibility.</p>
          )}
        </div>
      </div>

      {/* Best keepers (value surplus) */}
      {recs && (
        <div className="kp-card rounded-lg p-3" data-testid="keeper-war-room-recommendations">
          <p className="kp-label text-[11px]">Best keepers</p>
          {recs.needsMoreData ? (
            <p className="kp-warn mt-2 text-[12px]" data-testid="keeper-war-room-recs-limited">
              Keeper advice needs player values and keeper costs. Once the commissioner sets keeper costs, this ranks who is worth keeping.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {recs.recommended.map((r) => (
                <li key={r.playerId} className="kp-text2 text-[12px]">
                  <span className="kp-good font-semibold">Keep</span> <span className="kp-text font-semibold">{r.playerName}</span> ({r.position})
                  {r.surplusRounds != null && r.surplusRounds > 0 ? <span className="kp-good"> · {plural(r.surplusRounds, 'round')} of value</span> : null}
                  {r.keeperCostLabel ? <span className="kp-muted"> · costs {costWords(r.keeperCostLabel)}</span> : null}
                </li>
              ))}
              {recs.bubble.map((r) => (
                <li key={r.playerId} className="kp-text2 text-[12px]">
                  <span className="kp-muted font-semibold">On the bubble</span> <span className="kp-text font-semibold">{r.playerName}</span> ({r.position}) — {r.reason}
                </li>
              ))}
              {recs.avoid.map((r) => (
                <li key={r.playerId} className="kp-text2 text-[12px]">
                  <span className="kp-bad font-semibold">Let go</span> <span className="kp-text font-semibold">{r.playerName}</span> ({r.position}) — {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Roster needs after keepers */}
      {needs && (
        <div className="kp-card rounded-lg p-3">
          <p className="kp-label text-[11px]">Your roster after keepers</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="kp-bad text-[12px] font-semibold">Draft for</p>
              {needs.needs.length ? needs.needs.map((n) => (
                <p key={n.position} className="kp-text2 text-[12px]">{n.position} <span className="kp-muted">· {NEED_WORD[n.severity] ?? n.severity}</span></p>
              )) : <p className="kp-muted text-[12px]">Your keepers cover every starting spot.</p>}
            </div>
            <div>
              <p className="kp-good text-[12px] font-semibold">Covered by keepers</p>
              {needs.strengths.length ? needs.strengths.slice(0, 4).map((s) => (
                <p key={s} className="kp-text2 text-[12px]">{s}</p>
              )) : <p className="kp-muted text-[12px]">Nothing yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Tool buttons — every one wired to a real route (waivers/lineup only when active) */}
      <div className="flex flex-wrap gap-2">
        {(['cut-list', 'draft-plan', 'trade-analyze', 'trade-find'] as const).map((t) => (
          // The trade analyzer opens its form; it grades only once both players are picked.
          <button key={t} type="button" onClick={() => { if (t === 'trade-analyze') { setTool(t); setToolError(null) } else void runTool(t) }} disabled={toolBusy} data-testid={`keeper-war-room-tool-${t}`}
            aria-pressed={tool === t}
            className="kp-btn min-h-[36px] rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">
            {TOOL_LABEL[t]}
          </button>
        ))}
        {(seasonActive ? (['waivers', 'lineup'] as const) : []).map((t) => (
          <button key={t} type="button" onClick={() => void runTool(t)} disabled={toolBusy}
            aria-pressed={tool === t}
            data-testid={`keeper-war-room-tool-${t}`}
            className="kp-btn min-h-[36px] rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">
            {TOOL_LABEL[t]}
          </button>
        ))}
      </div>

      {toolError && !toolBusy && <p className="kp-warn text-[12px]" data-testid="keeper-war-room-tool-error" role="alert">{toolError}</p>}

      {toolBusy && <p className="kp-muted flex items-center gap-1.5 text-[12px]"><Loader2 className="h-3 w-3 animate-spin" /> Working…</p>}

      {tool === 'cut-list' && cutList && !toolBusy && (
        <ToolBox testId="keeper-war-room-cut-list-result">
          {cutList.cutList.length ? cutList.cutList.map((c) => (
            <p key={c.playerId} className="kp-text2"><span className="kp-text font-semibold">{c.playerName}</span> ({c.position}) — {c.reason}</p>
          )) : <p className="kp-muted">No one to cut.</p>}
          {cutList.riskFlags.length > 0 && <ul className="mt-2 space-y-1">{cutList.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
        </ToolBox>
      )}

      {tool === 'draft-plan' && draftPlan && !toolBusy && (
        <ToolBox testId="keeper-war-room-draft-plan-result">
          <p className="kp-text mb-1 font-semibold">
            {draftPlan.consumedRounds.length
              ? `Your keepers use your round ${draftPlan.consumedRounds.join(', ')} ${draftPlan.consumedRounds.length === 1 ? 'pick' : 'picks'}`
              : 'Your keepers use none of your picks'}
            {' · '}{draftPlan.remainingRounds.length} of {draftPlan.totalRounds} picks left
          </p>
          {draftPlan.roundPlan.map((rp) => (<p key={rp.round} className="kp-text2"><span className="kp-muted">Round {rp.round}:</span> {rp.focus} — {rp.note}</p>))}
          {draftPlan.missingDataFlags.length > 0 && <ul className="mt-2 space-y-1">{draftPlan.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
        </ToolBox>
      )}

      {tool === 'waivers' && waivers && !toolBusy && (
        <ToolBox testId="keeper-war-room-waivers-result">
          {waivers.needsProviderIntegration && <p className="kp-warn">No free agents to suggest yet. Who you could drop, from your roster:</p>}
          {waivers.recommendedAdds.map((a) => (<p key={a.playerId} className="kp-text2">Add <span className="kp-text font-semibold">{a.playerName}</span> ({a.position}) — {a.reason}</p>))}
          {waivers.recommendedDrops.map((d) => (<p key={d.playerId} className="kp-muted">Drop {d.playerName} ({d.position})</p>))}
        </ToolBox>
      )}

      {tool === 'lineup' && lineup && !toolBusy && (
        <ToolBox testId="keeper-war-room-lineup-result">
          <p className="kp-text mb-1 font-semibold">Suggested starters (confidence: {lineup.confidence})</p>
          {lineup.suggestedStarters.map((s, i) => (<p key={`${s.position}-${i}`} className="kp-text2"><span className="kp-muted">{s.position}:</span> {s.playerName ?? '—'}{s.value != null && <span className="kp-muted"> ({s.value})</span>}</p>))}
        </ToolBox>
      )}

      {tool === 'trade-analyze' && !toolBusy && (
        <ToolBox>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="grid min-w-0 gap-1">
              <span className="kp-label text-[11px]">You give</span>
              <select value={tradeOutgoingId} onChange={(e) => setTradeOutgoingId(e.target.value)} data-testid="keeper-war-room-trade-outgoing-select"
                className="kp-field min-h-[36px] min-w-0 rounded-md px-2 py-1.5 text-[12px]">
                <option value="">Pick one of your players</option>
                {myPlayers.map((p) => (<option key={p.playerId} value={p.playerId}>{p.playerName} ({p.position})</option>))}
              </select>
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="kp-label text-[11px]">You get</span>
              <select value={tradeIncomingId} onChange={(e) => setTradeIncomingId(e.target.value)} data-testid="keeper-war-room-trade-incoming-select"
                className="kp-field min-h-[36px] min-w-0 rounded-md px-2 py-1.5 text-[12px]">
                <option value="">{otherTeams.length ? 'Pick a player from another team' : 'No other rosters loaded yet'}</option>
                {otherTeams.map((t) => (
                  <optgroup key={t.rosterId} label={t.teamName ?? t.ownerName ?? 'Another team'}>
                    {t.players.map((p) => (<option key={p.playerId} value={p.playerId}>{p.playerName} ({p.position})</option>))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void runTool('trade-analyze')} disabled={toolBusy || !tradeIncomingId} data-testid="keeper-war-room-trade-analyze-submit"
              className="kp-btn-primary min-h-[36px] rounded-lg px-4 py-1.5 text-[12px] font-semibold disabled:opacity-50">Grade it</button>
          </div>
          {tradeAnalysis ? (
            <div className="kp-text2 mt-2 space-y-1" data-testid="keeper-war-room-trade-analyze-result">
              {/* 🛑 THE GRADE IS THE VERDICT (2026-09-29). The engine's own accept/reject/neutral is never shown. */}
              <WarRoomTradeGradeLine grade={tradeGrade} testId="keeper-war-room-trade-grade" />
              {tradeAnalysis.explanationFacts.filter((f) => !/^You give .+ and get /.test(f)).map((f) => (<p key={f}>{f}</p>))}
              {tradeAnalysis.keeperImpact.map((f) => (<p key={f} className="kp-good">{f}</p>))}
              {tradeAnalysis.riskFlags.length > 0 && <ul className="mt-2 space-y-1">{tradeAnalysis.riskFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>}
            </div>
          ) : <p className="kp-muted mt-2">Pick both players, then grade the trade.</p>}
        </ToolBox>
      )}

      {tool === 'trade-find' && tradeFinder && !toolBusy && (
        <ToolBox testId="keeper-war-room-trade-find-result">
          {tradeFinder.needsMoreData ? <ul className="space-y-1">{tradeFinder.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}</ul>
            : tradeFinder.targets.length ? tradeFinder.targets.slice(0, 5).map((t) => (<p key={t.rosterId} className="kp-text2"><span className="kp-text font-semibold">{t.teamName ?? 'Another team'}</span>: {t.reasons.join(' ')}</p>))
              : <p className="kp-muted">No team is a good keeper-trade fit right now.</p>}
        </ToolBox>
      )}

      {/* Global missing-data flags */}
      {context.missingDataFlags.length > 0 && (
        <ul className="kp-flag space-y-1 rounded-lg p-2">
          {context.missingDataFlags.map((f) => (<Flag key={f}>{f}</Flag>))}
        </ul>
      )}

      {/* Ask Chimmy */}
      <div className="kp-card rounded-lg p-3">
        <label htmlFor={`keeper-war-room-ask-${leagueId}`} className="kp-label mb-1.5 flex items-center gap-1.5 text-[11px]"><ShieldQuestion className="h-3.5 w-3.5" /> Ask Chimmy</label>
        <textarea id={`keeper-war-room-ask-${leagueId}`} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Who are my best keepers and who should I cut?" rows={2} data-testid="keeper-war-room-ask-input"
          className="kp-field w-full resize-none rounded-md px-2 py-1.5 text-[13px]" />
        <button type="button" onClick={() => void onAsk()} disabled={askBusy || !question.trim()} data-testid="keeper-war-room-ask-submit"
          className="kp-btn-primary mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-4 py-1.5 text-[12px] font-semibold disabled:opacity-50">
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} Ask
        </button>
        {askNote && <p className="kp-warn mt-2 text-[12px]" data-testid="keeper-war-room-ask-note">{askNote}</p>}
        {answer && <p className="kp-text mt-2 whitespace-pre-wrap text-[13px] leading-relaxed" data-testid="keeper-war-room-answer">{answer}</p>}
      </div>
    </section>
  )
}
