'use client'
/**
 * Fantasy OS Suite — Phase OS-B1: Commissioner Multi-League Command Center.
 *
 * The default Commissioner OS landing experience — "what requires my attention today?" across every
 * league the signed-in user commissions, before drilling into any single league. Self-fetching, like
 * every other Decision OS card on this page (Mission Control, League Analytics, League Context) —
 * this section owns its own request to `/api/decision-os/commissioner-command-center` rather than
 * having the parent page pre-fetch it, keeping the same "each card fetches its own Decision OS data"
 * convention this whole file already follows.
 *
 * Deliberately titled "Multi-League Overview," not "Commissioner Command Center" — that exact label
 * is already owned on this same page by `CommissionerShowcasePanel` (a separate, pre-existing,
 * mostly-static foundation-readiness widget). Reusing the same on-screen words for a materially
 * different, real-Decision-OS-driven surface would confuse users looking at the same page; see
 * `docs/os/COMMISSIONER_COMMAND_CENTER.md` §1 for the full naming-collision note.
 */
import { useEffect, useMemo, useState } from 'react'
import { Compass } from 'lucide-react'
import type { CommissionerCommandCenterSnapshot } from '@/lib/decision-os/commissionerCommandCenter'
import { composeDailyBrief } from '@/lib/decision-os/dailyBrief'
import { composeNotificationFeed } from '@/lib/decision-os/notifications'
import { resolveDeliveryPlan } from '@/lib/decision-os/delivery/deliveryResolver'
import {
  DecisionOsBadge,
  DecisionOsEmptyState,
  decisionOsCardClassName,
} from './DecisionOsCardPrimitives'
import CommissionerCommandCenterOverview from './CommissionerCommandCenterOverview'
import CommissionerLeagueHealthRanking from './CommissionerLeagueHealthRanking'
import CommissionerAttentionQueue from './CommissionerAttentionQueue'
import CommissionerLeagueSwitcher from './CommissionerLeagueSwitcher'
import TodaysBriefCard from './TodaysBriefCard'
import NotificationCenter from './NotificationCenter'

type CommissionerCommandCenterResponse = CommissionerCommandCenterSnapshot & { draftsApproachingCount: number }

type CommissionerCommandCenterSectionProps = {
  commissionerLeagues: { id: string; name: string }[]
  demoMode?: boolean
  onSelectLeague: (leagueId: string) => void
}

