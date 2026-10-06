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
import { localizeLeaguePulse, translatePulseText } from '@/lib/i18n/decision-os/leaguePulse'
import {
  buildDecisionRecommendationsViewModel,
  type DecisionRecommendationsViewModel,
} from '@/lib/decision-os/recommendations'
import type { ManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
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

function ordinal(n: number, language: string = 'en'): string {
  if (language === 'es') return `${n}.º`
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
  const { t, language } = useOptionalLanguage()
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
      localizeLeaguePulse(buildLeagueHomePulse({
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
      }), language),
    [league, teams, isCommissioner, intel, language],
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
      ? ordinal(projectedMe + 1, language)
      : myTeam?.currentRank != null
        ? ordinal(myTeam.currentRank, language)
        : myRankIndex >= 0
          ? ordinal(myRankIndex + 1, language)
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
          <div className="l">{t('decide.record')}</div>
          <div className="d">{myTeam ? myTeam.teamName || t('decide.yourTeam') : t('decide.kpi.noClaimedTeam')}</div>
        </div>
        <div className="bdx-kpi">
          <div className="v">{rankValue}</div>
          <div className="l">{t('decide.kpi.standing')}</div>
          <div className="d">
            {projected && projectedMe >= 0
              ? t('decide.kpi.projectedWk').replace('{{week}}', String(projected.week))
              : t('decide.kpi.ofTeams').replace('{{count}}', String(teams.length || league.teamCount || '—'))}
          </div>
        </div>
        <div className="bdx-kpi">
          <div className="v">{pointsFor}</div>
          <div className="l">{projected && projectedMe >= 0 ? t('decide.kpi.projPoints') : t('decide.pointsFor')}</div>
          <div className="d">
            {projected && projectedMe >= 0 ? t('decide.kpi.weekStarters').replace('{{week}}', String(projected.week)) : t('decide.kpi.seasonTotal')}
          </div>
        </div>
        <div className="bdx-kpi">
          <div className="v">{faab}</div>
          <div className="l">{t('decide.faabLeft')}</div>
          <div className="d">{myTeam?.waiverPriority != null ? t('decide.kpi.waiverPriority').replace('{{n}}', String(myTeam.waiverPriority)) : t('decide.kpi.waivers')}</div>
        </div>
      </div>

      {/* ── Attention queue ── */}
      <div className="bdx-kick">
        <h2 className="bdx-disp">{t('decide.needs.title')}</h2>
        <span className="bdx-sub">
          {isLoading ? t('decide.needs.reading') : t(needsCallCount === 1 ? 'decide.needs.countOne' : 'decide.needs.countMany').replace('{{count}}', String(needsCallCount))}
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
                <span className="bdx-kind">{pulse.eyebrow || t('decide.pulse.fallbackEyebrow')}</span>
                <SevChip sev={pulseSev(pulse.status)}>{pulse.statusLabel}</SevChip>
                <span className="bdx-when">{t('decide.pulse.updated').replace('{{when}}', new Date(pulse.lastUpdatedIso).toLocaleString(language === 'es' ? 'es' : undefined))}</span>
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
                      <span className="pct">{pulse.confidence}% · {language === 'es' ? translatePulseText(pulse.confidenceLabel) : pulse.confidenceLabel}</span>
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
                        {t('decide.pulse.next').replace('{{label}}', pulse.nextAction.label).replace('{{detail}}', pulse.nextAction.detail)}
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
                    <span className="bdx-kind">{t('decide.rec.kind')}</span>
                    <SevChip sev={recSev(r.priority)}>{r.priority}</SevChip>
                    <span className="bdx-when">
                      {t('decide.rec.impact').replace('{{impact}}', String(r.expectedImpact)).replace('{{difficulty}}', String(r.difficulty))}
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
                      {t('decide.rec.suggested').replace('{{action}}', String(r.suggestedAction)).replace('{{confidence}}', String(r.confidence))}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="bdx-empty">
                <div className="t">{recs.insufficientData?.title ?? t('decide.rec.emptyTitle')}</div>
                <div className="m">
                  {recs.insufficientData?.message ?? t('decide.rec.emptyMessage')}
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
          <h3>{t('decide.standings')}</h3>
          {standings.length > 0 ? (
            <table className="bdx-stand">
              <tbody>
                {standings.slice(0, 6).map((tm, i) => (
                  <tr key={tm.id} className={myTeam && tm.id === myTeam.id ? 'me' : undefined}>
                    <td className="rk">{i + 1}</td>
                    <td>{tm.teamName || tm.ownerName || t('decide.team')}</td>
                    <td className="rec">
                      {tm.wins}–{tm.losses}
                      {tm.ties > 0 ? `–${tm.ties}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="bdx-empty" style={{ border: 'none', padding: 0 }}>
              <div className="m">{t('decide.noRecordsYet')}</div>
            </div>
          )}
        </div>

        <div className="bdx-panelbox">
          <h3>{t('decide.yourTeam')}</h3>
          {myTeam ? (
            <div className="bdx-rows">
              <div className="bdx-row"><span className="k">{t('decide.team')}</span><span className="x">{myTeam.teamName || '—'}</span></div>
              <div className="bdx-row"><span className="k">{t('decide.record')}</span><span className="x">{record}</span></div>
              <div className="bdx-row"><span className="k">{t('decide.pointsFor')}</span><span className="x">{myTeam.pointsFor.toFixed(1)}</span></div>
              <div className="bdx-row"><span className="k">{t('decide.pointsAgainst')}</span><span className="x">{myTeam.pointsAgainst.toFixed(1)}</span></div>
              <div className="bdx-row"><span className="k">{t('decide.faabLeft')}</span><span className="x">{faab}</span></div>
            </div>
          ) : (
            <div className="bdx-empty" style={{ border: 'none', padding: 0 }}>
              <div className="m">{t('decide.noClaimedTeamYet')}</div>
            </div>
          )}
        </div>

        <div className="bdx-panelbox">
          <h3>{t('decide.vitals.title')}</h3>
          <div className="bdx-rows">
            <div className="bdx-row"><span className="k">{t('decide.vitals.format')}</span><span className="x">{league.format || '—'}</span></div>
            <div className="bdx-row"><span className="k">{t('decide.scoring')}</span><span className="x">{league.scoring || '—'}</span></div>
            <div className="bdx-row"><span className="k">{t('decide.vitals.teams')}</span><span className="x">{league.teamCount || teams.length || '—'}</span></div>
            <div className="bdx-row">
              <span className="k">{t('decide.tradeDeadline')}</span>
              <span className="x">{league.tradeDeadlineWeek ? t('decide.vitals.week').replace('{{week}}', String(league.tradeDeadlineWeek)) : t('decide.vitals.noneSet')}</span>
            </div>
            <div className="bdx-row">
              <span className="k">{t('decide.playoffs')}</span>
              <span className="x">{league.playoffStartWeek ? t('decide.vitals.week').replace('{{week}}', String(league.playoffStartWeek)) : '—'}</span>
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
        {t('decide.foot')}
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
  const { t, language } = useOptionalLanguage()
  const isYourCall = trade.status === 'pending' && trade.viewerIsReceiver
  const when = new Date(trade.timestamp)
  const statusKey = `decide.trade.status.${trade.status}`
  const statusText = t(statusKey) === statusKey ? trade.status.replace(/_/g, ' ') : t(statusKey)
  return (
    <div className={`bdx-card c-${sev}`}>
      <div className="bdx-head">
        <span className="bdx-kind">
          <ArrowLeftRight size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} aria-hidden />
          {t(trade.direction === 'incoming' ? 'decide.trade.offer' : trade.direction === 'outgoing' ? 'decide.trade.proposal' : 'decide.trade.plain')}
        </span>
        <SevChip sev={sev}>{isYourCall ? t('decide.trade.yourCall') : statusText}</SevChip>
        <span className="bdx-when">
          {t(trade.direction === 'incoming' ? 'decide.trade.from' : 'decide.trade.with').replace('{{name}}', trade.partnerName)} ·{' '}
          {Number.isFinite(when.getTime()) ? when.toLocaleDateString(language === 'es' ? 'es' : undefined) : ''}
        </span>
      </div>
      <div className="bdx-trade">
        <div className="bdx-side">
          <div className="dir">{t('decide.youSend')}</div>
          {trade.sent.length > 0 ? (
            trade.sent.map((a) => (
              <div className="bdx-asset" key={a.id}>
                {a.sublabel ? <span className="bdx-pos">{a.sublabel}</span> : null}
                {a.label}
              </div>
            ))
          ) : (
            <div className="bdx-asset" style={{ opacity: 0.6 }}>{t('decide.trade.nothing')}</div>
          )}
        </div>
        <div className="bdx-swap">⇄</div>
        <div className="bdx-side">
          <div className="dir">{t('decide.trade.youReceive')}</div>
          {trade.received.length > 0 ? (
            trade.received.map((a) => (
              <div className="bdx-asset" key={a.id}>
                {a.sublabel ? <span className="bdx-pos">{a.sublabel}</span> : null}
                {a.label}
              </div>
            ))
          ) : (
            <div className="bdx-asset" style={{ opacity: 0.6 }}>{t('decide.trade.nothing')}</div>
          )}
        </div>
      </div>
      {context && (context.idp || context.pirate) ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {context.idp ? (
            <span
              className="bdx-sev info"
              title={t('decide.trade.idpTitle').replace('{{adp}}', context.adpKeyLabel)}
            >
              {t('decide.trade.idpScoring')}{context.idpEmphasis ? ` · ${t(`decide.trade.idp.${context.idpEmphasis}`)}` : ''}
            </span>
          ) : null}
          {context.pirate?.active ? (
            <span className="bdx-sev crit" title={context.pirate.lines.join(' ')}>
              {t('decide.trade.pirateActive')}
            </span>
          ) : context.pirate ? (
            <span
              className="bdx-sev warn"
              title={t('decide.trade.pirateMaybeTitle')}
            >
              {t('decide.trade.pirateMaybe')}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="bdx-acts">
        <button type="button" className="bdx-btn pri" onClick={() => onOpenTab('trades')}>
          {isYourCall ? t('decide.trade.review') : t('decide.trade.open')}
        </button>
      </div>
    </div>
  )
}

export default DecideHome
