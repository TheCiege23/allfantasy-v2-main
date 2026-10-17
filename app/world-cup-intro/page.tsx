import { Suspense } from 'react'
import WorldCupIntroExperienceClient from '@/components/world-cup/WorldCupIntroExperienceClient'

export const dynamic = 'force-dynamic'

export default function WorldCupIntroPage() {
  return (
    <Suspense>
      <WorldCupIntroExperienceClient />
    </Suspense>
  )
}
