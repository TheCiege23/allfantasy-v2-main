'use client'

/**
 * Dynasty / C2C / devy-aware roster strip rendered inside the draft team panel.
 *
 * Groups the focused team's drafted picks into four sections — Starters, Bench,
 * Taxi, Devy — with position color-coding and slot placeholders so a manager
 * can see roster gaps as the draft progresses.
 *
 * Starter assignment uses a greedy fill:
 *   1. Walk drafted picks in draft order (lowest overall first).
 *   2. For each pick, place it in the first empty starter slot matching its
 *      position. If no exact match, try the first empty FLEX slot (RB/WR/TE
 *      eligible; SUPERFLEX adds QB).
 *   3. Overflow picks go to Bench. Picks flagged as devy-round go to Devy.
 *      Picks explicitly tagged `isTaxi` go to Taxi.
 *
 * When `starterSlots` is not supplied, falls back to sport defaults (NFL shown).
 */

import React, { useMemo } from 'react'
import { Users } from 'lucide-react'
import { PlayerAvatar } from './PlayerAvatar'

export interface DraftRosterStripPick {
  playerName: string
  position: string
  overall: number
  /** True when this pick was taken during a devy round (routed from the page). */
  isDevy?: boolean
  /** True when commissioner/manager flagged the player as taxi-squad eligible. */
  isTaxi?: boolean
  /** Optional NFL team abbreviation (badge / DEF logo selection). */
  team?: string | null
  /** Optional headshot URL — falls back to silhouette+initials when missing. */
  headshotUrl?: string | null
  /** Optional team logo URL — DEF promotes to primary avatar; others render as bottom-right badge. */
  teamLogoUrl?: string | null
}

export interface DraftRosterStripProps {
  picks: DraftRosterStripPick[]
  /** Map of starter slot name → count (QB, RB, WR, TE, FLEX, SUPERFLEX, K, DEF, …). */
  starterSlots?: Record<string, number> | null
  benchSlots?: number | null
  taxiSlots?: number | null
  devySlots?: number | null
  /** When true, taxi section renders even if no picks routed there yet. */
  isDynasty?: boolean
  /** Optional label for the focused team — shown in the section header. */
  teamLabel?: string | null
  sport?: string | null
}

const POSITION_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  QB: { border: 'border-rose-400/45', bg: 'bg-rose-500/12', text: 'text-rose-200' },
  RB: { border: 'border-emerald-400/45', bg: 'bg-emerald-500/12', text: 'text-emerald-200' },
  WR: { border: 'border-sky-400/45', bg: 'bg-sky-500/12', text: 'text-sky-200' },
  TE: { border: 'border-amber-400/45', bg: 'bg-amber-500/12', text: 'text-amber-200' },
  K: { border: 'border-violet-400/45', bg: 'bg-violet-500/12', text: 'text-violet-200' },
  DEF: { border: 'border-slate-400/45', bg: 'bg-slate-500/15', text: 'text-slate-200' },
  DST: { border: 'border-slate-400/45', bg: 'bg-slate-500/15', text: 'text-slate-200' },
  FLX: { border: 'border-cyan-400/45', bg: 'bg-cyan-500/12', text: 'text-cyan-200' },
  FLEX: { border: 'border-cyan-400/45', bg: 'bg-cyan-500/12', text: 'text-cyan-200' },
  SF: { border: 'border-fuchsia-400/45', bg: 'bg-fuchsia-500/12', text: 'text-fuchsia-200' },
  SUPERFLEX: { border: 'border-fuchsia-400/45', bg: 'bg-fuchsia-500/12', text: 'text-fuchsia-200' },
}

const NEUTRAL_COLOR = { border: 'border-white/15', bg: 'bg-white/[0.04]', text: 'text-white/70' }

const DEFAULT_NFL_STARTERS: Record<string, number> = {
  QB: 1,
  RB: 1,
  WR: 2,
  TE: 1,
  DEF: 1,
}

function colorForPosition(position: string): { border: string; bg: string; text: string } {
  return POSITION_COLORS[position.toUpperCase()] ?? NEUTRAL_COLOR
}

function normalizeSlotKey(key: string): string {
  const value = key.trim().toUpperCase().replace(/\s+/g, '')
  if (value === 'FLEX') return 'FLX'
  if (value === 'SUPERFLEX' || value === 'SUPER_FLEX') return 'SF'
  if (value === 'DST' || value === 'D/ST' || value === 'DEFENSE') return 'DEF'
  return value
}

