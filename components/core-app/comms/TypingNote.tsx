'use client'

/**
 * "Sam is typing…" with three bouncing dots, for the league chat and DMs alike.
 *
 * ⚠ IT RIDES THE 4–8s POLL, so it can appear just after the message it was announcing — the
 * dots make it read as live without claiming anything the text did not already claim. The dots
 * are decoration (`aria-hidden`); the words are what a screen reader hears, and what the tests
 * find. Under reduced motion the dots sit still.
 */
export function TypingNote({ typing }: { typing: Array<{ name: string }> }) {
  if (typing.length === 0) return null
  const text = typing.length === 1 ? `${typing[0]!.name} is typing…` : `${typing.length} people are typing…`
  return (
    <p className="af-cm-typing-note" role="status">
      <span className="af-cm-typing-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{text}</span>
    </p>
  )
}

export default TypingNote
