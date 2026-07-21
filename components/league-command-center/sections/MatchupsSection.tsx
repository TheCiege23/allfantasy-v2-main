'use client'

import Link from 'next/link'
import type { MatchupEntry, MatchupsSectionData } from '@/lib/league-command-center/sections/matchups'
import type { CommandCenterViewModel } from '@/lib/league-command-center/types'
import { LayerSection } from '../primitives/LayerSection'
import { Badge, DegradationNotice, EmptyState, KeyValueList, Panel } from '../primitives/Panel'
import { EntitlementGate } from '../primitives/EntitlementGate'
import { DecisionOsFooter, type ChimmyChip } from '../primitives/DecisionOsFooter'
import type { AIContextSource } from '@/lib/chimmy-chat/types'

/**
 * Matchups — three additive layers.
 *
 * The hero is ALWAYS the viewer's own matchup when one exists, for every role.
 * A commissioner opening this tab sees their own game first and the league
 * dashboard second — the ops layer adds oversight, it does not take the hero
 * slot. This is the locked rule expressed as a layout decision.
 *
 * Projection and win-probability elements render only when those columns are
 * actually populated. An unplayed week shows real zeroes for score (which are
 * true) but omits projections entirely (which are not yet computed) rather than
 * showing 0.0 as though it were a forecast.
 */

function statusTone(status: MatchupEntry['status']): { label: string; tone: 'good' | 'neutral' | 'brand' } {
  if (status === 'final') return { label: 'Final', tone: 'neutral' }
  if (status === 'active') return { label: 'Live', tone: 'good' }
  return { label: 'Upcoming', tone: 'brand' }
}

function TeamRow({
  side,
  isWinning,
  emphasise,
}: {
  side: NonNullable<MatchupEntry['away']>
  isWinning: boolean
  emphasise: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <div
        style={{
          width: emphasise ? 40 : 30,
          height: emphasise ? 40 : 30,
          borderRadius: 10,
          flex: 'none',
          background: 'var(--cc-brand-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: emphasise ? 13 : 11,
          fontWeight: 800,
          color: 'var(--cc-brand-pale)',
          overflow: 'hidden',
        }}
      >
        {side.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- provider-hosted avatar on an arbitrary remote host.
          <img src={side.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          side.teamName.slice(0, 2).toUpperCase()
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: emphasise ? 14 : 12.5,
            fontWeight: isWinning ? 700 : 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {side.teamName}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--cc-text-5)' }}>
          {side.record.wins}-{side.record.losses}
          {side.record.ties > 0 ? `-${side.record.ties}` : ''}
        </div>
      </div>

      <div style={{ textAlign: 'right', flex: 'none' }}>
        <div
          className="af-cc-num"
          style={{ fontSize: emphasise ? 26 : 17, fontWeight: 800, lineHeight: 1.1 }}
        >
          {side.score.toFixed(1)}
        </div>
        {side.projected !== null ? (
          <div style={{ fontSize: 10, color: 'var(--cc-text-5)' }} className="af-cc-num">
            proj {side.projected.toFixed(1)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function HeroMatchup({ matchup, reason }: { matchup: MatchupEntry; reason: string }) {
  const status = statusTone(matchup.status)
  const homeWinning = matchup.away ? matchup.home.score >= matchup.away.score : true

  return (
    <Panel
      title={reason}
      actions={<Badge tone={status.tone}>{status.label}</Badge>}
    >
      <TeamRow side={matchup.home} isWinning={homeWinning} emphasise />
      {matchup.away ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              margin: '2px 0',
              fontSize: 10,
              color: 'var(--cc-text-5)',
              fontWeight: 700,
              letterSpacing: '.06em',
            }}
          >
            <span style={{ flex: 1, height: 1, background: 'var(--cc-border)' }} />
            VS
            <span style={{ flex: 1, height: 1, background: 'var(--cc-border)' }} />
          </div>
          <TeamRow side={matchup.away} isWinning={!homeWinning} emphasise />
        </>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--cc-text-4)', margin: '10px 0 0' }}>
          Bye week — no opponent scheduled.
        </p>
      )}

      {matchup.home.winPct !== null && matchup.away?.winPct != null ? (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10.5,
              color: 'var(--cc-text-4)',
              marginBottom: 5,
            }}
          >
            <span>{matchup.home.winPct}%</span>
            <span style={{ fontWeight: 700, color: 'var(--cc-text-3)' }}>Win probability</span>
            <span>{matchup.away.winPct}%</span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: 'var(--cc-bad)',
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            <div style={{ width: `${matchup.home.winPct}%`, background: 'var(--cc-good)' }} />
          </div>
        </div>
      ) : null}

      {matchup.isMedianMatchup && matchup.medianScore !== null ? (
        <p style={{ fontSize: 11, color: 'var(--cc-text-4)', margin: '14px 0 0' }}>
          League median this week: <strong className="af-cc-num">{matchup.medianScore.toFixed(1)}</strong>
        </p>
      ) : null}
    </Panel>
  )
}

