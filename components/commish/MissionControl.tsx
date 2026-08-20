'use client'

/**
 * 11a — Mission control. The cross-league landing block for anyone commissioning
 * one or more AF-hosted leagues.
 *
 * ⚠ FOLDED INTO `/commissioner-hub`, WHICH IS ALREADY THIS PAGE. The handoff
 * names `/commissioner`; that route does not exist and this repo is close to
 * Vercel's route ceiling with a standing rule against adding more. The hub was
 * already the cross-league commissioner landing, so mission control renders at
 * the top of it.
 *
 * ⚠ THE QUEUE IS RANKED ACROSS LEAGUES, NOT GROUPED BY THEM. Build rule 1. The
 * page already carried a "Commissioner Mission Queue" — but it was a static grid
 * of navigation cards ("Create League", "Import League") with a hand-assigned
 * `priority` field, i.e. a menu wearing a queue's name. This is the real thing:
 * every row is a condition observed in a specific league right now, and the
 * ordering is severity across all of them.
 *
 * ⚠ EVERY ROW IS DERIVED FROM A REAL SNAPSHOT FIELD. Nothing here is sampled,
 * estimated or seeded. A league whose snapshot came back low-confidence produces
 * exactly one row — the dashed "health is unavailable" re-sync row — and
 * contributes to none of the counts above it, because a league we could not read
 * must not be quietly counted as healthy.
 *
 * ⚠ CHIMMY'S CARD IS DERIVED, NOT GENERATED. It restates the top-ranked queue row
 * and the reason it outranks the rest. No model call: this block renders on every
 * page load, and per the product direction AI generation is on-demand only.
 * Build rule 4 also wants exactly one recommendation here — the queue below it
 * already provides the ranking, so a second ranked list would be noise.
 */

import Link from 'next/link'
import { useMemo } from 'react'

import type { UserLeague } from '@/app/dashboard/types'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import AttentionQueue, { rankQueue, type AttentionItem } from './AttentionQueue'
import StatTiles, { type StatTile } from './StatTiles'
import HealthRanking, { ActivityTrend, type HealthRankRow, type TrendRow } from './HealthRanking'

function badgeFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '··'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function isHealthy(status: string): boolean {
  return status === 'healthy' || status === 'excellent'
}

function isAtRisk(status: string): boolean {
  return status === 'at_risk' || status === 'critical'
}

/** A league whose snapshot could not be trusted. Counted nowhere, queued once. */
function isUnreadable(s: CommissionerLeagueHealthSnapshot): boolean {
  return s.dataConfidence === 'low' || s.source === 'dashboard-fallback'
}

