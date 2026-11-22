'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Shown at the top of EVERY demo page (rendered by app/demo/layout.tsx, so a new demo
 * page cannot forget it).
 *
 * The live demo's wording is fixed by product: "Demo league — live sample data". The
 * per-format demos under /demo/formats are GENERATED examples, not a live league, so they
 * say so instead — calling a made-up league "live" would be a false claim on the one line
 * every visitor reads.
 */
export function DemoBanner() {
  const path = usePathname() ?? '/demo'
  const isFormatSample = path.startsWith('/demo/formats')
  return (
    <div
      role="status"
      data-testid="demo-league-banner"
      className="sticky top-0 z-30 border-b px-4 py-2 text-sm"
      style={{
        // Solid, not the translucent -soft token: the banner is sticky and content scrolls under it.
        background: 'color-mix(in srgb, var(--color-warning) 16%, var(--surface-app))',
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          <span aria-hidden="true">🧪 </span>
          {isFormatSample ? 'Demo league — example data' : 'Demo league — live sample data'}
          <span className="ml-2 font-normal af-muted">
            {isFormatSample
              ? 'A generated example of this league type. Real players, made-up teams and results.'
              : 'Real games and players, fake teams and managers. Read-only.'}
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
