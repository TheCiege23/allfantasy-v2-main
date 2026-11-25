'use client'

import { useEffect, useState, useTransition } from 'react'
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
import {
  ATTACHMENTS_PER_IDEA,
  ATTACHMENT_ACCEPT,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TOTAL_BYTES,
  PDF_TYPE,
  formatBytes,
} from '@/lib/community/attachments'

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
        className="ch-vote disabled:cursor-default"
        style={size === 'sm' ? { minWidth: 50 } : { minWidth: 62, padding: '10px 8px' }}
      >
        <span className="ch-vote-arrow" aria-hidden>
          ▲
        </span>
        <span className="ch-vote-num" style={size === 'sm' ? undefined : { fontSize: 20 }}>
          {upvotes}
        </span>
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
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  /** Set when the idea posted but a file did not: the member can still go to their idea. */
  const [postedId, setPostedId] = useState<string | null>(null)

  function addFiles(list: FileList | null) {
    if (!list) return
    setError(null)
    const next = [...files]
    for (const f of Array.from(list)) {
      if (next.length >= ATTACHMENTS_PER_IDEA) {
        setError(`An idea can have up to ${ATTACHMENTS_PER_IDEA} files.`)
        break
      }
      const isPdf = f.type === PDF_TYPE || /\.pdf$/i.test(f.name)
      const isImage = /^image\/(png|jpeg|gif|webp)$/.test(f.type)
      if (!isPdf && !isImage) {
        setError('Use a photo (PNG, JPG, GIF, WebP) or a PDF.')
        continue
      }
      if (f.size > (isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
        setError(isPdf ? 'PDFs can be up to 10 MB.' : 'Photos can be up to 5 MB.')
        continue
      }
      if (next.reduce((n, x) => n + x.size, 0) + f.size > MAX_TOTAL_BYTES) {
        setError('All files on one idea can add up to 20 MB.')
        continue
      }
      next.push(f)
    }
    setFiles(next)
  }

  const field = { borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }
  const labelCls = 'mb-1.5 block text-sm font-semibold'
  const hint = (t: string) => (
    <span className="font-normal" style={{ color: 'var(--muted)' }}>
      {t}
    </span>
  )

  return (
    <form
      className="ch-card space-y-5 p-5 sm:p-7"
      onSubmit={async (e) => {
        e.preventDefault()
        if (postedId) {
          router.push(clubhousePostHref(postedId))
          return
        }
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
          const id = String(data.id)
          const failed: string[] = []
          for (let i = 0; i < files.length; i++) {
            setStage(`Uploading file ${i + 1} of ${files.length}…`)
            const body = new FormData()
            body.append('file', files[i])
            const up = await fetch(`/api/community/ideas/${encodeURIComponent(id)}/attachments`, { method: 'POST', body }).catch(() => null)
            if (!up || !up.ok) {
              const msg = up ? (await up.json().catch(() => ({})))?.error : null
              failed.push(`${files[i].name}${msg ? ` (${msg})` : ''}`)
            }
          }
          // Starts the staff build plan now that the files are in. Best effort: the cron catches a miss.
          await fetch(`/api/community/ideas/${encodeURIComponent(id)}/plan`, { method: 'POST' }).catch(() => null)
          if (failed.length) {
            setPostedId(id)
            setStage(null)
            setError(`Your idea is posted, but ${failed.length === 1 ? 'this file' : 'these files'} did not upload: ${failed.join(', ')}.`)
            setSending(false)
            return
          }
          router.push(clubhousePostHref(id))
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

      <div>
        <span className={labelCls} style={{ color: 'var(--text)' }}>
          Photos or PDFs {hint(`(optional, up to ${ATTACHMENTS_PER_IDEA})`)}
        </span>
        <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
          A sketch, a screenshot of a league you run, a rules doc. Anyone reading the idea can open them.
        </p>
        {files.length > 0 && (
          <ul className="mb-2 space-y-1.5" data-testid="idea-files">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
              >
                <span className="min-w-0 truncate" style={{ color: 'var(--text)' }}>
                  {f.type === PDF_TYPE || /\.pdf$/i.test(f.name) ? '📄' : '🖼️'} {f.name}
                  <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>
                    {formatBytes(f.size)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="shrink-0 text-xs font-semibold"
                  style={{ color: 'var(--muted)' }}
                  aria-label={`Remove ${f.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length < ATTACHMENTS_PER_IDEA && !postedId && (
          <label className="ch-btn ch-btn-ghost inline-flex cursor-pointer text-sm">
            <span>＋ Add a photo or PDF</span>
            <input
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              disabled={sending}
              data-testid="idea-file-input"
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        )}
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
          className="ch-btn ch-btn-primary disabled:opacity-50"
        >
          {postedId ? 'Go to your idea' : sending ? stage ?? 'Posting…' : 'Post idea'}
        </button>
      </div>
    </form>
  )
}

// ─── staff build plan ────────────────────────────────────────────────────────

/** Regenerate, plus a quiet refresh while Chimmy is still writing. */
export function PlanControls({ postId, waiting }: { postId: string; waiting: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The server says when a run is queued or in flight; refresh until it is done.
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(t)
  }, [waiting, router])

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/community/ideas/${encodeURIComponent(postId)}/plan`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data?.error || 'Something went wrong. Try again.')
      else router.refresh()
    } catch {
      setError("Couldn't reach AllFantasy.")
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={regenerate} disabled={busy || waiting} className="ch-btn ch-btn-ghost text-sm disabled:opacity-60">
        {busy ? 'Starting…' : waiting ? 'Writing… (checks every 15s)' : '↻ Regenerate plan'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Opens a direct message to the person who pitched the idea, starting from the plan's open
 * questions. Staff edit the text before anything is sent.
 */
export function AskPosterButton({ username, draft }: { username: string; draft: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(draft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/shared/chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadType: 'dm', usernames: [username] }),
      })
      const data = await res.json().catch(() => ({}))
      const threadId = data?.thread?.id
      if (!res.ok || !threadId) {
        setError(data?.error || "Couldn't open a conversation with them.")
        setBusy(false)
        return
      }
      const sent = await fetch(`/api/shared/chat/threads/${encodeURIComponent(threadId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text.trim() }),
      })
      if (!sent.ok) {
        const d = await sent.json().catch(() => ({}))
        setError(d?.error || "The conversation opened, but the message didn't send.")
        setBusy(false)
        return
      }
      router.push(`/messages?thread=${encodeURIComponent(threadId)}`)
    } catch {
      setError("Couldn't reach AllFantasy.")
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ch-btn ch-btn-primary text-sm" data-testid="ask-poster">
        💬 Ask @{username}
      </button>
    )
  }
  return (
    <div className="mt-2 w-full space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 2000))}
        rows={7}
        className="block w-full resize-y rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
        aria-label={`Message to @${username}`}
      />
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => setOpen(false)} className="text-sm" style={{ color: 'var(--muted)' }}>
          Cancel
        </button>
        <button type="button" onClick={send} disabled={busy || !text.trim()} className="ch-btn ch-btn-primary text-sm disabled:opacity-50">
          {busy ? 'Sending…' : `Send to @${username}`}
        </button>
      </div>
    </div>
  )
}
