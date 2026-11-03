'use client'

/**
 * Redraft AF War Room panel — grounded in the league's OWN data via
 * /api/leagues/[leagueId]/redraft-war-room. Every button is wired to a real route.
 * Surfaces deterministic team needs + lineup/waiver/trade-finder + a grounded "ask".
 * Honestly shows data-unavailable states instead of fabricating values.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, ShieldQuestion, Sparkles } from 'lucide-react'
import {
  analyzeRedraftWarRoomTrade,
  askRedraftWarRoom,
  fetchRedraftWarRoomLineup,
  fetchRedraftWarRoomState,
  fetchRedraftWarRoomWaivers,
  findRedraftWarRoomTrades,
} from '@/lib/redraft-war-room/client'
import type { RedraftWarRoomContext } from '@/lib/redraft-war-room/types'
import type { TeamNeedsResult } from '@/lib/redraft-war-room/redraftTeamNeedsEngine'
import type { LineupResult } from '@/lib/redraft-war-room/redraftLineupEngine'
import type { WaiverResult } from '@/lib/redraft-war-room/redraftWaiverEngine'
import { PRIORITY_GUIDANCE_LABEL, type WaiverTier } from '@/lib/redraft-war-room/redraftWaiverScoring'
import type { TradeAnalysis, TradeFinderResult } from '@/lib/redraft-war-room/redraftTradeEngine'
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { WarRoomTradeAnalysisView } from '@/lib/decision-os/trade/warRoomTradeView'
import { WarRoomTradeGradeLine } from '../WarRoomTradeGradeLine'
import '../redraft-tailwind-tabs.css'

type Tool = 'lineup' | 'waivers' | 'trade-analyze' | 'trade-find' | null

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[11px] rdt-warn">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 rdt-warn" />
      <span>{children}</span>
    </li>
  )
}

function tierClass(tier: WaiverTier): string {
  switch (tier) {
    case 'Must Add':
      return 'rdt-bad-soft rdt-bad'
    case 'Strong Add':
      return 'rdt-warn-soft rdt-warn'
    case 'Worth Considering':
      return 'rdt-warn-soft rdt-warn'
    case 'Watch List':
      return 'rdt-accent-soft rdt-accent'
    default:
      return 'rdt-well rdt-muted'
  }
}

export function RedraftWarRoomPanel({ leagueId }: { leagueId: string }) {
  const [context, setContext] = useState<RedraftWarRoomContext | null>(null)
  const [needs, setNeeds] = useState<TeamNeedsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tool, setTool] = useState<Tool>(null)
  const [toolBusy, setToolBusy] = useState(false)
  const [lineup, setLineup] = useState<LineupResult | null>(null)
  const [waivers, setWaivers] = useState<WaiverResult | null>(null)
  const [tradeAnalysis, setTradeAnalysis] = useState<WarRoomTradeAnalysisView<TradeAnalysis> | null>(null)
  const [tradeGrade, setTradeGrade] = useState<SuggestionGrade | null>(null)
  const [tradeFinder, setTradeFinder] = useState<TradeFinderResult | null>(null)
  const [tradeOutgoingId, setTradeOutgoingId] = useState('')
  const [tradeIncomingIds, setTradeIncomingIds] = useState('')

  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [askNote, setAskNote] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchRedraftWarRoomState(leagueId)
      .then((res) => {
        if (!active) return
        setContext(res.context)
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
        if (which === 'lineup') setLineup((await fetchRedraftWarRoomLineup(leagueId)).lineup)
        else if (which === 'waivers') setWaivers((await fetchRedraftWarRoomWaivers(leagueId)).waivers)
        else if (which === 'trade-analyze') {
          const ownPlayers = context?.teams.find((t) => t.isUserTeam)?.players ?? []
          const fallbackOutgoing = ownPlayers.find((p) => !p.isStarterSlot)?.playerId ?? ownPlayers[0]?.playerId ?? ''
          const outgoing = (tradeOutgoingId || fallbackOutgoing).trim()
          const incoming = tradeIncomingIds
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
          const analyzed = await analyzeRedraftWarRoomTrade(leagueId, {
            outgoingPlayerIds: outgoing ? [outgoing] : [],
            incomingPlayerIds: incoming,
          })
          setTradeAnalysis(analyzed.tradeAnalysis)
          setTradeGrade(analyzed.tradeGrade ?? null)
          if (!tradeOutgoingId && fallbackOutgoing) setTradeOutgoingId(fallbackOutgoing)
        }
        else if (which === 'trade-find') setTradeFinder((await findRedraftWarRoomTrades(leagueId)).tradeFinder)
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
      const res = await askRedraftWarRoom(leagueId, q)
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
        className="rdt rdt-card flex items-center gap-2 p-4 text-[12px] rdt-muted"
        data-testid="redraft-war-room-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin rdt-accent" /> Loading AF Legacy — Redraft…
      </div>
    )
  }
  if (error || !context) {
    return (
      <div
        className="rdt rounded-xl border rdt-warn-line rdt-warn-soft px-3 py-2 text-[12px] rdt-warn"
        data-testid="redraft-war-room-error"
      >
        {error ?? 'AF Legacy — Redraft is unavailable for this league.'}
      </div>
    )
  }

  return (
    <section
      className="rdt rdt-card space-y-3 p-4 shadow-[inset_3px_0_0_var(--rdt-accent)]"
      data-testid="redraft-war-room-panel"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 rdt-accent" />
        <h2 className="text-sm font-bold rdt-text">AF Legacy — Redraft</h2>
        <span className="rdt-season-chip">
          {context.sport} · W{context.currentWeek}/{context.totalWeeks}
        </span>
      </div>

      {/* Matchup, standings & data status */}
      {(() => {
        const me = context.teams.find((t) => t.isUserTeam)
        const m = context.upcomingMatchup
        const opp = m?.opponentRosterId ? context.teams.find((t) => t.rosterId === m.opponentRosterId) : null
        return (
          <div
            className="grid gap-2 rounded-lg border rdt-line2 rdt-well p-3 sm:grid-cols-3"
            data-testid="redraft-war-room-matchup-card"
          >
            <div>
              <p className="rdt-eyebrow">Standing</p>
              <p className="text-[11px] rdt-muted">
                {me && me.wins != null ? `${me.wins}-${me.losses}${me.ties ? `-${me.ties}` : ''}` : '—'}
                {me?.playoffSeed != null ? ` · seed ${me.playoffSeed}` : ''}
                {me && me.pointsFor != null ? ` · PF ${me.pointsFor.toFixed(0)}` : ''}
              </p>
            </div>
            <div>
              <p className="rdt-eyebrow">Next matchup</p>
              <p className="text-[11px] rdt-muted">
                {m ? `W${m.week} vs ${opp?.teamName ?? opp?.ownerName ?? 'TBD'}` : 'No upcoming matchup'}
              </p>
            </div>
            <div>
              <p className="rdt-eyebrow">Data</p>
              <p className="text-[11px] rdt-muted">
                {context.freeAgents?.length ?? 0} FAs · proj{' '}
                {context.availability?.projections === 'available' ? '✓' : '—'} · ADP{' '}
                {context.availability?.tradeValues === 'available' ? '✓' : '—'} · inj{' '}
                {context.availability?.injuries === 'available' ? '✓' : '—'}
              </p>
            </div>
          </div>
        )
      })()}

      {/* Team needs */}
      {needs && (
        <div className="rounded-lg border rdt-line2 rdt-well p-3">
          <p className="rdt-eyebrow">
            Team needs · urgency {needs.urgencyScore}/100
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold rdt-bad">NEEDS</p>
              {needs.needs.length ? (
                needs.needs.map((n) => (
                  <p key={n.position} className="text-[11px] rdt-muted">
                    {n.position} <span className="rdt-faint">({n.severity})</span>
                  </p>
                ))
              ) : (
                <p className="text-[11px] rdt-faint">None detected</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold rdt-good">STRENGTHS</p>
              {needs.strengths.length ? (
                needs.strengths.slice(0, 4).map((s) => (
                  <p key={s} className="text-[11px] rdt-muted">
                    {s}
                  </p>
                ))
              ) : (
                <p className="text-[11px] rdt-faint">—</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold rdt-warn">TARGET POSITIONS</p>
              <p className="text-[11px] rdt-muted">{needs.tradeTargetPositions.join(', ') || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tool buttons — every one wired to a real route */}
      <div className="flex flex-wrap gap-2">
        {(['lineup', 'waivers', 'trade-analyze', 'trade-find'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => void runTool(t)}
            disabled={toolBusy}
            aria-pressed={tool === t}
            data-testid={`redraft-war-room-tool-${t}`}
            className="rdt-btn rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
          >
            {t === 'lineup'
              ? 'Start/Sit'
              : t === 'waivers'
                ? 'Waivers'
                : t === 'trade-analyze'
                  ? 'Trade analyzer'
                  : 'Trade finder'}
          </button>
        ))}
      </div>

      {/* Tool output */}
      {toolBusy && (
        <p className="flex items-center gap-1.5 text-[11px] rdt-faint">
          <Loader2 className="h-3 w-3 animate-spin" /> Running…
        </p>
      )}
      {tool === 'lineup' && lineup && !toolBusy && (
        <div
          className="rounded-lg border rdt-line2 rdt-well p-3 text-[11px] rdt-muted"
          data-testid="redraft-war-room-lineup-result"
        >
          <p className="mb-1 font-semibold rdt-text2">Suggested starters (confidence: {lineup.confidence})</p>
          {lineup.suggestedStarters.map((s) => (
            <p key={s.slotName}>
              <span className="rdt-faint">{s.slotName}:</span> {s.playerName ?? '—'}{' '}
              {s.valueUsed != null && <span className="rdt-faint">({s.valueUsed})</span>}
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
      {tool === 'waivers' && waivers && !toolBusy && (
        <div
          className="rounded-lg border rdt-line2 rdt-well p-3 text-[11px] rdt-muted"
          data-testid="redraft-war-room-waivers-result"
        >
          {waivers.needsProviderIntegration ? (
            <p className="rdt-warn">
              Free-agent add targets need provider integration. Drop-side analysis is grounded in your roster:
            </p>
          ) : (
            <p className="mb-1 font-semibold rdt-text2">Recommended adds</p>
          )}
          <div className="space-y-2">
            {waivers.recommendedAdds.map((a) => (
              <div
                key={a.playerId}
                className="rounded-md border rdt-line rdt-well p-2"
                data-testid={`redraft-war-room-waiver-add-${a.playerId}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold rdt-text2">+ {a.playerName}</span>
                  <span className="rdt-faint">({a.position})</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tierClass(a.tier)}`}
                    data-testid={`redraft-war-room-waiver-tier-${a.playerId}`}
                  >
                    {a.tier}
                  </span>
                  <span className="text-[11px] rdt-faint">
                    Score {a.recommendationScore} · Confidence {a.confidence} ({a.confidenceLevel})
                  </span>
                  {a.faabBand && (
                    <span className="rounded rdt-good-soft px-1.5 py-0.5 text-[11px] rdt-good">
                      FAAB {a.faabBand}
                    </span>
                  )}
                  {a.priorityGuidance && (
                    <span className="rounded rdt-accent-soft px-1.5 py-0.5 text-[11px] rdt-accent">
                      {PRIORITY_GUIDANCE_LABEL[a.priorityGuidance]}
                    </span>
                  )}
                </div>
                {a.explanation.length > 0 && (
                  <ul className="mt-1 ml-3 list-disc space-y-0.5 text-[11px] rdt-muted">
                    {a.explanation.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {waivers.recommendedDrops.length > 0 && (
            <p className="mt-2 mb-1 font-semibold rdt-text2">Suggested drops</p>
          )}
          {waivers.recommendedDrops.map((d) => (
            <p key={d.playerId} className="rdt-muted">– {d.playerName} ({d.position}) — {d.reason}</p>
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
      {tool === 'trade-analyze' && !toolBusy && (
        <div className="rounded-lg border rdt-line2 rdt-well p-3 text-[11px] rdt-muted">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <select
              value={tradeOutgoingId}
              onChange={(event) => setTradeOutgoingId(event.target.value)}
              data-testid="redraft-war-room-trade-outgoing-select"
              className="min-w-0 rdt-input rounded-md px-2 py-1.5 text-[12px]"
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
              data-testid="redraft-war-room-trade-incoming-input"
              className="min-w-0 rdt-input rounded-md px-2 py-1.5 text-[12px]"
            />
            <button
              type="button"
              onClick={() => void runTool('trade-analyze')}
              disabled={toolBusy}
              data-testid="redraft-war-room-trade-analyze-submit"
              className="rdt-btn rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            >
              Analyze
            </button>
          </div>
          {tradeAnalysis ? (
            <div className="mt-2 space-y-1" data-testid="redraft-war-room-trade-analyze-result">
              {/*
                🛑 THE GRADE IS THE VERDICT (2026-09-28). Since 2026-09-29 there is no fallback: the
                engine's own accept/reject/neutral and value delta are not sent, and no grade reads
                "Not graded" with the reason.
              */}
              <WarRoomTradeGradeLine grade={tradeGrade} testId="redraft-war-room-trade-grade" />
              {tradeAnalysis.explanationFacts.map((f) => (
                <p key={f}>{f}</p>
              ))}
              {tradeAnalysis.lineupImpact.map((f) => (
                <p key={f}>{f}</p>
              ))}
              {tradeAnalysis.benchImpact.map((f) => (
                <p key={f} className="rdt-muted">{f}</p>
              ))}
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
            <p className="mt-2 rdt-faint">No trade analysis loaded.</p>
          )}
        </div>
      )}
      {tool === 'trade-find' && tradeFinder && !toolBusy && (
        <div
          className="rounded-lg border rdt-line2 rdt-well p-3 text-[11px] rdt-muted"
          data-testid="redraft-war-room-trade-find-result"
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
                <span className="font-semibold rdt-text2">{t.teamName ?? t.rosterId}</span> (fit {t.fitScore}):{' '}
                {t.reasons.join(' ')}
              </p>
            ))
          ) : (
            <p className="rdt-faint">No complementary trade partners found right now.</p>
          )}
        </div>
      )}

      {/* Global missing-data flags */}
      {context.missingDataFlags.length > 0 && (
        <ul className="space-y-1 rounded-lg border rdt-warn-line rdt-warn-soft p-2">
          {context.missingDataFlags.map((f) => (
            <Flag key={f}>{f}</Flag>
          ))}
        </ul>
      )}

      {/* Ask War Room */}
      <div className="rounded-lg border rdt-line2 rdt-well p-3">
        <p className="mb-1.5 flex items-center gap-1.5 rdt-eyebrow">
          <ShieldQuestion className="h-3.5 w-3.5" /> Ask AF Legacy
        </p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Who should I start at FLEX this week?"
          rows={2}
          data-testid="redraft-war-room-ask-input"
          className="w-full resize-none rdt-input rounded-md px-2 py-1.5 text-[12px]"
        />
        <button
          type="button"
          onClick={() => void onAsk()}
          disabled={askBusy || !question.trim()}
          data-testid="redraft-war-room-ask-submit"
          className="rdt-fill mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-50"
        >
          {askBusy && <Loader2 className="h-3 w-3 animate-spin" />} Ask
        </button>
        {askNote && <p className="mt-2 text-[11px] rdt-warn" data-testid="redraft-war-room-ask-note">{askNote}</p>}
        {answer && (
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed rdt-text2" data-testid="redraft-war-room-answer">
            {answer}
          </p>
        )}
      </div>
    </section>
  )
}
