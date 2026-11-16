import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DemoCoreShell } from '@/components/demo-league/DemoCoreShell'
import { demoRailItems } from '@/lib/demo-league/demoRail'

export const metadata: Metadata = {
  title: 'Demo league — live sample data · AllFantasy',
  description: 'Browse a live AllFantasy league with anonymized teams: standings, matchups, rosters, trades, Chimmy and the trade evaluator. No account needed.',
  robots: { index: false, follow: false },
}

const RAIL = demoRailItems()

/**
 * Every /demo page renders inside this layout, so the "Demo league — live sample data"
 * label cannot be forgotten on a new page (DemoCoreShell renders DemoBanner). No session is read
 * anywhere under /demo: the demo is the same for every visitor, signed in or not.
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return <DemoCoreShell rail={RAIL}>{children}</DemoCoreShell>
}
