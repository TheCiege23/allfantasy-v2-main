'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TradeCenterModal } from './TradeCenterModal'
import { CommissionerReviewPanel } from './CommissionerReviewPanel'
import { TradeDiscoveryPanel } from './TradeDiscoveryPanel'
import { TradeBlockPanel } from './TradeBlockPanel'
import { MarketSnapshotPanel } from './MarketSnapshotPanel'
import { MarketValuePanel } from './MarketValuePanel'
import {
  fetchRedraftTradeSettings,
  listTradeProposals,
  submitTradeVote,
  vetoRedraftTradeProposal,
  type RedraftRosterRow,
  type RedraftTradeProposal,
  type RedraftTradeSettings,
} from '@/lib/redraft/client'

function rosterName(row: RedraftRosterRow | undefined, fallbackId: string): string {
  return row?.teamName ?? row?.ownerName ?? fallbackId.slice(0, 6)
}

function formatProposalAsset(asset: RedraftTradeProposal['assets'][number]): string {
  if (asset.assetType === 'player') return asset.playerName ?? 'Player'
  if (asset.assetType === 'draft_pick') {
    const season = asset.pickSeason ? `${asset.pickSeason} ` : ''
    const round = asset.pickRound ? `R${asset.pickRound}` : 'Pick'
    return `${season}${round}`.trim()
  }
  if (asset.assetType === 'faab') return 'FAAB'
  return 'Future consideration'
}

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
  const [proposals, setProposals] = useState<RedraftTradeProposal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [settings, setSettings] = useState<RedraftTradeSettings | null>(null)
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
      const rows = await listTradeProposals({ leagueId, seasonId })
      setProposals(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trade proposals')
    } finally {
      setLoading(false)
    }
  }, [leagueId, seasonId])

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
      await submitTradeVote({ proposalId, action })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action}`)
    } finally {
      setBusyProposalId(null)
    }
  }

  const onVeto = async (proposalId: string) => {
    setBusyProposalId(proposalId)
    setError(null)
    try {
      await vetoRedraftTradeProposal({ proposalId })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to veto proposal')
    } finally {
      setBusyProposalId(null)
    }
  }

  const canPropose = Boolean(seasonId && standings.length >= 2)

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4" data-testid="redraft-trade-center">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-white">Trade Center</p>
          <p className="text-[11px] text-white/50">
            Propose player + FAAB trades, then track offers through league review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || !seasonId}
            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/80 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            data-testid="trade-center-open"
            onClick={() => setModalOpen(true)}
            disabled={!canPropose}
            className="rounded-lg bg-cyan-500/85 px-3 py-1.5 text-[12px] font-semibold text-black disabled:opacity-50"
          >
            Propose Trade
          </button>
        </div>
      </div>

      {settings ? (
        <div className="flex flex-wrap gap-2 text-[10px] text-white/55" data-testid="trade-settings-summary">
          <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
            Review: {settings.commissionerTradeReviewType}
          </span>
          <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
            Offer window: {settings.tradeReviewHours}h
          </span>
          <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
            Deadline: {settings.tradeDeadlineWeek ? `Week ${settings.tradeDeadlineWeek}` : 'none'}
          </span>
          <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
            Pick trading: {settings.draftPickTrading ? 'on (reference-only)' : 'off'}
          </span>
        </div>
      ) : null}

      {isCommissioner || settingsCommissioner ? <MarketSnapshotPanel leagueId={leagueId} /> : null}
      {isCommissioner || settingsCommissioner ? <MarketValuePanel leagueId={leagueId} /> : null}

      {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}

      <div className="space-y-2">
        {proposals.length === 0 ? (
          <p className="text-[11px] text-white/45">No trade offers yet. Use “Propose Trade” to start one.</p>
        ) : (
          proposals.map((p) => {
            const proposerAssets = p.assets.filter((a) => a.fromRosterId === p.proposerRosterId)
            const receiverAssets = p.assets.filter((a) => a.fromRosterId === p.receiverRosterId)
            const tone = STATUS_TONE[p.status] ?? 'border-white/15 text-white/60'
            return (
              <div key={p.id} className="rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] text-white/80" data-testid="trade-proposal-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">
                    {rosterNameById.get(p.proposerRosterId) ?? 'Team A'}
                    {' ⇄ '}
                    {rosterNameById.get(p.receiverRosterId) ?? 'Team B'}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {p.valueSnapshot ? (
                      <span
                        className="rounded border border-cyan-300/40 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-100"
                        title={`Original grade at proposal time · fairness ${p.valueSnapshot.fairnessScore}/100`}
                        data-testid="trade-proposal-grade"
                      >
                        {p.valueSnapshot.grade}
                      </span>
                    ) : null}
                    <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${tone}`}>{p.status}</span>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white/70">{rosterNameById.get(p.proposerRosterId) ?? 'Team A'} sends</p>
                    <p className="mt-1 text-white/55">
                      {proposerAssets.length ? proposerAssets.map(formatProposalAsset).join(', ') : '—'}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white/70">{rosterNameById.get(p.receiverRosterId) ?? 'Team B'} sends</p>
                    <p className="mt-1 text-white/55">
                      {receiverAssets.length ? receiverAssets.map(formatProposalAsset).join(', ') : '—'}
                    </p>
                  </div>
                </div>
                {p.reason ? <p className="mt-2 text-white/55">“{p.reason}”</p> : null}
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
                        {action.replace('_', ' ')}
                      </button>
                    ))}
                    {isCommissioner || settingsCommissioner ? (
                      <button
                        type="button"
                        className="rounded border border-rose-500/40 px-2 py-1 text-rose-300 disabled:opacity-50"
                        disabled={busyProposalId === p.id}
                        onClick={() => void onVeto(p.id)}
                      >
                        commissioner veto
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {isCommissioner || settingsCommissioner ? <CommissionerReviewPanel proposalId={p.id} /> : null}
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
