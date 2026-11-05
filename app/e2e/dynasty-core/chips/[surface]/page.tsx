import { notFound } from 'next/navigation'
import DynastyChipsHarnessClient from '../DynastyChipsHarnessClient'
import { CHIP_SURFACES, type ChipSurface } from '../fixture'

/**
 * DB-free render of the dynasty age / ROOKIE / PROSPECT chips beyond My team, for visual review.
 * Production is refused here and by app/e2e/layout.tsx.
 *
 *   /e2e/dynasty-core/chips/card              ← My team; tap a name, the card shows age + ROOKIE
 *   /e2e/dynasty-core/chips/card?prospect=1   ← the card for a devy prospect
 *   /e2e/dynasty-core/chips/waivers           ← "Worth adding" with chips
 *   /e2e/dynasty-core/chips/finder            ← Player Finder results in a held devy league
 *   /e2e/dynasty-core/chips/devy              ← My team in a C2C league, PROSPECT on the devy rows
 *   …?identity=off                            ← the same screen as it rendered before
 */
export default async function DynastyChipsHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ surface: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { surface } = await params
  if (!(CHIP_SURFACES as readonly string[]).includes(surface)) notFound()
  const sp = await searchParams
  return <DynastyChipsHarnessClient surface={surface as ChipSurface} off={sp.identity === 'off'} />
}
