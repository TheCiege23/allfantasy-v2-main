'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CalendarClock, Check, Copy, LayoutGrid, Plus, QrCode, Settings2, Share2, Timer, Trophy, UserRound, Users } from 'lucide-react'
import { copyInviteText } from '@/components/league/invite/LeagueInviteShare'
import { inviteShareMessage } from '@/lib/league/league-invite-link'
import { formatRosterSummary } from '@/lib/league-settings-home/buildLeagueSettingsHome'

/**
 * THE pre-draft Draft tab, for every league that drafts on AllFantasy: every sport, team count and
 * draft type. Owner, 2026-11-28: "simple like Sleeper's screen… every change we make to this league
 * type should be a universal change". It replaced two screens: a "Draft setup is ready" card with
 * four stat boxes and four buttons, and a post-create popup holding a QR code, a link field, four
 * share buttons and a Clubhouse ad. The invite lives HERE now, at the top, and nowhere else on
 * arrival — so a new league opens on one calm screen instead of a modal over a busy one.
 *
 * Five blocks, top to bottom, each one line of purpose:
 *   1. Invite friends  — only while seats are open and the viewer may invite.
 *   2. Draft facts     — type, clock, rounds, teams. Edit for the commissioner.
 *   3. Draftboard      — when it is, and the way in. The mock draft is a quiet link, not a button.
 *   4. Teams           — every seat, filled or open.
 *   5. League settings — teams, scoring, roster. Edit for the commissioner.
 * Keep it that way: a sixth block is the busy screen coming back.
 */

export type PredraftTeamRow = {
  id: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  draftPosition: number | null
  /** True when a real manager holds the seat (claimed, or an imported owner). */
  filled: boolean
}

export type PredraftDraftHomeProps = {
  leagueId: string
  leagueName: string
  sport: string
  teamCount: number
  teams: PredraftTeamRow[]
  draftTypeLabel: string
  rounds: number
  /** Seconds per pick; null = not set yet, 0 = untimed. */
  timerSeconds: number | null
  draftDateIso: string | null
  scoringLabel: string | null
  /** Empty when there is no link or the viewer may not invite: the invite block is hidden. */
  inviteUrl: string
  isCommissioner: boolean
  onOpenSettings: (panel: string | null) => void
  /** Format-specific links (Zombie rules, chat) under the draftboard. */
  extra?: React.ReactNode
}

