'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UserPlus, Users, X } from 'lucide-react'
import type { UserLeagueTeam } from '@/app/dashboard/types'
import { LeagueInviteShare } from '@/components/league/invite/LeagueInviteShare'
import { leagueJoinUrl } from '@/lib/league/league-invite-link'

/** How many seats show before "+N more"; a 20-team Survivor league should not fill a phone. */
export const SEAT_PREVIEW_LIMIT = 12

export type SeatRow =
  | { kind: 'claimed'; id: string; name: string; teamName: string; avatarUrl: string | null; isYou: boolean }
  | { kind: 'open'; id: string }

/**
 * The seats to draw: everyone who has claimed one (you first, then draft order), then one open
 * chip per unclaimed seat. Open seats are counted from the league size, never from the team rows:
 * create makes placeholder rows, and a league can have fewer rows than seats.
 */
export function buildSeatRows(teams: readonly UserLeagueTeam[], teamCount: number, userTeamId: string | null): SeatRow[] {
  const claimed = teams
    .filter((team) => Boolean(team.claimedByUserId))
    .sort((a, b) => {
      if (a.id === userTeamId) return -1
      if (b.id === userTeamId) return 1
      return (a.draftPosition ?? 999) - (b.draftPosition ?? 999)
    })
    .map<SeatRow>((team) => ({
      kind: 'claimed',
      id: team.id,
      name: team.ownerName?.trim() || team.teamName?.trim() || 'Manager',
      teamName: team.teamName?.trim() || '',
      avatarUrl: team.avatarUrl ?? null,
      isYou: team.id === userTeamId,
    }))
  const open = Math.max(0, teamCount - claimed.length)
  return [...claimed, ...Array.from({ length: open }, (_, index) => ({ kind: 'open' as const, id: `open-${index}` }))]
}

/** "JD" from "John Doe", "J" from "john". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`
  return letters.toUpperCase()
}

function InviteSheet({ inviteUrl, leagueName, filled, total, onClose }: { inviteUrl: string; leagueName: string; filled: number; total: number; onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(2,6,23,0.72)] backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      data-testid="seat-invite-sheet"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 text-[color:var(--text-primary)] shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-black leading-tight">
            Invite managers to {leagueName}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-secondary)]"
            data-testid="seat-invite-close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <LeagueInviteShare url={inviteUrl} leagueName={leagueName} filled={filled} total={total} testIdPrefix="seat-invite" />
      </div>
    </div>
  )
}

/**
 * Who is in the league and which seats are still open. The commissioner can invite from any open
 * seat; everyone else sees the seats waiting. Replaces a single sentence ("3 of 12 manager seats
 * claimed") that gave nobody anything to do.
 */
export function LeagueSeatTracker({
  teams,
  teamCount,
  userTeamId,
  leagueName,
  inviteCode,
  canInvite,
  onOpenInviteSettings,
}: {
  teams: readonly UserLeagueTeam[]
  teamCount: number
  userTeamId: string | null
  leagueName: string
  /** The league's invite code; the link is built when the sheet opens, on the host serving it. */
  inviteCode: string
  canInvite: boolean
  /** No code yet: Settings › Invite mints one. */
  onOpenInviteSettings: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const rows = buildSeatRows(teams, teamCount, userTeamId)
  const filled = rows.filter((row) => row.kind === 'claimed').length
  const total = Math.max(teamCount, filled)
  const open = total - filled
  const visible = expanded ? rows : rows.slice(0, SEAT_PREVIEW_LIMIT)
  const hidden = rows.length - visible.length
  const percent = total > 0 ? Math.round((filled / total) * 100) : 0

  const closeInvite = useCallback(() => setInviteOpen(false), [])

  const invite = () => {
    if (!inviteCode) {
      onOpenInviteSettings()
      return
    }
    setInviteOpen(true)
  }

  return (
    <section className="nl-card nl-seats" aria-label="League seats" data-testid="seat-tracker">
      <div className="nl-card-label">
        <span>Managers</span>
        <Users size={16} aria-hidden />
      </div>
      <h2 data-testid="seat-tracker-count">
        {open === 0 ? `League full · ${filled} of ${total}` : `${filled} of ${total} joined`}
      </h2>
      <div className="nl-seats-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={filled} aria-label="Seats filled">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>
        {open === 0
          ? 'Every seat is taken.'
          : canInvite
            ? `${open} open ${open === 1 ? 'seat' : 'seats'}. Tap one to send the invite link.`
            : `${open} open ${open === 1 ? 'seat' : 'seats'}. The commissioner is still inviting managers.`}
      </p>
      <ul className="nl-seats-grid" data-testid="seat-tracker-list">
        {visible.map((row) =>
          row.kind === 'claimed' ? (
            <li key={row.id} className="nl-seat" data-seat="claimed" data-own-team={row.isYou || undefined}>
              {row.avatarUrl ? (
                <img src={row.avatarUrl} alt="" className="nl-seat-avatar" />
              ) : (
                <span className="nl-seat-avatar" aria-hidden>
                  {initialsOf(row.name)}
                </span>
              )}
              <span className="nl-seat-name">
                <strong>{row.isYou ? `${row.name} (you)` : row.name}</strong>
                {row.teamName && row.teamName !== row.name ? <small>{row.teamName}</small> : null}
              </span>
            </li>
          ) : (
            <li key={row.id} className="nl-seat" data-seat="open">
              {canInvite ? (
                <button type="button" className="nl-seat-invite" onClick={invite} data-testid="seat-tracker-invite">
                  <UserPlus size={15} aria-hidden />
                  Invite
                </button>
              ) : (
                <span className="nl-seat-waiting">Open seat</span>
              )}
            </li>
          ),
        )}
      </ul>
      {hidden > 0 || expanded ? (
        <button type="button" className="nl-text-link" onClick={() => setExpanded((value) => !value)} data-testid="seat-tracker-more">
          {expanded ? 'Show fewer' : `Show all ${rows.length} seats (+${hidden})`}
        </button>
      ) : null}
      {/* Portalled: a fixed sheet inside a card is clipped by any transformed ancestor. */}
      {inviteOpen && typeof document !== 'undefined'
        ? createPortal(
            <InviteSheet inviteUrl={leagueJoinUrl(inviteCode)} leagueName={leagueName} filled={filled} total={total} onClose={closeInvite} />,
            document.body,
          )
        : null}
    </section>
  )
}
