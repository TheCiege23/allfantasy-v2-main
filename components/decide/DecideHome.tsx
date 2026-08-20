'use client'

/**
 * DecideHome — the Broadcast Deck "Decide" view: the brain-first league landing tab.
 *
 * Slice 1 of the league-dashboard redesign (structure from the approved
 * Command Deck × Broadcast merge). Everything rendered here is REAL data or an
 * honest absent-state — never a fabricated number:
 *
 *  - KPI row       ← the viewer's LeagueTeamSlot (wins/losses, rank, PF, FAAB);
 *                    any missing field renders "—".
 *  - Trade cards   ← /api/league/trades-panel (AF-native active trades; the
 *                    Sleeper-league hardcoded-empty bug was fixed alongside this).
 *  - League Pulse  ← buildLeagueHomePulse — the Decision OS engine that decides
 *                    sufficiency itself and returns an explicit insufficient-data
 *                    state this view renders as-is (Honesty Pack rule: the UI
 *                    never re-decides sufficiency).
 *  - Recommended   ← /api/decision-os/manager-intelligence via
 *    moves            buildDecisionRecommendationsViewModel (same honesty contract).
 *  - Support band  ← real standings from team slots + real league settings.
 *
 * Pending trades made ON the external platform (e.g. Sleeper) are not shown:
 * the read-only public API does not expose unaccepted offers. The Trade Center
 * CTA is the honest path — recreate/propose the trade in AF to analyze it.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Info,
} from 'lucide-react'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import { isPreseason, useProjectedStandings } from '@/components/decide/useProjectedStandings'
import { TradeFinder } from '@/components/decide/TradeFinder'
import { MatchupCenter } from '@/components/decide/MatchupCenter'
import { WaiverIntel } from '@/components/decide/WaiverIntel'
import { CommissionerPulse } from '@/components/decide/CommissionerPulse'
import {
  buildLeagueHomePulse,
  type LeaguePulseViewModel,
} from '@/lib/decision-os/league-pulse'
import {
  buildDecisionRecommendationsViewModel,
  type DecisionRecommendationsViewModel,
} from '@/lib/decision-os/recommendations'
import type { ManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import './broadcast-deck.css'

// ── Local wire types (structural match for /api/league/trades-panel JSON) ────
type PanelTradeAsset = { id: string; label: string; sublabel: string | null }
type PanelTrade = {
  id: string
  direction: 'incoming' | 'outgoing' | 'complete' | string
  partnerName: string
  timestamp: string
  sent: PanelTradeAsset[]
  received: PanelTradeAsset[]
  status: string
  viewerIsReceiver: boolean
  viewerIsProposer: boolean
}
type VerdictContext = {
  idp: boolean
  idpEmphasis: 'tackle-heavy' | 'big-play' | 'balanced' | null
  scoringFormat: 'ppr' | 'half_ppr' | 'std'
  superflex: boolean
  dynasty: boolean
  adpKeyLabel: string
  pirate: { active: boolean; source: 'declared' | 'detected'; lines: string[] } | null
}
type TradesPanelPayload = { activeTrades?: PanelTrade[]; verdictContext?: VerdictContext | null }

export type DecideHomeProps = {
  league: UserLeague
  teams: LeagueTeamSlot[]
  /** The viewer's claimed team slot id (from the server page), if any. */
  userTeamId?: string | null
  isCommissioner?: boolean
  /** Open another league tab (e.g. 'trades', 'waivers') in the shell. */
  onOpenTab: (tabId: string) => void
}

type Sev = 'ok' | 'warn' | 'crit' | 'info'

const SEV_ICON: Record<Sev, typeof Info> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  crit: AlertTriangle,
  info: Info,
}

function SevChip({ sev, children }: { sev: Sev; children: React.ReactNode }) {
  const IconCmp = SEV_ICON[sev]
  return (
    <span className={`bdx-sev ${sev}`}>
      <IconCmp size={11} aria-hidden />
      {children}
    </span>
  )
}

