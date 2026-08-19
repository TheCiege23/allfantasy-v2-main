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
import { AlertTriangle, Compass, Layers, Loader2, ShieldQuestion, Sparkles } from 'lucide-react'
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
  const [tradeAnalysis, setTradeAnalysis] = useState<DynastyTradeAnalysis | null>(null)
  const [tradeFinder, setTradeFinder] = useState<DynastyTradeFinderResult | null>(null)
  const [tradeOutgoingId, setTradeOutgoingId] = useState('')
  const [tradeIncomingIds, setTradeIncomingIds] = useState('')

  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [askNote, setAskNote] = useState<string | null>(null)

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
        if (which === 'buy-sell-hold') setBuySellHold((await fetchDynastyWarRoomBuySellHold(leagueId)).buySellHold)
        else if (which === 'waivers') setWaivers((await fetchDynastyWarRoomWaivers(leagueId)).waivers)
        else if (which === 'lineup') setLineup((await fetchDynastyWarRoomLineup(leagueId)).lineup)
        else if (which === 'trade-analyze') {
          const ownPlayers = context?.teams.find((t) => t.isUserTeam)?.players ?? []
          const fallbackOutgoing = ownPlayers.find((p) => !p.isStarterSlot)?.playerId ?? ownPlayers[0]?.playerId ?? ''
          const outgoing = (tradeOutgoingId || fallbackOutgoing).trim()
          const incoming = tradeIncomingIds.split(',').map((id) => id.trim()).filter(Boolean)
          setTradeAnalysis(
            (
              await analyzeDynastyWarRoomTrade(leagueId, {
                outgoingPlayerIds: outgoing ? [outgoing] : [],
                incomingPlayerIds: incoming,
              })
            ).tradeAnalysis,
          )
          if (!tradeOutgoingId && fallbackOutgoing) setTradeOutgoingId(fallbackOutgoing)
        } else if (which === 'trade-find') setTradeFinder((await findDynastyWarRoomTrades(leagueId)).tradeFinder)
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
      const res = await askDynastyWarRoom(leagueId, q)
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
      <div
        className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#07071a] p-4 text-[12px] text-white/50"
        data-testid="dynasty-war-room-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin text-violet-300" /> Loading AF Legacy — Dynasty…
      </div>
    )
  }
  if (error || !context) {
    return (
      <div
        className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/90"
        data-testid="dynasty-war-room-error"
      >
        {error ?? 'AF Legacy — Dynasty is unavailable for this league.'}
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
      className="space-y-3 rounded-xl border border-violet-400/20 bg-[#0a0820] p-4"
      data-testid="dynasty-war-room-panel"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-300" />
        <h2 className="text-sm font-bold text-white">AF Legacy — Dynasty</h2>
        <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
          {context.sport} · {context.scoring.scoringPreset}
          {context.scoring.superflex ? ' · SF' : ''}
        </span>
      </div>

      {/* Team direction + age/value summary + data status */}
      <div
        className="grid gap-2 rounded-lg border border-white/[0.06] bg-[#07071a] p-3 sm:grid-cols-3"
        data-testid="dynasty-war-room-direction-card"
      >
        <div>
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
            <Compass className="h-3 w-3" /> Direction
          </p>
          <p className="text-[12px] font-semibold text-violet-100">
            {WINDOW_LABEL[direction?.window ?? 'unknown']}
            {direction?.contendScore != null ? (
              <span className="text-white/40"> · {direction.contendScore}/100</span>
            ) : null}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Age / value</p>
          <p className="text-[11px] text-white/70">
            {direction?.avgStarterAge != null ? `avg starter age ${direction.avgStarterAge}` : 'age n/a'}
            {direction?.youngValueShare != null ? ` · young ${(direction.youngValueShare * 100).toFixed(0)}%` : ''}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Data</p>
          <p className="text-[11px] text-white/60">
            {context.freeAgents?.length ?? 0} FAs · val{' '}
            {context.availability?.playerValues === 'available' ? '✓' : '—'} · age{' '}
            {context.availability?.playerAges === 'available' ? '✓' : '—'} · picks{' '}
            {context.availability?.futurePicks === 'available' ? '✓' : '—'}
          </p>
        </div>
      </div>

      {/* Roster needs */}
      {needs && (
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">
            Roster needs · urgency {needs.urgencyScore}/100
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold text-rose-300/80">NEEDS</p>
              {needs.needs.length ? (
                needs.needs.map((n) => (
                  <p key={n.position} className="text-[11px] text-white/70">
                    {n.position} <span className="text-white/40">({n.severity})</span>
                  </p>
                ))
              ) : (
                <p className="text-[11px] text-white/40">None detected</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-emerald-300/80">STRENGTHS</p>
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
              <p className="text-[10px] font-semibold text-amber-300/80">TARGET POSITIONS</p>
              <p className="text-[11px] text-white/60">{needs.tradeTargetPositions.join(', ') || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Taxi watch */}
      {taxiPlayers.length > 0 && (
        <div
          className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3"
          data-testid="dynasty-war-room-taxi-watch"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Taxi watch</p>
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
        className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3"
        data-testid="dynasty-war-room-pick-capital"
      >
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">
          <Layers className="h-3.5 w-3.5" /> Pick capital
          {picksState === 'available' && myPicks.length > 0 ? (
            <span className="ml-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
              {myPicks.length} picks · tier {Math.round(pickTierTotal * 10) / 10}
            </span>
          ) : null}
        </p>
        {picksState === 'missing' ? (
          <p className="mt-2 text-[11px] text-amber-200/80" data-testid="dynasty-war-room-pick-capital-limited">
            Future pick tracking is not enabled for this league yet.
          </p>
        ) : myPicks.length === 0 ? (
          <p className="mt-2 text-[11px] text-white/50" data-testid="dynasty-war-room-pick-capital-empty">
            Pick tracking is enabled, but you have no future picks recorded yet.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2" data-testid="dynasty-war-room-pick-capital-list">
            {myPicks.map((pk) => (
              <span
                key={pk.id}
                className="rounded-md bg-white/[0.04] px-2 py-1 text-[11px] text-white/70"
                title={pk.traded ? 'Acquired via trade' : 'Original pick'}
              >
                {pk.season} R{pk.round}
                {pk.traded ? <span className="text-amber-300/80"> ↔</span> : null}
                {pk.estValue != null ? <span className="text-white/40"> · tier {pk.estValue}</span> : null}
              </span>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[10px] text-white/30">
          Tiers are structural (round + years out), not market values.
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
            className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-50"
          >
            {t === 'buy-sell-hold'
              ? 'Buy / Sell / Hold'
              : t === 'waivers'
                ? 'Waivers'
                : t === 'lineup'
                  ? 'Lineup'
                  : t === 'trade-analyze'
                    ? 'Trade analyzer'
                    : 'Trade finder'}
          </button>
        ))}
      </div>

      {/* Tool output */}
      {toolBusy && (
        <p className="flex items-center gap-1.5 text-[11px] text-white/50">
          <Loader2 className="h-3 w-3 animate-spin" /> Running…
        </p>
      )}

      {tool === 'buy-sell-hold' && buySellHold && !toolBusy && (
        <div
          className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70"
          data-testid="dynasty-war-room-buy-sell-hold-result"
        >
          <p className="mb-1 font-semibold text-white/80">
            Asset calls — window: {WINDOW_LABEL[buySellHold.window]}
          </p>
          {buySellHold.pickCapitalNote ? (
            <p className="mb-1 text-sky-300/70">{buySellHold.pickCapitalNote}</p>
          ) : null}
          {buySellHold.entries.slice(0, 12).map((e) => (
            <p key={e.playerId}>
              <span className={`font-semibold ${CALL_COLOR[e.call]}`}>{e.call.toUpperCase()}</span> {e.playerName} (
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
          className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70"
          data-testid="dynasty-war-room-waivers-result"
        >
          {waivers.needsProviderIntegration ? (
            <p className="text-amber-200/80">
              Free-agent add targets unavailable for this sport/season. Drop-side analysis is grounded in your roster:
            </p>
          ) : (
            <p className="mb-1 font-semibold text-white/80">Recommended adds</p>
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
          className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70"
          data-testid="dynasty-war-room-lineup-result"
        >
          <p className="mb-1 font-semibold text-white/80">Best startable (confidence: {lineup.confidence})</p>
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
        <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <select
              value={tradeOutgoingId}
              onChange={(event) => setTradeOutgoingId(event.target.value)}
              data-testid="dynasty-war-room-trade-outgoing-select"
              className="min-w-0 rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[11px] text-white/80 focus:border-violet-400/40 focus:outline-none"
            >
              <option value="">Outgoing player</option>
              {(context?.teams.find((t) => t.isUserTeam)?.players ?? []).map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.playerName} ({p.position})
                </option>
              ))}
            </select>
            <input
              value={tradeIncomingIds}
              onChange={(event) => setTradeIncomingIds(event.target.value)}
              placeholder="Incoming player ID"
              data-testid="dynasty-war-room-trade-incoming-input"
              className="min-w-0 rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void runTool('trade-analyze')}
              disabled={toolBusy}
              data-testid="dynasty-war-room-trade-analyze-submit"
              className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-50"
            >
              Analyze
            </button>
          </div>
          {tradeAnalysis ? (
            <div className="mt-2 space-y-1" data-testid="dynasty-war-room-trade-analyze-result">
              <p className="font-semibold text-white/80">
                Verdict: {tradeAnalysis.verdict.replace(/_/g, ' ')}
                {tradeAnalysis.valueDelta != null ? (
                  <span className="text-white/40"> · value {tradeAnalysis.valueDelta}</span>
                ) : null}
              </p>
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
              {tradeAnalysis.directionImpact && <p className="text-violet-200/80">{tradeAnalysis.directionImpact}</p>}
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
            <p className="mt-2 text-white/40">No trade analysis loaded.</p>
          )}
        </div>
      )}

      {tool === 'trade-find' && tradeFinder && !toolBusy && (
        <div
          className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3 text-[11px] text-white/70"
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
                <span className="font-semibold text-white/80">{t.teamName ?? t.rosterId}</span> (fit {t.fitScore}):{' '}
                {t.reasons.join(' ')}
              </p>
            ))
          ) : (
            <p className="text-white/40">No complementary trade partners found right now.</p>
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
      <div className="rounded-lg border border-white/[0.06] bg-[#07071a] p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">
          <ShieldQuestion className="h-3.5 w-3.5" /> Ask AF Legacy
        </p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Should I sell my aging RB while I'm rebuilding?"
          rows={2}
          data-testid="dynasty-war-room-ask-input"
          className="w-full resize-none rounded-md border border-white/[0.1] bg-[#05050f] px-2 py-1.5 text-[12px] text-white/85 placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void onAsk()}
          disabled={askBusy || !question.trim()}
          data-testid="dynasty-war-room-ask-submit"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-50"
        >
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} Ask
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
