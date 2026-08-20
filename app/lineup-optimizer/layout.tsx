import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'

export const metadata: Metadata = {
  title: 'Lineup Optimizer | AllFantasy',
  description:
    'AI start/sit and lineup optimization tuned to your league: optimal starters, FLEX decisions, injury risk, matchup upside, and safe-floor lineups.',
  alternates: { canonical: 'https://allfantasy.ai/lineup-optimizer' },
}

export default function LineupOptimizerLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
