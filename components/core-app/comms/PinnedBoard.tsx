'use client'

import { useState } from 'react'
import type { PinnedRef } from '@/lib/chat-core/pinnedMessages'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { MessageTime } from './MessageTime'

/**
 * The pinned board for a league chat.
 *
 * ⚠ COLLAPSED BY DEFAULT, AND ABSENT WHEN EMPTY. It sits above a conversation
 * in a narrow drawer; a board that expands to a dozen pins pushes the thing
 * people came for off the screen.
 */
export function PinnedBoard({
  pins,
  onJump,
  onUnpin,
  busy,
}: {
  pins: PinnedRef[]
  onJump: (messageId: string) => void
  onUnpin: (pinId: string) => void
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)

  if (pins.length === 0) return null

  return (
    <div className="af-cm-pins">
      <button
        type="button"
        className="af-cm-pins-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        📌 {pins.length} pinned
      </button>

      {open ? (
        <ul className="af-cm-pins-list">
          {pins.map((p) => (
            <li key={p.pinId} className="af-cm-pin">
              <button
                type="button"
                className="af-cm-pin-jump"
                onClick={() => onJump(p.messageId)}
                title={`Pinned by ${p.pinnedBy}`}
              >
                {censorProfanity(p.snippet)}
              </button>
              <MessageTime value={p.pinnedAt} />
              <button
                type="button"
                className="af-cm-pin-x"
                disabled={busy}
                onClick={() => onUnpin(p.pinId)}
                aria-label="Unpin this message"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default PinnedBoard
