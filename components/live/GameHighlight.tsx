'use client'

import { useState } from 'react'
import { useLowData } from '@/components/live/LowDataProvider'

/**
 * A finished game's highlight video (TheSportsDB's YouTube link — see
 * `lib/live/gameHighlightMatch.ts`).
 *
 * ⚠ NOTHING LOADS UNTIL IT IS ASKED FOR. A YouTube iframe is ~1MB of script per
 * embed, and a Sunday slate holds sixteen finals — mounting them eagerly would
 * make the scoreboard the heaviest page in the product. So the card carries a
 * button, and only a tap mounts the player (autoplaying, since the tap was the
 * request to play).
 *
 * ⚠ UNDER LOW-DATA MODE IT IS A LINK, NOT A PLAYER. Video is exactly what that
 * mode exists to stop; the reader can still choose to open it on YouTube.
 *
 * `youtube-nocookie.com` rather than `youtube.com`: no tracking cookies until the
 * reader actually plays something.
 */
export function GameHighlight({ youtubeId, title }: { youtubeId: string; title: string }) {
  const lowData = useLowData().lowData
  const [open, setOpen] = useState(false)

  if (lowData) {
    return (
      <a
        className="af-live-highlight-btn"
        href={`https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span aria-hidden>▶</span> Game highlights <span className="af-live-highlight-note">(opens YouTube)</span>
      </a>
    )
  }

  if (!open) {
    return (
      <button type="button" className="af-live-highlight-btn" onClick={() => setOpen(true)}>
        <span aria-hidden>▶</span> Game highlights
      </button>
    )
  }

  return (
    <div className="af-live-highlight-frame">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0&playsinline=1`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

export default GameHighlight
