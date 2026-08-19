'use client'
/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * The manager-facing mirror of `CommissionerCommandCenterSection.tsx` — "what needs my attention
 * today, across every team I play in?" before drilling into any single league. Self-fetching, same
 * "each card fetches its own Decision OS data" convention every other Decision OS section on this
 * page family already follows.
 *
 * Reuses `TodaysBriefCard`, `CommissionerAttentionQueue`, and `NotificationCenter` completely
 * unchanged — all three already take fully generic props (`DailyBrief`, `DecisionOsAttentionSignal[]`,
 * `DecisionOsNotification[]`, all keyed by `leagueId`/`leagueNameById`, zero commissioner-specific
 * typing or copy). `CommissionerAttentionQueue`'s own name is a pre-existing naming artifact (it
 * predates Manager OS and was never renamed to something more neutral) — reusing it here is
 * intentional, not an oversight; renaming it is a separate, low-risk cleanup this phase deliberately
 * did not take on, to avoid touching a component with existing call sites/tests for a cosmetic
 * reason.
 *
 * Phase OS-C2 added the 3 Priority Modules (Lineup/Trade/Waiver) below the Attention Queue — built on
 * `ManagerCommandCenterSnapshot.recommendations`, the same real Phase 6.4 data the Attention Queue's
 * own `manager_recommendation` signals already read, chosen as the canonical source after an explicit
 * architecture audit (`docs/os/OS_C2_PRIORITIES_ARCHITECTURE_AUDIT.md`) ruled out 2 other candidate
 * systems.
 */
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Compass, ListChecks, Repeat } from 'lucide-react'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import { composeDailyBrief } from '@/lib/decision-os/dailyBrief'
import { composeNotificationFeed } from '@/lib/decision-os/notifications'
import { resolveDeliveryPlan } from '@/lib/decision-os/delivery/deliveryResolver'
import {
  DecisionOsBadge,
  DecisionOsEmptyState,
  decisionOsCardClassName,
} from './DecisionOsCardPrimitives'
import ManagerCommandCenterOverview from './ManagerCommandCenterOverview'
import ChampionshipTrajectory from '@/components/executive-viz/ChampionshipTrajectory'
import {
  WeeklyDecisionTimelineCard,
  TeamRiskSummaryCard,
} from '@/components/executive-viz/ManagerSupportingViz'
import WaiverImpactSequence from '@/components/executive-viz/WaiverImpactSequence'
import {
  WaiverOpportunityImpactCard,
  WaiverUrgencyCard,
} from '@/components/executive-viz/WaiverSupportingViz'
import DraftDecisionLadder from '@/components/executive-viz/DraftDecisionLadder'
import {
  DraftReadinessCard,
  DraftPreparationImpactCard,
} from '@/components/executive-viz/DraftSupportingViz'
import PlatformFocus from '@/components/executive-viz/PlatformFocus'
import {
  ExecutiveWorkloadCard,
  AttentionSummaryCard,
} from '@/components/executive-viz/PlatformSupportingViz'
import CommissionerAttentionQueue from './CommissionerAttentionQueue'
import ManagerPriorityModule from './ManagerPriorityModule'
import ManagerLeagueSwitcher from './ManagerLeagueSwitcher'
import TodaysBriefCard from './TodaysBriefCard'
import NotificationCenter from './NotificationCenter'

type ManagerCommandCenterResponse = ManagerCommandCenterSnapshot & { draftsApproachingCount: number }

type ManagerCommandCenterSectionProps = {
  leagues: { id: string; name: string }[]
  /** White-label (Phase V5.0): brand-neutral scope phrase for the Platform Focus summary. */
  platformScopeLabel?: string
  /** White-label (Phase V5.0): whether the tenant exposes the Platform Focus executive summary. */
  showPlatformFocus?: boolean
}

