import type { ReactNode } from 'react'
import type { SurvivorNotificationIcon } from '@/lib/core-app/survivorNotificationIcon'

/**
 * Small inline Survivor icons for the notifications centre, one per `SurvivorNotificationIcon`.
 * 16px, `currentColor` strokes so the row decides the colour (af-survivor-theme.css). Decorative:
 * the row's own title says what happened, so each glyph is aria-hidden.
 */

const PATHS: Record<SurvivorNotificationIcon, ReactNode> = {
  // A ballot going into the urn.
  ballot: (
    <>
      <path d="M7 3h7l3 3v6H7Z" />
      <path d="M9.5 7.5h4M9.5 10h4" />
      <path d="M4 13h16v7H4Z" />
      <path d="M9 16.5h6" />
    </>
  ),
  // A lit tribal torch.
  torch: (
    <>
      <path d="M12 2.8c-2.3 2.2-3 4.2-2.2 5.9.5 1 1.3 1.5 2.2 1.5s1.7-.5 2.2-1.5c.8-1.7.1-3.7-2.2-5.9Z" />
      <path d="M8.8 11.5h6.4l-1.1 2.3H9.9Z" />
      <path d="M12 13.8V21" />
    </>
  ),
  // The tribe has spoken.
  skull: (
    <>
      <path d="M12 3.5c-4.1 0-7 2.8-7 6.6 0 2.3 1.1 3.9 2.6 4.8V18h8.8v-3.1c1.5-.9 2.6-2.5 2.6-4.8 0-3.8-2.9-6.6-7-6.6Z" />
      <circle cx="9.3" cy="10.6" r="1.4" />
      <circle cx="14.7" cy="10.6" r="1.4" />
      <path d="M10.5 18v2.5M13.5 18v2.5" />
    </>
  ),
  // The immunity necklace.
  immunity: (
    <>
      <path d="M5 4c.4 5 3.2 8 7 8s6.6-3 7-8" />
      <path d="M12 12l-3 4 3 4.5 3-4.5Z" />
    </>
  ),
  // A hidden immunity idol.
  idol: (
    <>
      <path d="M8.5 4h7l1 4.5-1.5 2v8.5h-6v-8.5l-1.5-2Z" />
      <circle cx="10.6" cy="7.3" r=".9" />
      <circle cx="13.4" cy="7.3" r=".9" />
      <path d="M10.5 10h3M10 14h4M10 17h4" />
    </>
  ),
  // Buffs trading places.
  swap: (
    <>
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </>
  ),
  // A lone island across the water.
  exile: (
    <>
      <path d="M3 18c2 1.3 4 1.3 6 0s4-1.3 6 0 4 1.3 6 0" />
      <path d="M7 15c1.5-2 3.5-3 5-3s3.5 1 5 3" />
      <path d="M12 12V6M12 6c-1.6-1.2-3.4-1.4-5-.6M12 6c1.6-1.2 3.4-1.4 5-.6" />
    </>
  ),
  // Two tribes becoming one.
  merge: (
    <>
      <path d="M5 4v4c0 3 2.5 5 7 5" />
      <path d="M19 4v4c0 3-2.5 5-7 5v7" />
      <path d="M9 17l3 3 3-3" />
    </>
  ),
  // The jury bench.
  jury: (
    <>
      <path d="M4 20h16" />
      <path d="M6 20v-6h12v6" />
      <circle cx="8.5" cy="9" r="1.8" />
      <circle cx="12" cy="8" r="1.8" />
      <circle cx="15.5" cy="9" r="1.8" />
    </>
  ),
  // The Sole Survivor.
  crown: (
    <>
      <path d="M4 8l4 4 4-6 4 6 4-4-1.5 10h-13Z" />
      <path d="M6.5 20.5h11" />
    </>
  ),
  // A challenge flag.
  challenge: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4.5h11l-2.5 3.5L17 11.5H6" />
    </>
  ),
  // Chimmy's report: a page with its sparkle.
  chimmy: (
    <>
      <path d="M6 3.5h9l3 3V20.5H6Z" />
      <path d="M9 11h6M9 14h6M9 17h4" />
      <path d="M11 5.2l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z" />
    </>
  ),
  // A raid on a roster.
  raid: (
    <>
      <path d="M5 19L17 7" />
      <path d="M14 4h6v6" />
      <path d="M5 13v6h6" />
    </>
  ),
  // Something on the island needs the commissioner.
  alert: (
    <>
      <path d="M12 3.5l9 16H3Z" />
      <path d="M12 10v4.5M12 17v.5" />
    </>
  ),
}

export function SurvivorNotificationGlyph({ icon, size = 16 }: { icon: SurvivorNotificationIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-sv-icon={icon}
    >
      {PATHS[icon]}
    </svg>
  )
}
