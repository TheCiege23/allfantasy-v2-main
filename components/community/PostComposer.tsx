'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { COMMUNITY_CHANNELS, SPORT_TAGS, clubhousePostHref, getChannel } from '@/lib/community/channels'
import { MAX_TAGS, POST_BODY_MAX, POST_TITLE_MAX } from '@/lib/community/validation'

/**
 * The new-thread form. A channel with a `starter` pre-fills the title and body, so an
 * introduction starts from a prompt rather than an empty box — the hardest post to
 * write is the first one.
 */
export function PostComposer({ initialChannel }: { initialChannel: string }) {
  const router = useRouter()
  const composable = COMMUNITY_CHANNELS.filter((c) => !c.systemOnly)
  const requested = getChannel(initialChannel)
  const startChannel = requested && !requested.systemOnly ? requested : composable[1]!
  const [channel, setChannel] = useState(startChannel.slug)
  const [title, setTitle] = useState(startChannel.starter?.title ?? '')
  const [body, setBody] = useState(startChannel.starter?.body ?? '')
  const [tags, setTags] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const current = getChannel(channel)

  function switchChannel(slug: string) {
    const prev = getChannel(channel)
    const next = getChannel(slug)
    // Swap the starter text only while it is untouched, never over what someone wrote.
    const untouched = title === (prev?.starter?.title ?? '') && body === (prev?.starter?.body ?? '')
    setChannel(slug)
    if (untouched) {
      setTitle(next?.starter?.title ?? '')
      setBody(next?.starter?.body ?? '')
    }
    if (!next?.sportTags) setTags([])
  }

  function toggleTag(tag: string) {
    setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : t.length >= MAX_TAGS ? t : [...t, tag]))
  }

  const field = { borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }

  return (
    <form
      className="mode-panel space-y-4 rounded-xl border p-4 sm:p-5"
      style={{ borderColor: 'var(--border)' }}
      onSubmit={async (e) => {
        e.preventDefault()
        setSending(true)
        setError(null)
        try {
          const res = await fetch('/api/community/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, title, body, tags }),
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
      <div>
        <span className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Channel
        </span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Channel">
          {composable.map((c) => (
            <button
              key={c.slug}
              type="button"
              role="radio"
              aria-checked={channel === c.slug}
              onClick={() => switchChannel(c.slug)}
              className="rounded-full border px-3 py-1 text-sm"
              style={{
                borderColor: channel === c.slug ? 'var(--accent)' : 'var(--border)',
                background: channel === c.slug ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                color: 'var(--text)',
              }}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
        {current && (
          <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
            {current.blurb}
          </p>
        )}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Title
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, POST_TITLE_MAX))}
          placeholder="What's on your mind?"
          className="block w-full rounded-lg border px-3 py-2"
          style={field}
          required
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Post
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, POST_BODY_MAX))}
          rows={9}
          placeholder="Share the details. Links work, and @username mentions someone."
          className="block w-full resize-y rounded-lg border px-3 py-2"
          style={field}
          required
        />
      </label>

      {current?.sportTags && (
        <div>
          <span className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Sport <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional, up to {MAX_TAGS})</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {SPORT_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tags.includes(t)}
                onClick={() => toggleTag(t)}
                className="rounded-md border px-2 py-0.5 text-xs font-bold"
                style={{
                  borderColor: tags.includes(t) ? 'var(--accent)' : 'var(--border)',
                  color: tags.includes(t) ? 'var(--accent)' : 'var(--muted)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

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
          {sending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  )
}
