'use client'

import { useMemo, useState } from 'react'
import type { StandingsSectionData, StandingsRow } from '@/lib/league-command-center/sections/standings'
import type { CommandCenterViewModel } from '@/lib/league-command-center/types'
import { LayerSection } from '../primitives/LayerSection'
import { Badge, DegradationNotice, EmptyState, KeyValueList, Panel } from '../primitives/Panel'
import { EntitlementGate } from '../primitives/EntitlementGate'
import { DecisionOsFooter, type ChimmyChip } from '../primitives/DecisionOsFooter'
import type { AIContextSource } from '@/lib/chimmy-chat/types'

/**
 * Standings — three additive layers.
 *
 *  1. Personal  — the viewer's own standing, always first, for every role.
 *  2. Shared    — the official league table, with the views real data supports.
 *  3. Commissioner ops — standings integrity signals, additive.
 *
 * The view switcher only offers views backed by data that actually exists.
 * "All-play" and "Expected wins" disappear entirely when no weeks have been
 * completed, rather than rendering a table of zeroes that reads as a real
 * result.
 */

type StandingsView = 'official' | 'allplay' | 'expected'

const VIEW_LABELS: Record<StandingsView, string> = {
  official: 'Official',
  allplay: 'All-play',
  expected: 'Schedule luck',
}

function recordLabel(row: { wins: number; losses: number; ties: number }): string {
  return `${row.wins}-${row.losses}${row.ties > 0 ? `-${row.ties}` : ''}`
}

