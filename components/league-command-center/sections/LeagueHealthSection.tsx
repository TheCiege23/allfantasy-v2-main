'use client'

import type { LeagueHealthSectionData } from '@/lib/league-command-center/sections/leagueHealth'
import type { CommandCenterViewModel } from '@/lib/league-command-center/types'
import type { AIContextSource } from '@/lib/chimmy-chat/types'
import { DegradationNotice, EmptyState, KeyValueList, Panel } from '../primitives/Panel'
import { EntitlementGate } from '../primitives/EntitlementGate'
import { DecisionOsFooter, type ChimmyChip } from '../primitives/DecisionOsFooter'

/**
 * League Health Center — the score, what drives it, and how measured it is.
 *
 * Every value is a projection of the same resolved health result the Overview
 * card reads (via the shared `summarizeHealth`), so the two can never disagree.
 * The coverage line is not optional chrome: the engine mixes real Decision OS
 * signals with schema defaults, and this surface states exactly how many inputs
 * were real rather than presenting a partly-defaulted composite as measured.
 *
 * A `requiresCommissioner` section reached via the hero's dual-role switcher,
 * which keeps the full manager experience one click away.
 */

function toneForScore(score: number): string {
  return score >= 75 ? 'var(--cc-good)' : score >= 50 ? 'var(--cc-ops)' : 'var(--cc-bad)'
}

/** Engine status is a raw enum ('at_risk'); render it as words. */
function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

function HealthGauge({ score, status }: { score: number; status: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const tone = toneForScore(clamped)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div
        style={{
          width: 116,
          height: 116,
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
            width: 92,
            height: 92,
            borderRadius: '50%',
            background: 'var(--cc-panel)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="af-cc-num" style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>
            {clamped}
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--cc-text-5)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            / 100
          </span>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--cc-text-4)', fontWeight: 700, marginBottom: 4 }}>
          Overall status
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: tone, textTransform: 'capitalize' }}>
          {humanizeStatus(status)}
        </div>
      </div>
    </div>
  )
}

function HealthBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  const tone = toneForScore(clamped)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: 'var(--cc-text-3)', fontWeight: 600 }}>{label}</span>
        <span className="af-cc-num" style={{ fontSize: 13.5, fontWeight: 800 }}>{clamped}</span>
      </div>
      <div
        style={{ height: 7, borderRadius: 4, background: 'var(--cc-border)', overflow: 'hidden' }}
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${clamped} out of 100`}
      >
        <div style={{ height: '100%', width: `${clamped}%`, background: tone, borderRadius: 4 }} />
      </div>
    </div>
  )
}

export interface LeagueHealthSectionProps {
  viewModel: CommandCenterViewModel
  data: LeagueHealthSectionData
  onAskChimmy: (chip: ChimmyChip, source: AIContextSource) => void
}

export function LeagueHealthSection({ viewModel, data, onAskChimmy }: LeagueHealthSectionProps) {
  const { league, entitlement } = viewModel
  const health = data.health
  const trend = data.trend

  const trendLabel = trend.available
    ? trend.direction === 'increasing'
      ? `Increasing (+${trend.eventCountDelta} events) across ${trend.periodsTracked} periods`
      : trend.direction === 'decreasing'
        ? `Decreasing (${trend.eventCountDelta} events) across ${trend.periodsTracked} periods`
        : `Holding steady across ${trend.periodsTracked} periods`
    : null

  const chips: ChimmyChip[] = [
    {
      id: 'health-explain',
      label: 'How healthy is my league?',
      prompt: `Review the health of ${league.name} as its commissioner. What is driving the score, what needs my attention, and what should I do about it?`,
    },
    {
      id: 'health-improve',
      label: 'What should I improve next season?',
      prompt: `Based on ${league.name}'s health signals, what changes should I consider for next season to improve engagement, fairness, and retention?`,
    },
  ]

  return (
    <div className="af-cc-stack">
      <DegradationNotice warnings={[...viewModel.warnings, ...data.warnings]} />

      <Panel
        title="League Health"
        subtitle="A composite of engagement, fairness, and sustainability signals from real league activity."
      >
        <EntitlementGate access={entitlement.intelligence} lockedMode="placeholder" minHeight={260}>
          {health ? (
            <div className="af-cc-stack" style={{ gap: 18 }}>
              <HealthGauge score={health.score} status={health.overallStatus} />

              <p style={{ fontSize: 13, color: 'var(--cc-text-3)', lineHeight: 1.6, margin: 0 }}>
                {health.summary}
              </p>

              <div className="af-cc-stack" style={{ gap: 12 }}>
                <HealthBar label="Engagement" value={health.engagementScore} />
                <HealthBar label="Fairness" value={health.fairnessScore} />
                <HealthBar label="Sustainability" value={health.sustainabilityScore} />
              </div>

              {/*
                * Coverage is stated, never implied. The engine mixes real
                * Decision OS signals with schema defaults; presenting the
                * composite without saying so overstates how measured it is.
                */}
              <div className="af-cc-trust" role="note" style={{ borderColor: 'var(--cc-border)' }}>
                <i className="ph ph-gauge" style={{ color: 'var(--cc-info)' }} aria-hidden="true" />
                <span style={{ fontSize: 11, color: 'var(--cc-text-4)', lineHeight: 1.5 }}>
                  Based on {health.realSignalCount} of {health.totalSignalCount} scoring inputs measured
                  from real league activity · {health.confidencePct}% engine confidence. Remaining inputs
                  use schema defaults.
                </span>
              </div>
            </div>
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

      {health ? (
        <div className="af-cc-grid-2">
          <Panel title="What's working">
            {health.biggestStrengths.length > 0 ? (
              <ul className="af-cc-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
                {health.biggestStrengths.map((item) => (
                  <li key={item} style={{ display: 'flex', gap: 9, fontSize: 12.5, color: 'var(--cc-text-2)', lineHeight: 1.5 }}>
                    <i className="ph ph-check-circle" style={{ color: 'var(--cc-good)', flex: 'none', marginTop: 2 }} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="ph-thumbs-up" title="No standout strengths flagged yet" />
            )}
          </Panel>

          <Panel title="What needs work">
            {health.biggestProblems.length > 0 ? (
              <ul className="af-cc-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
                {health.biggestProblems.map((item) => (
                  <li key={item} style={{ display: 'flex', gap: 9, fontSize: 12.5, color: 'var(--cc-text-2)', lineHeight: 1.5 }}>
                    <i className="ph ph-warning-circle" style={{ color: 'var(--cc-ops)', flex: 'none', marginTop: 2 }} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="ph-confetti" title="No pressing problems flagged" />
            )}
          </Panel>
        </div>
      ) : null}

      <div className="af-cc-grid-2">
        <Panel title="Activity signals" subtitle="Real behavioral counts behind the score.">
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

        <Panel title="Activity trend" subtitle="Direction of league activity over time.">
          <EntitlementGate access={entitlement.intelligence} lockedMode="placeholder" minHeight={150}>
            {trend.available ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <i
                    className={`ph ${
                      trend.direction === 'increasing'
                        ? 'ph-trend-up'
                        : trend.direction === 'decreasing'
                          ? 'ph-trend-down'
                          : 'ph-chart-line'
                    }`}
                    style={{
                      fontSize: 22,
                      color:
                        trend.direction === 'increasing'
                          ? 'var(--cc-good)'
                          : trend.direction === 'decreasing'
                            ? 'var(--cc-ops)'
                            : 'var(--cc-info)',
                    }}
                    aria-hidden="true"
                  />
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{trendLabel}</span>
                </div>
                <KeyValueList
                  rows={[
                    { label: 'Latest period events', value: trend.latestEventCount },
                    { label: 'Managers active (latest)', value: trend.latestManagerCount },
                    { label: 'Periods tracked', value: trend.periodsTracked },
                  ]}
                />
              </>
            ) : (
              <EmptyState
                icon="ph-chart-line"
                title="Not enough history for a trend"
                body={
                  trend.reason === 'insufficient_history'
                    ? 'At least two activity snapshots are needed before a trend can be shown.'
                    : 'Activity snapshots have not been recorded for this league yet.'
                }
              />
            )}
          </EntitlementGate>
        </Panel>
      </div>

      <DecisionOsFooter
        title="Decision OS — League Health"
        source="dashboard"
        onAskChimmy={onAskChimmy}
        rows={[
          { label: 'Health score', value: health ? `${health.score}/100` : null },
          { label: 'Engine confidence', value: health ? `${health.confidencePct}%` : null },
          {
            label: 'Measured inputs',
            value: health ? `${health.realSignalCount} of ${health.totalSignalCount}` : null,
          },
        ]}
        chips={chips}
        unavailableNote={
          !health && entitlement.intelligence.allowed
            ? 'League health could not be calculated, so the Decision OS summary is unavailable.'
            : null
        }
      />
    </div>
  )
}

export default LeagueHealthSection
