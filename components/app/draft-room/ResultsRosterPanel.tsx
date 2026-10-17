'use client'

/**
 * D.6 — Sleeper-style Results / Roster panel (right column of the bottom dock).
 *
 * Shows the focused team's roster filled in canonical slot order
 * (QB / RB / RB / WR / WR / TE / FLEX / SF / [IDP] / DEF / K / BN…).
 * Users can switch the focused team via the dropdown next to the team name —
 * NO route change, NO ownership change, just a read-only view swap.
 *
 * Defaults to the current user's team when `currentUserRosterId` is provided.
 *
 * Per spec:
 *   - Use actual league roster settings; never force SF/IDP slots when the
 *     league config doesn't include them.
 *   - Preserve commissioner custom slots (rendered after the canonical block).
 *   - Bench slots come last.
 */

import { useMemo, useState, useEffect } from 'react'
import { ChevronDown, Bot, User } from 'lucide-react'
import {
  buildOrderedRosterSlots,
  assignPicksToSlots,
  type RosterSlotEntry,
} from '@/lib/draft-room/rosterSlotOrder'

export interface ResultsRosterPanelTeam {
  rosterId: string
  /** Display name — "TheCiege24", "JohnBailey33", "Slot 4". */
  displayName: string
  /** When true, this is the user's team (drives the default focus). */
  isCurrentUser?: boolean
  /** AI manager flag — surfaces a tiny robot icon next to the name. */
  isAi?: boolean
}

export interface ResultsRosterPanelPick {
  rosterId: string
  playerName: string
  position: string
  team?: string | null
  overall: number
  isDevy?: boolean
}

export interface ResultsRosterPanelProps {
  teams: readonly ResultsRosterPanelTeam[]
  /** Picks across ALL teams; the panel filters by focused rosterId. */
  picks: readonly ResultsRosterPanelPick[]
  /** Drives the default focus when no manual selection has been made. */
  currentUserRosterId: string | null
  /** League roster config — drives slot order. */
  starterSlots: Record<string, number> | null | undefined
  benchSlots?: number | null
  idpEnabled?: boolean
  /** Optional override of the focused team — used by tests / external triggers. */
  focusRosterIdOverride?: string | null
  testIdBase?: string
}