function flexEligible(position: string, flexKey: string): boolean {
  const pos = position.toUpperCase()
  if (flexKey === 'FLEX' || flexKey === 'FLX') return pos === 'RB' || pos === 'WR' || pos === 'TE'
  if (flexKey === 'SUPERFLEX' || flexKey === 'SUPER_FLEX' || flexKey === 'SF') {
    return pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE'
  }
  if (flexKey === 'WR/RB' || flexKey === 'RB/WR') return pos === 'RB' || pos === 'WR'
  if (flexKey === 'WR/TE') return pos === 'WR' || pos === 'TE'
  return false
}

type Slot = { key: string; label: string; pick: DraftRosterStripPick | null }

function buildStarterSlots(
  starterSlots: Record<string, number>,
  sortedPicks: DraftRosterStripPick[],
  excluded: Set<number>,
): { slots: Slot[]; usedOveralls: Set<number> } {
  const slots: Slot[] = []
  for (const [rawKey, count] of Object.entries(starterSlots)) {
    const key = normalizeSlotKey(rawKey)
    for (let i = 0; i < (count ?? 0); i += 1) {
      slots.push({ key, label: key, pick: null })
    }
  }

  const used = new Set<number>()

  for (const pick of sortedPicks) {
    if (excluded.has(pick.overall)) continue
    const pos = pick.position.toUpperCase()

    const directIdx = slots.findIndex((s) => !s.pick && s.key === pos)
    if (directIdx >= 0) {
      slots[directIdx]!.pick = pick
      used.add(pick.overall)
      continue
    }

    const flexIdx = slots.findIndex((s) => !s.pick && flexEligible(pos, s.key))
    if (flexIdx >= 0) {
      slots[flexIdx]!.pick = pick
      used.add(pick.overall)
    }
  }

  return { slots, usedOveralls: used }
}

function buildFillerSlots(
  capacity: number,
  assigned: DraftRosterStripPick[],
): Slot[] {
  const slots: Slot[] = []
  for (let i = 0; i < capacity; i += 1) {
    slots.push({ key: 'BN', label: `BN${i + 1}`, pick: assigned[i] ?? null })
  }
  for (let i = capacity; i < assigned.length; i += 1) {
    slots.push({ key: 'BN', label: `BN${i + 1}`, pick: assigned[i]! })
  }
  return slots
}

