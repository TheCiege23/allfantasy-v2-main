'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RosterSectionData, RosterSlotGroup, RosterSlotPlayer } from '@/lib/league-command-center/sections/roster'
import type { ActionCapability, CommandCenterViewModel } from '@/lib/league-command-center/types'
import { LayerSection } from '../primitives/LayerSection'
import { Badge, DegradationNotice, EmptyState, KeyValueList, Panel } from '../primitives/Panel'
import { CapabilityAction } from '../primitives/CapabilityAction'
import { DecisionOsFooter, type ChimmyChip } from '../primitives/DecisionOsFooter'
import type { AIContextSource } from '@/lib/chimmy-chat/types'

/**
 * Roster — the viewer's own lineup, with a two-click swap editor.
 *
 * **Eligibility is server-supplied.** Each slot carries the `eligiblePositions`
 * the server resolved from the same per-sport config
 * `lib/redraft/lineupValidation.ts` validates against, so this component cannot
 * disagree with the server about what is legal. It deliberately does not
 * reimplement the prototype's hardcoded `FLEX = RB/WR/TE`, which is wrong for
 * non-NFL sports and for leagues with custom layouts.
 *
 * **Writes are capability-gated.** On a native league the swap POSTs to the
 * existing `PATCH /api/redraft/roster` (which re-validates server-side, honours
 * locks, and records move history). On an imported league there is no write
 * control at all — AllFantasy has no write access to Sleeper/ESPN/Yahoo, so the
 * UI says where to finish instead of offering a button that would lie.
 */

const POSITION_COLORS: Record<string, string> = {
  QB: 'var(--cc-pos-qb)',
  RB: 'var(--cc-pos-rb)',
  WR: 'var(--cc-pos-wr)',
  TE: 'var(--cc-pos-te)',
  K: 'var(--cc-pos-k)',
  DEF: 'var(--cc-pos-def)',
}

function positionColor(position: string): string {
  return POSITION_COLORS[position] ?? 'var(--cc-text-3)'
}

/** Mirrors the server's error-status set so a starter problem looks the same on both sides. */
const INJURY_ERROR = new Set([
  'OUT', 'O', 'IR', 'INJURED_RESERVE', 'PUP', 'NFI', 'RESERVE',
  'SUSP', 'SUSPENDED', 'COVID', 'INACTIVE', 'DNR',
])

function injuryTone(status: string | null): 'bad' | 'warn' | null {
  if (!status) return null
  const normalized = status.trim().toUpperCase().replace(/\s+/g, '_')
  if (INJURY_ERROR.has(normalized)) return 'bad'
  if (['QUESTIONABLE', 'Q', 'DOUBTFUL', 'D'].includes(normalized)) return 'warn'
  return null
}

interface SelectedSlot {
  groupIndex: number
  playerIndex: number
}

export interface RosterSectionProps {
  viewModel: CommandCenterViewModel
  data: RosterSectionData
  capability: ActionCapability
  onAskChimmy: (chip: ChimmyChip, source: AIContextSource) => void
}

