'use client'

import { useState } from 'react'
import { initialsFor, safeAvatarUrl } from './chatLayout'

/**
 * One row in the DM or huddle list: who it is with (their avatar, or up to three stacked for a
 * huddle), a one-line preview of the last message you can read, how long ago, and whether there is
 * anything unread.
 *
 * Everything here comes from `/api/shared/chat/threads` as it is — the preview is filtered on the
 * server (private rows for someone else, blocked senders, moderator-hidden and deleted rows), so
 * this file only formats it. A client copy of those rules would be the one that drifts.
 */

export type ThreadRowPerson = { id: string; name: string; avatarUrl: string | null }

export type ThreadRowContext = {
  lastMessagePreview?: string | null
  lastMessageMine?: boolean
  /** Your last message has been opened by the other person — drives ✓ (sent) vs ✓✓ (seen). */
  lastMessageSeen?: boolean
  lastMessageCreatedAt?: string | null
  members?: ThreadRowPerson[]
  isMuted?: boolean
  /** DM only: when the other person last had a conversation open. */
  otherLastActiveAt?: string | null
}

export type ThreadRowThread = {
  id: string
  threadType: string
  title: string
  lastMessageAt: string
  unreadCount: number
  memberCount: number
  context?: ThreadRowContext | null
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "now", "5m", "3h", "Tue", "Sep 12" — and "Sep 12, 2025" once it is another year. */
export function formatThreadTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const then = new Date(iso)
  const t = then.getTime()
  if (!Number.isFinite(t) || t <= 0) return ''
  const diff = now.getTime() - t
  // A clock a little ahead of ours is still "now", never "-2m".
  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < 7 * DAY) return then.toLocaleDateString('en-US', { weekday: 'short' })
  const sameYear = then.getFullYear() === now.getFullYear()
  return then.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Within this, someone counts as here right now: an open conversation re-stamps every 4-8s. */
export const ACTIVE_NOW_MS = 5 * MINUTE

/**
 * "Active now", "Active 12m ago", "Active 3h ago", "Active yesterday" — or null past a week, where a
 * stale "last seen" says nothing useful. It is chat activity (an open DM or huddle), and the header
 * that shows it says so; nothing here claims the person is or is not on AllFantasy.
 */
export function formatLastActive(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t) || t <= 0) return null
  const diff = now.getTime() - t
  if (diff < ACTIVE_NOW_MS) return 'Active now'
  if (diff < HOUR) return `Active ${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `Active ${Math.floor(diff / HOUR)}h ago`
  if (diff < 2 * DAY) return 'Active yesterday'
  if (diff < 7 * DAY) return `Active ${Math.floor(diff / DAY)}d ago`
  return null
}

/** The one line under the name: "You: " on your own, the server's label for media, or a nudge. */
export function threadRowPreview(context: ThreadRowContext | null | undefined): string {
  const preview = typeof context?.lastMessagePreview === 'string' ? context.lastMessagePreview.trim() : ''
  if (!preview) return 'No messages yet'
  return context?.lastMessageMine ? `You: ${preview}` : preview
}

/**
 * ✓ sent, ✓✓ seen — only ever on your OWN last message. One tick is "it is there for them", never
 * "they ignored you": a recipient with no read on record has simply not opened it yet.
 */
export function ReadTicks({
  seen,
  className = 'af-cm-ticks',
  announce = true,
}: {
  seen: boolean
  className?: string
  /** False when visible text beside the ticks already says it ("Seen by Jordan"). */
  announce?: boolean
}) {
  return (
    <span className={className} data-seen={seen || undefined} title={seen ? 'Seen' : 'Sent'}>
      <svg viewBox="0 0 18 12" width="16" height="11" aria-hidden="true" focusable="false">
        <path d="M1 6.5l3.5 3.5L11 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {seen ? (
          <path d="M7.5 10L14 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
      </svg>
      {announce ? <span className="af-cm-sr">{seen ? 'Seen' : 'Sent'}</span> : null}
    </span>
  )
}

function Avatar({ person }: { person: ThreadRowPerson }) {
  const safe = safeAvatarUrl(person.avatarUrl)
  const [failed, setFailed] = useState(false)
  return (
    <span className="af-cm-dmrow-av" title={person.name}>
      {safe && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={safe} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="af-cm-dmrow-initials">{initialsFor(person.name)}</span>
      )}
    </span>
  )
}

export function ThreadListRow({
  thread,
  now,
  onOpen,
}: {
  thread: ThreadRowThread
  now: Date
  onOpen: () => void
}) {
  const ctx = thread.context ?? null
  const title = thread.title || `${thread.memberCount} people`
  const members = Array.isArray(ctx?.members) ? ctx!.members.filter((m) => m && m.id) : []
  // A DM is one face; a huddle stacks up to three. With nobody named, the title's initials stand in.
  const faces: ThreadRowPerson[] =
    members.length > 0
      ? members.slice(0, thread.threadType === 'dm' ? 1 : 3)
      : [{ id: `${thread.id}-title`, name: title, avatarUrl: null }]
  const unread = thread.unreadCount > 0
  const time = formatThreadTime(ctx?.lastMessageCreatedAt || thread.lastMessageAt, now)
  const preview = threadRowPreview(ctx)
  const showTicks =
    Boolean(ctx?.lastMessageMine) && typeof ctx?.lastMessagePreview === 'string' && ctx.lastMessagePreview.trim() !== ''
  const activeNow = thread.threadType === 'dm' && formatLastActive(ctx?.otherLastActiveAt, now) === 'Active now'

  return (
    <button
      type="button"
      className="af-cm-threadrow af-cm-dmrow"
      data-unread={unread || undefined}
      data-muted={ctx?.isMuted || undefined}
      onClick={onOpen}
    >
      <span className="af-cm-dmrow-avs" data-count={faces.length} aria-hidden="true">
        {faces.map((p) => (
          <Avatar key={p.id} person={p} />
        ))}
        {activeNow ? <span className="af-cm-dmrow-presence" /> : null}
      </span>
      <span className="af-cm-dmrow-main">
        <span className="af-cm-dmrow-top">
          <span className="af-cm-threadrow-title">
            {title}
            {activeNow ? <span className="af-cm-sr"> (active now)</span> : null}
          </span>
          {ctx?.isMuted ? (
            <span className="af-cm-dmrow-muted" title="Muted">
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
                <path d="M8.7 3A6 6 0 0 1 18 8a21 21 0 0 0 .6 5M17 17H3s3-2 3-9a4.7 4.7 0 0 1 .3-1.7M10.3 21a1.9 1.9 0 0 0 3.4 0M2 2l20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="af-cm-sr">Muted</span>
            </span>
          ) : null}
          {time ? <span className="af-cm-dmrow-time">{time}</span> : null}
        </span>
        <span className="af-cm-dmrow-bottom">
          {showTicks ? <ReadTicks seen={Boolean(ctx?.lastMessageSeen)} /> : null}
          <span className="af-cm-dmrow-preview">{preview}</span>
          {unread ? (
            <span className="af-cm-threadrow-unread">
              {thread.unreadCount > 99 ? '99+' : thread.unreadCount}
              <span className="af-cm-sr"> unread</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

export default ThreadListRow
