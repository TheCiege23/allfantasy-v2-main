import Link from 'next/link'
import type { ReactNode } from 'react'

import './af-primitives.css'

/**
 * "Nothing here yet", said as a titled card: what is missing, why, and where to go. Uses the
 * `af-empty-card` classes the screens' empty states already share (PR #3261), so those hand-rolled
 * cards can move onto this component without a visual change.
 *
 * `links` are quiet text links; `actions` is for real buttons (an import, a create) when the empty
 * state's job is to start something.
 */
export function EmptyState({
  title,
  body,
  hint,
  mark,
  links,
  actions,
  className,
  testId,
}: {
  title: ReactNode
  body?: ReactNode
  hint?: ReactNode
  mark?: ReactNode
  /** `prefetch: false` for a link into a heavy screen, as the screens' own links already do. */
  links?: Array<{ href: string; label: ReactNode; prefetch?: boolean }>
  actions?: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div className={['af-empty-card', className].filter(Boolean).join(' ')} data-testid={testId}>
      {mark != null ? (
        <span className="af-empty-card-mark" aria-hidden>
          {mark}
        </span>
      ) : null}
      <div className="af-empty-card-text">
        <p className="af-empty-card-title">{title}</p>
        {body != null && body !== '' ? <p className="af-empty-card-body">{body}</p> : null}
        {hint != null && hint !== '' ? <p className="af-empty-card-hint">{hint}</p> : null}
        {links && links.length > 0 ? (
          <p className="af-empty-card-links">
            {links.map((link) => (
              <Link key={link.href} href={link.href} prefetch={link.prefetch}>
                {link.label}
              </Link>
            ))}
          </p>
        ) : null}
        {actions ? <div className="af-empty-card-actions">{actions}</div> : null}
      </div>
    </div>
  )
}