export interface MatchupsSectionProps {
  viewModel: CommandCenterViewModel
  data: MatchupsSectionData
  onAskChimmy: (chip: ChimmyChip, source: AIContextSource) => void
}

export function MatchupsSection({ viewModel, data, onAskChimmy }: MatchupsSectionProps) {
  const entitlement = viewModel.entitlement.intelligence
  const leagueHref = `/league/${viewModel.league.leagueId}/command-center?section=matchups`

  if (!data.available) {
    return (
      <Panel title="Matchups">
        <EmptyState
          icon="ph-flag-checkered"
          title="No matchups to show"
          body={data.warnings[0] ?? 'This league has no schedule generated yet.'}
        />
      </Panel>
    )
  }

  const hero = data.viewerMatchup ?? data.matchups[0] ?? null
  const heroReason = data.viewerMatchup ? 'Your matchup' : 'Featured matchup'
  const others = data.matchups.filter((m) => m.id !== hero?.id)

  // ── Layer 1: the viewer's own matchup ───────────────────────────────────────
  const personal = hero ? (
    <HeroMatchup matchup={hero} reason={heroReason} />
  ) : (
    <Panel title="Your matchup">
      <EmptyState
        icon="ph-user-focus"
        title="You are not scheduled this week"
        body="You may not have a claimed team, or this week may be a bye for you."
      />
    </Panel>
  )

  // ── Layer 2: the rest of the league ─────────────────────────────────────────
  const shared = (
    <Panel
      title={`League matchups — week ${data.week}`}
      actions={
        data.availableWeeks.length > 1 ? (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 360 }}>
            {data.availableWeeks.map((week) => (
              <Link
                key={week}
                href={`${leagueHref}&week=${week}`}
                className="af-cc-chip"
                aria-current={week === data.week ? 'page' : undefined}
                style={
                  week === data.week
                    ? { borderColor: 'var(--cc-brand)', background: 'var(--cc-brand)', color: '#fff' }
                    : undefined
                }
              >
                {week}
              </Link>
            ))}
          </div>
        ) : null
      }
    >
      {others.length === 0 ? (
        <EmptyState icon="ph-flag-checkered" title="No other matchups this week" />
      ) : (
        <div className="af-cc-grid-2">
          {others.map((matchup) => {
            const status = statusTone(matchup.status)
            const homeWinning = matchup.away ? matchup.home.score >= matchup.away.score : true
            return (
              <div
                key={matchup.id}
                style={{
                  border: '1px solid var(--cc-border)',
                  borderRadius: 'var(--cc-r-md)',
                  padding: 14,
                  background: 'var(--cc-panel-raised)',
                }}
              >
                <div style={{ marginBottom: 6 }}>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <TeamRow side={matchup.home} isWinning={homeWinning} emphasise={false} />
                {matchup.away ? (
                  <TeamRow side={matchup.away} isWinning={!homeWinning} emphasise={false} />
                ) : (
                  <p style={{ fontSize: 11, color: 'var(--cc-text-4)', margin: '6px 0 0' }}>Bye week</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )

  // ── Layer 3: commissioner operations (additive) ─────────────────────────────
  const liveCount = data.matchups.filter((m) => m.status === 'active').length
  const finalCount = data.matchups.filter((m) => m.status === 'final').length
  const byes = data.matchups.filter((m) => m.away === null).length
  const blowouts = data.matchups.filter((m) => m.margin !== null && m.margin >= 40).length
  const closest = data.matchups
    .filter((m) => m.margin !== null)
    .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0))[0]

  const commissionerOps = (
    <Panel
      title="Matchup dashboard"
      subtitle="League-wide view of this week's slate."
    >
      <EntitlementGate access={entitlement} lockedMode="placeholder" minHeight={150}>
        <KeyValueList
          rows={[
            { label: 'Matchups', value: data.matchups.length },
            { label: 'Live now', value: liveCount, tone: liveCount > 0 ? 'good' : 'default' },
            { label: 'Final', value: finalCount },
            { label: 'Byes', value: byes > 0 ? byes : '0' },
            {
              label: 'Blowouts (40+)',
              value: blowouts > 0 ? blowouts : '0',
              tone: blowouts > 0 ? 'warn' : 'default',
            },
            {
              label: 'Closest game',
              value:
                closest && closest.margin !== null
                  ? `${closest.home.teamName} vs ${closest.away?.teamName ?? 'bye'} · ${closest.margin.toFixed(1)}`
                  : null,
            },
          ]}
        />
      </EntitlementGate>
    </Panel>
  )

  const chips: ChimmyChip[] = [
    {
      id: 'win-this-week',
      label: 'How do I win this week?',
      prompt: hero?.away
        ? `I am playing ${hero.away.teamName} in week ${data.week} of ${viewModel.league.name}. What are my best moves to win this matchup?`
        : `What should I focus on in week ${data.week} of ${viewModel.league.name}?`,
      insightType: 'matchup',
    },
    {
      id: 'opponent-weakness',
      label: "Where is my opponent weak?",
      prompt: hero?.away
        ? `Analyze ${hero.away.teamName}'s roster in ${viewModel.league.name} and tell me where they are vulnerable this week.`
        : `Analyze the strongest teams in ${viewModel.league.name} and where they are vulnerable.`,
      insightType: 'matchup',
    },
    {
      id: 'week-recap',
      label: 'Recap the week',
      prompt: `Give me a recap of week ${data.week} in ${viewModel.league.name} — biggest performances, upsets, and what it means for the standings.`,
      insightType: 'matchup',
    },
  ]

  return (
    <div className="af-cc-stack">
      <DegradationNotice warnings={data.warnings} />

      <LayerSection
        role={viewModel.viewer.role}
        labels={{ personal: 'Your matchup', shared: 'Around the league' }}
        personal={personal}
        shared={shared}
        commissionerOps={commissionerOps}
      />

      <DecisionOsFooter
        title="Decision OS — Matchups"
        source="matchup_tool"
        onAskChimmy={onAskChimmy}
        rows={[
          { label: 'Week', value: data.week },
          {
            label: 'Your game',
            value: hero?.away ? `${hero.home.teamName} vs ${hero.away.teamName}` : null,
          },
          {
            label: 'Win probability',
            value:
              data.viewerMatchup && data.viewerMatchup.home.winPct !== null
                ? `${data.viewerMatchup.home.winPct}%`
                : null,
          },
        ]}
        chips={chips}
        unavailableNote={
          hero && hero.home.projected === null
            ? 'Projections have not run for this week yet, so forecast rows are omitted.'
            : null
        }
      />
    </div>
  )
}

export default MatchupsSection
