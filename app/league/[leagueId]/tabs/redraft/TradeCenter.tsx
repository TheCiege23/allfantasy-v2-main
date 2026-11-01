'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TradeCenterModal } from './TradeCenterModal'
import { CommissionerReviewPanel } from './CommissionerReviewPanel'
import { reviewIdFor } from '@/lib/trade-review/reviewIdStore'
import { TradeDiscoveryPanel } from './TradeDiscoveryPanel'
import { TradeBlockPanel } from './TradeBlockPanel'
import { MarketSnapshotPanel } from './MarketSnapshotPanel'
import { MarketValuePanel } from './MarketValuePanel'
import {
  fetchRedraftTradeRuntime,
  fetchRedraftTradeSettings,
  listTradeProposals,
  submitTradeVote,
  vetoRedraftTradeProposal,
  type RedraftTradeRuntimeClient,
  type RedraftRosterRow,
  type RedraftTradeProposal,
  type RedraftTradeSettings,
} from '@/lib/redraft/client'
import { ReverseTradeDialog } from '@/components/league-trade/ReverseTradeDialog'
import { previewNativeTradeReversal, requestNativeTradeReversal } from '@/lib/trade-reversal/client'
import { explainTradeReview } from '@/lib/redraft/tradeReviewWindow'
import {
  isMultiTeamTrade,
  tradeParticipantRosterIds,
  tradePartiesPendingAcceptance,
  tradePartiesToAccept,
} from '@/lib/redraft/tradeParticipants'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { pickEnEs } from '@/lib/i18n/bilingual'

type Translate = (key: string) => string
type TranslateVars = (key: string, vars?: Record<string, string | number | undefined>) => string

function rosterName(row: RedraftRosterRow | undefined, fallbackId: string): string {
  return row?.teamName ?? row?.ownerName ?? fallbackId.slice(0, 6)
}

function formatProposalAsset(
  asset: RedraftTradeProposal['assets'][number],
  t: Translate,
  tInterpolate: TranslateVars,
): string {
  if (asset.assetType === 'player') return asset.playerName ?? t('tradeCenter.asset.player')
  if (asset.assetType === 'draft_pick') {
    const season = asset.pickSeason ? `${asset.pickSeason} ` : ''
    const round = asset.pickRound
      ? tInterpolate('tradeCenter.asset.pickRound', { round: asset.pickRound })
      : t('tradeCenter.asset.pick')
    return `${season}${round}`.trim()
  }
  // FAAB is the same word in every language this app ships.
  if (asset.assetType === 'faab') return 'FAAB'
  return t('tradeCenter.asset.future')
}

/** A server enum shown as-is when there is no copy for it, so a new value still reads as something. */
function labelFor(t: Translate, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const out = t(key)
  return out === key ? value : out
}

/** The one fixed reason the proposals route withholds a multi-team grade; translated when it is that one. */
const MULTI_TEAM_GRADE_WITHHELD_EN = 'Grades are shown for two-team trades.'

const STATUS_TONE: Record<string, string> = {
  pending: 'border-amber-400/30 text-amber-200',
  accepted: 'border-emerald-400/30 text-emerald-200',
  rejected: 'border-white/15 text-white/50',
  cancelled: 'border-white/15 text-white/50',
  vetoed: 'border-rose-400/30 text-rose-200',
  expired: 'border-white/15 text-white/40',
}

/**
 * Redraft Trade Center: a stepped propose flow (partner → assets → review) in the shared AppModal,
 * plus the active offers list with respond/vote/commissioner controls. Trades settle for real on
 * accept (see lib/redraft/tradeSettlement.ts).
 */
