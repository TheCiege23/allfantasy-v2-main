'use client'

import { useRef, useState } from 'react'
import { QUICK_REACTIONS, type ViewerReaction } from '@/lib/chat-core/messageReactions'

/**
 * Emoji reactions on a chat message.
 *
 * ⚠ THE CHIP ROW IS ABSENT, NOT EMPTY, WHEN NOBODY HAS REACTED. An always-visible
 * strip of zeroes under every message would add a line of furniture to every row
 * in the thread to say nothing. The affordance to add one lives behind a single
 * quiet button — or, in the bubble layout, behind the message's own actions
 * (long-press / hover / keyboard), where `showAdd={false}` drops it entirely.
 *
 * ⚠ TAP TOGGLES; WHO REACTED IS ONE GESTURE FURTHER. Tapping a chip adds or
 * removes your own reaction, as it always has. Hovering a chip names who reacted
 * (`describe`), and a long-press or right-click on it opens the full list
 * (`onShowWho`) — names only, never ids.
 */
export function MessageReactions({
  reactions,
  onToggle,
  disabled,
  describe,
  onShowWho,
  showAdd = true,
}: {
  reactions: ViewerReaction[]
  onToggle: (emoji: string) => void
  disabled?: boolean
  /** "You, Sam and 2 others" for an emoji — shown on hover. */
  describe?: (emoji: string) => string
  /** Open the who-reacted list (long-press or right-click on a chip). */
  onShowWho?: (emoji: string) => void
  showAdd?: boolean
}) {
  const [picking, setPicking] = useState(false)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  if (!showAdd && reactions.length === 0) return null

  const clearPress = () => {
    if (pressTimer.current != null) window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  return (
    <div className="af-cm-rx">
      {reactions.map((r) => {
        const who = describe?.(r.emoji) ?? ''
        return (
          <button
            key={r.emoji}
            type="button"
            className="af-cm-rx-chip"
            data-mine={r.mine}
            disabled={disabled}
            title={who || undefined}
            onClick={() => {
              if (longPressed.current) {
                longPressed.current = false
                return
              }
              onToggle(r.emoji)
            }}
            onContextMenu={
              onShowWho
                ? (e) => {
                    e.preventDefault()
                    onShowWho(r.emoji)
                  }
                : undefined
            }
            onPointerDown={
              onShowWho
                ? (e) => {
                    if (e.pointerType === 'mouse') return
                    longPressed.current = false
                    clearPress()
                    pressTimer.current = window.setTimeout(() => {
                      longPressed.current = true
                      onShowWho(r.emoji)
                    }, 450)
                  }
                : undefined
            }
            onPointerUp={onShowWho ? clearPress : undefined}
            onPointerLeave={onShowWho ? clearPress : undefined}
            onPointerCancel={onShowWho ? clearPress : undefined}
            aria-pressed={r.mine}
            aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <span className="af-cm-rx-n">{r.count}</span>
          </button>
        )
      })}

      {showAdd ? (
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
      ) : null}

      {showAdd && picking ? (
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