export default function ManagerCommandCenterSection({
  leagues,
  platformScopeLabel,
  showPlatformFocus = true,
}: ManagerCommandCenterSectionProps) {
  const [snapshot, setSnapshot] = useState<ManagerCommandCenterResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasLeagues = leagues.length > 0

  useEffect(() => {
    if (!hasLeagues) {
      setSnapshot(null)
      return
    }
    let cancelled = false
    setError(null)
    void fetch('/api/decision-os/manager-command-center', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<ManagerCommandCenterResponse>
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
  }, [hasLeagues])

  const leagueNameById = useMemo(() => new Map(leagues.map((league) => [league.id, league.name])), [leagues])

  // Composed directly from data this section already fetched — same zero-extra-fetch discipline
  // `CommissionerCommandCenterSection.tsx` established (see `docs/os/DAILY_BRIEF.md` §4).
  const brief = useMemo(
    () =>
      composeDailyBrief({
        leaguesMonitored: leagues.length,
        healthyLeagueCount: snapshot?.healthyLeagueCount ?? 0,
        draftsApproachingCount: snapshot?.draftsApproachingCount ?? 0,
        signals: snapshot?.attentionQueue ?? [],
        leagueTrends: snapshot?.leagueTrends ?? [],
      }),
    [snapshot, leagues.length],
  )

  // Phase OS-C6: production-readiness audit found this composition had no error handling — a
  // malformed signal/brief would throw inside this useMemo and crash the whole section (caught only
  // by the page-level error boundary, with zero record of which signal caused it). Wrapped so a
  // composition failure degrades this ONE card honestly (empty feed, logged) instead of taking down
  // the whole Multi-League Overview.
  const notifications = useMemo(() => {
    try {
      return composeNotificationFeed({ signals: snapshot?.attentionQueue ?? [], brief })
    } catch (err) {
      console.error('[ManagerCommandCenterSection] composeNotificationFeed failed:', err)
      return []
    }
  }, [snapshot, brief])

  const deliveryPlan = useMemo(() => {
    try {
      return resolveDeliveryPlan(notifications)
    } catch (err) {
      console.error('[ManagerCommandCenterSection] resolveDeliveryPlan failed:', err)
      return { generatedAt: new Date().toISOString(), entries: [], inApp: [] }
    }
  }, [notifications])

  // Phase OS-C3: found during live validation — separate empty Priority Module boxes stacked together
  // (the common case: not every manager has an active recommendation in every category every week) read
  // as clutter, the same "near-permanently-empty standalone card" anti-pattern OS-B6 already removed for
  // Commissioner OS's Recent Changes card. Collapses to ONE honest combined empty state only when ALL
  // categories are empty; any real content still renders each module individually.
  //
  // Phase V2.5: `waiver_opportunity` was removed from this set and its "Waiver Priorities" module
  // deleted — the Waiver OS workspace above now renders those exact recommendations as the dominant
  // Waiver Impact Sequence, so keeping the module too would show the same recommendations twice.
  const priorityCategories = new Set(['lineup_discipline', 'trade_coaching'])
  const hasAnyPriorities = (snapshot?.recommendations ?? []).some((entry) =>
    priorityCategories.has(entry.recommendation.category),
  )

  if (!hasLeagues) {
    return (
      <section data-testid="manager-command-center-section" className={decisionOsCardClassName}>
        <div className="p-5">
          <DecisionOsEmptyState
            icon={Compass}
            title="Your multi-league overview will appear here"
            description="Import or create a league to begin receiving executive insights — once you belong to at least one league, this becomes your default view of what needs attention across every team you play in."
          />
        </div>
      </section>
    )
  }

  // Phase V1.0: a small, additive loading affordance — the sub-cards below each already have their own
  // deliberate, tested "honest default" while the fetch is in flight (see
  // docs/os/VISUAL_OS_V1_AUDIT.md Finding 8), so this does NOT replace their content with a skeleton;
  // it only signals that the first real fetch hasn't resolved yet.
  const isLoading = !snapshot && !error

  return (
    <section
      data-testid="manager-command-center-section"
      className={decisionOsCardClassName}
      aria-label="Manager multi-league overview"
    >
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge icon={Compass}>Multi-League Overview</DecisionOsBadge>
          {isLoading ? (
            <span
              data-testid="manager-command-center-loading"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-primary" aria-hidden />
              Loading your overview…
            </span>
          ) : null}
        </div>
        <h2 className="mt-3 text-xl font-black tracking-tight text-primary">What needs your attention today?</h2>
        <p className="mt-1 text-xs leading-5 text-secondary">
          Across every team you play — select a league below to open its own dashboard.
        </p>
      </div>

      <div className="space-y-5 p-5">
        {error ? (
          <div
            data-testid="manager-command-center-error"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700"
          >
            {error}
          </div>
        ) : null}

        {/* Phase V2.7 — Platform OS Executive Analytics Workspace. The executive layer ABOVE the
            individual Operating Systems below: the Platform Focus flagship (dominant) answers "what
            requires my attention across my entire footprint?" and SUMMARIZES the Manager/Waiver/Draft
            workspaces that follow (open work per Operating System) — it does not duplicate them. No
            platform history/trend is reachable, so it is a current-state focus view, not a Pulse. */}
        {snapshot && showPlatformFocus ? (
          <section data-testid="platform-os-workspace" className="space-y-4" aria-label="Platform overview">
            <PlatformFocus snapshot={snapshot} draftsApproachingCount={snapshot.draftsApproachingCount} scopeLabel={platformScopeLabel} />
            <div className="grid gap-4 md:grid-cols-2">
              <ExecutiveWorkloadCard snapshot={snapshot} />
              <AttentionSummaryCard snapshot={snapshot} />
            </div>
          </section>
        ) : null}

        {/* Phase V2.2 — Manager OS Executive Analytics Workspace. The Championship Trajectory flagship
            (dominant) plus supporting graphs give the 10-second read of the manager's season; the
            existing overview + priority modules below remain the detailed, per-league drill-down the
            graphs summarize. Rendered once the snapshot has loaded (the loading badge above covers the
            in-flight state) so the supporting cards don't flash their unavailable states during fetch. */}
        {snapshot ? (
          <section data-testid="manager-executive-workspace" className="space-y-4" aria-label="Manager season workspace">
            <ChampionshipTrajectory snapshot={snapshot} />
            {/* Phase V3.1 (integration de-duplication): the Decision Focus card was removed — its
                by-category distribution is now owned by Platform OS's "where the work is" (rendered at
                the top of this hub), so keeping it here duplicated the same executive summary. */}
            <div className="grid gap-4 md:grid-cols-2">
              <WeeklyDecisionTimelineCard snapshot={snapshot} />
              <TeamRiskSummaryCard snapshot={snapshot} />
            </div>
          </section>
        ) : null}

        {/* Phase V2.5 — Waiver OS Executive Analytics Workspace. The Waiver Impact Sequence flagship
            (dominant) over Opportunity Impact + Waiver Urgency, all from the same already-fetched
            snapshot's waiver-category recommendations. It is an ordered priority sequence, NOT a
            timeline: no waiver deadlines/processing windows are reachable, so none are invented. This
            supersedes the old "Waiver Priorities" module (removed below to avoid duplicating the same
            recommendations across two cards). */}
        {snapshot ? (
          <section data-testid="waiver-os-workspace" className="space-y-4" aria-label="Waiver decision workspace">
            <WaiverImpactSequence snapshot={snapshot} />
            <div className="grid gap-4 md:grid-cols-2">
              <WaiverOpportunityImpactCard snapshot={snapshot} />
              <WaiverUrgencyCard snapshot={snapshot} />
            </div>
          </section>
        ) : null}

        {/* Phase V2.6 — Draft OS Executive Analytics Workspace. The Draft Decision Ladder flagship
            (dominant) over Draft Readiness + Preparation Impact, all from the same snapshot's
            `draft_preparation` recommendations + `draftsApproachingCount`. It is an ordered priority
            LADDER, NOT a value curve or pick timeline: no draft value/ADP/tier/pick data is reachable,
            so none is invented. */}
        {snapshot ? (
          <section data-testid="draft-os-workspace" className="space-y-4" aria-label="Draft decision workspace">
            <DraftDecisionLadder snapshot={snapshot} />
            <div className="grid gap-4 md:grid-cols-2">
              <DraftReadinessCard snapshot={snapshot} draftsApproachingCount={snapshot.draftsApproachingCount} />
              <DraftPreparationImpactCard snapshot={snapshot} />
            </div>
          </section>
        ) : null}

        <ManagerCommandCenterOverview
          totalLeagues={leagues.length}
          trackedLeagueCount={snapshot ? snapshot.totalLeagues - snapshot.unavailableLeagueCount : 0}
          leaguesNeedingAttentionCount={snapshot?.atRiskLeagueCount ?? 0}
          draftsApproachingCount={snapshot?.draftsApproachingCount ?? 0}
        />

        <TodaysBriefCard brief={brief} leagueNameById={leagueNameById} />

        <CommissionerAttentionQueue entries={snapshot?.attentionQueue ?? []} leagueNameById={leagueNameById} />

        {/* Phase OS-C2: Priority Modules — real Phase 6.4 manager-tier recommendations, grouped by
            their own real category. Same source data as the Attention Queue above (see
            docs/os/OS_C2_PRIORITIES_ARCHITECTURE_AUDIT.md for why this is intentional, not
            duplication). Phase OS-C3: collapsed to one combined empty state when all are empty —
            see the `hasAnyPriorities` comment above. Phase V2.5 removed the Waiver module (now the
            dominant Waiver Impact Sequence above). */}
        {hasAnyPriorities ? (
          <>
            <ManagerPriorityModule
              title="Lineup Priorities"
              icon={ListChecks}
              category="lineup_discipline"
              entries={snapshot?.recommendations ?? []}
              leagueNameById={leagueNameById}
              emptyMessage="No lineup priorities right now."
            />
            <ManagerPriorityModule
              title="Trade Priorities"
              icon={Repeat}
              category="trade_coaching"
              entries={snapshot?.recommendations ?? []}
              leagueNameById={leagueNameById}
              emptyMessage="No trade priorities right now."
            />
          </>
        ) : (
          <div
            className="flex items-center gap-2 rounded-xl border border-subtle bg-surface-muted px-4 py-3 text-sm text-muted"
            data-testid="manager-priorities-empty"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
            No lineup or trade priorities right now.
          </div>
        )}

        <NotificationCenter notifications={deliveryPlan.inApp} leagueNameById={leagueNameById} />

        <ManagerLeagueSwitcher leagues={leagues} />
      </div>
    </section>
  )
}