export function ResultsRosterPanel({
  teams,
  picks,
  currentUserRosterId,
  starterSlots,
  benchSlots,
  idpEnabled = false,
  focusRosterIdOverride,
  testIdBase = 'results-roster-panel',
}: ResultsRosterPanelProps) {
  // Defaults to current user; manual selection via dropdown overrides.
  const [manualFocus, setManualFocus] = useState<string | null>(null)
  // External override (e.g. test harness) wins over both.
  useEffect(() => {
    if (focusRosterIdOverride !== undefined) setManualFocus(focusRosterIdOverride)
  }, [focusRosterIdOverride])

  const focusedRosterId =
    manualFocus ?? currentUserRosterId ?? teams[0]?.rosterId ?? null
  const focusedTeam = useMemo(
    () => teams.find((t) => t.rosterId === focusedRosterId) ?? null,
    [teams, focusedRosterId],
  )

  const orderedSlots = useMemo(
    () => buildOrderedRosterSlots({ starterSlots, benchSlots, idpEnabled }),
    [starterSlots, benchSlots, idpEnabled],
  )

  const focusedPicks = useMemo(() => {
    return picks
      .filter((p) => p.rosterId === focusedRosterId)
      .slice()
      .sort((a, b) => a.overall - b.overall)
  }, [picks, focusedRosterId])

  const slotAssignments = useMemo(
    () => assignPicksToSlots(focusedPicks, orderedSlots),
    [focusedPicks, orderedSlots],
  )

  const [dropdownOpen, setDropdownOpen] = useState(false)

  const starterPicks = slotAssignments.filter((s) => s.slot.kind === 'starter' || s.slot.kind === 'custom')
  const benchPicks = slotAssignments.filter((s) => s.slot.kind === 'bench')

  return (
    <section
      data-testid={testIdBase}
      data-focused-roster-id={focusedRosterId ?? ''}
      className="flex h-full min-h-0 flex-col bg-[#060d1d] text-white"
      aria-label="Roster results"
    >
      {/* Header — team selector dropdown. */}
      <header className="shrink-0 border-b border-white/10 bg-[#0a1228] px-3 py-2">
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={dropdownOpen}
          data-testid={`${testIdBase}-team-trigger`}
          className="flex w-full items-center justify-between gap-2 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-left transition hover:border-white/25"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {focusedTeam?.isAi ? (
              <Bot className="h-3.5 w-3.5 shrink-0 text-violet-300/85" aria-label="AI manager" />
            ) : (
              <User className="h-3.5 w-3.5 shrink-0 text-cyan-200/85" aria-hidden />
            )}
            <span className="truncate text-[12px] font-semibold text-white/95">
              {focusedTeam?.displayName ?? '—'}
            </span>
            {focusedTeam?.isCurrentUser ? (
              <span className="rounded border border-cyan-400/40 bg-cyan-500/15 px-1 text-[11px] font-bold uppercase tracking-wider text-cyan-100">
                YOU
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-white/55 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {dropdownOpen ? (
          <ul
            role="listbox"
            data-testid={`${testIdBase}-team-listbox`}
            className="mt-1 max-h-[40vh] overflow-y-auto rounded border border-white/10 bg-[#0a1228] py-1 shadow-lg shadow-black/40"
          >
            {teams.map((t) => {
              const isFocused = t.rosterId === focusedRosterId
              return (
                <li key={t.rosterId} role="option" aria-selected={isFocused}>
                  <button
                    type="button"
                    data-testid={`${testIdBase}-team-option-${t.rosterId}`}
                    onClick={() => {
                      setManualFocus(t.rosterId)
                      setDropdownOpen(false)
                    }}
                    className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] transition ${
                      isFocused ? 'bg-cyan-500/12 text-cyan-100' : 'text-white/80 hover:bg-white/5'
                    }`}
                  >
                    {t.isAi ? (
                      <Bot className="h-3 w-3 shrink-0 text-violet-300/85" aria-hidden />
                    ) : (
                      <User className="h-3 w-3 shrink-0 text-cyan-200/85" aria-hidden />
                    )}
                    <span className="truncate">{t.displayName}</span>
                    {t.isCurrentUser ? (
                      <span className="ml-auto rounded border border-cyan-400/40 bg-cyan-500/15 px-1 text-[11px] font-bold uppercase tracking-wider text-cyan-100">
                        YOU
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </header>

      {/* Body — ordered slots. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SlotGroup heading="STARTERS" entries={starterPicks} testIdBase={`${testIdBase}-starters`} />
        {benchPicks.length ? (
          <SlotGroup heading="BENCH" entries={benchPicks} testIdBase={`${testIdBase}-bench`} />
        ) : null}
        {starterPicks.length === 0 && benchPicks.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-white/45">
            League roster settings have no starter slots configured yet.
          </div>
        ) : null}
      </div>
    </section>
  )
}

interface SlotGroupProps {
  heading: string
  entries: ReadonlyArray<{ slot: RosterSlotEntry; pick: ResultsRosterPanelPick | null }>
  testIdBase: string
}

function SlotGroup({ heading, entries, testIdBase }: SlotGroupProps) {
  if (!entries.length) return null
  return (
    <div className="border-b border-white/8 last:border-b-0" data-testid={testIdBase}>
      <div className="sticky top-0 bg-[#0a1228] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
        {heading}
      </div>
      <ul>
        {entries.map((entry, idx) => (
          <li
            key={`${entry.slot.label}-${idx}`}
            data-testid={`${testIdBase}-row-${idx}`}
            data-slot-label={entry.slot.label}
            data-slot-position={entry.slot.position}
            className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[11px] last:border-b-0"
          >
            <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-white/55">
              {entry.slot.label}
            </span>
            {entry.pick ? (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate text-[12px] text-white/95">
                  {entry.pick.playerName}
                </span>
                <span className="shrink-0 text-[11px] text-white/45">
                  {entry.pick.position}
                  {entry.pick.team ? ` · ${entry.pick.team}` : ''}
                </span>
              </span>
            ) : (
              <span className="text-[11px] italic text-white/35">Empty</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