function ordinal(n: number): string {
  const rem10 = n % 10
  const rem100 = n % 100
  if (rem10 === 1 && rem100 !== 11) return `${n}st`
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`
  return `${n}th`
}

function pulseSev(status: LeaguePulseViewModel['status']): Sev {
  if (status === 'at-risk') return 'crit'
  if (status === 'watch') return 'warn'
  if (status === 'healthy') return 'ok'
  return 'info'
}

function pulseCallClass(status: LeaguePulseViewModel['status']): string {
  if (status === 'at-risk') return 'risk'
  if (status === 'watch') return 'watch'
  if (status === 'insufficient-data') return 'na'
  return ''
}

function recSev(priority: string): Sev {
  const p = priority.trim().toLowerCase()
  if (p === 'critical') return 'crit'
  if (p === 'high') return 'warn'
  return 'info'
}

export function DecideHome({
  league,
  teams,
  userTeamId = null,
  isCommissioner = false,
  onOpenTab,
}: DecideHomeProps) {
  const [trades, setTrades] = useState<PanelTrade[] | null>(null)
  const [verdictContext, setVerdictContext] = useState<VerdictContext | null>(null)
  const [tradesLoading, setTradesLoading] = useState(true)
  const [intel, setIntel] = useState<ManagerIntelligencePayload | null>(null)
  const [intelLoading, setIntelLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setTradesLoading(true)
    void fetch(`/api/league/trades-panel?leagueId=${encodeURIComponent(league.id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<TradesPanelPayload>) : null))
      .then((data) => {
        if (cancelled) return
        setTrades(Array.isArray(data?.activeTrades) ? data.activeTrades : [])
        setVerdictContext(data?.verdictContext ?? null)
      })
      .catch(() => {
        if (!cancelled) setTrades([])
      })
      .finally(() => {
        if (!cancelled) setTradesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [league.id])

  useEffect(() => {
    let cancelled = false
    setIntelLoading(true)
    void fetch(`/api/decision-os/manager-intelligence?leagueId=${encodeURIComponent(league.id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<ManagerIntelligencePayload>) : null))
      .then((data) => {
        if (!cancelled) setIntel(data)
      })
      .catch(() => {
        if (!cancelled) setIntel(null)
      })
      .finally(() => {
        if (!cancelled) setIntelLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [league.id])

  // ── League Pulse: sufficiency decided by the engine, rendered as-is ────────
  const pulse: LeaguePulseViewModel = useMemo(
    () =>
      buildLeagueHomePulse({
        league: {
          id: league.id,
          name: league.name,
          sport: league.sport,
          format: league.format,
          platform: league.platform,
          teamCount: league.teamCount,
          status: league.status ?? null,
          lifecycleState: league.lifecycleState ?? null,
          currentWeek: league.currentWeek ?? null,
          draftDate: league.draftDate ?? null,
          importedAt: league.importedAt ?? null,
          isCommissioner,
        },
        teams,
        isCommissioner,
        managerDna: intel?.managerDna ?? null,
      }),
    [league, teams, isCommissioner, intel],
  )

  const recs: DecisionRecommendationsViewModel = useMemo(
    () => buildDecisionRecommendationsViewModel({ source: intel?.recommendations ?? null }),
    [intel],
  )

  // ── KPI row: viewer's real slot, or honest dashes ──────────────────────────
  const myTeam = useMemo(
    () => teams.find((t) => t.id === userTeamId) ?? null,
    [teams, userTeamId],
  )
  const standings = useMemo(
    () =>
      [...teams].sort(
        (a, b) => (b.wins ?? 0) - (a.wins ?? 0) || (b.pointsFor ?? 0) - (a.pointsFor ?? 0),
      ),
    [teams],
  )
  const myRankIndex = myTeam ? standings.findIndex((t) => t.id === myTeam.id) : -1
  const record = myTeam
    ? `${myTeam.wins}–${myTeam.losses}${myTeam.ties > 0 ? `–${myTeam.ties}` : ''}`
    : '—'
  // Pre-season: rank by projected week-1 points (labeled), never a wall of ties.
  const preseason = useMemo(() => isPreseason(teams), [teams])
  const projected = useProjectedStandings(league.id ?? null, preseason)
  const projectedMe =
    projected && myTeam?.platformUserId
      ? projected.rows.findIndex((r) => r.ownerId === myTeam.platformUserId)
      : -1
  const rankValue =
    projected && projectedMe >= 0
      ? ordinal(projectedMe + 1)
      : myTeam?.currentRank != null
        ? ordinal(myTeam.currentRank)
        : myRankIndex >= 0
          ? ordinal(myRankIndex + 1)
          : '—'
  const pointsFor =
    projected && projectedMe >= 0
      ? projected.rows[projectedMe].projectedPoints.toFixed(1)
      : myTeam != null
        ? myTeam.pointsFor.toFixed(1)
        : '—'
  const faab = myTeam?.faabRemaining != null ? `$${myTeam.faabRemaining}` : '—'

  const actionableTrades = (trades ?? []).filter((t) => t.status === 'pending' && t.viewerIsReceiver)
  const otherTrades = (trades ?? []).filter((t) => !(t.status === 'pending' && t.viewerIsReceiver))
  const needsCallCount =
    actionableTrades.length +
    (pulse.status === 'at-risk' || pulse.status === 'watch' ? 1 : 0) +
    recs.recommendations.filter((r) => recSev(r.priority) !== 'info').length

  const isLoading = tradesLoading || intelLoading

  return (
    <div className="bdx" data-testid="decide-home">
      {/* ── KPI row ── */}
      <div className="bdx-kpis">
        <div className="bdx-kpi">
          <div className="v">{record}</div>
          <div className="l">Record</div>
          <div className="d">{myTeam ? myTeam.teamName || 'Your team' : 'No claimed team'}</div>
        </div>
        <div className="bdx-kpi">
          <div className="v">{rankValue}</div>
          <div className="l">Standing</div>
          <div className="d">
            {projected && projectedMe >= 0
              ? `projected · wk ${projected.week}`
              : `of ${teams.length || league.teamCount || '—'} teams`}
          </div>
        </div>
        <div className="bdx-kpi">
          <div className="v">{pointsFor}</div>
          <div className="l">{projected && projectedMe >= 0 ? 'Proj. points' : 'Points for'}</div>
          <div className="d">
            {projected && projectedMe >= 0 ? `week ${projected.week} starters` : 'season total'}
          </div>
        </div>
        <div className="bdx-kpi">
          <div className="v">{faab}</div>
          <div className="l">FAAB left</div>
          <div className="d">{myTeam?.waiverPriority != null ? `waiver priority ${myTeam.waiverPriority}` : 'waivers'}</div>
        </div>
      </div>

      {/* ── Attention queue ── */}
      <div className="bdx-kick">
        <h2 className="bdx-disp">Needs your call</h2>
        <span className="bdx-sub">
          {isLoading ? 'reading your league…' : `${needsCallCount} item${needsCallCount === 1 ? '' : 's'} · every verdict shows its work`}
        </span>
      </div>

      <div className="bdx-queue">
        {isLoading ? (
          <>
            <div className="bdx-skel" />
            <div className="bdx-skel" />
          </>
        ) : (
          <>
            {/* Incoming trades needing the viewer's decision */}
            {actionableTrades.map((t) => (
              <TradeCard key={t.id} trade={t} sev="warn" onOpenTab={onOpenTab} context={verdictContext} />
            ))}

            {/* League Pulse — the Decision OS verdict for this league */}
            <div className={`bdx-card c-${pulseSev(pulse.status)}`}>
              <div className="bdx-head">
                <span className="bdx-kind">{pulse.eyebrow || 'League pulse'}</span>
                <SevChip sev={pulseSev(pulse.status)}>{pulse.statusLabel}</SevChip>
                <span className="bdx-when">updated {new Date(pulse.lastUpdatedIso).toLocaleString()}</span>
              </div>
              {pulse.insufficientData ? (
                <div className="bdx-empty" style={{ border: 'none', padding: '4px 0 0' }}>
                  <div className="t">{pulse.insufficientData.title}</div>
                  <div className="m">{pulse.insufficientData.message}</div>
                  <div className="missing">
                    {pulse.insufficientData.missing.map((m) => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="bdx-verdict">
                    <span className={`bdx-call ${pulseCallClass(pulse.status)}`}>{pulse.headline}</span>
                    <span className="bdx-conf">
                      <span className="bar">
                        <span className="fill" style={{ width: `${Math.max(0, Math.min(100, pulse.confidence))}%` }} />
                      </span>
                      <span className="pct">{pulse.confidence}% · {pulse.confidenceLabel}</span>
                    </span>
                  </div>
                  <div className="bdx-line">{pulse.summary}</div>
                  {pulse.derivation.length > 0 ? (
                    <ul className="bdx-why" style={{ marginTop: 10 }}>
                      {pulse.derivation.slice(0, 4).map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                  {pulse.evidence.length > 0 ? (
                    <div className="bdx-evrow">
                      {pulse.evidence.slice(0, 4).map((ev) => (
                        <span className="bdx-ev" key={ev.label}>
                          {ev.label}: <b>{ev.value}</b>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="bdx-acts">
                    {pulse.nextAction.href ? (
                      <a className="bdx-btn pri" href={pulse.nextAction.href}>
                        {pulse.nextAction.label}
                      </a>
                    ) : (
                      <span className="bdx-note" style={{ marginLeft: 0 }}>
                        Next: {pulse.nextAction.label} — {pulse.nextAction.detail}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Recommended moves — Decision OS action queue */}
            {recs.status === 'ready' ? (
              recs.recommendations.map((r) => (
                <div className={`bdx-card c-${recSev(r.priority)}`} key={r.title}>
                  <div className="bdx-head">
                    <span className="bdx-kind">Recommended move</span>
                    <SevChip sev={recSev(r.priority)}>{r.priority}</SevChip>
                    <span className="bdx-when">
                      impact: {r.expectedImpact} · {r.difficulty}
                    </span>
                  </div>
                  <div className="bdx-line">
                    <b>{r.title}</b>
                  </div>
                  {r.evidence.length > 0 ? (
                    <ul className="bdx-why" style={{ marginTop: 8 }}>
                      {r.evidence.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="bdx-acts">
                    <span className="bdx-note" style={{ marginLeft: 0 }}>
                      Suggested: {r.suggestedAction} · confidence {r.confidence}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="bdx-empty">
                <div className="t">{recs.insufficientData?.title ?? 'No grounded recommendations yet'}</div>
                <div className="m">
                  {recs.insufficientData?.message ??
                    'Recommendations appear once enough league activity is available.'}
                </div>
                {recs.insufficientData?.missing?.length ? (
                  <div className="missing">
                    {recs.insufficientData.missing.map((m) => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {/* Trades in flight (waiting on others / commissioner review) */}
            {otherTrades.map((t) => (
              <TradeCard key={t.id} trade={t} sev="info" onOpenTab={onOpenTab} context={verdictContext} />
            ))}
          </>
        )}
      </div>

      {/* ── Support band ── */}
      <div className="bdx-support">
        <div className="bdx-panelbox">
          <h3>Standings</h3>
          {standings.length > 0 ? (
            <table className="bdx-stand">
              <tbody>
                {standings.slice(0, 6).map((t, i) => (
                  <tr key={t.id} className={myTeam && t.id === myTeam.id ? 'me' : undefined}>
                    <td className="rk">{i + 1}</td>
                    <td>{t.teamName || t.ownerName || 'Team'}</td>
                    <td className="rec">
                      {t.wins}–{t.losses}
                      {t.ties > 0 ? `–${t.ties}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="bdx-empty" style={{ border: 'none', padding: 0 }}>
              <div className="m">No team records synced yet.</div>
            </div>
          )}
        </div>

        <div className="bdx-panelbox">
          <h3>Your team</h3>
          {myTeam ? (
            <div className="bdx-rows">
              <div className="bdx-row"><span className="k">Team</span><span className="x">{myTeam.teamName || '—'}</span></div>
              <div className="bdx-row"><span className="k">Record</span><span className="x">{record}</span></div>
              <div className="bdx-row"><span className="k">Points for</span><span className="x">{myTeam.pointsFor.toFixed(1)}</span></div>
              <div className="bdx-row"><span className="k">Points against</span><span className="x">{myTeam.pointsAgainst.toFixed(1)}</span></div>
              <div className="bdx-row"><span className="k">FAAB left</span><span className="x">{faab}</span></div>
            </div>
          ) : (
            <div className="bdx-empty" style={{ border: 'none', padding: 0 }}>
              <div className="m">No claimed team in this league yet.</div>
            </div>
          )}
        </div>

        <div className="bdx-panelbox">
          <h3>League vitals</h3>
          <div className="bdx-rows">
            <div className="bdx-row"><span className="k">Format</span><span className="x">{league.format || '—'}</span></div>
            <div className="bdx-row"><span className="k">Scoring</span><span className="x">{league.scoring || '—'}</span></div>
            <div className="bdx-row"><span className="k">Teams</span><span className="x">{league.teamCount || teams.length || '—'}</span></div>
            <div className="bdx-row">
              <span className="k">Trade deadline</span>
              <span className="x">{league.tradeDeadlineWeek ? `Week ${league.tradeDeadlineWeek}` : 'None set'}</span>
            </div>
            <div className="bdx-row">
              <span className="k">Playoffs</span>
              <span className="x">{league.playoffStartWeek ? `Week ${league.playoffStartWeek}` : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Matchup center: this week's games + projection-model win prob ── */}
      <MatchupCenter leagueId={league.id} />

      {/* ── Trade finder: both-sides offer ideas from real rosters + market ── */}
      <TradeFinder leagueId={league.id} onOpenTab={onOpenTab} />

      {/* ── Waiver intelligence: league bid history + value-anchored bids ── */}
      <WaiverIntel leagueId={league.id} />

      {/* ── Commissioner pulse: inactivity flags (commissioner only) ── */}
      {isCommissioner ? <CommissionerPulse leagueId={league.id} /> : null}

      <div className="bdx-foot">
        Every number above comes from this league&apos;s synced data or the Decision OS engine — when
        something isn&apos;t known yet, it says so instead of guessing. Pending offers made on the
        external platform aren&apos;t visible to a read-only import: recreate them in the Trade Center
        to analyze them here.
      </div>
    </div>
  )
}

// ── Trade card ───────────────────────────────────────────────────────────────

function TradeCard({
  trade,
  sev,
  onOpenTab,
  context = null,
}: {
  trade: PanelTrade
  sev: Sev
  onOpenTab: (tabId: string) => void
  context?: VerdictContext | null
}) {
  const isYourCall = trade.status === 'pending' && trade.viewerIsReceiver
  const when = new Date(trade.timestamp)
  return (
    <div className={`bdx-card c-${sev}`}>
      <div className="bdx-head">
        <span className="bdx-kind">
          <ArrowLeftRight size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} aria-hidden />
          Trade {trade.direction === 'incoming' ? 'offer' : trade.direction === 'outgoing' ? 'proposal' : ''}
        </span>
        <SevChip sev={sev}>{isYourCall ? 'Your call' : trade.status.replace(/_/g, ' ')}</SevChip>
        <span className="bdx-when">
          {trade.direction === 'incoming' ? 'from' : 'with'} {trade.partnerName} ·{' '}
          {Number.isFinite(when.getTime()) ? when.toLocaleDateString() : ''}
        </span>
      </div>
      <div className="bdx-trade">
        <div className="bdx-side">
          <div className="dir">You send</div>
          {trade.sent.length > 0 ? (
            trade.sent.map((a) => (
              <div className="bdx-asset" key={a.id}>
                {a.sublabel ? <span className="bdx-pos">{a.sublabel}</span> : null}
                {a.label}
              </div>
            ))
          ) : (
            <div className="bdx-asset" style={{ opacity: 0.6 }}>Nothing</div>
          )}
        </div>
        <div className="bdx-swap">⇄</div>
        <div className="bdx-side">
          <div className="dir">You receive</div>
          {trade.received.length > 0 ? (
            trade.received.map((a) => (
              <div className="bdx-asset" key={a.id}>
                {a.sublabel ? <span className="bdx-pos">{a.sublabel}</span> : null}
                {a.label}
              </div>
            ))
          ) : (
            <div className="bdx-asset" style={{ opacity: 0.6 }}>Nothing</div>
          )}
        </div>
      </div>
      {context && (context.idp || context.pirate) ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {context.idp ? (
            <span
              className="bdx-sev info"
              title={`Player value here reads through ${context.adpKeyLabel} and your league's real (IDP) scoring settings.`}
            >
              ◆ IDP scoring{context.idpEmphasis ? ` · ${context.idpEmphasis}` : ''}
            </span>
          ) : null}
          {context.pirate?.active ? (
            <span className="bdx-sev crit" title={context.pirate.lines.join(' ')}>
              ☠ pirate rules — weekly floor &gt; ceiling
            </span>
          ) : context.pirate ? (
            <span
              className="bdx-sev warn"
              title="Name suggests a pirate league — confirm it in Live Intel and every verdict adjusts."
            >
              ☠ pirate? unconfirmed
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="bdx-acts">
        <button type="button" className="bdx-btn pri" onClick={() => onOpenTab('trades')}>
          {isYourCall ? 'Review in Trade Center' : 'Open Trade Center'}
        </button>
      </div>
    </div>
  )
}

export default DecideHome