export function MissionControl({
  leagues,
  snapshots,
  onBroadcast,
}: {
  leagues: UserLeague[]
  snapshots: CommissionerLeagueHealthSnapshot[]
  onBroadcast?: () => void
}) {
  const commissioned = useMemo(() => leagues.filter((l) => l.isCommissioner), [leagues])
  const leagueById = useMemo(() => new Map(commissioned.map((l) => [l.id, l])), [commissioned])

  const readable = useMemo(() => snapshots.filter((s) => !isUnreadable(s)), [snapshots])
  const unreadable = useMemo(() => snapshots.filter(isUnreadable), [snapshots])

  const tiles: StatTile[] = useMemo(() => {
    const healthy = readable.filter((s) => isHealthy(s.overallStatus))
    const atRisk = readable.filter((s) => isAtRisk(s.overallStatus))
    const inactiveManagers = readable.reduce((sum, s) => sum + (s.metrics.inactiveTeams ?? 0), 0)
    const totalManagers = readable.reduce((sum, s) => sum + (s.teamCount ?? 0), 0)
    /*
     * ⚠ RETENTION RISK COUNTS LEAGUES, NOT MANAGERS, AND THE FOOTLINE SAYS SO.
     * The design's tile reads "N managers · reach out this week". There is no
     * per-manager churn score anywhere in this codebase — `churnRiskScore` is
     * computed per league by `monitorLeagueHealth`. Rendering a league count
     * under a manager-shaped label would be a fabricated denominator, so the
     * number is real and the label describes what it actually counted.
     */
    const churningLeagues = readable.filter((s) => s.churnRiskScore >= 60)

    return [
      {
        key: 'leagues',
        label: 'Leagues',
        value: commissioned.length,
        foot: 'you commission',
      },
      {
        key: 'healthy',
        label: 'Healthy',
        value: readable.length > 0 ? healthy.length : null,
        foot: healthy.length === 1 ? (healthy[0]?.leagueName ?? 'scored healthy') : 'scored healthy',
        tone: healthy.length > 0 ? 'good' : undefined,
      },
      {
        key: 'at-risk',
        label: 'At risk',
        value: readable.length > 0 ? atRisk.length : null,
        foot: atRisk.length === 1 ? (atRisk[0]?.leagueName ?? 'needs attention') : 'need attention',
        // Zero at-risk leagues is good news; an amber outline around a `0` reads as a warning.
        tone: atRisk.length > 0 ? 'warn' : undefined,
      },
      {
        key: 'inactive',
        label: 'Inactive',
        value: readable.length > 0 ? inactiveManagers : null,
        foot: totalManagers > 0 ? `of ${totalManagers} managers` : 'managers',
        tone: inactiveManagers > 0 ? 'warn' : undefined,
        help: 'Teams with no recent lineup or transaction activity, summed across every league you commission. Leagues that could not be read are excluded.',
      },
      {
        key: 'retention',
        label: 'Retention risk',
        value: readable.length > 0 ? churningLeagues.length : null,
        foot: churningLeagues.length === 1 ? 'league losing managers' : 'leagues losing managers',
        tone: churningLeagues.length > 0 ? 'bad' : undefined,
        help: 'Leagues whose churn-risk score is 60 or higher. Churn risk is scored per league, not per manager — there is no per-manager score to report.',
      },
    ]
  }, [commissioned.length, readable])

  const queue: AttentionItem[] = useMemo(() => {
    const items: AttentionItem[] = []

    for (const s of readable) {
      const league = leagueById.get(s.leagueId)
      const name = s.leagueName || league?.name || 'League'

      // Abandoned teams — the only condition that outranks everything else.
      if (s.metrics.inactiveTeams >= 2) {
        items.push({
          key: `${s.leagueId}-abandoned`,
          severity: 'critical',
          icon: '!',
          title: `${s.metrics.inactiveTeams} inactive teams in ${name}`,
          desc: 'No recent lineup or transaction activity. Replacement managers may be needed.',
          actionLabel: 'Open',
          href: `/league/${s.leagueId}/orphan-teams`,
        })
      } else if (s.metrics.inactiveTeams === 1) {
        items.push({
          key: `${s.leagueId}-abandoned`,
          severity: 'high',
          icon: '!',
          title: `An inactive team in ${name}`,
          desc: 'One manager has stopped setting lineups or making moves.',
          actionLabel: 'Open',
          href: `/league/${s.leagueId}/orphan-teams`,
        })
      }

      // Open AI/integrity alerts — the review surface, not the fix surface.
      if (s.metrics.openAiAlerts > 0) {
        items.push({
          key: `${s.leagueId}-alerts`,
          severity: 'high',
          icon: '◆',
          title: `${s.metrics.openAiAlerts} open integrity alert${s.metrics.openAiAlerts === 1 ? '' : 's'} — ${name}`,
          desc: 'Flagged from trade values and lineup cards. Manual review recommended.',
          actionLabel: 'Review',
          href: `/league/${s.leagueId}/commissioner/integrity`,
        })
      }

      if (s.metrics.pendingTrades > 0) {
        items.push({
          key: `${s.leagueId}-trades`,
          severity: 'medium',
          icon: '⇄',
          title: `${s.metrics.pendingTrades} trade${s.metrics.pendingTrades === 1 ? '' : 's'} awaiting review`,
          desc: `${name} · pending commissioner decision.`,
          actionLabel: 'Review',
          href: `/league/${s.leagueId}`,
        })
      }

      if (s.metrics.pendingWaiverClaims > 0) {
        items.push({
          key: `${s.leagueId}-waivers`,
          severity: 'medium',
          icon: '◷',
          title: `${s.metrics.pendingWaiverClaims} waiver claim${s.metrics.pendingWaiverClaims === 1 ? '' : 's'} pending`,
          desc: `${name} · claims are queued and have not processed.`,
          actionLabel: 'Process',
          href: `/league/${s.leagueId}`,
        })
      }

      // Draft setup — a deadline, so it queues even when nothing is wrong.
      const lifecycle = (league?.status ?? s.status ?? '').toString().toLowerCase()
      if (lifecycle.includes('pre_draft') && !league?.draftDate) {
        items.push({
          key: `${s.leagueId}-draft`,
          severity: 'medium',
          icon: '◉',
          title: `${name} has no draft date set`,
          desc: 'Managers cannot plan around a draft that has not been scheduled.',
          actionLabel: 'Set up',
          href: `/league/${s.leagueId}/settings`,
        })
      }
    }

    /*
     * ⚠ ONE DASHED ROW PER UNREADABLE LEAGUE, AND NO SEVERITY TAG. Build rule 3.
     * This is the row that stops the screen from lying: rather than dropping the
     * league silently (which reads as "nothing wrong there") or scoring it from
     * missing data (which reads as "it's bad"), it says plainly that we could not
     * read it and offers the only action that helps.
     */
    for (const s of unreadable) {
      const name = s.leagueName || leagueById.get(s.leagueId)?.name || 'League'
      items.push({
        key: `${s.leagueId}-sync`,
        severity: 'unavailable',
        icon: '⊘',
        title: `${name} health is unavailable`,
        desc: 'This league has not synced successfully — no score is shown rather than a guessed one.',
        actionLabel: 'Re-sync',
        href: `/league/${s.leagueId}/settings`,
      })
    }

    return items
  }, [readable, unreadable, leagueById])

  const rankRows: HealthRankRow[] = useMemo(
    () =>
      snapshots.map((s) => ({
        leagueId: s.leagueId,
        name: s.leagueName,
        badge: badgeFor(s.leagueName),
        score: isUnreadable(s) ? null : s.healthScore,
        subtitle: isUnreadable(s)
          ? 'insufficient evidence'
          : `${s.overallStatus.replace(/_/g, ' ')} · ${s.healthTrend}`,
        href: `/league/${s.leagueId}/intelligence`,
      })),
    [snapshots],
  )

  const trendRows: TrendRow[] = useMemo(
    () =>
      snapshots.map((s) => ({
        leagueId: s.leagueId,
        name: s.leagueName,
        /*
         * Net 7-day activity: the three transaction/chat counters the snapshot
         * already windows to seven days. Not a delta against a prior week — the
         * snapshot carries no history — so it is presented as a volume, and a
         * league we could not read reports nothing at all.
         */
        delta: isUnreadable(s)
          ? null
          : s.metrics.tradeActivity + s.metrics.waiverActivity + s.metrics.chatMessagesLast7Days,
      })),
    [snapshots],
  )

  // Build rule 4: exactly one recommendation, restating the top of the queue.
  const top = useMemo(() => rankQueue(queue)[0] ?? null, [queue])

  if (commissioned.length === 0) return null

  return (
    <section className="af-core af-cm-shell" style={{ minHeight: 0, padding: 0, background: 'transparent' }}>
      <div className="af-cm">
        <header className="af-cm-head">
          <div className="af-cm-head-titles">
            <h2 className="af-cm-title">Mission control</h2>
            <span className="af-cm-sub">All leagues you commission</span>
          </div>
          {onBroadcast ? (
            <div className="af-cm-head-actions">
              <button type="button" className="af-btn" onClick={onBroadcast}>
                Send @everyone
              </button>
            </div>
          ) : null}
        </header>

        <StatTiles tiles={tiles} />

        <div className="af-cm-body">
          <main>
            <div className="af-cm-section-head">
              <h3 className="af-cm-section-title">Attention queue</h3>
              <span className="af-cm-section-hint">
                Ranked across all {commissioned.length === 1 ? 'your leagues' : `${commissioned.length} leagues`}, most
                severe first.
              </span>
            </div>
            <AttentionQueue items={queue} />
          </main>

          <aside className="af-cm-rail">
            <HealthRanking rows={rankRows} />
            <ActivityTrend rows={trendRows} />

            {top ? (
              <div className="af-cm-chimmy">
                <div className="af-cm-chimmy-head">
                  <span className="af-cm-chimmy-label">Chimmy intelligence</span>
                </div>
                <p className="af-cm-chimmy-lead">
                  {top.severity === 'unavailable'
                    ? `Re-sync first — ${top.title.replace(' health is unavailable', '')} cannot be scored until it does.`
                    : `Start with: ${top.title}.`}
                </p>
                <p className="af-cm-chimmy-why">
                  {top.severity === 'unavailable'
                    ? 'Everything else on this screen excludes that league, so the counts above are incomplete until the sync succeeds.'
                    : `${top.desc} It outranks everything else in the queue, so the rest can wait.`}
                </p>
              </div>
            ) : null}
          </aside>
        </div>

        <div className="af-cm-foot">
          <span>Every commissioner action is written to the audit log with a timestamp.</span>
          {commissioned.length === 1 ? (
            <Link href={`/league/${commissioned[0].id}/intelligence`} className="af-cm-foot-link">
              View log →
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default MissionControl
