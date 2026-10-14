import { ReactNode } from 'react'

export function RosterSettingsModalShell({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string
  subtitle: string
  /** Short chip beside the title — the sport, read-only state, etc. */
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="af-ls-card-title">{title}</h3>
          <p className="af-ls-card-sub">{subtitle}</p>
        </div>
        {badge ? <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{badge}</div> : null}
      </div>
      {children}
    </div>
  )
}
