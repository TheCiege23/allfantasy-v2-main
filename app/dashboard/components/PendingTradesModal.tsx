'use client'

import { X } from 'lucide-react'
import type { PendingTradeLeague, TradesDashboardResponse } from '@/app/dashboard/dashboardStripApiTypes'
import { ProLeagueLink } from '@/components/dashboard/ProLeagueLink'

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type Props = {
  isOpen: boolean
  onClose: () => void
  data: TradesDashboardResponse | null
  loading: boolean
  hasProAccess: boolean
}

export function PendingTradesModal({ isOpen, onClose, data, loading, hasProAccess }: Props) {
  if (!isOpen) return null

  const leagues: PendingTradeLeague[] = data?.trades ?? []
  const hasTrades = leagues.some((l) => l.trades.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div
        className="relative max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0f1521] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-trades-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-2 text-white/40 transition hover:bg-white/[0.06] hover:text-white/80"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="border-b border-white/[0.06] px-5 pb-4 pt-5 pr-12">
          <h2 id="pending-trades-title" className="text-[17px] font-bold text-white">
            🔄 Pending trades
          </h2>
          <p className="mt-1 text-[12px] text-white/50">
            {loading ? 'Checking Sleeper…' : `${data?.totalPending ?? 0} pending offer${(data?.totalPending ?? 0) === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-36 animate-pulse rounded-xl bg-white/[0.05]" />
              ))}
            </div>
          ) : !hasTrades ? (
            <p className="text-center text-[13px] text-emerald-300/90">✅ No pending trades right now.</p>
          ) : (
            <div className="space-y-4">
              {leagues.map((lg) => (
                <div key={lg.leagueId}>
                  <div className="mb-2 flex gap-3">
                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white/10">
                      {lg.leagueAvatar ? (
                        <img src={lg.leagueAvatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-white/50">
                          {(lg.leagueName || 'L').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold text-white">{lg.leagueName}</p>
                      <p className="text-[11px] text-white/40">{lg.sport}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {lg.trades.map((trade) => (
                      <div
                        key={trade.transactionId}
                        className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-white/50">
                            Trade from {trade.proposedBy}
                            {trade.proposedAt ? ` · ${formatRelativeDate(trade.proposedAt)}` : ''}
                          </span>
                          {trade.chimmyVerdict ? (
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                              trade.chimmyVerdict === 'accept'
                                ? 'border-green-500/30 bg-green-500/15 text-green-400'
                                : trade.chimmyVerdict === 'decline'
                                  ? 'border-red-500/30 bg-red-500/15 text-red-400'
                                  : 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                            }`}
                          >
                            {trade.chimmyVerdict === 'accept'
                              ? '✓ Accept'
                              : trade.chimmyVerdict === 'decline'
                                ? '✗ Decline'
                                : '↔ Negotiate'}
                          </span>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-400/70">You give</p>
                            {trade.assetsGiven.map((a, i) => (
                              <p key={i} className="text-[12px] text-white/70">
                                {a.isPick ? `📋 ${a.pickRound ?? 'Pick'}` : a.playerName}
                                <span className="ml-1 text-white/35">{a.position}</span>
                              </p>
                            ))}
                          </div>
                          <div>
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-green-400/70">You get</p>
                            {trade.assetsReceived.map((a, i) => (
                              <p key={i} className="text-[12px] text-white/70">
                                {a.isPick ? `📋 ${a.pickRound ?? 'Pick'}` : a.playerName}
                                <span className="ml-1 text-white/35">{a.position}</span>
                              </p>
                            ))}
                          </div>
                        </div>

                        {trade.chimmyReason ? (
                        <div className="rounded-lg border border-cyan-500/[0.12] bg-cyan-500/[0.06] p-2.5">
                          <div className="flex gap-2">
                            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-[9px] font-bold text-white">
                              CH
                            </div>
                            <p className="text-[12px] leading-snug text-cyan-100">{trade.chimmyReason}</p>
                          </div>
                        </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              window.dispatchEvent(
                                new CustomEvent('af-chimmy-shortcut', {
                                  detail: {
                                    prompt: `Analyze this trade in ${lg.leagueName}: I give ${trade.assetsGiven.map((a) => a.playerName).join(', ')}, I get ${trade.assetsReceived.map((a) => a.playerName).join(', ')}`,
                                  },
                                })
                              )
                              onClose()
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 transition hover:text-cyan-300"
                          >
                            Ask Chimmy for full analysis →
                          </button>
                          <ProLeagueLink
                            leagueId={lg.leagueId}
                            leagueName={lg.leagueName}
                            label="Open league"
                            hasProAccess={hasProAccess}
                            href={`/league/${lg.leagueId}?tab=trades`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.06] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-white/[0.1] bg-white/[0.04] py-2.5 text-[13px] font-semibold text-white/80 transition hover:bg-white/[0.08]"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
