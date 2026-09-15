'use client'

import { useState } from 'react'
import { shareCardImage } from '@/components/decide/shareCard'

/**
 * Share a moment as an image (shareable moments, 2026-09-14): fetches the auth-gated card PNG and
 * hands it to the native share sheet, or downloads it. The IMAGE is shared — the card URL never
 * leaves the signed-in session. Same states and copy as the rivalry card's button.
 */
export function ShareMomentButton({
  url,
  filename,
  title,
  label = 'Share',
}: {
  url: string
  filename: string
  title: string
  label?: string
}) {
  const [state, setState] = useState<'idle' | 'working' | 'shared' | 'downloaded' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="af3a-share-btn"
      disabled={state === 'working'}
      onClick={() => {
        setState('working')
        void shareCardImage(url, filename, title).then(setState)
      }}
    >
      {state === 'working'
        ? 'Building card…'
        : state === 'downloaded'
          ? 'Card saved ✓'
          : state === 'shared'
            ? 'Shared ✓'
            : state === 'failed'
              ? 'Retry share'
              : label}
    </button>
  )
}

export default ShareMomentButton
