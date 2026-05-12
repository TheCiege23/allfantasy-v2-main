'use client'

/**
 * Horizontal team strip rendered above the draft board.
 *
 * Mirrors the reference draft-room layout: a row of circular team avatars
 * with display names underneath, matching the board's column order (slot).
 * Unfilled / unclaimed slots render as a "CLAIM" chip placeholder the
 * commissioner can use to invite more managers or spot orphan seats.
 *
 * Respects imported leagues — shows real `LeagueTeam.teamName` + avatar
 * when that's richer than the normalized slotOrder display name.
 */

import React, { memo, useMemo } from 'react'
import { getManagerColorBySlot } from '@/lib/draft-room'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { BotPersonalityBadge } from '@/components/league-feed/BotPersonalityBadge'

export interface DraftTeamStripTeamMeta {
  rosterId: string
  teamName?: string | null
  ownerName?: string | null
  avatarUrl?: string | null
  /** When true, roster is orphaned (no claimant); renders a CLAIM chip. */
  isOrphan?: boolean
  /** Highlights the cell border when this slot is on the clock. */
  isOnClock?: boolean
  /** AI opponent archetype label from `/api/league/ai-opponents/summary`. */
  aiArchetypeLabel?: string | null
}

export interface DraftTeamStripProps {
  teamCount: number
  slotOrder: SlotOrderEntry[]
  /** Map of rosterId → LeagueTeam metadata for richer display. Optional. */
  teamMetaByRoster?: Record<string, DraftTeamStripTeamMeta> | null
  /** Current user's roster id — gets a cyan glow. */
  currentUserRosterId?: string | null
  /** Roster id currently on the clock — gets a flame/accent border. */
  onClockRosterId?: string | null
  /** When set and slot has no claimant, renders a CLAIM button → callback. */
  onClaimSlot?: (slot: number) => void
  /** When set, clicking any slot triggers this (e.g., roster peek). */
  onSelectSlot?: (slot: number) => void
  /** Optional invite CTA for the commissioner; shown on empty slots. */
  canInvite?: boolean
}

function initials(name: string | null | undefined): string {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '??'
}

function DraftTeamStripInner({
  teamCount,
  slotOrder,
  teamMetaByRoster,
  currentUserRosterId,
  onClockRosterId,
  onClaimSlot,
  onSelectSlot,
  canInvite = false,
}: DraftTeamStripProps) {
  const bySlot = useMemo(() => {
    const map = new Map<number, SlotOrderEntry>()
    for (const entry of slotOrder) map.set(entry.slot, entry)
    return map
  }, [slotOrder])

  const columns = useMemo(() => Array.from({ length: teamCount }, (_, i) => i + 1), [teamCount])

  return (
    <section
      className="border-b border-cyan-400/20 bg-gradient-to-r from-[#0f1728] via-[#132445] to-[#0f1728] px-2 py-2.5 backdrop-blur-sm"
      data-testid="draft-team-strip"
      aria-label="Draft managers"
    >
      <div
        className="grid gap-1.5 sm:gap-2"
        style={{ gridTemplateColumns: `repeat(${teamCount}, minmax(80px, 1fr))` }}
      >
        {columns.map((slot) => {
          const entry = bySlot.get(slot)
          const meta = entry ? teamMetaByRoster?.[entry.rosterId] : null
          const color = getManagerColorBySlot(slot)
          const displayName =
            meta?.teamName?.trim() ||
            meta?.ownerName?.trim() ||
            entry?.displayName ||
            `Team ${slot}`
          const isUser = !!currentUserRosterId && entry?.rosterId === currentUserRosterId
          const isOnClock = !!onClockRosterId && entry?.rosterId === onClockRosterId
          const isOrphan = meta?.isOrphan

          if (!entry) {
            // Empty slot — CLAIM placeholder
            return (
              <div
                key={`empty-${slot}`}
                className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-white/15 bg-white/[0.04] p-2"
                data-testid={`draft-team-strip-empty-${slot}`}
              >
                {canInvite && onClaimSlot ? (
                  <button
                    type="button"
                    onClick={() => onClaimSlot(slot)}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/80 bg-gradient-to-br from-cyan-500/50 to-cyan-600/30 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-100 hover:from-cyan-400/60 hover:to-cyan-500/40 shadow-lg shadow-cyan-500/30 transition-all hover:shadow-xl hover:shadow-cyan-500/40"
                  >
                    CLAIM
                  </button>
                ) : (
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-[10px] font-semibold text-white/50">
                    {slot}
                  </span>
                )}
                <span className="truncate text-[9px] text-white/50">Team {slot}</span>
              </div>
            )
          }

          return (
            <button
              key={entry.rosterId}
              type="button"
              onClick={onSelectSlot ? () => onSelectSlot(slot) : undefined}
              disabled={!onSelectSlot}
              data-testid={`draft-team-strip-slot-${slot}`}
              className={`flex flex-col items-center gap-1 rounded-lg p-2 transition ${
                onSelectSlot ? 'hover:bg-white/[0.06]' : ''
              } ${isUser ? 'ring-1 ring-cyan-300/70' : ''}`}
            >
              <div
                className={`relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 shadow-lg ${
                  isOnClock
                    ? 'border-amber-300/95 shadow-[0_0_0_4px_rgba(252,211,77,0.4),0_0_20px_rgba(252,211,77,0.5)]'
                    : isUser
                      ? 'border-cyan-400/70 shadow-[0_0_0_3px_rgba(34,211,238,0.3),0_0_16px_rgba(34,211,238,0.4)]'
                      : 'border-cyan-400/30 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                }`}
                style={{ backgroundColor: color.tintHex + '50' }}
              >
                {meta?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={meta.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <span className="text-[11px] font-black text-white/90">
                    {initials(displayName)}
                  </span>
                )}
                {isOrphan && (
                  <span
                    className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-amber-300/60 bg-amber-500 text-[8px] font-black text-black"
                    title="Orphan roster"
                  >
                    !
                  </span>
                )}
              </div>
              <span
                className={`w-full truncate text-[9px] ${
                  isUser ? 'font-bold text-cyan-200' : 'text-white/80'
                }`}
                title={displayName}
              >
                {displayName}
              </span>
              {meta?.aiArchetypeLabel ? (
                <BotPersonalityBadge archetypeLabel={meta.aiArchetypeLabel} compact className="max-w-full" />
              ) : null}
              {isOnClock && (
                <span className="rounded-full bg-amber-400/95 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-black">
                  On clock
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/**
 * P1 Fix #9: Wrapped in React.memo so the team strip does not re-render on every
 * timer tick, chat update, or poll that doesn't change the on-clock roster or team meta.
 */
export const DraftTeamStrip = memo(DraftTeamStripInner)
