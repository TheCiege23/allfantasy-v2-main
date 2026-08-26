'use client'

/**
 * The message a reply is answering, shown above it.
 *
 * ⚠ THE PARENT IS OFTEN NOT ON SCREEN. The panel loads the most recent 40
 * messages; a reply to something older has a `parentMessageId` pointing at a
 * message the client does not hold. That case says so plainly instead of
 * rendering an empty quote, which would read as a reply to a blank message.
 */
export function QuotedMessage({
  author,
  text,
  onJump,
}: {
  /** Null when the parent is outside the loaded window. */
  author: string | null
  text: string | null
  /** Only offered when the parent is actually on screen to jump to. */
  onJump?: () => void
}) {
  const missing = !author && !text

  const inner = (
    <>
      <span className="af-cm-quote-bar" aria-hidden="true" />
      <span className="af-cm-quote-body">
        {missing ? (
          <span className="af-cm-quote-missing">Replying to an earlier message</span>
        ) : (
          <>
            <span className="af-cm-quote-who">{author ?? 'Someone'}</span>
            {/*
              One line. A quote that can grow taller than the reply under it
              turns the thread into a hall of mirrors on a narrow drawer.
            */}
            <span className="af-cm-quote-text">{text ?? ''}</span>
          </>
        )}
      </span>
    </>
  )

  if (onJump && !missing) {
    return (
      <button type="button" className="af-cm-quote af-cm-quote-jump" onClick={onJump}>
        {inner}
      </button>
    )
  }

  return <span className="af-cm-quote">{inner}</span>
}

export default QuotedMessage