function timerLabel(seconds: number | null): string {
  if (seconds == null) return 'Clock not set'
  if (seconds <= 0) return 'No pick clock'
  if (seconds % 3600 === 0) return `${seconds / 3600} hr per pick`
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min per pick`
  return `${seconds} sec per pick`
}

function draftDateLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.03]'
const sectionTitle = 'text-[17px] font-bold text-white'
const editLink = 'min-h-11 touch-manipulation px-1 text-sm font-bold text-[#ff8fb8] hover:text-[#ffb8d1]'

function InviteBlock({ url, leagueName, filled, total }: { url: string; leagueName: string; filled: number; total: number }) {
  const [canShare, setCanShare] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [showQr, setShowQr] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  const copy = async () => {
    const outcome = await copyInviteText(url)
    setCopied(outcome)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied('idle'), 2500)
  }
  const invite = async () => {
    if (!canShare) return copy()
    try {
      await navigator.share({ title: leagueName || 'AllFantasy league', text: inviteShareMessage(leagueName), url })
    } catch {
      /* cancelled — nothing to report */
    }
  }
  const display = url.replace(/^https?:\/\//, '')

  return (
    <section aria-label="Invite friends" data-testid="predraft-invite">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionTitle}>Invite friends to play</h2>
        <p className="text-[15px] font-bold tabular-nums" data-testid="predraft-invite-count">
          <span className="text-[#ff3d81]">{filled}</span>
          <span className="text-white/70">/{total}</span>
        </p>
      </div>
      <div className={`${card} mt-3 space-y-3 p-4`}>
        <button
          type="button"
          onClick={() => void invite()}
          className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-full border-2 border-[#ff3d81]/70 bg-[#ff3d81]/10 text-sm font-black uppercase tracking-[0.12em] text-[#ffb8d1] transition active:scale-[0.99]"
          data-testid="predraft-invite-button"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Invite friends to join
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex min-h-11 min-w-0 flex-1 touch-manipulation items-center gap-2 rounded-full border border-dashed border-white/25 px-4 text-left"
            aria-label="Copy invite link"
            data-testid="predraft-invite-copy"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-white/80">{display}</span>
            {copied === 'copied' ? <Check className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden /> : <Copy className="h-4 w-4 shrink-0 text-white/60" aria-hidden />}
          </button>
          {canShare ? (
            <button
              type="button"
              onClick={() => void invite()}
              className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full bg-[#ff3d81]/15 text-[#ffb8d1]"
              aria-label="Share invite link"
              data-testid="predraft-invite-share"
            >
              <Share2 className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowQr((v) => !v)}
            aria-expanded={showQr}
            className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full bg-[#ff3d81]/15 text-[#ffb8d1]"
            aria-label={showQr ? 'Hide QR code' : 'Show QR code'}
            data-testid="predraft-invite-qr-toggle"
          >
            <QrCode className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p aria-live="polite" className="min-h-0 text-xs text-white/55 empty:hidden" data-testid="predraft-invite-status">
          {copied === 'copied' ? 'Invite link copied.' : copied === 'failed' ? 'Couldn’t copy. Press and hold the link to copy it.' : ''}
        </p>
        {showQr ? (
          <div className="flex justify-center" data-testid="predraft-invite-qr">
            <div className="rounded-xl bg-[#ffffff] p-3">
              <QRCodeSVG value={url} size={160} level="M" aria-label="QR code for the invite link" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function PredraftDraftHome(props: PredraftDraftHomeProps) {
  const { leagueId, leagueName, sport, teamCount, teams, isCommissioner, onOpenSettings } = props
  const filled = teams.filter((t) => t.filled).length
  const openSeats = Math.max(0, teamCount - filled)
  const date = draftDateLabel(props.draftDateIso)
  const mockHref = `/mock-draft?leagueId=${encodeURIComponent(leagueId)}&sport=${encodeURIComponent(String(sport).toLowerCase())}`

  // Roster positions come from the commissioner route; a member who cannot read it just doesn't see the row.
  const [roster, setRoster] = useState<string | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings`, { credentials: 'include', signal: ac.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { slots?: Record<string, number> } } | null) => {
        const slots = d?.config?.slots
        if (!ac.signal.aborted && slots && typeof slots === 'object' && Object.keys(slots).length) setRoster(formatRosterSummary(slots))
      })
      .catch(() => {})
    return () => ac.abort()
  }, [leagueId])

  // Seats in draft order; an empty seat still gets a row, so 1/12 reads as twelve places to fill.
  const ordered = [...teams].sort((a, b) => (a.draftPosition ?? 999) - (b.draftPosition ?? 999))
  const rows: (PredraftTeamRow | null)[] = ordered.slice(0, Math.max(teamCount, ordered.length))
  while (rows.length < teamCount) rows.push(null)

  const facts = [
    { icon: LayoutGrid, label: props.draftTypeLabel },
    { icon: Timer, label: timerLabel(props.timerSeconds) },
    { icon: CalendarClock, label: `${props.rounds} rounds` },
    { icon: Users, label: `${teamCount} teams` },
  ]

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7 pb-8" data-testid="predraft-draft-home">
      {props.inviteUrl && openSeats > 0 ? <InviteBlock url={props.inviteUrl} leagueName={leagueName} filled={filled} total={teamCount} /> : null}

      <section aria-label="Draft" data-testid="predraft-draft-facts">
        <div className={`${card} grid grid-cols-2 gap-x-3 gap-y-4 p-4`}>
          {facts.map(({ icon: Icon, label }) => (
            <div key={label} className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.08] text-white/80">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="truncate text-[15px] text-white/90">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Draftboard" data-testid="predraft-draftboard">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={sectionTitle}>Draftboard</h2>
            <p className="mt-0.5 text-sm text-white/55">{date ? `Drafts ${date}` : 'Draft time has not been set'}</p>
          </div>
          {isCommissioner ? (
            <button type="button" onClick={() => onOpenSettings('draft')} className={editLink} data-testid="predraft-open-draft-settings">
              Edit
            </button>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          {!date && isCommissioner ? (
            <button
              type="button"
              onClick={() => onOpenSettings('draft')}
              className="flex min-h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl border border-white/20 text-sm font-black uppercase tracking-[0.1em] text-white"
              data-testid="predraft-set-draft-time"
            >
              <CalendarClock className="h-4 w-4" aria-hidden />
              Set draft time
            </button>
          ) : null}
          <Link
            href={`/league/${leagueId}/draft`}
            className="flex min-h-14 w-full touch-manipulation items-center justify-center rounded-2xl bg-[#ff3d81] text-sm font-black uppercase tracking-[0.1em] text-[#ffffff] transition active:scale-[0.99]"
            data-testid="predraft-open-draft-room"
          >
            Enter draft room
          </Link>
          <Link href={mockHref} className="block py-1 text-center text-sm font-semibold text-white/60 hover:text-white" data-testid="predraft-start-mock-draft">
            Practice with a mock draft
          </Link>
        </div>
        {props.extra}
      </section>

      <section aria-label="Teams" data-testid="predraft-teams">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={sectionTitle}>Teams</h2>
            <p className="mt-0.5 text-sm text-white/55">
              {openSeats > 0 ? `Invite ${openSeats} more ${openSeats === 1 ? 'friend' : 'friends'}` : 'Every seat is filled'}
            </p>
          </div>
        </div>
        <ol className={`${card} mt-3 divide-y divide-white/[0.06] overflow-hidden`}>
          {rows.map((team, i) => (
            <li key={team?.id ?? `open-${i}`} className="flex min-h-14 items-center gap-3 px-4 py-2" data-testid={team?.filled ? 'predraft-team-filled' : 'predraft-team-open'}>
              <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-white/45">{i + 1}</span>
              {team?.filled && team.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={team.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${team?.filled ? 'bg-[#ff3d81]/20 text-[#ffb8d1]' : 'bg-white/[0.06] text-white/35'}`}>
                  <UserRound className="h-4 w-4" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[15px] font-semibold ${team?.filled ? 'text-white' : 'text-white/45'}`}>
                  {team?.filled ? team.teamName || team.ownerName : 'Open seat'}
                </p>
                {team?.filled && team.ownerName && team.ownerName !== team.teamName ? (
                  <p className="truncate text-xs text-white/50">{team.ownerName}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="League settings" data-testid="predraft-league-settings">
        <div className="flex items-center justify-between gap-3">
          <h2 className={sectionTitle}>League settings</h2>
          {isCommissioner ? (
            <button type="button" onClick={() => onOpenSettings(null)} className={editLink} data-testid="predraft-open-league-settings">
              Edit
            </button>
          ) : null}
        </div>
        <dl className={`${card} mt-3 space-y-4 p-4`}>
          <div>
            <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
              <Users className="h-3.5 w-3.5" aria-hidden /> Teams
            </dt>
            <dd className="mt-1 text-[15px] text-white">{teamCount}</dd>
          </div>
          {props.scoringLabel ? (
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                <Trophy className="h-3.5 w-3.5" aria-hidden /> Scoring
              </dt>
              <dd className="mt-1 text-[15px] text-white">{props.scoringLabel}</dd>
            </div>
          ) : null}
          {roster ? (
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                <Settings2 className="h-3.5 w-3.5" aria-hidden /> Roster
              </dt>
              <dd className="mt-1 text-[15px] leading-relaxed text-white" data-testid="predraft-roster">{roster}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  )
}