export function DraftRosterStrip({
  picks,
  starterSlots,
  benchSlots,
  taxiSlots,
  devySlots,
  isDynasty = false,
  teamLabel,
  sport,
}: DraftRosterStripProps) {
  const effectiveStarterSlots = useMemo(() => {
    if (starterSlots && Object.keys(starterSlots).length > 0) return starterSlots
    return DEFAULT_NFL_STARTERS
  }, [starterSlots])

  const sortedPicks = useMemo(
    () => picks.slice().sort((a, b) => a.overall - b.overall),
    [picks],
  )

  const devyPicks = useMemo(
    () => sortedPicks.filter((p) => p.isDevy === true),
    [sortedPicks],
  )
  const taxiPicks = useMemo(
    () => sortedPicks.filter((p) => p.isTaxi === true),
    [sortedPicks],
  )
  const excludedFromStarters = useMemo(() => {
    const s = new Set<number>()
    for (const p of devyPicks) s.add(p.overall)
    for (const p of taxiPicks) s.add(p.overall)
    return s
  }, [devyPicks, taxiPicks])

  const { slots: starterSlotList, usedOveralls } = useMemo(
    () => buildStarterSlots(effectiveStarterSlots, sortedPicks, excludedFromStarters),
    [effectiveStarterSlots, sortedPicks, excludedFromStarters],
  )

  const benchPicks = useMemo(
    () =>
      sortedPicks.filter(
        (p) => !usedOveralls.has(p.overall) && !excludedFromStarters.has(p.overall),
      ),
    [sortedPicks, usedOveralls, excludedFromStarters],
  )

  const benchCapacity = Math.max(0, benchSlots ?? 6)
  const benchSlotList = useMemo(
    () => buildFillerSlots(benchCapacity, benchPicks),
    [benchCapacity, benchPicks],
  )

  const taxiCapacity = Math.max(0, taxiSlots ?? 0)
  const taxiSlotList = useMemo(
    () =>
      taxiCapacity > 0 || taxiPicks.length > 0
        ? buildFillerSlots(taxiCapacity, taxiPicks).map((s, i) => ({
            ...s,
            key: 'TX',
            label: `TX${i + 1}`,
          }))
        : [],
    [taxiCapacity, taxiPicks],
  )

  const devyCapacity = Math.max(0, devySlots ?? 0)
  const devySlotList = useMemo(
    () =>
      devyCapacity > 0 || devyPicks.length > 0
        ? buildFillerSlots(devyCapacity, devyPicks).map((s, i) => ({
            ...s,
            key: 'DV',
            label: `DV${i + 1}`,
          }))
        : [],
    [devyCapacity, devyPicks],
  )

  const showTaxi = isDynasty || taxiCapacity > 0 || taxiPicks.length > 0
  const showDevy = devyCapacity > 0 || devyPicks.length > 0

  return (
    <section
      className="border-t border-white/8 bg-[#050c1d] px-3 py-2"
      data-testid="draft-roster-strip"
      aria-label="Roster strip"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Users className="h-3 w-3 text-cyan-300/80" aria-hidden />
        <p className="text-[11px] font-medium uppercase tracking-wider text-cyan-200/80">
          Roster
          {teamLabel ? <span className="ml-1 text-white/55">· {teamLabel}</span> : null}
          {sport ? <span className="ml-1 text-white/30">· {sport}</span> : null}
        </p>
      </div>

      <RosterSection title="Starters" slots={starterSlotList} emptyHint="No starter slots configured." />

      {benchSlotList.length > 0 ? (
        <RosterSection title="Bench" slots={benchSlotList} emptyHint={null} />
      ) : null}

      {showTaxi ? (
        <RosterSection
          title="Taxi"
          slots={taxiSlotList.length > 0 ? taxiSlotList : [{ key: 'TX', label: 'TX1', pick: null }]}
          emptyHint="No taxi picks yet."
        />
      ) : null}

      {showDevy ? (
        <RosterSection
          title="Devy"
          slots={devySlotList.length > 0 ? devySlotList : [{ key: 'DV', label: 'DV1', pick: null }]}
          emptyHint="No devy picks yet."
        />
      ) : null}
    </section>
  )
}

function RosterSection({
  title,
  slots,
  emptyHint,
}: {
  title: string
  slots: Slot[]
  emptyHint: string | null
}) {
  if (slots.length === 0 && emptyHint === null) return null
  return (
    <div
      className="mb-1.5 last:mb-0"
      data-testid={`draft-roster-strip-section-${title.toLowerCase()}`}
    >
      <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-white/38">{title}</p>
      {slots.length === 0 ? (
        <p className="text-[11px] text-white/30">{emptyHint}</p>
      ) : (
        <ul className="space-y-0.5">
          {slots.map((slot, idx) => {
            const tone = slot.pick
              ? colorForPosition(slot.pick.position)
              : colorForPosition(slot.label)
            return (
              <li
                key={`${title}-${idx}-${slot.label}`}
                className={`flex items-center gap-2 rounded border px-1.5 py-1 text-[11px] ${tone.border} ${tone.bg}`}
              >
                <span
                  className={`inline-flex min-w-[28px] shrink-0 justify-center rounded px-1 py-0.5 text-[11px] font-black uppercase tracking-[0.1em] ${tone.text} ${tone.bg} ${tone.border} border`}
                >
                  {slot.label}
                </span>
                {slot.pick ? (
                  <>
                    <PlayerAvatar
                      headshotUrl={slot.pick.headshotUrl ?? null}
                      teamLogoUrl={slot.pick.teamLogoUrl ?? null}
                      teamAbbr={slot.pick.team ?? null}
                      position={slot.pick.position}
                      displayName={slot.pick.playerName}
                      size={22}
                      testIdBase={`draft-roster-strip-avatar-${title}-${idx}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-white/88">
                      {slot.pick.playerName}
                    </span>
                    <span className="shrink-0 text-[11px] text-white/45">
                      {slot.pick.position} · #{slot.pick.overall}
                    </span>
                  </>
                ) : (
                  <span className="italic text-white/28">Empty</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
