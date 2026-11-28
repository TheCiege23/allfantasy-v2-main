'use client'

import { useState } from 'react'

/**
 * The Clubhouse's "bring people in, bring them back" controls: share a post, invite a
 * commissioner, and the weekly email switch. Client-only because they use the share sheet,
 * the clipboard and one route call.
 */

async function shareOrCopy(args: { url: string; title: string; text: string }): Promise<'shared' | 'copied' | 'failed'> {
  const absolute = args.url.startsWith('http') ? args.url : `${window.location.origin}${args.url}`
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: args.title, text: args.text, url: absolute })
      return 'shared'
    } catch (e) {
      // The person closed the sheet: that is not a failure, and the clipboard is not a fallback for it.
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
    }
  }
  try {
    await navigator.clipboard.writeText(`${args.text} ${absolute}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export function ShareButton({
  url,
  title,
  text,
  label = 'Share',
  className = 'ch-btn ch-btn-ghost ch-btn-sm',
}: {
  url: string
  title: string
  text: string
  label?: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      className={className}
      data-testid="clubhouse-share"
      onClick={async () => {
        const r = await shareOrCopy({ url, title, text })
        setState(r === 'copied' ? 'copied' : r === 'failed' ? 'failed' : 'idle')
        if (r !== 'shared') setTimeout(() => setState('idle'), 2500)
      }}
    >
      {state === 'copied' ? '✓ Link copied' : state === 'failed' ? "Couldn't copy" : `↗ ${label}`}
    </button>
  )
}

export const CLUBHOUSE_INVITE_TEXT =
  'Come talk league formats with me in the AllFantasy Clubhouse. Pitch an idea, upvote the ones you would play, and see what gets built:'

export function InviteButton({ className }: { className?: string }) {
  return (
    <ShareButton
      url="/clubhouse"
      title="The AllFantasy Clubhouse"
      text={CLUBHOUSE_INVITE_TEXT}
      label="Invite a commissioner"
      className={className}
    />
  )
}

export function DigestToggle({ initialOn, blocked }: { initialOn: boolean; blocked: boolean }) {
  const [on, setOn] = useState(initialOn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(blocked ? 'You unsubscribed from AllFantasy emails. Turn them back on in Settings first.' : null)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/community/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !on }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data?.error || 'Something went wrong. Try again.')
      else setOn(Boolean(data.on))
    } catch {
      setError("Couldn't reach AllFantasy.")
    }
    setBusy(false)
  }

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={toggle}
        disabled={busy || blocked}
        className="ch-btn ch-btn-sm ch-btn-ghost disabled:opacity-60"
        data-testid="digest-toggle"
      >
        {on ? '✓ Weekly email on · turn off' : '✉️ Get the weekly email'}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-500">
          {error}{' '}
          {blocked && (
            <a href="/settings" className="underline">
              Settings
            </a>
          )}
        </p>
      )}
    </div>
  )
}
