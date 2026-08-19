import type { ReactNode } from 'react'
import { Suspense } from 'react'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'
import { LeagueEmbedGate } from '@/components/navigation/LeagueEmbedGate'

/**
 * League pages own their chrome: the global AllFantasy top nav is hidden here
 * (hideHeader) — the league command-center header carries identity, Home, and
 * settings itself, so the page reads as ONE surface instead of stacked navs.
 */
export default function LeagueSegmentLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ProductShellLayout hideHeader hideSidebar>{children}</ProductShellLayout>}>
      <LeagueEmbedGate fallback={<ProductShellLayout hideHeader hideSidebar>{children}</ProductShellLayout>}>
        {children}
      </LeagueEmbedGate>
    </Suspense>
  )
}
