import Link from 'next/link'

/**
 * Shown at the top of EVERY demo page (rendered by app/demo/layout.tsx, so a new demo
 * page cannot forget it). The wording is fixed by product: "Demo league — live sample data".
 */
export function DemoBanner() {
  return (
    <div
      role="status"
      data-testid="demo-league-banner"
      className="sticky top-0 z-30 border-b px-4 py-2 text-sm"
      style={{
        background: 'var(--color-warning-soft)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          <span aria-hidden="true">🧪 </span>Demo league — live sample data
          <span className="ml-2 font-normal af-muted">
            Real games and players, fake teams and managers. Read-only.
          </span>
        </p>
        <Link
          href="/create-league"
          className="af-button-primary inline-flex min-h-[36px] items-center rounded-xl px-4 text-xs font-semibold"
        >
          Create your own league
        </Link>
      </div>
    </div>
  )
}
