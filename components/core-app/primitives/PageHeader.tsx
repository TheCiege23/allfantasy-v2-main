import type { ReactNode } from 'react'

import './af-primitives.css'

/**
 * The redesigned /core page header: an optional mono eyebrow, the title, an optional one-line
 * purpose, and an optional actions area. Typography lives in af-primitives.css, so every screen
 * that uses it reads the same; a screen keeps its own head class (`className`) for layout only.
 *
 * The `*ClassName` props carry a screen's existing classes through, so its tests, its remaining
 * layout rules and anything that targets them keep working while the duplicated type rules go.
 *
 * `titleAside` is for the small things a screen sets BESIDE its title on the same line — a
 * freshness chip, an explainer tip, an "every league" link — which belong to the title rather than
 * to the actions area. They sit in a row with the heading, outside it, so they never become part of
 * the heading's accessible name.
 */
export type PageHeaderProps = {
  title: ReactNode
  eyebrow?: ReactNode
  eyebrowTestId?: string
  sub?: ReactNode
  actions?: ReactNode
  titleAside?: ReactNode
  /** Heading level; a page has one h1, a panel inside a page may want h2. */
  as?: 'h1' | 'h2'
  className?: string
  headlineClassName?: string
  eyebrowClassName?: string
  titleRowClassName?: string
  titleClassName?: string
  subClassName?: string
  actionsClassName?: string
  testId?: string
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
  titleAside,
  as: Heading = 'h1',
  className,
  headlineClassName,
  eyebrowClassName,
  titleRowClassName,
  titleClassName,
  subClassName,
  actionsClassName,
  testId,
}: PageHeaderProps) {
  const heading = <Heading className={cx('af-pg-title', titleClassName)}>{title}</Heading>
  return (
    <header className={cx('af-pg-head', className)} data-testid={testId}>
      <div className={cx('af-pg-headline', headlineClassName)}>
        {eyebrow != null && eyebrow !== '' ? (
          <p className={cx('af-pg-eyebrow', eyebrowClassName)} data-testid={eyebrowTestId}>
            {eyebrow}
          </p>
        ) : null}
        {titleAside ? (
          <div className={cx('af-pg-titlerow', titleRowClassName)}>
            {heading}
            {titleAside}
          </div>
        ) : (
          heading
        )}
        {sub != null && sub !== '' ? <p className={cx('af-pg-sub', subClassName)}>{sub}</p> : null}
      </div>
      {actions ? <div className={cx('af-pg-actions', actionsClassName)}>{actions}</div> : null}
    </header>
  )
}
