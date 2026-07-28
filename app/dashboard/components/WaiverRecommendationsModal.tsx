'use client'

import { X } from 'lucide-react'
import type { WaiverDashboardResponse } from '@/app/dashboard/dashboardStripApiTypes'
import { ProLeagueLink } from '@/components/dashboard/ProLeagueLink'
import { SourceActionLink, ReadOnlyLeagueNote } from '@/components/league-links/SourceActionLink'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type Props = {
  isOpen: boolean
  onClose: () => void
  data: WaiverDashboardResponse | null
  loading: boolean
  hasProAccess: boolean
}

function formatReportDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export function WaiverRecommendationsModal({ isOpen, onClose, data, loading, hasProAccess }: Props) {
  const { t } = useLanguage()
  if (!isOpen) return null

  const recs = data?.recommendations ?? []
  const injuryPulse = data?.injuryPulse ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div
        className="relative max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0f1521] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="waiver-rec-title"
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
          <h2 id="waiver-rec-title" className="text-[17px] font-bold text-white">
            📋 Waiver recommendations
          </h2>
          <p className="mt-1 text-[12px] text-white/50">
            {loading ? 'Loading your leagues…' : `${recs.length} connected league${recs.length === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-white/[0.05]" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {injuryPulse.length > 0 ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/80">
                    {t('dashboard.waiverModal.injuryPulseTitle')}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-white/45">{t('dashboard.waiverModal.injuryPulseHint')}</p>
                  <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-[12px]">
                    {injuryPulse.slice(0, 12).map((row, idx) => (
                      <li
                        key={`${row.sport}-${row.playerName}-${row.reportDate}-${idx}`}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-white/[0.04] pb-1.5 last:border-0 last:pb-0"
                      >
                        <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/55">
                          {row.sport}
                        </span>
                        <span className="font-medium text-white/90">{row.playerName}</span>
                        <span className="text-white/40">{row.team}</span>
                        <span className="text-amber-200/85">{row.status}</span>
                        <span className="text-[10px] text-white/35">{formatReportDate(row.reportDate)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {recs.length === 0 ? (
                <p className="text-center text-[13px] text-emerald-300/90">
                  {injuryPulse.length > 0
                    ? `✅ ${t('dashboard.waiverModal.emptyWithInjuryPulse')}`
                    : `✅ ${t('dashboard.waiverModal.emptyNoRecs')}`}
                </p>
              ) : (
              <div className="space-y-3">
              {recs.map((lg) => (
                <div key={lg.leagueId} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <div className="flex gap-3">
                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white/10">
                      {lg.leagueAvatar ? (
                        <img src={lg.leagueAvatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-white/50">
                          {(lg.leagueName || 'L').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold text-white">{lg.leagueName}</p>
                      <p className="text-[11px] text-white/40">
                        {lg.sport} · {lg.platform}
                      </p>
                    </div>
                  </div>

                  {lg.pickups.length > 0 && (
                    <>
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">Recommended pickups</p>
                      <div className="mt-1 space-y-1.5">
                        {lg.pickups.map((p) => (
                          <div key={p.playerId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                            <span className="text-green-400">+ {p.playerName}</span>
                            <span className="text-white/40">
                              {p.position} · {p.team}
                            </span>
                            <span className="text-[10px] text-white/35">{p.addReason}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {lg.drops.length > 0 && (
                    <>
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">Drop candidates</p>
                      <div className="mt-1 space-y-1">
                        {lg.drops.map((d) => (
                          <div key={d.playerId} className="text-[12px]">
                            <span className="text-red-400">− {d.playerName}</span>
                            <span className="text-white/40">
                              {' '}
                              {d.position} · {d.team}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="mt-3 rounded-lg border border-cyan-500/[0.12] bg-cyan-500/[0.06] p-3">
                    <div className="flex gap-2">
                      <div
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-[9px] font-bold text-white"
                        aria-hidden
                      >
                        CH
                      </div>
                      <p className="text-[12px] leading-snug text-cyan-100">{lg.chimmyAdvice}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('af-chimmy-shortcut', {
                            detail: { prompt: `Give me detailed waiver wire advice for ${lg.leagueName}` },
                          })
                        )
                      }
                      className="text-[11px] font-semibold text-cyan-400 transition hover:text-cyan-300"
                    >
                      → Ask Chimmy for full waiver analysis
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <ProLeagueLink
                        leagueId={lg.leagueId}
                        leagueName={lg.leagueName}
                        label={lg.actionLinks?.internal?.label ?? 'Analyze Waivers in AF'}
                        hasProAccess={hasProAccess}
                        href={lg.actionLinks?.internal?.href ?? `/league/${lg.leagueId}?tab=players`}
                      />
                      {lg.actionLinks?.external ? (
                        <SourceActionLink
                          link={lg.actionLinks.external.link}
                          label={lg.actionLinks.external.label}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/75 transition hover:bg-white/[0.08]"
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.06] px-5 py-4">
          {recs.some((l) => l.actionLinks?.imported && l.actionLinks?.external) ? (
            <ReadOnlyLeagueNote className="mb-3 text-[11px] leading-snug text-white/45" />
          ) : null}
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
