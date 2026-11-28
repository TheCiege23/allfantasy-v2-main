'use client'

import { brandShieldSrc, seasonalShieldSrc } from '@/lib/brand/seasonalShield'

/**
 * The AllFantasy shield for the public pages' nav bars (landing, commissioners,
 * sign-in / sign-up, import, pricing) — one component, so they always match.
 *
 * The art follows the calendar (fall / winter / New Year, plain otherwise).
 * Pass `founding` ONLY from a surface where the server resolved this viewer's
 * founding offer (pricing, via LaunchOfferContext): then the "50% OFF" sale art
 * may show, and only when that offer's label itself says 50%. Without the prop
 * no sale art ever shows. Rules: lib/brand/seasonalShield.ts.
 *
 * `suppressHydrationWarning`: the server and the browser each read the date;
 * they only disagree in the seconds around a season change.
 */
export function BrandShield({
  height = 34,
  founding,
}: {
  height?: number
  founding?: { label: string | null } | null
}) {
  const src = founding === undefined ? seasonalShieldSrc() : brandShieldSrc({ founding })
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static brand art, already sized
    <img
      src={src}
      suppressHydrationWarning
      alt=""
      aria-hidden
      draggable={false}
      style={{ height, width: 'auto', display: 'block', flex: 'none' }}
    />
  )
}
