'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getPrimaryChimmyEntry } from '@/lib/ai-product-layer'

const CHIMMY_HREF = getPrimaryChimmyEntry().href

const TABS = [
  { href: '/brackets', label: 'Home' },
  { href: '/brackets', label: 'My Pools' },
  { href: '/brackets/leagues/new', label: 'Create Pool' },
  { href: '/brackets/join', label: 'Join Pool' },
  { href: '/brackets', label: 'My Entries' },
  { href: '/brackets', label: 'Standings' },
  { href: '/messages', label: 'Pool Chat' },
  { href: CHIMMY_HREF, label: 'AI Coach' },
  { href: '/brackets', label: 'History' },
] as const

export default function BracketTopNav() {
  const pathname = usePathname() ?? ""

  return (
    <nav
      aria-label="Bracket sections"
      className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2 sm:gap-1.5"
    >
      {TABS.map((tab, idx) => {
        const active = tab.href !== CHIMMY_HREF && pathname === tab.href
        return (
          <Link
            key={`${tab.label}-${idx}`}
            href={tab.href}
            className={`touch-manipulation inline-flex min-h-[40px] min-w-[44px] flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-lg px-2 py-2 text-center text-[11px] font-semibold leading-tight transition sm:flex-none sm:basis-auto sm:px-3 sm:py-1.5 sm:text-xs ${
              active
                ? 'bg-white text-black'
                : 'border border-white/10 bg-black/20 text-white/75 hover:bg-white/10 active:bg-white/15'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