export function TradeCenter({
  leagueId,
  seasonId,
  standings,
  currentWeek = 1,
  myRosterId = null,
  isCommissioner = false,
}: {
  leagueId: string
  seasonId: string | null
  standings: RedraftRosterRow[]
  currentWeek?: number
  myRosterId?: string | null
  isCommissioner?: boolean
}) {
  const { t, tInterpolate, language } = useOptionalLanguage()
  const plural = (key: string, count: number) => tInterpolate(`${key}.${count === 1 ? 'one' : 'many'}`, { count })
  const asset = (a: RedraftTradeProposal['assets'][number]) => formatProposalAsset(a, t, tInterpolate)
  const [proposals, setProposals] = useState<RedraftTradeProposal[]>([])
  const [loading, setLoading] = useState(false)
  const [reversingId, setReversingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [settings, setSettings] = useState<RedraftTradeSettings | null>(null)
  const [runtime, setRuntime] = useState<RedraftTradeRuntimeClient | null>(null)
  const [faabByRosterId, setFaabByRosterId] = useState<Record<string, number>>({})
  const [settingsCommissioner, setSettingsCommissioner] = useState(false)
  const [discoveryPartnerId, setDiscoveryPartnerId] = useState<string | null>(null)

  const rosterNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of standings) map.set(r.id, rosterName(r, r.id))
    return map
  }, [standings])

  const refresh = useCallback(async () => {
    if (!seasonId) {
      setProposals([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [rows, runtimeState] = await Promise.all([
        listTradeProposals({ leagueId, seasonId }),
        fetchRedraftTradeRuntime({ leagueId, seasonId, week: currentWeek }).catch(() => null),
      ])
      setProposals(rows)
      setRuntime(runtimeState)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tradeCenter.error.load'))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` only changes with the language
  }, [leagueId, seasonId, currentWeek])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchRedraftTradeSettings({ leagueId, seasonId })
        if (!cancelled) {
          setSettings(res.settings)
          setFaabByRosterId(res.faabByRosterId)
          setSettingsCommissioner(Boolean(res.isCommissioner))
        }
      } catch {
        if (!cancelled) setSettings(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, seasonId])

  const onAction = async (proposalId: string, action: Parameters<typeof submitTradeVote>[0]['action']) => {
    setBusyProposalId(proposalId)
    setError(null)
    try {
      // A commissioner's decision carries the review it was made with (design step 6: decision logged).
      const commissionerAction = action === 'commissioner_approve' || action === 'commissioner_veto'
      await submitTradeVote({ proposalId, action, ...(commissionerAction ? { reviewId: reviewIdFor(proposalId) } : {}) })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t(`tradeCenter.error.action.${action}`))
    } finally {
      setBusyProposalId(null)
    }
  }

  const onVeto = async (proposalId: string) => {
    setBusyProposalId(proposalId)
    setError(null)
    try {
      await vetoRedraftTradeProposal({ proposalId, reviewId: reviewIdFor(proposalId) })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tradeCenter.error.veto'))
    } finally {
      setBusyProposalId(null)
    }
  }

  const canPropose = Boolean(seasonId && standings.length >= 2)

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4" data-testid="redraft-trade-center">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-white">{t('tradeCenter.title')}</p>
          <p className="text-[11px] text-white/50">{t('tradeCenter.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || !seasonId}
            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/80 disabled:opacity-50"
          >
            {loading ? t('tradeCenter.refreshing') : t('tradeCenter.refresh')}
          </button>
          <button
            type="button"
            data-testid="trade-center-open"
            onClick={() => setModalOpen(true)}
            disabled={!canPropose}
            className="rounded-lg bg-[#ff3d81]/85 px-3 py-1.5 text-[12px] font-semibold text-black disabled:opacity-50"
          >
            {t('tradeCenter.propose')}
          </button>
        </div>
      </div>

      {settings ? (
        <div className="flex flex-wrap gap-2 text-[11px] text-white/55" data-testid="trade-settings-summary">
          <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
            {tInterpolate('tradeCenter.settings.review', {
              type: labelFor(t, 'tradeCenter.reviewType', settings.commissionerTradeReviewType),
            })}
          </span>
          <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
            {tInterpolate('tradeCenter.settings.offerWindow', { hours: settings.tradeReviewHours })}
          </span>
          <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
            {tInterpolate('tradeCenter.settings.deadline', {
              deadline: settings.tradeDeadlineWeek
                ? tInterpolate('tradeCenter.settings.deadlineWeek', { week: settings.tradeDeadlineWeek })
                : t('tradeCenter.settings.deadlineNone'),
            })}
          </span>
          <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
            {tInterpolate('tradeCenter.settings.pickTrading', {
              state: settings.draftPickTrading ? t('tradeCenter.settings.pickTradingOn') : t('tradeCenter.settings.pickTradingOff'),
            })}
          </span>
        </div>
      ) : null}

      {runtime ? (
        <div
          className="grid gap-2 rounded-lg border border-[#ff9ec0]/15 bg-[#ff3d81]/[0.06] p-3 text-[11px] text-white/70 sm:grid-cols-4"
          data-testid="redraft-trade-runtime-summary"
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#ffd7e5]/60">{t('tradeCenter.runtime.title')}</p>
            <p className="mt-1 font-semibold text-white">{plural('tradeCenter.runtime.pending', runtime.coverage.pendingTrades)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#ffd7e5]/60">{t('tradeCenter.runtime.history')}</p>
            <p className="mt-1 font-semibold text-white">{plural('tradeCenter.runtime.records', runtime.coverage.transactionCount)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#ffd7e5]/60">{t('tradeCenter.runtime.voteState')}</p>
            <p className="mt-1 font-semibold text-white">{plural('tradeCenter.runtime.votes', runtime.coverage.voteCount)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#ffd7e5]/60">{t('tradeCenter.runtime.pickTrading')}</p>
            <p className="mt-1 font-semibold text-white">
              {runtime.settings.pickExecutionStatus === 'unavailable'
                ? t('tradeCenter.runtime.notInProposals')
                : labelFor(t, 'tradeCenter.pickStatus', runtime.settings.pickExecutionStatus)}
            </p>
          </div>
        </div>
      ) : null}

      {isCommissioner || settingsCommissioner ? <MarketSnapshotPanel leagueId={leagueId} /> : null}
      {isCommissioner || settingsCommissioner ? <MarketValuePanel leagueId={leagueId} /> : null}

      {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}

      <div className="space-y-2">
        {proposals.length === 0 ? (
          <p className="text-[11px] text-white/45">{t('tradeCenter.empty')}</p>
        ) : (
          proposals.map((p) => {
            const proposerAssets = p.assets.filter((a) => a.fromRosterId === p.proposerRosterId)
            const receiverAssets = p.assets.filter((a) => a.fromRosterId === p.receiverRosterId)
            const tone = STATUS_TONE[p.status] ?? 'border-white/15 text-white/60'
            // Multi-team trades: every team, each team's gives and gets, and who has accepted so far.
            const multiTeam = isMultiTeamTrade(p)
            const teamIds = tradeParticipantRosterIds(p)
            const teamName = (id: string, i: number) =>
              rosterNameById.get(id) ?? tInterpolate('tradeCenter.teamFallback', { letter: String.fromCharCode(65 + i) })
            const proposerName = rosterNameById.get(p.proposerRosterId) ?? tInterpolate('tradeCenter.teamFallback', { letter: 'A' })
            const receiverName = rosterNameById.get(p.receiverRosterId) ?? tInterpolate('tradeCenter.teamFallback', { letter: 'B' })
            const partiesToAccept = tradePartiesToAccept(p)
            const stillPending = tradePartiesPendingAcceptance(p)
            const acceptedCount = partiesToAccept.length - stillPending.length
            return (
              <div key={p.id} className="rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] text-white/80" data-testid="trade-proposal-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">
                    {multiTeam ? (
                      <>
                        {teamIds.map((id, i) => teamName(id, i)).join(' · ')}
                        <span className="ml-1.5 text-[11px] font-normal text-white/50">
                          {tInterpolate('tradeCenter.list.teamCount', { count: teamIds.length })}
                        </span>
                      </>
                    ) : (
                      <>
                        {proposerName}
                        {' ⇄ '}
                        {receiverName}
                      </>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {/* The one grade, from the proposer's side — not the proposal-time snapshot's own scale. */}
                    {p.tradeGrade?.grade ? (
                      <span
                        className="rounded border border-[#ff9ec0]/40 bg-[#ff3d81]/10 px-1.5 py-0.5 text-[11px] font-bold text-[#ffd7e5]"
                        title={tInterpolate('tradeCenter.list.gradeTitle', {
                          name: rosterNameById.get(p.proposerRosterId) ?? t('tradeCenter.list.theProposer'),
                        })}
                        data-testid="trade-proposal-grade"
                      >
                        {p.tradeGrade.grade}
                      </span>
                    ) : null}
                    {multiTeam && p.status === 'pending' && !p.acceptedAt ? (
                      <span className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/70" data-testid="trade-proposal-accept-count">
                        {tInterpolate('tradeCenter.list.acceptedCount', { accepted: acceptedCount, total: partiesToAccept.length })}
                      </span>
                    ) : null}
                    <span className={`rounded border px-2 py-0.5 text-[11px] uppercase ${tone}`}>{labelFor(t, 'tradeCenter.status', p.status)}</span>
                  </div>
                </div>
                {multiTeam ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="trade-proposal-multi-team">
                    {teamIds.map((id, i) => {
                      const gets = p.assets.filter((a) => a.toRosterId === id)
                      const gives = p.assets.filter((a) => a.fromRosterId === id)
                      const accepted = id !== p.proposerRosterId && !stillPending.includes(id)
                      return (
                        <div key={id} className="rounded border border-white/10 bg-white/[0.03] p-2">
                          <p className="font-semibold text-white/70">
                            {teamName(id, i)}
                            {id === p.proposerRosterId ? <span className="ml-1 font-normal text-white/40">{t('tradeCenter.list.proposed')}</span> : null}
                            {accepted ? <span className="ml-1 font-normal text-emerald-300/80">{t('tradeCenter.list.acceptedMark')}</span> : null}
                          </p>
                          <p className="mt-1 text-white/55">
                            <span className="text-white/40">{t('tradeCenter.list.getsLabel')}</span>{' '}
                            {gets.length ? gets.map(asset).join(', ') : '—'}
                          </p>
                          <p className="text-white/55">
                            <span className="text-white/40">{t('tradeCenter.list.givesLabel')}</span>{' '}
                            {gives.length ? gives.map(asset).join(', ') : '—'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    {/* Each team over what it GETS — the proposer's grade above is for this column. */}
                    <p className="font-semibold text-white/70">{tInterpolate('tradeCenter.list.teamGets', { name: proposerName })}</p>
                    <p className="mt-1 text-white/55">
                      {receiverAssets.length ? receiverAssets.map(asset).join(', ') : '—'}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white/70">{tInterpolate('tradeCenter.list.teamGets', { name: receiverName })}</p>
                    <p className="mt-1 text-white/55">
                      {proposerAssets.length ? proposerAssets.map(asset).join(', ') : '—'}
                    </p>
                  </div>
                </div>
                )}
                {multiTeam && p.tradeGrade?.gradeWithheld ? (
                  <p className="mt-2 text-white/45" data-testid="trade-proposal-grade-note">
                    {p.tradeGrade.gradeWithheld === MULTI_TEAM_GRADE_WITHHELD_EN
                      ? t('tradeCenter.list.multiTeamGradeWithheld')
                      : p.tradeGrade.gradeWithheld}
                  </p>
                ) : null}
                {p.reason ? <p className="mt-2 text-white/55">“{p.reason}”</p> : null}
                {p.status === 'pending' ? (
                  <p className="mt-2 rounded border border-cyan-300/20 bg-cyan-400/[0.06] px-2 py-1.5 text-cyan-50/85" data-testid="trade-review-explainer">
                    {multiTeam && !p.acceptedAt
                      ? tInterpolate('tradeCenter.list.waitingOn', {
                          teams: stillPending.map((id) => teamName(id, teamIds.indexOf(id))).join(', '),
                        })
                      : pickEnEs(explainTradeReview({ ...p, acceptedAt: p.acceptedAt ?? null, votes: p.votes }, Date.now()), language)}
                  </p>
                ) : null}
                {p.status === 'pending' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['accept', 'reject', 'cancel', 'vote_approve', 'vote_veto'] as const).map((action) => (
                      <button
                        key={action}
                        type="button"
                        className="rounded border border-white/20 px-2 py-1 disabled:opacity-50"
                        disabled={busyProposalId === p.id}
                        onClick={() => void onAction(p.id, action)}
                      >
                        {t(`tradeCenter.action.${action}`)}
                      </button>
                    ))}
                    {isCommissioner || settingsCommissioner ? (
                      <button
                        type="button"
                        className="rounded border border-rose-500/40 px-2 py-1 text-rose-300 disabled:opacity-50"
                        disabled={busyProposalId === p.id}
                        onClick={() => void onVeto(p.id)}
                      >
                        {t('tradeCenter.action.commissionerVeto')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {/*
                 * Reverse is offered only on an ACCEPTED proposal, and only to a commissioner. The server
                 * enforces both; this keeps the control off screens where pressing it could only be refused.
                 */}
                {p.status === 'accepted' && (isCommissioner || settingsCommissioner) ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="min-h-[44px] rounded border border-rose-500/40 px-3 py-1 text-rose-300 disabled:opacity-50"
                      disabled={busyProposalId === p.id}
                      onClick={() => setReversingId(p.id)}
                      data-testid="trade-proposal-reverse"
                    >
                      {t('tradeCenter.action.reverse')}
                    </button>
                  </div>
                ) : null}
                {reversingId === p.id ? (
                  <ReverseTradeDialog
                    title={
                      multiTeam
                        ? teamIds.map((id, i) => teamName(id, i)).join(' · ')
                        : `${proposerName} ⇄ ${receiverName}`
                    }
                    preflight={() => previewNativeTradeReversal(p.id)}
                    reverse={(reason) => requestNativeTradeReversal(p.id, reason)}
                    onClose={() => setReversingId(null)}
                    onReversed={() => void refresh()}
                  />
                ) : null}
                {isCommissioner || settingsCommissioner ? <CommissionerReviewPanel leagueId={leagueId} proposalId={p.id} /> : null}
              </div>
            )
          })
        )}
      </div>

      {seasonId && myRosterId ? (
        <TradeBlockPanel
          leagueId={leagueId}
          myRosterId={myRosterId}
          currentWeek={currentWeek}
          onBuildProposal={(partnerRosterId) => {
            setDiscoveryPartnerId(partnerRosterId)
            setModalOpen(true)
          }}
        />
      ) : null}

      {seasonId && myRosterId ? (
        <TradeDiscoveryPanel
          leagueId={leagueId}
          myRosterId={myRosterId}
          onBuildProposal={(partnerRosterId) => {
            setDiscoveryPartnerId(partnerRosterId)
            setModalOpen(true)
          }}
        />
      ) : null}

      {seasonId ? (
        <TradeCenterModal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false)
            setDiscoveryPartnerId(null)
          }}
          leagueId={leagueId}
          seasonId={seasonId}
          standings={standings}
          currentWeek={currentWeek}
          myRosterId={myRosterId}
          settings={settings}
          faabByRosterId={faabByRosterId}
          onSubmitted={() => void refresh()}
          initialReceiverRosterId={discoveryPartnerId}
        />
      ) : null}
    </div>
  )
}
