'use client'

import Link from 'next/link'
import type { AttentionItem, AttentionSectionData } from '@/lib/league-command-center/sections/attention'
import type { CommandCenterViewModel } from '@/lib/league-command-center/types'
import type { AIContextSource } from '@/lib/chimmy-chat/types'
import { Badge, DegradationNotice, EmptyState, Panel } from '../primitives/Panel'
import { EntitlementGate } from '../primitives/EntitlementGate'
import { DecisionOsFooter, type ChimmyChip } from '../primitives/DecisionOsFooter'
import type { DailyBriefTone } from '@/lib/league-command-center/dailyBrief'

/**
 * Attention Queue — the Commissioner HQ home.
 *
 * This is a `requiresCommissioner` section: a plain manager never reaches it.
 * The dual-role guarantee ("commissioner mode never replaces the manager
 * experience") is met here two ways rather than by wrapping the whole section
 * in `LayerSection`: the hero's My Team ⇄ Commissioner HQ switcher keeps the
 * full manager surface one click away, and the personal-actions strip below
 * links straight back to it. The `overview` section remains the
 * LayerSection-based, personal-first landing. Using `LayerSection` here would
 * force a synthetic "shared" layer that only duplicates Mission Control.
 */

const BRIEF_TONE_COLOR: Record<DailyBriefTone, string> = {
  good: 'var(--cc-good)',
  warn: 'var(--cc-ops)',
  bad: 'var(--cc-bad)',
  info: 'var(--cc-info)',
}

const SEVERITY_META: Record<
  AttentionItem['severity'],
  { label: string; color: string; icon: string }
> = {
  critical: { label: 'Urgent', color: 'var(--cc-bad)', icon: 'ph-warning-octagon' },
  medium: { label: 'Review', color: 'var(--cc-ops)', icon: 'ph-lightbulb' },
}

export interface AttentionSectionProps {
  viewModel: CommandCenterViewModel
  data: AttentionSectionData
  onAskChimmy: (chip: ChimmyChip, source: AIContextSource) => void
}

