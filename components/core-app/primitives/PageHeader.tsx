import type { ReactNode } from 'react'

import './af-primitives.css'

/**
 * The redesigned /core page header: an optional mono eyebrow, the title, an optional one-line
 * purpose, and an optional actions area. Typography lives in af-primitives.css, so every screen
 * that uses it reads the same; a screen keeps its own head class (`className`) for layout only.
 *
 * The `*ClassName` props carry a screen's existing classes through, so its tests, its remaining
 * layout rules and anything that targets them keep working while the duplicated type rules go.
 */
export type PageHeaderProps = {
  title: ReactNode
  eyebrow?: ReactNode
  eyebrowTestId?: string
  sub?: ReactNode
  actions?: ReactNode
  /** Heading level; a page has one h1, a panel inside a page may want h2. */
  as?: 'h1' | 'h2'
  className?: string
  headlineClassName?: string
  eyebrowClassName?: string
  titleClassName?: string
  subClassName?: string
  actionsClassName?: string
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function PageHeader({
  title,
  eyebrow,
  eyebrowTestId,
  sub,
  actions,
  as: Heading = 'h1',
  className,
  headlineClassName,
  eyebrowClassName,
  titleClassName,
  subClassName,
  actionsClassName,
}: PageHeaderProps) {
  return (
    <header className={cx('af-pg-head', className)}>
      <div className={cx('af-pg-headline', headlineClassName)}>
        {eyebrow != null && eyebrow !== '' ? (
          <p className={cx('af-pg-eyebrow', eyebrowClassName)} data-testid={eyebrowTestId}>
            {eyebrow}
          </p>
        ) : null}
        <Heading className={cx('af-pg-title', titleClassName)}>{title}</Heading>
        {sub != null && sub !== '' ? <p className={cx('af-pg-sub', subClassName)}>{sub}</p> : null}
      </div>
      {actions ? <div className={cx('af-pg-actions', actionsClassName)}>{actions}</div> : null}
    </header>
  )
}
