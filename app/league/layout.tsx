import type { ReactNode } from 'react'
import { Suspense } from 'react'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'
import { LeagueEmbedGate } from '@/components/navigation/LeagueEmbedGate'

export default function LeagueSegmentLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ProductShellLayout>{children}</ProductShellLayout>}>
      <LeagueEmbedGate fallback={<ProductShellLayout>{children}</ProductShellLayout>}>{children}</LeagueEmbedGate>
    </Suspense>
  )
}