export default function CommissionerCommandCenterSection({
  commissionerLeagues,
  demoMode = false,
  onSelectLeague,
}: CommissionerCommandCenterSectionProps) {
  const [snapshot, setSnapshot] = useState<CommissionerCommandCenterResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasLeagues = commissionerLeagues.length > 0

  useEffect(() => {
    if (demoMode || !hasLeagues) {
      setSnapshot(null)
      return
    }
    let cancelled = false
    setError(null)
    void fetch('/api/decision-os/commissioner-command-center', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<CommissionerCommandCenterResponse>
      })
      .then((data) => {
        if (!cancelled) setSnapshot(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your multi-league overview right now.')
      })
    return () => {
      cancelled = true
    }
  }, [demoMode, hasLeagues])

  const leagueNameById = useMemo(
    () => new Map(commissionerLeagues.map((league) => [league.id, league.name])),
    [commissionerLeagues],
  )

  // Composed directly from data this section already fetched for its OTHER cards — deliberately NOT a
  // separate self-fetch. See `docs/os/DAILY_BRIEF.md` §4 for why (avoids a second Mission Control fetch
  // per league on the same page load, the same discipline `commissionerCommandCenter.ts` itself follows).
  const brief = useMemo(
    () =>
      composeDailyBrief({
        leaguesMonitored: commissionerLeagues.length,
        healthyLeagueCount: snapshot?.healthyLeagueCount ?? 0,
        draftsApproachingCount: snapshot?.draftsApproachingCount ?? 0,
        signals: snapshot?.attentionQueue ?? [],
        leagueTrends: snapshot?.recentChanges ?? [],
      }),
    [snapshot, commissionerLeagues.length],
  )

  // Same zero-extra-fetch discipline as `brief` above — composed from data already on the page.
  // Phase OS-C6: production-readiness audit found this composition had no error handling — a
  // malformed signal/brief would throw inside this useMemo and crash the whole section (caught only
  // by the page-level error boundary, with zero record of which signal caused it). Wrapped so a
  // composition failure degrades this ONE card honestly (empty feed, logged) instead of taking down
  // the whole Multi-League Overview.
  const notifications = useMemo(() => {
    try {
      return composeNotificationFeed({ signals: snapshot?.attentionQueue ?? [], brief })
    } catch (err) {
      console.error('[CommissionerCommandCenterSection] composeNotificationFeed failed:', err)
      return []
    }
  }, [snapshot, brief])

  // Phase OS-B5: route the notification feed through the Delivery Adapter Layer rather than handing it
  // to the UI directly — exercises the real architecture end-to-end even though, today, the in-app
  // adapter always accepts everything (so `deliveryPlan.inApp` is currently equivalent in content to
  // `notifications` itself).
  const deliveryPlan = useMemo(() => {
    try {
      return resolveDeliveryPlan(notifications)
    } catch (err) {
      console.error('[CommissionerCommandCenterSection] resolveDeliveryPlan failed:', err)
      return { generatedAt: new Date().toISOString(), entries: [], inApp: [] }
    }
  }, [notifications])

  if (demoMode || !hasLeagues) {
    return (
      <section data-testid="commissioner-command-center-section" className={decisionOsCardClassName}>
        <div className="p-5">
          <DecisionOsEmptyState
            icon={Compass}
            title="Your multi-league overview will appear here"
            description="Once you commission at least one league, this becomes your default view — what needs attention across every league you run, before you drill into any one of them."
          />
        </div>
      </section>
    )
  }

  // Phase V1.0: a small, additive loading affordance — the sub-cards below (Today's Brief, Attention
  // Queue, etc.) each already have their own deliberate, tested "honest default" while the fetch is in
  // flight (see docs/os/VISUAL_OS_V1_AUDIT.md Finding 8), so this does NOT replace their content with a
  // skeleton; it only signals that the first real fetch hasn't resolved yet.
  const isLoading = !snapshot && !error

  return (
    <section
      data-testid="commissioner-command-center-section"
      className={decisionOsCardClassName}
      aria-label="Multi-league overview"
    >
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge icon={Compass}>Multi-League Overview</DecisionOsBadge>
          {isLoading ? (
            <span
              data-testid="commissioner-command-center-loading"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-primary" aria-hidden />
              Loading your overview…
            </span>
          ) : null}
        </div>
        <h2 className="mt-3 text-xl font-black tracking-tight text-primary">What needs your attention today?</h2>
        <p className="mt-1 text-xs leading-5 text-secondary">
          Across every league you commission — select a league below to drill into its own dashboard.
        </p>
      </div>

      <div className="space-y-5 p-5">
        {error ? (
          <div
            data-testid="commissioner-command-center-error"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700"
          >
            {error}
          </div>
        ) : null}

        <CommissionerCommandCenterOverview
          totalLeagues={commissionerLeagues.length}
          trackedLeagueCount={snapshot ? snapshot.totalLeagues - snapshot.unavailableLeagueCount : 0}
          leaguesNeedingAttentionCount={snapshot?.atRiskLeagueCount ?? 0}
          draftsApproachingCount={snapshot?.draftsApproachingCount ?? 0}
        />

        <TodaysBriefCard brief={brief} leagueNameById={leagueNameById} />

        <CommissionerLeagueHealthRanking summaries={snapshot?.leagueSummaries ?? []} leagueNameById={leagueNameById} />

        {/* Phase OS-B6: the standalone "Recent Changes" card was removed — its own real data
            (`snapshot.recentChanges`) is already surfaced by Today's Brief's league highlights above,
            and the card itself was near-permanently empty in real environments (the snapshot-capture
            cron isn't scheduled anywhere yet), making it a duplicated, low-value section rather than a
            distinct source of information. See docs/os/OS_B6_DEMO_EXCELLENCE.md §2. */}
        <CommissionerAttentionQueue entries={snapshot?.attentionQueue ?? []} leagueNameById={leagueNameById} />

        <NotificationCenter notifications={deliveryPlan.inApp} leagueNameById={leagueNameById} />

        <CommissionerLeagueSwitcher leagues={commissionerLeagues} onSelect={onSelectLeague} />
      </div>
    </section>
  )
}
