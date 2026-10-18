'use client'

import { useState } from 'react'

/** "Copy link" and "Share" on the public moment page. Share falls back to copying the link. */
export function MomentShareActions({ url, title }: { url: string; title: string }) {
  const [note, setNote] = useState<string | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setNote('Link copied.')
    } catch {
      setNote('Copy the link from your address bar.')
    }
  }

  async function share() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
        return
      } catch (error) {
        if ((error as { name?: string } | null)?.name === 'AbortError') return
      }
    }
    await copy()
  }

  return <div className="svk-row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
    <button type="button" className="svk-btn" onClick={() => void copy()} data-testid="moment-copy-link">Copy link</button>
    <button type="button" className="svk-btn" onClick={() => void share()} data-testid="moment-share">Share</button>
    <span role="status" aria-live="polite" className="svk-faint" style={{ fontSize: 13 }}>{note}</span>
  </div>
}
