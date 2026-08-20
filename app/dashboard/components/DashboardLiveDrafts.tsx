'use client'

/**
 * DashboardLiveDrafts — the CROSS-LEAGUE draft strip on the main dashboard.
 *
 * This is the one surface that shows the viewer's drafts across every league
 * (league pages deliberately show only their own draft room). Live/paused
 * drafts render hot with a link straight into that league's Live Intel tab;
 * scheduled ones show their clock. Complete drafts stay out of the way.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { DraftListItem } from '@/lib/draft-intel/sleeperDraftIntelService'
import type { UserLeague } from '@/app/dashboard/types'
import '@/components/decide/broadcast-deck.css'

type ListResponse =
  | { linked: false; drafts: null }
  | { linked: true; season?: string; drafts: DraftListItem[] | null; error?: string }

export function DashboardLiveDrafts({ leagues }: { leagues: UserLeague[] }) {
  const [drafts, setDrafts] = useState<DraftListItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/draft/intel', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<ListResponse>) : null))
      .then((payload) => {
        if (!cancelled && payload?.linked && Array.isArray(payload.drafts)) {
          setDrafts(payload.drafts)
        }
      })
      .catch(() => {
        /* strip is additive — dashboard renders fine without it */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const active = (drafts ?? []).filter((d) => d.status !== 'complete')
  if (active.length === 0) return null

  const afLeagueFor = (sleeperLeagueId: string | null): UserLeague | null =>
    sleeperLeagueId
      ? leagues.find((l) => l.sleeperLeagueId === sleeperLeagueId) ?? null
      : null

  // Rows wear the SAME visual language as the LeagueSidebarCard rows below
  // them (rounded-xl, left-rail hover, avatar block, name + sub-line) so the
  // strip reads as part of the My Leagues list, not a foreign widget bolted on
  // top. The `.bdx` wrapper stays only for the severity-chip colors.
  return (
    <div className="bdx bdx-strip px-2 pt-2" data-testid="dashboard-live-drafts">
      <p className="px-1.5 pb-1 text-[10px] font-black uppercase italic tracking-wide text-[#ff8a3d]">
        Draft radar · {active.length}
      </p>
      <div className="space-y-0.5">
        {active.slice(0, 6).map((d) => {
          const af = afLeagueFor(d.leagueId)
          const name = af?.name ?? d.name
          const chip =
            d.status === 'drafting' ? (
              <span className="bdx-sev ok shrink-0">● LIVE</span>
            ) : d.status === 'paused' ? (
              <span className="bdx-sev warn shrink-0">⏸ paused</span>
            ) : (
              <span className="bdx-sev info shrink-0">
                {d.startTime ? new Date(d.startTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'scheduled'}
              </span>
            )
          // Imported → straight into that league's Live Intel.
          // NOT imported → into the import flow, so a live draft is never a dead end.
          return (
            <Link
              key={d.draftId}
              href={af ? `/league/${af.id}?view=draft_intel` : d.leagueId ? `/import?provider=sleeper&leagueId=${encodeURIComponent(d.leagueId)}&returnTo=/dashboard` : '/import?returnTo=/dashboard'}
              className="flex min-w-0 items-center gap-2.5 rounded-xl border border-l-[3px] border-transparent border-l-transparent px-2.5 py-2 no-underline transition-all duration-150 hover:border-[#262c6a] hover:bg-[#12163e]/70"
              style={{ color: 'inherit' }}
              title={
                af
                  ? "Open this league's Live Intel"
                  : 'Import this league to AllFantasy to unlock its draft cockpit'
              }
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-[10px] font-black ${
                  d.status === 'drafting'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-[#262c6a] bg-[#12163e] text-[#ff9ec0]'
                }`}
                aria-hidden
              >
                {name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-extrabold leading-tight tracking-tight text-white/90">
                  {name}
                </span>
                <span className="block truncate text-[10.5px] leading-tight text-white/40">
                  Draft · {d.teams || '—'} teams · {d.rounds || '—'} rounds
                </span>
              </span>
              {!af ? (
                <span
                  className="bdx-sev warn shrink-0"
                  title="This league is on your Sleeper account but not imported to AllFantasy yet — import it to unlock Live Intel, grades, and Chimmy."
                >
                  import
                </span>
              ) : null}
              {chip}
            </Link>
          )
        })}
      </div>
      <div className="mx-1.5 mb-1 mt-2 border-b border-[#1c2153]" aria-hidden />
    </div>
  )
}

export default DashboardLiveDrafts
