'use client'

import Link from 'next/link'
import type { OverviewSectionData } from '@/lib/league-command-center/sections/overview'
import type { MatchupsSectionData } from '@/lib/league-command-center/sections/matchups'
import type { StandingsSectionData } from '@/lib/league-command-center/sections/standings'
import type { CommandCenterViewModel } from '@/lib/league-command-center/types'
import { LayerSection } from '../primitives/LayerSection'
import { Badge, DegradationNotice, EmptyState, KeyValueList, Panel } from '../primitives/Panel'
import { EntitlementGate } from '../primitives/EntitlementGate'
import { DecisionOsFooter, type ChimmyChip } from '../primitives/DecisionOsFooter'
import type { AIContextSource } from '@/lib/chimmy-chat/types'

/**
 * Overview — the role-aware landing page.
 *
 * Layer order is the whole point of this screen: a commissioner lands here and
 * sees THEIR team first, the league second, and their ops queue third. The
 * commissioner tools are unmistakably present (gold, labelled, distinct) but
 * they sit below a personal snapshot that is byte-for-byte what a regular
 * manager gets.
 */

function HealthRing({ score, label }: { score: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, score))
  const tone =
    clamped >= 75 ? 'var(--cc-good)' : clamped >= 50 ? 'var(--cc-ops)' : 'var(--cc-bad)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div
        style={{
          width: 92,
          height: 92,
          borderRadius: '50%',
          flex: 'none',
          background: `conic-gradient(${tone} ${clamped * 3.6}deg, var(--cc-border) 0deg)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        role="img"
        aria-label={`League health ${clamped} out of 100`}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'var(--cc-panel)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="af-cc-num" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
            {clamped}
          </span>
          <span style={{ fontSize: 9, color: 'var(--cc-text-5)', textTransform: 'uppercase' }}>
            / 100
          </span>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{label}</div>
      </div>
    </div>
  )
}

export interface OverviewSectionProps {
  viewModel: CommandCenterViewModel
  data: OverviewSectionData
  matchups: MatchupsSectionData
  standings: StandingsSectionData
  onAskChimmy: (chip: ChimmyChip, source: AIContextSource) => void
}

export function OverviewSection({
  viewModel,
  data,
  matchups,
  standings,
  onAskChimmy,
}: OverviewSectionProps) {
  const { league, viewer, source, entitlement } = viewModel
  const ccHref = `/league/${league.leagueId}/command-center`
  const viewerRow = standings.viewerRow
  const viewerMatchup = matchups.viewerMatchup
  const health = data.health

  // ── Layer 1: my team snapshot (always first, every role) ────────────────────
  const personal = (
    <Panel
      title="My team"
      subtitle={viewer.teamName ? undefined : 'You have not claimed a team in this league.'}
      actions={
        viewerRow ? (
          <Badge tone="brand">
            #{viewerRow.rank} of {standings.rows.length}
          </Badge>
        ) : null
      }
    >
      {viewer.teamName || viewerRow ? (
        <>
          <div className="af-cc-grid-3" style={{ marginBottom: 16 }}>
            <div>
              <div className="af-cc-num" style={{ fontSize: 26, fontWeight: 800 }}>
                {viewerRow
                  ? `${viewerRow.wins}-${viewerRow.losses}${viewerRow.ties > 0 ? `-${viewerRow.ties}` : ''}`
                  : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cc-text-4)' }}>Record</div>
            </div>
            <div>
              <div className="af-cc-num" style={{ fontSize: 26, fontWeight: 800 }}>
                {viewerRow ? viewerRow.pointsFor.toFixed(0) : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cc-text-4)' }}>Points for</div>
            </div>
            <div>
              <div className="af-cc-num" style={{ fontSize: 26, fontWeight: 800 }}>
                {viewerRow?.streak ?? '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cc-text-4)' }}>Streak</div>
            </div>
          </div>

          {viewerMatchup ? (
            <div
              style={{
                border: '1px solid var(--cc-border)',
                borderRadius: 'var(--cc-r-md)',
                padding: 14,
                background: 'var(--cc-panel-raised)',
              }}
            >
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--cc-text-4)', marginBottom: 8, fontWeight: 700 }}>
                This week
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {viewerMatchup.home.teamName}
                    {viewerMatchup.away ? ` vs ${viewerMatchup.away.teamName}` : ' — bye'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--cc-text-4)' }}>
                    Week {viewerMatchup.week} ·{' '}
                    {viewerMatchup.status === 'final'
                      ? 'Final'
                      : viewerMatchup.status === 'active'
                        ? 'Live'
                        : 'Upcoming'}
                  </div>
                </div>
                <div className="af-cc-num" style={{ fontSize: 20, fontWeight: 800, whiteSpace: 'nowrap' }}>
                  {viewerMatchup.home.score.toFixed(1)}
                  {viewerMatchup.away ? ` – ${viewerMatchup.away.score.toFixed(1)}` : ''}
                </div>
              </div>
              <Link
                href={`${ccHref}?section=matchups`}
                className="af-cc-action"
                style={{ marginTop: 12 }}
              >
                <i className="ph ph-flag-checkered" aria-hidden="true" />
                Open matchup
              </Link>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--cc-text-4)', margin: 0 }}>
              No matchup scheduled for you this week.
            </p>
          )}
        </>
      ) : (
        <EmptyState
          icon="ph-user-focus"
          title="No team claimed"
          body="Claim your team to see your record, matchup, and personalized recommendations here."
        />
      )}
    </Panel>
  )

  // ── Layer 2: shared league state ────────────────────────────────────────────
  const shared = (
    <div className="af-cc-stack">
      <Panel title="League health">
        <EntitlementGate access={entitlement.intelligence} lockedMode="placeholder" minHeight={190}>
          {health ? (
            <>
              <HealthRing score={health.score} label={health.overallStatus} />
              <p style={{ fontSize: 12.5, color: 'var(--cc-text-3)', lineHeight: 1.6, margin: '14px 0 0' }}>
                {health.summary}
              </p>

              <div className="af-cc-grid-3" style={{ marginTop: 16 }}>
                {[
                  { label: 'Engagement', value: health.engagementScore },
                  { label: 'Fairness', value: health.fairnessScore },
                  { label: 'Sustainability', value: health.sustainabilityScore },
                ].map((metric) => (
                  <div key={metric.label}>
                    <div className="af-cc-num" style={{ fontSize: 19, fontWeight: 800 }}>
                      {metric.value}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--cc-text-4)' }}>{metric.label}</div>
                  </div>
                ))}
              </div>

              {/*
                * Coverage is stated, not implied. The scoring engine mixes real
                * Decision OS signals with schema defaults, and presenting the
                * composite without saying so would overstate how measured it is.
                */}
              <p style={{ fontSize: 10.5, color: 'var(--cc-text-5)', margin: '14px 0 0', lineHeight: 1.5 }}>
                Based on {health.realSignalCount} of {health.totalSignalCount} scoring inputs measured
                from real league activity ({health.confidencePct}% engine confidence). Remaining inputs
                use defaults.
              </p>
            </>
          ) : (
            <EmptyState
              icon="ph-heart-straight"
              title="League health is unavailable"
              body={
                data.warnings[0] ??
                'Not enough league activity has been recorded to calculate a health score yet.'
              }
            />
          )}
        </EntitlementGate>
      </Panel>

      <Panel title="Around the league">
        <KeyValueList
          rows={[
            { label: 'Teams', value: standings.rows.length > 0 ? standings.rows.length : null },
            {
              label: 'Leader',
              value: standings.rows[0]
                ? `${standings.rows[0].teamName} (${standings.rows[0].wins}-${standings.rows[0].losses})`
                : null,
            },
            { label: 'Week', value: matchups.week },
            {
              label: 'Live games',
              value:
                matchups.matchups.length > 0
                  ? matchups.matchups.filter((m) => m.status === 'active').length
                  : null,
            },
            { label: 'Data source', value: `${source.label} · ${source.trustDetail}` },
          ]}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Link href={`${ccHref}?section=standings`} className="af-cc-action">
            <i className="ph ph-list-numbers" aria-hidden="true" />
            Standings
          </Link>
          <Link href={`${ccHref}?section=matchups`} className="af-cc-action">
            <i className="ph ph-flag-checkered" aria-hidden="true" />
            Matchups
          </Link>
        </div>
      </Panel>
    </div>
  )

  // ── Layer 3: commissioner operations (additive) ─────────────────────────────
  const commissionerOps = (
    <div className="af-cc-stack">
      <Panel title="Operations snapshot" subtitle="Real activity signals from this league.">
        <EntitlementGate access={entitlement.intelligence} lockedMode="placeholder" minHeight={150}>
          {health ? (
            <KeyValueList
              rows={[
                { label: 'Active managers', value: health.activeManagerCount },
                {
                  label: 'Inactive managers',
                  value: health.inactiveManagerCount,
                  tone: health.inactiveManagerCount > 0 ? 'warn' : 'default',
                },
                {
                  label: 'Managers at retention risk',
                  value: health.managersAtRiskCount,
                  tone: health.managersAtRiskCount > 0 ? 'bad' : 'good',
                },
                { label: 'Trades this season', value: health.tradeCount },
                { label: 'Waiver claims', value: health.waiverClaimCount },
              ]}
            />
          ) : (
            <EmptyState icon="ph-gauge" title="No activity signals available yet" />
          )}
        </EntitlementGate>
      </Panel>

      {health && (health.urgentAlerts.length > 0 || health.interventionRecommendations.length > 0) ? (
        <Panel title="Attention queue" subtitle="What the health engine flagged for a commissioner.">
          <EntitlementGate access={entitlement.intelligence} lockedMode="placeholder" minHeight={120}>
            <div className="af-cc-stack" style={{ gap: 10 }}>
              {health.urgentAlerts.map((alert) => (
                <div
                  key={alert}
                  style={{
                    display: 'flex',
                    gap: 9,
                    fontSize: 12.5,
                    color: 'var(--cc-text-2)',
                    lineHeight: 1.5,
                  }}
                >
                  <i
                    className="ph ph-warning-circle"
                    style={{ color: 'var(--cc-bad)', flex: 'none', marginTop: 2 }}
                    aria-hidden="true"
                  />
                  <span>{alert}</span>
                </div>
              ))}
              {health.interventionRecommendations.map((rec) => (
                <div
                  key={rec}
                  style={{
                    display: 'flex',
                    gap: 9,
                    fontSize: 12.5,
                    color: 'var(--cc-text-3)',
                    lineHeight: 1.5,
                  }}
                >
                  <i
                    className="ph ph-lightbulb"
                    style={{ color: 'var(--cc-ops)', flex: 'none', marginTop: 2 }}
                    aria-hidden="true"
                  />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </EntitlementGate>
        </Panel>
      ) : null}
    </div>
  )

  const chips: ChimmyChip[] = [
    {
      id: 'my-week',
      label: 'What should I do this week?',
      prompt: `Give me a prioritized list of what I should do this week in ${league.name} — lineup, waivers, and trades.`,
      insightType: 'matchup',
    },
    {
      id: 'team-outlook',
      label: 'How is my team trending?',
      prompt: `Assess my team in ${league.name}. Am I a contender, and what is my biggest weakness?`,
      insightType: 'playoff',
    },
    ...(viewer.isCommissioner
      ? [
          {
            id: 'league-health',
            label: 'How healthy is my league?',
            prompt: `Review the health of ${league.name} as its commissioner. What needs my attention, and what should I do about it?`,
          } satisfies ChimmyChip,
        ]
      : []),
  ]

  return (
    <div className="af-cc-stack">
      <DegradationNotice warnings={[...viewModel.warnings, ...data.warnings]} />

      <LayerSection
        role={viewer.role}
        labels={{ personal: 'Your team', shared: 'Your league' }}
        personal={personal}
        shared={shared}
        commissionerOps={commissionerOps}
      />

      <DecisionOsFooter
        title="Decision OS — Overview"
        source="dashboard"
        onAskChimmy={onAskChimmy}
        rows={[
          {
            label: 'Your record',
            value: viewerRow
              ? `${viewerRow.wins}-${viewerRow.losses}${viewerRow.ties > 0 ? `-${viewerRow.ties}` : ''}`
              : null,
          },
          { label: 'League health', value: health ? `${health.score}/100` : null },
          {
            label: 'Needs attention',
            value: health ? health.urgentAlerts.length : null,
            tone: health && health.urgentAlerts.length > 0 ? 'warn' : 'default',
          },
        ]}
        chips={chips}
        unavailableNote={
          !health && entitlement.intelligence.allowed
            ? 'League health could not be calculated, so the Decision OS summary is partial.'
            : null
        }
      />
    </div>
  )
}

export default OverviewSection
