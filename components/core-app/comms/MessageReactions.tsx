'use client'

import { useState } from 'react'
import { QUICK_REACTIONS, type ViewerReaction } from '@/lib/chat-core/messageReactions'

/**
 * Emoji reactions on a chat message.
 *
 * ⚠ THE CHIP ROW IS ABSENT, NOT EMPTY, WHEN NOBODY HAS REACTED. An always-visible
 * strip of zeroes under every message would add a line of furniture to every row
 * in the thread to say nothing. The affordance to add one lives behind a single
 * quiet button.
 */
export function MessageReactions({
  reactions,
  onToggle,
  disabled,
}: {
  reactions: ViewerReaction[]
  onToggle: (emoji: string) => void
  disabled?: boolean
}) {
  const [picking, setPicking] = useState(false)

  return (
    <div className="af-cm-rx">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className="af-cm-rx-chip"
          data-mine={r.mine}
          disabled={disabled}
          onClick={() => onToggle(r.emoji)}
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
        >
          <span aria-hidden="true">{r.emoji}</span>
          <span className="af-cm-rx-n">{r.count}</span>
        </button>
      ))}

      <button
        type="button"
        className="af-cm-rx-add"
        disabled={disabled}
        onClick={() => setPicking((v) => !v)}
        aria-expanded={picking}
        aria-label="Add a reaction"
      >
        ☺+
      </button>

      {picking ? (
        <span className="af-cm-rx-pick" role="group" aria-label="Pick a reaction">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="af-cm-rx-opt"
              disabled={disabled}
              onClick={() => {
                setPicking(false)
                onToggle(emoji)
              }}
            >
              {emoji}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  )
}

export default MessageReactions
