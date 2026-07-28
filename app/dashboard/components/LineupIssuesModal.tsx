'use client'

import { X } from 'lucide-react'
import { ProLeagueLink } from '@/components/dashboard/ProLeagueLink'
import { SourceActionLink, ReadOnlyLeagueNote } from '@/components/league-links/SourceActionLink'
import type { LineupActionSummaryPayload } from '@/lib/lineup-actions/types'

export type LineupCheckPayload = LineupActionSummaryPayload

export type LineupIssueRow = {
  type: string
  message: string
  playerName?: string
  position?: string
  severity: 'critical' | 'warning' | 'info'
}

function severityIcon(sev: LineupIssueRow['severity']) {
  if (sev === 'critical') return '🔴'
  if (sev === 'warning') return '🟡'
  return '🔵'
}

type Props = {
  isOpen: boolean
  onClose: () => void
  data: LineupCheckPayload | null
  loading: boolean
  hasProAccess: boolean
}

export function LineupIssuesModal({ isOpen, onClose, data, loading, hasProAccess }: Props) {
  if (!isOpen) return null

  const scanned = data?.scannedLeagues ?? 0
  const leagues = data?.leagues ?? []
  const total = data?.totalUnresolvedSlotActions ?? data?.totalIssues ?? 0
  const urgent = data?.urgentLineupActions ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div
        className="relative max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0f1521] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lineup-issues-title"
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
          <h2 id="lineup-issues-title" className="text-[17px] font-bold text-white">
            Lineup decisions
          </h2>
          <p className="mt-1 text-[12px] text-white/50">
            {loading
              ? 'Checking your leagues…'
              : total === 0 && leagues.length === 0
                ? 'No lineup actions needed in leagues we could scan.'
                : `${total} decision${total === 1 ? '' : 's'} across ${leagues.length} league${leagues.length === 1 ? '' : 's'}${
                    urgent > 0 ? ` · ${urgent} urgent` : ''
                  }`}
          </p>
          <p className="mt-2 text-[11px] leading-snug text-white/38">
            Counts empty or illegal starters, inactive players in your lineup, and (when enabled) doubtful starters.
            Locked players and low-impact suggestions are excluded.
          </p>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-white/[0.05]" />
              ))}
            </div>
          ) : leagues.length === 0 ? (
            <p className="text-center text-[13px] text-emerald-300/90">
              You&apos;re set for now — Chimmy scanned {scanned > 0 ? `all ${scanned} connected ` : 'your '}league
              {scanned === 1 ? '' : 's'}.
            </p>
          ) : (
            <div className="space-y-3">
              {leagues.map((lg) => (
                <div
                  key={lg.leagueId}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4"
                >
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

                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">Actions</p>
                  <ul className="mt-1 space-y-1">
                    {lg.issues.map((issue, idx) => (
                      <li key={`${issue.type}-${idx}`} className="text-[12px] text-white/75">
                        <span className="mr-1">{severityIcon(issue.severity)}</span>
                        {issue.message}
                      </li>
                    ))}
                  </ul>

                  {lg.chimmyAdvice ? (
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
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('af-chimmy-shortcut', {
                            detail: {
                              prompt: `Give me full lineup help for ${lg.leagueName} — starters, injuries, and matchup strategy.`,
                            },
                          })
                        )
                      }
                      className="text-[11px] font-semibold text-cyan-400 transition hover:text-cyan-300"
                    >
                      → Ask Chimmy for full lineup help
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <ProLeagueLink
                        leagueId={lg.leagueId}
                        leagueName={lg.leagueName}
                        label={lg.actionLinks?.internal?.label ?? 'Review Lineup in AF'}
                        hasProAccess={hasProAccess}
                        href={lg.actionLinks?.internal?.href ?? `/league/${lg.leagueId}?tab=team`}
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

        <div className="border-t border-white/[0.06] px-5 py-4">
          {leagues.some((l) => l.actionLinks?.imported && l.actionLinks?.external) ? (
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
