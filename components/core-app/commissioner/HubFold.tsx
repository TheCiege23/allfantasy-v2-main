import type { ReactNode } from 'react'

/**
 * One folded row of the Commissioner Hub (2026-11-14): the section's title and, where there is one,
 * the one fact worth seeing closed ("75/100", "5 gone quiet"). The page was 28 open sections and about
 * 25,000px tall; now everything below "Needs you now" is a list of these, each opening in place.
 *
 * The section inside keeps its own `id`, so the jump chips still land on it — `HubFoldOpener` opens the
 * fold first. Its own heading is hidden inside an open fold (af-commish-hub.css), because the summary
 * already says it; its notes and buttons stay.
 *
 * A server component: `<details>` needs no script to open or close.
 */
export function HubFold({
  id,
  title,
  note,
  children,
}: {
  /** The id of the section inside, which the jump chips target. */
  id: string
  /** Already in the reader's language. */
  title: string
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <details className="af-ch-fold" data-fold={id} data-testid={`hub-fold-${id}`}>
      <summary className="af-ch-fold-summary">
        <span className="af-ch-fold-title">{title}</span>
        {note != null && note !== '' ? <span className="af-ch-fold-note af-num">{note}</span> : null}
      </summary>
      <div className="af-ch-fold-body">{children}</div>
    </details>
  )
}
