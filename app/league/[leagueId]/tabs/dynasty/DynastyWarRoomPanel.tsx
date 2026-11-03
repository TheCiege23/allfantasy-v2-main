'use client'

/**
 * Dynasty AF War Room panel — grounded in the league's OWN data via
 * /api/leagues/[leagueId]/dynasty-war-room. Every button is wired to a real route.
 * Surfaces team DIRECTION (contention window), age/value summary, buy/sell/hold,
 * trade analyzer/finder, taxi watch, waiver targets, lineup (contenders), and a
 * grounded "ask". Honestly shows data-unavailable + provider-limited states
 * (e.g. future picks) instead of fabricating values. Dynasty horizon, not redraft.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Compass, Layers, Loader2, ShieldQuestion, Sparkles } from 'lucide-react'
import '@/components/dynasty/dynasty-era.css'
import {
  analyzeDynastyWarRoomTrade,
  askDynastyWarRoom,
  fetchDynastyWarRoomBuySellHold,
  fetchDynastyWarRoomLineup,
  fetchDynastyWarRoomState,
  fetchDynastyWarRoomWaivers,
  findDynastyWarRoomTrades,
} from '@/lib/dynasty-war-room/client'
import type { DynastyWarRoomContext } from '@/lib/dynasty-war-room/types'
import type { DynastyNeedsResult } from '@/lib/dynasty-war-room/dynastyRosterNeedsEngine'
import type { DynastyDirectionResult } from '@/lib/dynasty-war-room/dynastyTeamDirectionEngine'
import type { BuySellHoldResult } from '@/lib/dynasty-war-room/dynastyBuySellHoldEngine'
import type { DynastyLineupResult } from '@/lib/dynasty-war-room/dynastyLineupEngine'
import type { DynastyWaiverResult } from '@/lib/dynasty-war-room/dynastyWaiverEngine'
import type { DynastyTradeAnalysis, DynastyTradeFinderResult } from '@/lib/dynasty-war-room/dynastyTradeEngine'
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { WarRoomTradeAnalysisView } from '@/lib/decision-os/trade/warRoomTradeView'
import { WarRoomTradeGradeLine } from '../WarRoomTradeGradeLine'
import { DynastyProspectFreeAgents } from './DynastyProspectFreeAgents'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tOr } from '@/lib/i18n/tInterpolate'

type Tool = 'buy-sell-hold' | 'waivers' | 'lineup' | 'trade-analyze' | 'trade-find' | null

const WINDOW_LABEL: Record<string, string> = {
  contend: 'Contending',
  rebuild: 'Rebuilding',
  middle: 'Middling',
  unknown: 'Unclear',
}
const CALL_COLOR: Record<string, string> = {
  sell: 'text-rose-300/85',
  buy: 'text-emerald-300/85',
  hold: 'text-white/60',
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[11px] text-amber-200/80">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" />
      <span>{children}</span>
    </li>
  )
}

export function DynastyWarRoomPanel({ leagueId }: { leagueId: string }) {
  const [context, setContext] = useState<DynastyWarRoomContext | null>(null)
  const [direction, setDirection] = useState<DynastyDirectionResult | null>(null)
  const [needs, setNeeds] = useState<DynastyNeedsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tool, setTool] = useState<Tool>(null)
  const [toolBusy, setToolBusy] = useState(false)
  const [buySellHold, setBuySellHold] = useState<BuySellHoldResult | null>(null)
  const [waivers, setWaivers] = useState<DynastyWaiverResult | null>(null)
  const [lineup, setLineup] = useState<DynastyLineupResult | null>(null)
  const [tradeAnalysis, setTradeAnalysis] = useState<WarRoomTradeAnalysisView<DynastyTradeAnalysis> | null>(null)
  const [tradeGrade, setTradeGrade] = useState<SuggestionGrade | null>(null)
  const [tradeFinder, setTradeFinder] = useState<DynastyTradeFinderResult | null>(null)
  const [tradeOutgoingId, setTradeOutgoingId] = useState('')
  const [tradeIncomingIds, setTradeIncomingIds] = useState('')

  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [askNote, setAskNote] = useState<string | null>(null)
  const { t: tw, tInterpolate: twi } = useOptionalLanguage()
  /** Window and call labels: translated when a key exists, otherwise the English map / raw call. */
  const windowLabel = (w: string) => tOr(tw, `dynastyWarRoom.panel.window.${w}`, WINDOW_LABEL[w])
  const callLabel = (call: string) => tOr(tw, `dynastyWarRoom.panel.call.${call}`, call.toUpperCase())

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchDynastyWarRoomState(leagueId)
      .then((res) => {
        if (!active) return
        setContext(res.context)
        setDirection(res.direction)
        setNeeds(res.needs)
        setError(null)
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : tw('dynastyWarRoom.panel.loadFailed')))
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
        if (which === 'buy-sell-hold') setBuySellHold((await fetchDynastyWarRoomBuySellHold(leagueId)).buySellHold)
        else if (which === 'waivers') setWaivers((await fetchDynastyWarRoomWaivers(leagueId)).waivers)
        else if (which === 'lineup') setLineup((await fetchDynastyWarRoomLineup(leagueId)).lineup)
        else if (which === 'trade-analyze') {
          const ownPlayers = context?.teams.find((t) => t.isUserTeam)?.players ?? []
          const fallbackOutgoing = ownPlayers.find((p) => !p.isStarterSlot)?.playerId ?? ownPlayers[0]?.playerId ?? ''
          const outgoing = (tradeOutgoingId || fallbackOutgoing).trim()
          const incoming = tradeIncomingIds.split(',').map((id) => id.trim()).filter(Boolean)
          const analyzed = await analyzeDynastyWarRoomTrade(leagueId, {
            outgoingPlayerIds: outgoing ? [outgoing] : [],
            incomingPlayerIds: incoming,
          })
          setTradeAnalysis(analyzed.tradeAnalysis)
          setTradeGrade(analyzed.tradeGrade ?? null)
          if (!tradeOutgoingId && fallbackOutgoing) setTradeOutgoingId(fallbackOutgoing)
        } else if (which === 'trade-find') setTradeFinder((await findDynastyWarRoomTrades(leagueId)).tradeFinder)
      } catch (e) {
        setError(e instanceof Error ? e.message : tw('dynastyWarRoom.panel.toolFailed'))
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
      const res = await askDynastyWarRoom(leagueId, q)
      if (res.aiUnavailable) {
        setAskNote(tw('dynastyWarRoom.panel.aiUnavailable'))
        setAnswer(null)
      } else {
        setAnswer(res.answer)
      }
    } catch (e) {
      setAskNote(e instanceof Error ? e.message : tw('dynastyWarRoom.panel.askFailed'))
    } finally {
      setAskBusy(false)
    }
  }, [leagueId, question])

  if (loading) {
    return (
      <div
        className="dyn-well dyn-era-muted flex items-center gap-2 rounded-xl p-4 text-[12px]"
        data-testid="dynasty-war-room-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin dyn-gold-icon motion-reduce:animate-none" /> {tw('dynastyWarRoom.panel.loading')}
      </div>
    )
  }
  if (error || !context) {
    return (
      <div
        className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/90"
        data-testid="dynasty-war-room-error"
      >
        {error ?? tw('dynastyWarRoom.panel.unavailable')}
      </div>
    )
  }

  const me = context.teams.find((t) => t.isUserTeam)
  const taxiPlayers = me?.players.filter((p) => p.slotType === 'taxi') ?? []
  const myPicks = me?.picks ?? []
  const picksState = context.availability?.futurePicks
  const pickTierTotal = myPicks.reduce((sum, pk) => sum + (pk.estValue ?? 0), 0)

  return (
    <section
      className="dyn-panel dyn-era space-y-3 rounded-xl p-4"
      data-testid="dynasty-war-room-panel"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="dyn-gold-icon h-4 w-4" aria-hidden />
        <h2 className="text-sm font-bold text-white">{tw('dynastyWarRoom.panel.title')}</h2>
        <span className="dyn-badge-gold rounded-full px-2 py-0.5 text-[11px] font-semibold">
          {context.sport} · {context.scoring.scoringPreset}
          {context.scoring.superflex ? ' · SF' : ''}
        </span>
      </div>

      {/* Team direction + age/value summary + data status */}
      <div
        className="grid gap-2 dyn-well rounded-lg p-3 sm:grid-cols-3"
        data-testid="dynasty-war-room-direction-card"
      >
        <div>
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/40">
            <Compass className="h-3 w-3" /> {tw('dynastyWarRoom.panel.direction')}
          </p>
          <p className="dyn-gold-text text-[12px] font-semibold">
            {windowLabel(direction?.window ?? 'unknown')}
            {direction?.contendScore != null ? (
              <span className="text-white/40"> · {direction.contendScore}/100</span>
            ) : null}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{tw('dynastyWarRoom.panel.ageValue')}</p>
          <p className="text-[11px] text-white/70">
            {direction?.avgStarterAge != null ? twi('dynastyWarRoom.panel.avgStarterAge', { age: direction.avgStarterAge }) : tw('dynastyWarRoom.panel.ageNa')}
            {direction?.youngValueShare != null ? ` · ${twi('dynastyWarRoom.panel.youngShare', { pct: (direction.youngValueShare * 100).toFixed(0) })}` : ''}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{tw('dynastyWarRoom.panel.data')}</p>
          <p className="text-[11px] text-white/60">
            {/* Ranked free agents only: NHL dynasty prospects are listed in the waiver tool. */}
            {twi('dynastyWarRoom.panel.dataLine', {
              fas: context.freeAgents?.filter((p) => p.prospectSource !== 'fantrax').length ?? 0,
              val: context.availability?.playerValues === 'available' ? '✓' : '—',
              age: context.availability?.playerAges === 'available' ? '✓' : '—',
              picks:
                context.availability?.futurePicks === 'available'
                  ? '✓'
                  : context.availability?.futurePicks === 'partial'
                    ? tw('dynastyWarRoom.panel.partial')
                    : '—',
            })}
          </p>
        </div>
      </div>

      {/* Roster needs */}
      {needs && (
        <div className="dyn-well rounded-lg p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">
            {twi('dynastyWarRoom.panel.rosterNeeds', { score: needs.urgencyScore })}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold text-rose-300/80">{tw('dynastyWarRoom.panel.needs')}</p>
              {needs.needs.length ? (
                needs.needs.map((n) => (
                  <p key={n.position} className="text-[11px] text-white/70">
                    {n.position} <span className="text-white/40">({n.severity})</span>
                  </p>
                ))
              ) : (
                <p className="text-[11px] text-white/40">{tw('dynastyWarRoom.panel.noneDetected')}</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-emerald-300/80">{tw('dynastyWarRoom.panel.strengths')}</p>
              {needs.strengths.length ? (
                needs.strengths.slice(0, 4).map((s) => (
                  <p key={s} className="text-[11px] text-white/60">
                    {s}
                  </p>
                ))
              ) : (
                <p className="text-[11px] text-white/40">—</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-amber-300/80">{tw('dynastyWarRoom.panel.targetPositions')}</p>
              <p className="text-[11px] text-white/60">{needs.tradeTargetPositions.join(', ') || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Taxi watch */}
      {taxiPlayers.length > 0 && (
        <div
          className="dyn-well rounded-lg p-3"
          data-testid="dynasty-war-room-taxi-watch"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{tw('dynastyWarRoom.panel.taxiWatch')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {taxiPlayers.map((p) => (
              <span key={p.playerId} className="rounded-md bg-white/[0.04] px-2 py-1 text-[11px] text-white/70">
                {p.playerName} ({p.position}){p.age != null ? ` · ${p.age}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Pick capital — real future_draft_picks; honest provider-limited states. */}
      <div
        className="dyn-well rounded-lg p-3"
        data-testid="dynasty-war-room-pick-capital"
      >
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">
          <Layers className="h-3.5 w-3.5" /> {tw('dynastyWarRoom.panel.pickCapital')}
          {picksState === 'available' && myPicks.length > 0 ? (
            <span className="ml-1 dyn-badge-gold rounded-full px-2 py-0.5 text-[11px] font-semibold">
              {twi('dynastyWarRoom.panel.picksTier', { count: myPicks.length, tier: Math.round(pickTierTotal * 10) / 10 })}
            </span>
          ) : null}
        </p>
        {picksState === 'missing' ? (
          <p className="mt-2 text-[11px] text-amber-200/80" data-testid="dynasty-war-room-pick-capital-limited">
            {tw('dynastyWarRoom.panel.picksMissing')}
          </p>
        ) : myPicks.length === 0 ? (
          picksState === 'partial' ? null : (
            <p className="mt-2 text-[11px] text-white/50" data-testid="dynasty-war-room-pick-capital-empty">
              {tw('dynastyWarRoom.panel.picksEmpty')}
            </p>
          )
        ) : (
          <div className="mt-2 flex flex-wrap gap-2" data-testid="dynasty-war-room-pick-capital-list">
            {myPicks.map((pk) => (
              <span
                key={pk.id}
                className={`${pk.round === 1 ? 'dyn-chip-r1' : 'dyn-chip'} inline-flex items-center rounded-md px-2 py-1 text-[11px]`}
                title={
                  pk.traded
                    ? pk.originalTeamName
                      ? twi('dynastyWarRoom.panel.acquiredFrom', { team: pk.originalTeamName })
                      : tw('dynastyWarRoom.panel.acquiredViaTrade')
                    : tw('dynastyWarRoom.panel.originalPick')
                }
              >
                {pk.season} R{pk.round}
                {pk.traded ? <ArrowLeftRight className="ml-1 h-3 w-3 text-amber-300/80" aria-hidden /> : null}
                {pk.estValue != null ? <span className="text-white/40">{` · ${twi('dynastyWarRoom.panel.tier', { tier: pk.estValue })}`}</span> : null}
              </span>
            ))}
          </div>
        )}
        {picksState === 'partial' ? (
          <p className="mt-2 text-[11px] text-amber-200/80" data-testid="dynasty-war-room-pick-capital-partial">
            {myPicks.length > 0 ? tw('dynastyWarRoom.panel.partialSome') : tw('dynastyWarRoom.panel.partialNone')}
          </p>
        ) : null}
        <p className="mt-1.5 text-[11px] text-white/30">
          {tw('dynastyWarRoom.panel.tiersNote')}
        </p>
      </div>

      {/* Tool buttons — every one wired to a real route */}
      <div className="flex flex-wrap gap-2">
        {(['buy-sell-hold', 'waivers', 'lineup', 'trade-analyze', 'trade-find'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => void runTool(t)}
            disabled={toolBusy}
            data-testid={`dynasty-war-room-tool-${t}`}
            className="dyn-action rounded-lg px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-50"
          >
            {t === 'buy-sell-hold'
              ? tw('dynastyWarRoom.panel.tool.buySellHold')
              : t === 'waivers'
                ? tw('dynastyWarRoom.panel.tool.waivers')
                : t === 'lineup'
                  ? tw('dynastyWarRoom.panel.tool.lineup')
                  : t === 'trade-analyze'
                    ? tw('dynastyWarRoom.panel.tool.tradeAnalyzer')
                    : tw('dynastyWarRoom.panel.tool.tradeFinder')}
          </button>
        ))}
      </div>

      {/* Tool output */}
      {toolBusy && (
        <p className="flex items-center gap-1.5 text-[11px] text-white/50">
          <Loader2 className="h-3 w-3 animate-spin" /> {tw('dynastyWarRoom.panel.running')}
        </p>
      )}

      {tool === 'buy-sell-hold' && buySellHold && !toolBusy && (
        <div
          className="dyn-well rounded-lg p-3 text-[11px] text-white/70"
          data-testid="dynasty-war-room-buy-sell-hold-result"
        >
          <p className="mb-1 font-semibold text-white/80">
            {twi('dynastyWarRoom.panel.assetCalls', { window: windowLabel(buySellHold.window) })}
          </p>
          {buySellHold.pickCapitalNote ? (
            <p className="mb-1 text-sky-300/70">{buySellHold.pickCapitalNote}</p>
          ) : null}
          {buySellHold.entries.slice(0, 12).map((e) => (
            <p key={e.playerId}>
              <span className={`font-semibold ${CALL_COLOR[e.call]}`}>{callLabel(e.call)}</span> {e.playerName} (
              {e.position}
              {e.age != null ? `, ${e.age}` : ''}) — {e.reason}
            </p>
          ))}
          {buySellHold.missingDataFlags.length > 0 && (
            <ul className="mt-2 space-y-1">
              {buySellHold.missingDataFlags.map((f) => (
                <Flag key={f}>{f}</Flag>
              ))}
            </ul>
          )}
        </div>
      )}

      {tool === 'waivers' && waivers && !toolBusy && (
        <div
          className="dyn-well rounded-lg p-3 text-[11px] text-white/70"
          data-testid="dynasty-war-room-waivers-result"
        >
          {waivers.needsProviderIntegration ? (
            <p className="text-amber-200/80">
              {tw('dynastyWarRoom.panel.addsUnavailable')}
            </p>
          ) : (
            <p className="mb-1 font-semibold text-white/80">{tw('dynastyWarRoom.panel.recommendedAdds')}</p>
          )}
          {waivers.recommendedAdds.map((a) => (
            <p key={a.playerId}>
              + {a.playerName} ({a.position}) — {a.reason}
            </p>
          ))}
          {waivers.recommendedDrops.map((d) => (
            <p key={d.playerId} className="text-white/55">
              – {d.playerName} ({d.position}) — {d.reason}
            </p>
          ))}
          <DynastyProspectFreeAgents prospects={waivers.unrankedProspects} list={waivers.prospectList} />
          {waivers.missingDataFlags.length > 0 && (
            <ul className="mt-2 space-y-1">
              {waivers.missingDataFlags.map((f) => (
                <Flag key={f}>{f}</Flag>
              ))}
            </ul>
          )}
        </div>
      )}

      {tool === 'lineup' && lineup && !toolBusy && (
        <div
          className="dyn-well rounded-lg p-3 text-[11px] text-white/70"
          data-testid="dynasty-war-room-lineup-result"
        >
          <p className="mb-1 font-semibold text-white/80">{twi('dynastyWarRoom.panel.bestStartable', { confidence: lineup.confidence })}</p>
          {lineup.suggestedStarters.map((s, i) => (
            <p key={`${s.position}-${i}`}>
              <span className="text-white/40">{s.position}:</span> {s.playerName ?? '—'}{' '}
              {s.value != null && <span className="text-white/40">({s.value})</span>}
            </p>
          ))}
          {lineup.missingDataFlags.length > 0 && (
            <ul className="mt-2 space-y-1">
              {lineup.missingDataFlags.map((f) => (
                <Flag key={f}>{f}</Flag>
              ))}
            </ul>
          )}
        </div>
      )}

      {tool === 'trade-analyze' && !toolBusy && (
        <div className="dyn-well rounded-lg p-3 text-[11px] text-white/70">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <select
              value={tradeOutgoingId}
              onChange={(event) => setTradeOutgoingId(event.target.value)}
              data-testid="dynasty-war-room-trade-outgoing-select"
              className="dyn-input min-w-0 rounded-md px-2 py-1.5 text-[11px]"
            >
              <option value="">{tw('dynastyWarRoom.panel.outgoingPlayer')}</option>
              {(context?.teams.find((t) => t.isUserTeam)?.players ?? []).map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.playerName} ({p.position})
                </option>
              ))}
            </select>
            <input
              value={tradeIncomingIds}
              onChange={(event) => setTradeIncomingIds(event.target.value)}
              placeholder={tw('dynastyWarRoom.panel.incomingPlayerId')}
              data-testid="dynasty-war-room-trade-incoming-input"
              className="dyn-input min-w-0 rounded-md px-2 py-1.5 text-[11px]"
            />
            <button
              type="button"
              onClick={() => void runTool('trade-analyze')}
              disabled={toolBusy}
              data-testid="dynasty-war-room-trade-analyze-submit"
              className="dyn-action rounded-lg px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-50"
            >
              {tw('dynastyWarRoom.panel.analyze')}
            </button>
          </div>
          {tradeAnalysis ? (
            <div className="mt-2 space-y-1" data-testid="dynasty-war-room-trade-analyze-result">
              {/*
                🛑 THE GRADE IS THE VERDICT (2026-09-28). Since 2026-09-29 there is no fallback: the
                engine's own accept/reject/neutral and value delta are not sent, and no grade reads
                "Not graded" with the reason.
              */}
              <WarRoomTradeGradeLine grade={tradeGrade} testId="dynasty-war-room-trade-grade" />
              {tradeAnalysis.explanationFacts.map((f) => (
                <p key={f}>{f}</p>
              ))}
              {tradeAnalysis.ageImpact.map((f) => (
                <p key={f} className="text-emerald-300/70">
                  {f}
                </p>
              ))}
              {tradeAnalysis.pickImpact.map((f) => (
                <p key={f} className="text-sky-300/70">
                  {f}
                </p>
              ))}
              {tradeAnalysis.directionImpact && <p className="dyn-gold-text">{tradeAnalysis.directionImpact}</p>}
              {tradeAnalysis.riskFlags.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {tradeAnalysis.riskFlags.map((f) => (
                    <Flag key={f}>{f}</Flag>
                  ))}
                </ul>
              )}
              {tradeAnalysis.missingDataFlags.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {tradeAnalysis.missingDataFlags.map((f) => (
                    <Flag key={f}>{f}</Flag>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-2 text-white/40">{tw('dynastyWarRoom.panel.noTradeAnalysis')}</p>
          )}
        </div>
      )}

      {tool === 'trade-find' && tradeFinder && !toolBusy && (
        <div
          className="dyn-well rounded-lg p-3 text-[11px] text-white/70"
          data-testid="dynasty-war-room-trade-find-result"
        >
          {tradeFinder.needsMoreData ? (
            <ul className="space-y-1">
              {tradeFinder.missingDataFlags.map((f) => (
                <Flag key={f}>{f}</Flag>
              ))}
            </ul>
          ) : tradeFinder.targets.length ? (
            tradeFinder.targets.slice(0, 5).map((t) => (
              <p key={t.rosterId}>
                <span className="font-semibold text-white/80">{t.teamName ?? t.rosterId}</span> {twi('dynastyWarRoom.panel.fit', { score: t.fitScore })}{' '}
                {t.reasons.join(' ')}
              </p>
            ))
          ) : (
            <p className="text-white/40">{tw('dynastyWarRoom.panel.noPartners')}</p>
          )}
        </div>
      )}

      {/* Global missing-data flags (incl. provider-limited future picks) */}
      {context.missingDataFlags.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] p-2">
          {context.missingDataFlags.map((f) => (
            <Flag key={f}>{f}</Flag>
          ))}
        </ul>
      )}

      {/* Ask War Room */}
      <div className="dyn-well rounded-lg p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">
          <ShieldQuestion className="h-3.5 w-3.5" /> {tw('dynastyWarRoom.panel.askTitle')}
        </p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={tw('dynastyWarRoom.panel.askPlaceholder')}
          rows={2}
          data-testid="dynasty-war-room-ask-input"
          className="dyn-input w-full resize-none rounded-md px-2 py-1.5 text-[12px]"
        />
        <button
          type="button"
          onClick={() => void onAsk()}
          disabled={askBusy || !question.trim()}
          data-testid="dynasty-war-room-ask-submit"
          className="dyn-action dyn-gold-text mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-50"
        >
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} {tw('dynastyWarRoom.panel.ask')}
        </button>
        {askNote && (
          <p className="mt-2 text-[11px] text-amber-200/80" data-testid="dynasty-war-room-ask-note">
            {askNote}
          </p>
        )}
        {answer && (
          <p
            className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-white/80"
            data-testid="dynasty-war-room-answer"
          >
            {answer}
          </p>
        )}
      </div>
    </section>
  )
}
