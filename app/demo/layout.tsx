import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DemoBanner } from '@/components/demo-league/DemoBanner'
import { DemoNav } from '@/components/demo-league/DemoNav'

export const metadata: Metadata = {
  title: 'Demo league — live sample data · AllFantasy',
  description: 'Browse a live AllFantasy league with anonymized teams: standings, matchups, rosters, trades, Chimmy and the trade evaluator. No account needed.',
  robots: { index: false, follow: false },
}

/**
 * Every /demo page renders inside this layout, so the "Demo league — live sample data"
 * label cannot be forgotten on a new page. No session is read anywhere under /demo: the
 * demo is the same for every visitor, signed in or not.
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="af-surface min-h-dvh" data-demo-league="1">
      <DemoBanner />
      <DemoNav />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">{children}</main>
    </div>
  )
}
