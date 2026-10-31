'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SPORT_TAGS, clubhousePostHref } from '@/lib/community/channels'
import {
  DRAFT_TYPES,
  IDEA_BODY_MAX,
  IDEA_HOOK_MAX,
  IDEA_STATUSES,
  IDEA_STATUS_COPY,
  type IdeaStatus,
} from '@/lib/community/ideas'

/**
 * The League Lab pieces a click changes: the upvote, the staff status picker and the short
 * idea form. Same pattern as ClubhouseClient — one route call, then let the server render.
 */

// ─── upvote ──────────────────────────────────────────────────────────────────

export function UpvoteButton({
  postId,
  initialUpvotes,
  initialVoted,
  signedIn,
  isAuthor,
  loginHref,
  size = 'md',
}: {
  postId: string
  initialUpvotes: number
  initialVoted: boolean
  signedIn: boolean
  isAuthor: boolean
  loginHref: string
  size?: 'sm' | 'md'
}) {
  const router = useRouter()
  const [upvotes, setUpvotes] = useState(initialUpvotes)
  const [voted, setVoted] = useState(initialVoted)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (!signedIn) {
      router.push(loginHref)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/community/ideas/${encodeURIComponent(postId)}/vote`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data?.error || 'Something went wrong. Try again.')
      else {
        setUpvotes(Number(data.upvotes) || 0)
        setVoted(Boolean(data.votedByMe))
      }
    } catch {
      setError("Couldn't reach AllFantasy.")
    }
    setBusy(false)
  }

  const label = isAuthor ? `${upvotes} upvotes on your idea` : voted ? 'Remove your upvote' : 'Upvote this idea'
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={toggle}
        disabled={busy || isAuthor}
        aria-pressed={voted}
        aria-label={label}
        title={isAuthor ? "You can't upvote your own idea" : label}
        className={`flex flex-col items-center rounded-lg border font-semibold tabular-nums transition disabled:cursor-default ${
          size === 'sm' ? 'min-w-[44px] px-2 py-1 text-xs' : 'min-w-[56px] px-3 py-2 text-sm'
        }`}
        style={{
          borderColor: voted ? 'var(--accent)' : 'var(--border)',
          background: voted ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
          color: voted ? 'var(--accent)' : 'var(--text)',
        }}
      >
        <span aria-hidden>▲</span>
        <span>{upvotes}</span>
      </button>
      {error && (
        <p role="alert" className="mt-1 max-w-[10rem] text-center text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── staff status ────────────────────────────────────────────────────────────

export function IdeaStatusControl({ postId, status }: { postId: string; status: IdeaStatus | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function set(next: IdeaStatus | null) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/community/ideas/${encodeURIComponent(postId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data?.error || 'Something went wrong. Try again.')
      else startTransition(() => router.refresh())
    } catch {
      setError("Couldn't reach AllFantasy.")
    }
    setBusy(false)
  }

  const disabled = busy || pending
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Staff: idea status
      </p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Idea status">
        {([null, ...IDEA_STATUSES] as const).map((s) => {
          const active = status === s
          return (
            <button
              key={s ?? 'open'}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => !active && set(s)}
              className="rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-60"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--border)',
                background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                color: 'var(--text)',
              }}
            >
              {s ? `${IDEA_STATUS_COPY[s].emoji} ${IDEA_STATUS_COPY[s].label}` : 'Open'}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
        The author gets a notification each time this moves to a new status.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── the short form ──────────────────────────────────────────────────────────

export function IdeaForm() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [hook, setHook] = useState('')
  const [body, setBody] = useState('')
  const [sport, setSport] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [draftType, setDraftType] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const field = { borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }
  const labelCls = 'mb-1.5 block text-sm font-semibold'
  const hint = (t: string) => (
    <span className="font-normal" style={{ color: 'var(--muted)' }}>
      {t}
    </span>
  )

  return (
    <form
      className="mode-panel space-y-4 rounded-xl border p-4 sm:p-5"
      style={{ borderColor: 'var(--border)' }}
      onSubmit={async (e) => {
        e.preventDefault()
        setSending(true)
        setError(null)
        try {
          const res = await fetch('/api/community/ideas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, hook, body, sport, teamSize, draftType }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data?.id) {
            setError(data?.error || 'Something went wrong. Try again.')
            setSending(false)
            return
          }
          router.push(clubhousePostHref(data.id))
        } catch {
          setError("Couldn't reach AllFantasy. Check your connection.")
          setSending(false)
        }
      }}
    >
      <label className="block">
        <span className={labelCls} style={{ color: 'var(--text)' }}>
          Name your league idea
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 80))}
          placeholder="e.g. Relegation Dynasty"
          className="block w-full rounded-lg border px-3 py-2"
          style={field}
          required
        />
      </label>

      <label className="block">
        <span className={labelCls} style={{ color: 'var(--text)' }}>
          The hook {hint('(one line, why would people play it?)')}
        </span>
        <input
          value={hook}
          onChange={(e) => setHook(e.target.value.slice(0, IDEA_HOOK_MAX))}
          placeholder="The bottom two teams get sent down to a second league every season."
          className="block w-full rounded-lg border px-3 py-2"
          style={field}
          required
        />
      </label>

      <label className="block">
        <span className={labelCls} style={{ color: 'var(--text)' }}>
          How it works
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, IDEA_BODY_MAX))}
          rows={7}
          placeholder="Scoring, the weekly rhythm, what makes it different. Rough is fine — people can help fill gaps in the replies."
          className="block w-full resize-y rounded-lg border px-3 py-2"
          style={field}
          required
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={labelCls} style={{ color: 'var(--text)' }}>
            Sport {hint('(optional)')}
          </span>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className="block w-full rounded-lg border px-3 py-2" style={field}>
            <option value="">Any</option>
            {SPORT_TAGS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls} style={{ color: 'var(--text)' }}>
            Teams {hint('(optional)')}
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={32}
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            placeholder="12"
            className="block w-full rounded-lg border px-3 py-2"
            style={field}
          />
        </label>
        <label className="block">
          <span className={labelCls} style={{ color: 'var(--text)' }}>
            Draft {hint('(optional)')}
          </span>
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value)}
            className="block w-full rounded-lg border px-3 py-2 capitalize"
            style={field}
          >
            <option value="">Any</option>
            {DRAFT_TYPES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Your idea is posted publicly in League Lab under your username, so other members can upvote it and help shape it. If
        AllFantasy builds it, you get the credit on the idea and a Shipped badge next to your name.
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => router.back()} className="text-sm" style={{ color: 'var(--muted)' }}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={sending}
          className="rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {sending ? 'Posting…' : 'Post idea'}
        </button>
      </div>
    </form>
  )
}
