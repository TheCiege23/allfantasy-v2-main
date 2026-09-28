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
  lastMessageCreatedAt?: string | null
  members?: ThreadRowPerson[]
  isMuted?: boolean
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

/** The one line under the name: "You: " on your own, the server's label for media, or a nudge. */
export function threadRowPreview(context: ThreadRowContext | null | undefined): string {
  const preview = typeof context?.lastMessagePreview === 'string' ? context.lastMessagePreview.trim() : ''
  if (!preview) return 'No messages yet'
  return context?.lastMessageMine ? `You: ${preview}` : preview
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

  return (
    <button
      type="button"
      className="af-cm-threadrow af-cm-dmrow"
      data-unread={unread || undefined}
      onClick={onOpen}
    >
      <span className="af-cm-dmrow-avs" data-count={faces.length} aria-hidden="true">
        {faces.map((p) => (
          <Avatar key={p.id} person={p} />
        ))}
      </span>
      <span className="af-cm-dmrow-main">
        <span className="af-cm-dmrow-top">
          <span className="af-cm-threadrow-title">{title}</span>
          {time ? <span className="af-cm-dmrow-time">{time}</span> : null}
        </span>
        <span className="af-cm-dmrow-bottom">
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
