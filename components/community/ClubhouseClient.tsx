'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { COMMUNITY_REACTIONS } from '@/lib/community/channels'
import { REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from '@/lib/moderation/shared'
import { REPLY_BODY_MAX } from '@/lib/community/validation'
import type { ReactionSummary } from '@/lib/community/service'

/**
 * Everything in the Clubhouse that a click changes. Each piece calls one API route and
 * then `router.refresh()`, so the server-rendered page stays the source of truth: no
 * client cache to drift from what the database says.
 */

async function send(method: string, url: string, body?: unknown): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || 'Something went wrong. Try again.' }
    return { ok: true, data }
  } catch {
    return { ok: false, error: "Couldn't reach AllFantasy. Check your connection." }
  }
}

const quietButton =
  'rounded-md px-2 py-1 text-xs font-medium transition hover:bg-[color:var(--surface-hover)] disabled:opacity-50'

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="mt-2 text-sm text-red-500">
      {error}
    </p>
  )
}

// ─── reactions ───────────────────────────────────────────────────────────────

export function ReactionBar({
  targetType,
  targetId,
  initial,
  signedIn,
  loginHref,
}: {
  targetType: 'post' | 'reply'
  targetId: string
  initial: ReactionSummary[]
  signedIn: boolean
  loginHref: string
}) {
  const router = useRouter()
  const [reactions, setReactions] = useState(initial)
  const [busy, setBusy] = useState(false)
  const byEmoji = new Map(reactions.map((r) => [r.emoji, r]))

  async function toggle(emoji: string) {
    if (!signedIn) {
      router.push(loginHref)
      return
    }
    setBusy(true)
    const res = await send('POST', '/api/community/reactions', { targetType, targetId, emoji })
    setBusy(false)
    if (res.ok && Array.isArray(res.data?.reactions)) setReactions(res.data.reactions)
  }

  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Reactions">
      {COMMUNITY_REACTIONS.map((emoji) => {
        const r = byEmoji.get(emoji)
        return (
          <button
            key={emoji}
            type="button"
            disabled={busy}
            onClick={() => toggle(emoji)}
            aria-pressed={Boolean(r?.mine)}
            className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition disabled:opacity-60"
            style={{
              borderColor: r?.mine ? 'var(--accent)' : 'var(--border)',
              background: r?.mine ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
              color: 'var(--text)',
            }}
          >
            <span>{emoji}</span>
            {r && r.count > 0 && <span className="text-xs tabular-nums">{r.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

// ─── report ──────────────────────────────────────────────────────────────────

export function ReportButton({ targetType, targetId }: { targetType: 'post' | 'reply'; targetId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>('spam')
  const [details, setDetails] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (state === 'sent') {
    return (
      <span className="px-2 text-xs" style={{ color: 'var(--muted)' }}>
        Reported. Thanks, a moderator will take a look.
      </span>
    )
  }
  if (!open) {
    return (
      <button type="button" className={quietButton} style={{ color: 'var(--muted)' }} onClick={() => setOpen(true)}>
        Report
      </button>
    )
  }
  return (
    <form
      className="mt-2 w-full rounded-lg border p-3"
      style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
      onSubmit={async (e) => {
        e.preventDefault()
        setState('sending')
        const res = await send('POST', '/api/community/reports', {
          targetType,
          targetId,
          reason,
          details: details.trim() || undefined,
        })
        if (res.ok) setState('sent')
        else {
          setState('idle')
          setError(res.error ?? null)
        }
      }}
    >
      <label className="block text-xs font-semibold" style={{ color: 'var(--text)' }}>
        What's wrong with it?
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
          className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {REPORT_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value.slice(0, 500))}
        placeholder="Anything a moderator should know (optional)"
        rows={2}
        className="mt-2 block w-full rounded-md border px-2 py-1.5 text-sm"
        style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
      />
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold disabled:opacity-60"
          style={{ color: '#fff' }}
        >
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button type="button" className={quietButton} style={{ color: 'var(--muted)' }} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  )
}

// ─── reply composer ──────────────────────────────────────────────────────────

export function ReplyComposer({
  postId,
  signedIn,
  loginHref,
  locked,
  canReplyWhenLocked,
}: {
  postId: string
  signedIn: boolean
  loginHref: string
  locked: boolean
  canReplyWhenLocked: boolean
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [sending, setSending] = useState(false)

  if (locked && !canReplyWhenLocked) {
    return (
      <p className="ch-card ch-card-pad text-sm" style={{ color: 'var(--muted)' }}>
        🔒 This thread is locked, so no new replies.
      </p>
    )
  }
  if (!signedIn) {
    return (
      <div className="ch-nudge text-sm" style={{ color: 'var(--muted)' }}>
        <span className="text-2xl" aria-hidden>
          💬
        </span>
        <span>
          <Link href={loginHref} className="font-bold underline" style={{ color: 'var(--accent)' }}>
            Sign in
          </Link>{' '}
          to join the conversation.
        </span>
      </div>
    )
  }

  return (
    <form
      className="ch-card p-3 sm:p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!body.trim()) return
        setSending(true)
        setError(null)
        const res = await send('POST', `/api/community/posts/${encodeURIComponent(postId)}/replies`, { body })
        setSending(false)
        if (!res.ok) {
          setError(res.error ?? null)
          return
        }
        setBody('')
        startTransition(() => router.refresh())
      }}
    >
      <label htmlFor="reply-body" className="sr-only">
        Your reply
      </label>
      <textarea
        id="reply-body"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, REPLY_BODY_MAX))}
        rows={3}
        placeholder="Add to the conversation… (@username to mention someone)"
        className="block w-full resize-y px-3 py-2.5 text-[15px]"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs" style={{ color: 'var(--muted2)' }}>
          {locked ? '🔒 Locked: only moderators can reply.' : 'Be kind. Disagree with takes, not people.'}
        </span>
        <button
          type="submit"
          disabled={sending || pending || !body.trim()}
          className="ch-btn ch-btn-primary ch-btn-sm disabled:opacity-50"
        >
          {sending ? 'Posting…' : 'Reply'}
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  )
}

// ─── post / reply actions ────────────────────────────────────────────────────

function useAction() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Stays busy until the refreshed page arrives, not just until the API answers — otherwise
  // the buttons re-enable over stale content and invite a second click.
  const [refreshing, startTransition] = useTransition()
  async function run(method: string, url: string, body?: unknown, after?: () => void) {
    setSending(true)
    setError(null)
    const res = await send(method, url, body)
    setSending(false)
    if (!res.ok) {
      setError(res.error ?? null)
      return false
    }
    if (after) after()
    else startTransition(() => router.refresh())
    return true
  }
  return { run, error, busy: sending || refreshing, router }
}

export function PostActions({
  postId,
  canEdit,
  isModerator,
  isPinned,
  isLocked,
  removed,
  signedIn,
  initialTitle,
  initialBody,
  initialTags,
}: {
  postId: string
  canEdit: boolean
  isModerator: boolean
  isPinned: boolean
  isLocked: boolean
  removed: boolean
  signedIn: boolean
  initialTitle: string
  initialBody: string
  initialTags: string[]
}) {
  const { run, error, busy, router } = useAction()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const url = `/api/community/posts/${encodeURIComponent(postId)}`
  const moderate = (action: string) => run('PATCH', url, { action })

  if (editing) {
    return (
      <form
        className="mt-3 w-full space-y-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await run('PATCH', url, { title, body, tags: initialTags })) setEditing(false)
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="block w-full rounded-lg border px-3 py-2 font-semibold"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="block w-full rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink, #fff)' }}
          >
            Save
          </button>
          <button type="button" className={quietButton} style={{ color: 'var(--muted)' }} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        <ErrorLine error={error} />
      </form>
    )
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-1" style={{ color: 'var(--muted)' }}>
      {canEdit && (
        <>
          <button type="button" className={quietButton} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className={quietButton}
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Delete this post? Replies will go with it.')) return
              void run('DELETE', url, undefined, () => router.push('/clubhouse'))
            }}
          >
            Delete
          </button>
        </>
      )}
      {isModerator && (
        <>
          <button type="button" className={quietButton} disabled={busy} onClick={() => moderate(isPinned ? 'unpin' : 'pin')}>
            {isPinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" className={quietButton} disabled={busy} onClick={() => moderate(isLocked ? 'unlock' : 'lock')}>
            {isLocked ? 'Unlock' : 'Lock'}
          </button>
          <button type="button" className={quietButton} disabled={busy} onClick={() => moderate(removed ? 'restore' : 'remove')}>
            {removed ? 'Restore' : 'Remove'}
          </button>
        </>
      )}
      {signedIn && !canEdit && !removed && <ReportButton targetType="post" targetId={postId} />}
      <ErrorLine error={error} />
    </div>
  )
}

export function ReplyActions({
  replyId,
  canEdit,
  isModerator,
  signedIn,
  initialBody,
}: {
  replyId: string
  canEdit: boolean
  isModerator: boolean
  signedIn: boolean
  initialBody: string
}) {
  const { run, error, busy } = useAction()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(initialBody)
  const url = `/api/community/replies/${encodeURIComponent(replyId)}`

  if (editing) {
    return (
      <form
        className="mt-2 w-full space-y-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await run('PATCH', url, { body })) setEditing(false)
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, REPLY_BODY_MAX))}
          rows={3}
          className="block w-full rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink, #fff)' }}
          >
            Save
          </button>
          <button type="button" className={quietButton} style={{ color: 'var(--muted)' }} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        <ErrorLine error={error} />
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1" style={{ color: 'var(--muted)' }}>
      {canEdit && (
        <button type="button" className={quietButton} onClick={() => setEditing(true)}>
          Edit
        </button>
      )}
      {(canEdit || isModerator) && (
        <button
          type="button"
          className={quietButton}
          disabled={busy}
          onClick={() => {
            if (window.confirm(canEdit ? 'Delete your reply?' : 'Remove this reply?')) void run('DELETE', url)
          }}
        >
          {canEdit ? 'Delete' : 'Remove'}
        </button>
      )}
      {signedIn && !canEdit && <ReportButton targetType="reply" targetId={replyId} />}
      <ErrorLine error={error} />
    </div>
  )
}

// ─── moderation queue ────────────────────────────────────────────────────────

export function ResolveReportButtons({ reportId, targetRemoved }: { reportId: string; targetRemoved: boolean }) {
  const { run, error, busy } = useAction()
  const url = `/api/community/reports/${encodeURIComponent(reportId)}`
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!targetRemoved && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run('PATCH', url, { action: 'remove' })}
          className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold disabled:opacity-50"
          style={{ color: '#fff' }}
        >
          Remove content
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => run('PATCH', url, { action: 'dismiss' })}
        className="rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        Dismiss
      </button>
      <ErrorLine error={error} />
    </div>
  )
}
