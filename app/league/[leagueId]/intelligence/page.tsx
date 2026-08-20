/**
 * `/league/[leagueId]/intelligence` — the per-league commissioner surface.
 *
 * Was a thin client shell around `CommissionerIntelligenceHub` (G15.6's
 * read-only module stack). It now renders handoffs 11b (league health + manager
 * health) and 11d (rivalries + universal messaging + audit log) above that stack,
 * on the same route. See CommissionerConsole.tsx for why these are folded in here
 * rather than given the routes the handoffs name.
 *
 * ⚠ SERVER COMPONENT NOW, AND THAT IS THE POINT. The health snapshot, the
 * per-manager rows, the rivalry board and the audit log are four independent
 * database reads. Doing them here means one round trip and — more importantly —
 * it means the commissioner gate runs before any of this data is assembled,
 * rather than a client bundle asking four endpoints and hoping each one gates
 * itself.
 *
 * ⚠ A NON-COMMISSIONER STILL GETS THE PAGE, JUST NOT THE CONSOLE. Manager health,
 * integrity-adjacent signals and the audit log are commissioner-only; the
 * existing intelligence modules below already gate themselves per module and are
 * useful to any member. So the gate hides the console and leaves the rest,
 * instead of 403-ing a page members could always reach.
 */

import Link from 'next/link'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { buildCommissionerHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { getRivalryBoard } from '@/lib/rivalry-engine/rivalryBoard'
import { CommissionerIntelligenceHub } from '@/components/commissioner-intelligence/CommissionerIntelligenceHub'
import CommissionerConsole from './CommissionerConsole'
import type { FlaggedSignal, Intervention } from '@/components/commish/HealthScoreCard'
import type { StatTile } from '@/components/commish/StatTiles'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-commish.css'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ leagueId: string }> }

/**
 * Risk scores are inverted relative to health: 45 churn risk is bad, 45 health is
 * middling. Tone therefore reads the other way round, and getting this backwards
 * would paint the worst league green.
 */
function riskTone(value: number | null): 'good' | 'warn' | 'bad' | undefined {
  if (value == null) return undefined
  if (value >= 60) return 'bad'
  if (value >= 35) return 'warn'
  return 'good'
}

export default async function LeagueIntelligencePage({ params }: PageProps) {
  const { leagueId } = await params

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''

  const commish = userId ? await isCommissioner(leagueId, userId).catch(() => false) : false

  let console_: React.ReactNode = null

  if (commish) {
    /*
     * The same select `getCommissionerHubHealthForUser` uses, for one league.
     * Reusing `buildCommissionerHealthSnapshot` rather than re-deriving a score
     * here is what keeps 11a's ranking and this detail view in agreement.
     */
    const league = await prisma.league
      .findUnique({
        where: { id: leagueId },
        select: {
          id: true,
          name: true,
          sport: true,
          season: true,
          leagueSize: true,
          status: true,
          lifecycleState: true,
          leagueType: true,
          isDynasty: true,
          scoring: true,
          settings: true,
          starters: true,
          waiverType: true,
          tradeReviewHours: true,
          playoffTeams: true,
          lockAllMoves: true,
          lastSyncedAt: true,
          rosters: { select: { id: true, platformUserId: true, playerData: true, updatedAt: true, settings: true } },
        },
      })
      .catch(() => null)

    if (league) {
      const [managerHealth, rivalryBoard, auditRows, commissionedLeagues] = await Promise.all([
        getLeagueManagerHealth(leagueId).catch(() => ({
          leagueId,
          rows: [],
          totalManagers: 0,
          inactiveCount: 0,
          atRiskCount: 0,
        })),
        getRivalryBoard(leagueId).catch(() => ({ leagueId, rows: [], seasonsCovered: 0 })),
        prisma.leagueAuditLog
          .findMany({
            where: { leagueId },
            orderBy: { createdAt: 'desc' },
            take: 8,
            select: { id: true, actionType: true, entityType: true, createdAt: true },
          })
          .catch(() => [] as Array<{ id: string; actionType: string; entityType: string; createdAt: Date }>),
        /*
         * The broadcast blast radius. `League.userId` is the ownership column
         * `/api/chat/global-broadcast` itself filters on, so this count is the
         * same set that endpoint would accept — the label cannot promise a
         * league the send would reject.
         */
        prisma.league
          .findMany({ where: { userId }, select: { id: true } })
          .catch(() => [] as Array<{ id: string }>),
      ])

      const snapshot = buildCommissionerHealthSnapshot({ league, source: 'database' })

      /*
       * ⚠ A LOW-CONFIDENCE SNAPSHOT PUBLISHES NO SCORE. `dataConfidence: 'low'`
       * is what the builder emits for a league it could not read properly —
       * including one that has never synced. Showing its computed score anyway
       * would be exactly the "guessed score" 11a and 11b both forbid.
       */
      const withhold = snapshot.dataConfidence === 'low' || !league.lastSyncedAt


      /*
       * ⚠ AN INTERVENTION IS PAIRED BY MEANING, NEVER BY POSITION. Build rule 3
       * says each recommendation gets the button that performs it. The first
       * attempt here zipped `recommendations[i]` against `enabledActions[i]`, and
       * against a real league that rendered "Post weekly recaps ... to boost
       * engagement" beside a **Force Lineup** button — a destructive commissioner
       * override offered as the fix for a morale problem. Positional pairing of
       * two independently-ordered lists is always a coincidence.
       *
       * So each recommendation is matched on its own words. Anything that finds
       * no honest destination is NOT rendered as an intervention with a
       * mismatched button; it falls through to the flagged-signals list below,
       * where advice is allowed to be text.
       */
      const enabledActions = snapshot.actions.filter((a) => a.enabled && a.href)
      type ActionKey = (typeof enabledActions)[number]['key']
      const actionByKey = new Map<ActionKey, (typeof enabledActions)[number]>(
        enabledActions.map((a) => [a.key, a]),
      )

      const matchIntervention = (text: string): Omit<Intervention, 'primary'> | null => {
        const t = text.toLowerCase()
        const use = (key: ActionKey) => {
          const a = actionByKey.get(key)
          return a ? { text, ctaLabel: a.label, href: a.href } : null
        }
        if (t.includes('lineup')) return use('force_lineup')
        if (t.includes('waiver')) return use('process_waivers')
        if (t.includes('trade')) return use('reverse_trade')
        if (t.includes('scor')) return use('adjust_scores')
        if (t.includes('setting') || t.includes('rule') || t.includes('playoff')) return use('settings')
        /*
         * Engagement advice — recaps, power rankings, trash talk, "post an
         * update". The button that performs it is the league chat, which is a
         * real destination rather than a commissioner override.
         */
        if (
          t.includes('recap') ||
          t.includes('engagement') ||
          t.includes('post') ||
          t.includes('rankings') ||
          t.includes('message') ||
          t.includes('chat')
        ) {
          return { text, ctaLabel: 'Open chat', href: `/app/league/${leagueId}` }
        }
        return null
      }

      const matched = snapshot.recommendations
        .map(matchIntervention)
        .filter((x): x is Omit<Intervention, 'primary'> => x != null)
      const interventions: Intervention[] = matched.map((x, i) => ({ ...x, primary: i === 0 }))
      const unpairedAdvice = snapshot.recommendations.filter((text) => matchIntervention(text) == null)

      /*
       * The three engine risk scores, each with a footline naming what it counted
       * so the number is checkable rather than oracular. All three are withheld
       * together with the headline score — a risk figure derived from a league we
       * could not read is the same guess the score itself would be.
       */
      const signals: FlaggedSignal[] = [
        ...snapshot.alerts.map((text) => ({ tone: 'bad' as const, text })),
        /*
         * Advice with no button lands here rather than being dropped — a
         * recommendation is still worth reading when we have nowhere to send the
         * commissioner, it just is not an "intervention".
         */
        ...unpairedAdvice.map((text) => ({ tone: 'none' as const, text })),
        /*
         * Build rule 2: the list is not only problems. A confirming item appears
         * whenever one is true, so the panel is not purely a list of failures.
         */
        ...(snapshot.fairnessScore >= 70
          ? [{ tone: 'good' as const, text: `Fair structure — fairness scores ${Math.round(snapshot.fairnessScore)}.` }]
          : []),
      ]

      const riskTiles: StatTile[] = [
        {
          key: 'churn',
          label: 'Churn risk',
          value: withhold ? null : Math.round(snapshot.churnRiskScore),
          foot: 'managers not returning',
          tone: riskTone(withhold ? null : snapshot.churnRiskScore),
        },
        {
          key: 'disputes',
          label: 'Dispute risk',
          value: withhold ? null : Math.round(snapshot.disputeRiskScore),
          foot: `${snapshot.metrics.openAiAlerts} open alert${snapshot.metrics.openAiAlerts === 1 ? '' : 's'}, ${snapshot.metrics.pendingTrades} pending trade${snapshot.metrics.pendingTrades === 1 ? '' : 's'}`,
          tone: riskTone(withhold ? null : snapshot.disputeRiskScore),
        },
        {
          /*
           * ⚠ VALUE AND FOOTLINE COME FROM THE SAME COMPUTATION. This tile
           * briefly read `0` above the words "12 inactive of 12", because the
           * score came from the engine and the footline came from the per-manager
           * table, which was then using a different inactivity rule. Both now
           * read `snapshot.metrics.inactiveTeams` — the exact input the
           * abandonment score was computed from.
           */
          key: 'abandonment',
          label: 'Abandonment',
          value: withhold ? null : Math.round(snapshot.abandonmentRiskScore),
          foot:
            snapshot.metrics.inactiveTeams === 0
              ? 'no abandoned teams'
              : `${snapshot.metrics.inactiveTeams} inactive of ${snapshot.teamCount}`,
          tone: riskTone(withhold ? null : snapshot.abandonmentRiskScore),
        },
      ]

      console_ = (
        <CommissionerConsole
          leagueId={leagueId}
          leagueName={snapshot.leagueName}
          lastSyncedAt={league.lastSyncedAt ? league.lastSyncedAt.toISOString() : null}
          score={{
            score: withhold ? null : snapshot.healthScore,
            status: snapshot.overallStatus,
            trend: snapshot.healthTrend,
            engagement: withhold ? null : snapshot.engagementScore,
            fairness: withhold ? null : snapshot.fairnessScore,
            sustainability: withhold ? null : snapshot.sustainabilityScore,
            confidencePct: withhold ? null : snapshot.confidencePct,
            teamCount: snapshot.teamCount || null,
            currentWeek: snapshot.currentWeek || null,
            totalWeeks: null,
            unavailableReason: withhold
              ? league.lastSyncedAt
                ? 'Not enough synced data to score this league yet — no score is shown rather than a guessed one.'
                : 'This league has never synced, so no score is shown rather than a guessed one.'
              : null,
          }}
          riskTiles={riskTiles}
          signals={signals}
          interventions={interventions}
          managers={managerHealth.rows}
          rivalries={rivalryBoard.rows}
          seasonsCovered={rivalryBoard.seasonsCovered}
          audit={auditRows.map((a) => ({
            id: a.id,
            actionType: a.actionType,
            entityType: a.entityType,
            createdAt: a.createdAt.toISOString(),
          }))}
          messagingScope={{
            leagueIds: commissionedLeagues.map((l) => l.id),
            inactiveManagerCount: managerHealth.inactiveCount,
          }}
        />
      )
    }
  }

  return (
    <div>
      <div className="mx-auto max-w-3xl px-4 pt-4">
        <Link href={`/league/${leagueId}`} className="text-xs text-cyan-300/90 hover:underline">
          ← Back to league
        </Link>
      </div>
      {console_}
      <CommissionerIntelligenceHub leagueId={leagueId} />
    </div>
  )
}