export function RosterSection({ viewModel, data, capability, onAskChimmy }: RosterSectionProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<SelectedSlot | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canEdit = capability.canExecute && data.rosterId !== null

  const selectedPlayer = useMemo<RosterSlotPlayer | null>(() => {
    if (!selected) return null
    return data.groups[selected.groupIndex]?.players[selected.playerIndex] ?? null
  }, [selected, data.groups])

  /**
   * Whether `player` may legally occupy `group`. Bench-like slots accept
   * anything (`eligiblePositions` empty); starter slots use the server-resolved
   * list.
   */
  const accepts = useCallback((group: RosterSlotGroup, player: RosterSlotPlayer): boolean => {
    if (group.eligiblePositions.length === 0) return true
    return group.eligiblePositions.includes(player.position)
  }, [])

  /** A swap is legal only if BOTH players are eligible in each other's slot and neither is locked. */
  const canSwapWith = useCallback(
    (group: RosterSlotGroup, player: RosterSlotPlayer): boolean => {
      if (!selectedPlayer || !selected) return false
      if (player.isLocked || selectedPlayer.isLocked) return false
      const sourceGroup = data.groups[selected.groupIndex]
      if (!sourceGroup) return false
      return accepts(group, selectedPlayer) && accepts(sourceGroup, player)
    },
    [selected, selectedPlayer, data.groups, accepts],
  )

  const submitSwap = useCallback(
    async (target: SelectedSlot) => {
      if (!selected || !data.rosterId) return
      const sourceGroup = data.groups[selected.groupIndex]
      const targetGroup = data.groups[target.groupIndex]
      const a = sourceGroup?.players[selected.playerIndex]
      const b = targetGroup?.players[target.playerIndex]
      if (!sourceGroup || !targetGroup || !a || !b) return

      setPending(true)
      setError(null)
      try {
        const response = await fetch('/api/redraft/roster', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rosterId: data.rosterId,
            week: data.week ?? undefined,
            moves: [
              { playerId: a.playerId, fromSlot: sourceGroup.slotType, toSlot: targetGroup.slotType },
              { playerId: b.playerId, fromSlot: targetGroup.slotType, toSlot: sourceGroup.slotType },
            ],
          }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          // Surface the server's own reason. It is the authority on legality,
          // and its message is more specific than anything we could infer.
          setError(payload?.error ?? `Move rejected (${response.status}).`)
          return
        }

        setSelected(null)
        router.refresh()
      } catch {
        setError('Could not reach the server. Your lineup was not changed.')
      } finally {
        setPending(false)
      }
    },
    [selected, data.rosterId, data.groups, data.week, router],
  )

  const handleSlotClick = useCallback(
    (groupIndex: number, playerIndex: number) => {
      if (!canEdit || pending) return
      const group = data.groups[groupIndex]
      const player = group?.players[playerIndex]
      if (!group || !player) return

      if (!selected) {
        if (player.isLocked) return
        setSelected({ groupIndex, playerIndex })
        setError(null)
        return
      }

      if (selected.groupIndex === groupIndex && selected.playerIndex === playerIndex) {
        setSelected(null)
        return
      }

      if (canSwapWith(group, player)) {
        void submitSwap({ groupIndex, playerIndex })
      } else {
        // Re-anchor rather than silently doing nothing — a dead click reads as a bug.
        setSelected(player.isLocked ? null : { groupIndex, playerIndex })
      }
    },
    [canEdit, pending, data.groups, selected, canSwapWith, submitSwap],
  )

  if (!data.available) {
    return (
      <Panel title="My roster">
        <EmptyState
          icon="ph-identification-card"
          title="Your roster is not available"
          body={data.warnings[0] ?? 'You do not have a roster in this league yet.'}
        />
      </Panel>
    )
  }

  const renderPlayerRow = (group: RosterSlotGroup, groupIndex: number, player: RosterSlotPlayer, playerIndex: number) => {
    const isSelected = selected?.groupIndex === groupIndex && selected?.playerIndex === playerIndex
    const isSwapTarget = selected !== null && !isSelected && canSwapWith(group, player)
    const tone = injuryTone(player.injuryStatus)

    return (
      <button
        key={player.playerId}
        type="button"
        onClick={() => handleSlotClick(groupIndex, playerIndex)}
        disabled={!canEdit || pending}
        aria-pressed={isSelected}
        data-testid={`cc-roster-slot-${group.slotType}-${playerIndex}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          textAlign: 'left',
          padding: '8px 10px',
          borderRadius: 'var(--cc-r-md)',
          border: `1px solid ${isSelected ? 'var(--cc-brand)' : isSwapTarget ? 'var(--cc-good)' : 'transparent'}`,
          background: isSelected
            ? 'var(--cc-brand-wash)'
            : isSwapTarget
              ? 'rgba(126,224,129,.08)'
              : 'transparent',
          color: 'inherit',
          font: 'inherit',
          cursor: canEdit && !player.isLocked ? 'pointer' : 'default',
          opacity: player.isLocked ? 0.6 : 1,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            width: 30,
            flex: 'none',
            color: positionColor(player.position),
          }}
        >
          {player.position}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {player.playerName}
          {player.team ? <span style={{ color: 'var(--cc-text-5)' }}> · {player.team}</span> : null}
        </span>
        {player.byeWeek ? (
          <span style={{ fontSize: 10, color: 'var(--cc-text-5)' }}>BYE {player.byeWeek}</span>
        ) : null}
        {tone ? <Badge tone={tone}>{player.injuryStatus}</Badge> : null}
        {player.isLocked ? (
          <i className="ph ph-lock-simple" style={{ fontSize: 12, color: 'var(--cc-text-5)' }} title="Locked — game has started" aria-label="Locked" />
        ) : null}
      </button>
    )
  }

  const renderGroup = (group: RosterSlotGroup, groupIndex: number) => {
    const emptyCount = Math.max(0, group.capacity - group.players.length)
    return (
      <div key={`${group.slotType}-${groupIndex}`} style={{ marginBottom: 6 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: '.05em',
            textTransform: 'uppercase',
            color: 'var(--cc-text-5)',
            padding: '6px 10px 4px',
          }}
        >
          <span>{group.label}</span>
          {group.eligiblePositions.length > 0 ? (
            <span style={{ color: 'var(--cc-text-5)', fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>
              {group.eligiblePositions.join(' / ')}
            </span>
          ) : null}
        </div>
        {group.players.map((player, playerIndex) => renderPlayerRow(group, groupIndex, player, playerIndex))}
        {Array.from({ length: emptyCount }, (_, i) => (
          <div
            key={`empty-${i}`}
            style={{
              padding: '8px 10px',
              fontSize: 12,
              color: 'var(--cc-bad)',
              border: '1px dashed var(--cc-border-control)',
              borderRadius: 'var(--cc-r-md)',
              margin: '2px 0',
            }}
          >
            Empty {group.label} slot
          </div>
        ))}
      </div>
    )
  }

  const starterGroups = data.groups.filter((g) => g.isStarter)
  const benchGroups = data.groups.filter((g) => !g.isStarter)

  // ── Layer 1: my roster ──────────────────────────────────────────────────────
  const personal = (
    <Panel
      title="My roster"
      subtitle={
        canEdit
          ? 'Select a player, then select another to swap them. Ineligible and locked players cannot be selected.'
          : undefined
      }
      actions={
        data.startersComplete ? (
          <Badge tone="good" icon="ph-check-circle">Lineup set</Badge>
        ) : (
          <Badge tone="bad" icon="ph-warning-circle">Needs attention</Badge>
        )
      }
    >
      {!canEdit ? (
        <div style={{ marginBottom: 14 }}>
          <CapabilityAction
            capability={capability}
            label={`Edit lineup on ${viewModel.source.label}`}
          />
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--cc-bad)',
            background: 'rgba(224,120,90,.1)',
            border: '1px solid rgba(224,120,90,.3)',
            borderRadius: 'var(--cc-r-md)',
            padding: '9px 12px',
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ opacity: pending ? 0.6 : 1 }}>
        {starterGroups.map(renderGroup)}
        {benchGroups.length > 0 ? (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--cc-border)' }}>
            {benchGroups.map((group) => renderGroup(group, data.groups.indexOf(group)))}
          </div>
        ) : null}
      </div>
    </Panel>
  )

  // ── Layer 2: shared league rules ────────────────────────────────────────────
  const shared = (
    <Panel title="Roster rules" subtitle="The layout every team in this league plays by.">
      <KeyValueList
        rows={[
          {
            label: 'Starters',
            value: starterGroups.reduce((sum, g) => sum + g.capacity, 0) || null,
          },
          {
            label: 'Bench',
            value: benchGroups.find((g) => g.slotType === 'BENCH')?.capacity ?? null,
          },
          { label: 'IR', value: benchGroups.find((g) => g.slotType === 'IR')?.capacity ?? null },
          { label: 'Taxi', value: benchGroups.find((g) => g.slotType === 'TAXI')?.capacity ?? null },
          {
            label: 'Layout source',
            value:
              data.configSource === 'commissioner'
                ? 'League settings'
                : data.configSource === 'defaults'
                  ? `${data.sport ?? 'Sport'} defaults`
                  : null,
          },
          { label: 'Week', value: data.week },
        ]}
      />
      <p style={{ fontSize: 11, color: 'var(--cc-text-5)', margin: '12px 0 0', lineHeight: 1.5 }}>
        Slot eligibility shown above each group comes from this league&apos;s resolved configuration —
        the same rules the server validates against when a lineup is submitted.
      </p>
    </Panel>
  )

  // ── Layer 3: commissioner operations (additive) ─────────────────────────────
  const commissionerOps = (
    <Panel title="Lineup compliance" subtitle="Your own lineup, from an operations angle.">
      <KeyValueList
        rows={[
          {
            label: 'Empty starter slots',
            value: data.emptyStarterSlots.length,
            tone: data.emptyStarterSlots.length > 0 ? 'bad' : 'good',
          },
          {
            label: 'Overfilled slots',
            value: data.overfilledSlots.length
              ? data.overfilledSlots.map((s) => `${s.label} ${s.count}/${s.capacity}`).join(', ')
              : 0,
            tone: data.overfilledSlots.length > 0 ? 'bad' : 'good',
          },
          {
            label: 'Players in undefined slots',
            value: data.unassignedCount,
            tone: data.unassignedCount > 0 ? 'warn' : 'good',
          },
          {
            label: 'Starters flagged out',
            value: data.problemStarters.length,
            tone: data.problemStarters.length > 0 ? 'bad' : 'good',
          },
          { label: 'Locked players', value: data.lockedCount },
        ]}
      />
      <p style={{ fontSize: 11.5, color: 'var(--cc-text-3)', margin: '12px 0 0', lineHeight: 1.55 }}>
        League-wide lineup compliance for every team is not in the Command Center yet — this panel
        covers your own roster only.
      </p>
    </Panel>
  )

  const chips: ChimmyChip[] = [
    {
      id: 'optimize-lineup',
      label: 'Optimize my lineup',
      prompt: `Review my week ${data.week ?? ''} lineup in ${viewModel.league.name} and tell me which changes would raise my projected score.`,
      insightType: 'matchup',
    },
    {
      id: 'start-sit',
      label: 'Who should I start?',
      prompt: `I have tough start/sit calls in ${viewModel.league.name} this week. Walk me through my closest decisions.`,
      insightType: 'matchup',
    },
    {
      id: 'roster-holes',
      label: "Where is my roster weak?",
      prompt: `Analyze my roster construction in ${viewModel.league.name}. Which positions are thin, and what should I target?`,
    },
  ]

  return (
    <div className="af-cc-stack">
      <DegradationNotice warnings={data.warnings} />

      <LayerSection
        role={viewModel.viewer.role}
        labels={{ personal: 'Your roster', shared: 'League roster rules' }}
        personal={personal}
        shared={shared}
        commissionerOps={commissionerOps}
      />

      <DecisionOsFooter
        title="Decision OS — Roster"
        source="lineup_tool"
        onAskChimmy={onAskChimmy}
        rows={[
          {
            label: 'Lineup status',
            value: data.startersComplete ? 'Set' : `${data.emptyStarterSlots.length} slot(s) to fill`,
            tone: data.startersComplete ? 'good' : 'warn',
          },
          {
            label: 'Injured starters',
            value: data.problemStarters.length,
            tone: data.problemStarters.length > 0 ? 'bad' : 'default',
          },
          {
            label: 'Editable here',
            value: canEdit ? 'Yes' : `No — complete on ${viewModel.source.label}`,
          },
        ]}
        chips={chips}
      />
    </div>
  )
}

export default RosterSection