export function AttentionSection({ viewModel, data, onAskChimmy }: AttentionSectionProps) {
  const { league, entitlement } = viewModel
  const ccHref = `/league/${league.leagueId}/command-center`
  const { brief, items } = data

  const urgentCount = items.filter((item) => item.severity === 'critical').length

  // ── Daily Brief ─────────────────────────────────────────────────────────────
  const dailyBrief = (
    <Panel
      title="Daily Brief"
      subtitle="What changed, what needs you, and what can wait — every line from real league data."
      actions={<span className="af-cc-muted" style={{ fontSize: 11 }}>{brief.freshnessLabel}</span>}
    >
      <EntitlementGate access={entitlement.intelligence} lockedMode="placeholder" minHeight={160}>
        {brief.available ? (
          <>
            <p style={{ fontSize: 14.5, fontWeight: 700, margin: '0 0 12px' }}>{brief.greeting}</p>
            <ul className="af-cc-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>
              {brief.lines.map((line) => (
                <li
                  key={line.id}
                  style={{ display: 'flex', gap: 9, fontSize: 12.5, color: 'var(--cc-text-2)', lineHeight: 1.5 }}
                >
                  <i
                    className={`ph ${line.icon}`}
                    style={{ color: BRIEF_TONE_COLOR[line.tone], flex: 'none', marginTop: 2 }}
                    aria-hidden="true"
                  />
                  <span>{line.text}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            icon="ph-newspaper-clipping"
            title="Your brief is not available yet"
            body={
              data.warnings[0] ??
              'Once this league has recorded some activity, your daily brief will summarize it here.'
            }
          />
        )}
      </EntitlementGate>
    </Panel>
  )

  // ── Personal-actions strip (additive — the commissioner is still a manager) ──
  // Brand (personal) accent, distinct from the gold commissioner treatment, so
  // the "you're a manager too" affordance reads as personal at a glance.
  const personalStrip = (
    <div
      className="af-cc-panel af-cc-panel--tight"
      style={{ borderLeft: '2px solid var(--cc-brand-bright)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <i
            className="ph ph-user-focus"
            style={{ color: 'var(--cc-brand-bright)', fontSize: 18, flex: 'none' }}
            aria-hidden="true"
          />
          <span style={{ fontSize: 12.5, color: 'var(--cc-text-3)', lineHeight: 1.5 }}>
            {data.personalActionCount === null
              ? "You're a manager here too — your own team lives in My Team."
              : data.personalActionCount > 0
                ? `${data.personalActionCount} of your own manager ${
                    data.personalActionCount === 1 ? 'action needs' : 'actions need'
                  } attention.`
                : 'Your own team is all set — no pending manager actions.'}
          </span>
        </div>
        <Link href={`${ccHref}?section=overview`} className="af-cc-action" style={{ flex: 'none' }}>
          <i className="ph ph-arrow-u-up-left" aria-hidden="true" />
          Go to My Team
        </Link>
      </div>
    </div>
  )

  // ── Attention queue ─────────────────────────────────────────────────────────
  const queue = (
    <Panel
      title="Attention Queue"
      subtitle="Flagged by the league health engine. Review-oriented — nothing here is an accusation."
      actions={
        entitlement.intelligence.allowed && items.length > 0 ? (
          <Badge tone={urgentCount > 0 ? 'bad' : 'ops'}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </Badge>
        ) : null
      }
    >
      <EntitlementGate access={entitlement.intelligence} lockedMode="placeholder" minHeight={160}>
        {items.length > 0 ? (
          <div className="af-cc-stack" style={{ gap: 10 }}>
            {items.map((item) => {
              const meta = SEVERITY_META[item.severity]
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 11,
                    border: '1px solid var(--cc-border)',
                    borderLeft: `2px solid ${meta.color}`,
                    borderRadius: 'var(--cc-r-md)',
                    padding: '11px 13px',
                    background: 'var(--cc-panel-raised)',
                  }}
                >
                  <i
                    className={`ph ${meta.icon}`}
                    style={{ color: meta.color, flex: 'none', marginTop: 1, fontSize: 15 }}
                    aria-hidden="true"
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '.06em',
                          color: meta.color,
                        }}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--cc-text-2)', margin: 0, lineHeight: 1.5 }}>
                      {item.message}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="af-cc-chip"
                    style={{ flex: 'none' }}
                    aria-label={`Ask Chimmy about this flagged item: ${item.message}`}
                    onClick={() =>
                      onAskChimmy(
                        {
                          id: `attention-${item.id}`,
                          label: 'Ask Chimmy',
                          prompt: `As commissioner of ${league.name}, help me act on this flagged item: "${item.message}". What should I do, and can you draft any message I might need?`,
                        },
                        'dashboard',
                      )
                    }
                  >
                    <i className="ph ph-sparkle" aria-hidden="true" />
                    Ask Chimmy
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon="ph-check-circle"
            title="No urgent commissioner actions"
            body="The league is currently operating normally. New items appear here as the health engine flags them."
          />
        )}
      </EntitlementGate>
    </Panel>
  )

  // ── Retention risk ──────────────────────────────────────────────────────────
  const retention = data.managersAtRetentionRisk
  const inactiveAtRisk = retention.filter((m) => m.isInactive).length
  const distinctReasons = Array.from(
    new Set(retention.flatMap((m) => m.retentionRiskReasons)),
  ).slice(0, 5)

  const retentionPanel =
    retention.length > 0 ? (
      <Panel
        title="Managers to check in with"
        subtitle="Elevated retention risk — commissioner-only, never shown publicly to the league."
        actions={<Badge tone="bad">{retention.length}</Badge>}
      >
        <EntitlementGate access={entitlement.intelligence} lockedMode="placeholder" minHeight={110}>
          <p style={{ fontSize: 12.5, color: 'var(--cc-text-2)', margin: '0 0 10px', lineHeight: 1.55 }}>
            {retention.length} {retention.length === 1 ? 'manager shows' : 'managers show'} elevated
            retention risk{inactiveAtRisk > 0 ? `, ${inactiveAtRisk} of them inactive` : ''}. A
            personalized check-in is usually the most effective response.
          </p>
          {distinctReasons.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {distinctReasons.map((reason) => (
                <Badge key={reason} tone="neutral">
                  {reason}
                </Badge>
              ))}
            </div>
          ) : null}
          <p style={{ fontSize: 10.5, color: 'var(--cc-text-5)', margin: '12px 0 0', lineHeight: 1.5 }}>
            Manager identities appear in the Managers view. Names are withheld here so risk labels are
            never exposed alongside them.
          </p>
        </EntitlementGate>
      </Panel>
    ) : null

  // ── Chimmy chips ────────────────────────────────────────────────────────────
  const chips: ChimmyChip[] = [
    {
      id: 'attention-today',
      label: 'What needs my attention today?',
      prompt: `As commissioner of ${league.name}, what are the most important things needing my attention today, and what should I do about each?`,
    },
    {
      id: 'inactive-managers',
      label: 'Which managers are inactive?',
      prompt: `Which managers in ${league.name} are inactive or at risk of leaving, and how should I re-engage them?`,
    },
    {
      id: 'draft-checkin',
      label: 'Draft a check-in message',
      prompt: `Draft a friendly, non-accusatory check-in message I can send to an inactive manager in ${league.name}.`,
    },
  ]

  return (
    <div className="af-cc-stack">
      <DegradationNotice warnings={[...viewModel.warnings, ...data.warnings]} />

      {dailyBrief}
      {personalStrip}
      {queue}
      {retentionPanel}

      <DecisionOsFooter
        title="Decision OS — Commissioner HQ"
        source="dashboard"
        onAskChimmy={onAskChimmy}
        rows={[
          { label: 'Open attention items', value: brief.available ? items.length : null },
          {
            label: 'Urgent',
            value: brief.available ? urgentCount : null,
            tone: urgentCount > 0 ? 'warn' : 'default',
          },
          {
            label: 'Managers at risk',
            value: brief.available ? retention.length : null,
            tone: retention.length > 0 ? 'bad' : 'default',
          },
          { label: 'Your own actions', value: data.personalActionCount },
        ]}
        chips={chips}
        unavailableNote={
          !brief.available && entitlement.intelligence.allowed
            ? 'League intelligence could not be resolved, so the commissioner summary is partial.'
            : null
        }
      />
    </div>
  )
}

export default AttentionSection