function StandingsTable({
  rows,
  view,
  playoffLine,
}: {
  rows: readonly StandingsRow[]
  view: StandingsView
  playoffLine: number | null
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>
            {['#', 'Team', 'Record', 'PF', 'PA', view === 'official' ? 'Streak' : VIEW_LABELS[view]].map(
              (heading, index) => (
                <th
                  key={heading}
                  style={{
                    textAlign: index <= 1 ? 'left' : 'right',
                    padding: '0 8px 8px',
                    borderBottom: '1px solid var(--cc-border)',
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '.04em',
                    color: 'var(--cc-text-4)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inPlayoffs = playoffLine !== null && row.rank <= playoffLine
            return (
              <tr
                key={row.rosterId}
                data-testid={row.isViewer ? 'cc-standings-viewer-row' : undefined}
                style={{
                  background: row.isViewer ? 'var(--cc-brand-wash)' : 'transparent',
                  borderBottom: '1px solid var(--cc-panel-raised)',
                }}
              >
                <td style={{ padding: '9px 8px', color: 'var(--cc-text-4)' }} className="af-cc-num">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {row.rank}
                    {inPlayoffs ? (
                      <span
                        title="In the playoff field"
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          background: 'var(--cc-good)',
                        }}
                      />
                    ) : null}
                  </span>
                </td>
                <td style={{ padding: '9px 8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: row.isViewer ? 700 : 500 }}>
                      {row.teamName}
                      {row.isViewer ? <span style={{ color: 'var(--cc-brand-bright)' }}> · You</span> : null}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--cc-text-5)' }}>{row.ownerName}</span>
                  </div>
                </td>
                <td className="af-cc-num" style={{ padding: '9px 8px', textAlign: 'right' }}>
                  {recordLabel(row)}
                </td>
                <td className="af-cc-num" style={{ padding: '9px 8px', textAlign: 'right' }}>
                  {row.pointsFor.toFixed(1)}
                </td>
                <td
                  className="af-cc-num"
                  style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--cc-text-4)' }}
                >
                  {row.pointsAgainst.toFixed(1)}
                </td>
                <td className="af-cc-num" style={{ padding: '9px 8px', textAlign: 'right' }}>
                  {view === 'official' ? (
                    row.streak ?? <span className="af-cc-muted">—</span>
                  ) : view === 'allplay' ? (
                    row.allPlayWins !== null ? (
                      `${row.allPlayWins}-${row.allPlayLosses}`
                    ) : (
                      <span className="af-cc-muted">—</span>
                    )
                  ) : row.scheduleLuck !== null ? (
                    <span
                      style={{
                        color:
                          row.scheduleLuck > 0.5
                            ? 'var(--cc-good)'
                            : row.scheduleLuck < -0.5
                              ? 'var(--cc-bad)'
                              : undefined,
                      }}
                    >
                      {row.scheduleLuck > 0 ? '+' : ''}
                      {row.scheduleLuck.toFixed(1)}
                    </span>
                  ) : (
                    <span className="af-cc-muted">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export interface StandingsSectionProps {
  viewModel: CommandCenterViewModel
  data: StandingsSectionData
  onAskChimmy: (chip: ChimmyChip, source: AIContextSource) => void
}

export function StandingsSection({ viewModel, data, onAskChimmy }: StandingsSectionProps) {
  const hasAllPlay = data.rows.some((row) => row.allPlayWins !== null)
  const views = useMemo<StandingsView[]>(
    () => (hasAllPlay ? ['official', 'allplay', 'expected'] : ['official']),
    [hasAllPlay],
  )
  const [view, setView] = useState<StandingsView>('official')

  const { viewerRow } = data
  const entitlement = viewModel.entitlement.intelligence

  if (!data.available) {
    return (
      <Panel title="Standings">
        <EmptyState
          icon="ph-list-numbers"
          title="Standings are not available yet"
          body={
            data.warnings[0] ??
            'This league has no completed season data to build standings from.'
          }
        />
      </Panel>
    )
  }

  // ── Layer 1: the viewer's own standing ──────────────────────────────────────
  const personal = viewerRow ? (
    <Panel title="My standing" subtitle="Where you sit, and how you got there.">
      <div className="af-cc-grid-3" style={{ marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800 }} className="af-cc-num">
            #{viewerRow.rank}
          </div>
          <div style={{ fontSize: 11, color: 'var(--cc-text-4)' }}>of {data.rows.length} teams</div>
        </div>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800 }} className="af-cc-num">
            {recordLabel(viewerRow)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--cc-text-4)' }}>
            {viewerRow.streak ? `Streak ${viewerRow.streak}` : 'Record'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800 }} className="af-cc-num">
            {viewerRow.pointsFor.toFixed(0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--cc-text-4)' }}>points for</div>
        </div>
      </div>

      <KeyValueList
        rows={[
          {
            label: 'Playoff position',
            value:
              data.playoffLine === null
                ? null
                : viewerRow.rank <= data.playoffLine
                  ? 'In the field'
                  : `${viewerRow.rank - data.playoffLine} spot${
                      viewerRow.rank - data.playoffLine === 1 ? '' : 's'
                    } out`,
            tone:
              data.playoffLine !== null && viewerRow.rank <= data.playoffLine ? 'good' : 'warn',
          },
          {
            label: 'All-play record',
            value:
              viewerRow.allPlayWins !== null
                ? `${viewerRow.allPlayWins}-${viewerRow.allPlayLosses}`
                : null,
          },
          {
            label: 'Schedule luck',
            value:
              viewerRow.scheduleLuck !== null
                ? `${viewerRow.scheduleLuck > 0 ? '+' : ''}${viewerRow.scheduleLuck.toFixed(1)} wins`
                : null,
            tone:
              viewerRow.scheduleLuck === null
                ? 'default'
                : viewerRow.scheduleLuck > 0.5
                  ? 'good'
                  : viewerRow.scheduleLuck < -0.5
                    ? 'bad'
                    : 'default',
          },
          { label: 'Points against', value: viewerRow.pointsAgainst.toFixed(1) },
        ]}
      />
    </Panel>
  ) : (
    <Panel title="My standing">
      <EmptyState
        icon="ph-user-focus"
        title="You do not have a team in this league"
        body="Standings below are still fully available. Claim a team to see your own seed, playoff path, and schedule luck here."
      />
    </Panel>
  )

  // ── Layer 2: the official league table ──────────────────────────────────────
  const shared = (
    <Panel
      title="League standings"
      actions={
        views.length > 1 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {views.map((option) => (
              <button
                key={option}
                type="button"
                className="af-cc-chip"
                onClick={() => setView(option)}
                aria-pressed={view === option}
                style={
                  view === option
                    ? {
                        borderColor: 'var(--cc-brand)',
                        background: 'var(--cc-brand)',
                        color: '#fff',
                      }
                    : undefined
                }
              >
                {VIEW_LABELS[option]}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      <StandingsTable rows={data.rows} view={view} playoffLine={data.playoffLine} />
      {data.playoffLine === null ? (
        <p style={{ fontSize: 11, color: 'var(--cc-text-5)', margin: '12px 0 0' }}>
          Playoff seeds have not been assigned yet, so the playoff cut line is not shown.
        </p>
      ) : null}
    </Panel>
  )

  // ── Layer 3: commissioner operations (additive) ─────────────────────────────
  const orphanCount = 0
  const eliminated = data.rows.filter((row) => row.isEliminated)
  const luckSpread = data.rows
    .map((row) => row.scheduleLuck)
    .filter((value): value is number => value !== null)

  const commissionerOps = (
    <Panel title="Standings health" subtitle="League-wide integrity signals for the standings table.">
      <EntitlementGate access={entitlement} lockedMode="placeholder" minHeight={140}>
        <KeyValueList
          rows={[
            { label: 'Teams', value: data.rows.length },
            {
              label: 'Eliminated',
              value: eliminated.length > 0 ? eliminated.length : '0',
              tone: eliminated.length > 0 ? 'warn' : 'default',
            },
            {
              label: 'Widest schedule-luck gap',
              value:
                luckSpread.length > 1
                  ? `${(Math.max(...luckSpread) - Math.min(...luckSpread)).toFixed(1)} wins`
                  : null,
            },
            {
              label: 'Playoff field size',
              value: data.playoffLine !== null ? `${data.playoffLine} teams` : null,
            },
          ]}
        />
        {luckSpread.length > 1 && Math.max(...luckSpread) - Math.min(...luckSpread) > 2 ? (
          <p style={{ fontSize: 11.5, color: 'var(--cc-text-3)', margin: '12px 0 0', lineHeight: 1.55 }}>
            Schedule luck varies by more than two wins across the league. That is a scheduling
            artifact, not a rules problem — but it is worth knowing before a playoff-seeding dispute.
          </p>
        ) : null}
      </EntitlementGate>
    </Panel>
  )

  const chips: ChimmyChip[] = [
    {
      id: 'playoff-path',
      label: 'What is my playoff path?',
      prompt: `In ${viewModel.league.name}, I am ranked #${viewerRow?.rank ?? '?'} of ${data.rows.length}. What do I need to do to make the playoffs?`,
      insightType: 'playoff',
    },
    {
      id: 'schedule-luck',
      label: 'Have I been lucky?',
      prompt: `Look at my all-play record versus my actual record in ${viewModel.league.name} and tell me whether my standing reflects how well my team has actually played.`,
      insightType: 'playoff',
    },
    {
      id: 'threats',
      label: 'Who should I worry about?',
      prompt: `Which teams in ${viewModel.league.name} are the biggest threats to my playoff position over the rest of the season?`,
      insightType: 'playoff',
    },
  ]

  return (
    <div className="af-cc-stack">
      <DegradationNotice warnings={data.warnings} />

      <LayerSection
        role={viewModel.viewer.role}
        labels={{ personal: 'Your standing', shared: 'League standings' }}
        personal={personal}
        shared={shared}
        commissionerOps={commissionerOps}
      />

      <DecisionOsFooter
        title="Decision OS — Standings"
        source="league_forecast"
        onAskChimmy={onAskChimmy}
        rows={[
          { label: 'Your rank', value: viewerRow ? `#${viewerRow.rank} of ${data.rows.length}` : null },
          {
            label: 'Playoff field',
            value: data.playoffLine !== null ? `Top ${data.playoffLine}` : null,
          },
          {
            label: 'All-play',
            value:
              viewerRow?.allPlayWins !== null && viewerRow
                ? `${viewerRow.allPlayWins}-${viewerRow.allPlayLosses}`
                : null,
          },
        ]}
        chips={chips}
        unavailableNote={
          orphanCount > 0 ? 'Some teams are unclaimed, so league-wide numbers may be incomplete.' : null
        }
      />
    </div>
  )
}

export default StandingsSection
