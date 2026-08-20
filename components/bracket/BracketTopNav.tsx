'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getPrimaryChimmyEntry } from '@/lib/ai-product-layer'

const CHIMMY_HREF = getPrimaryChimmyEntry().href

/** Single-line bracket product nav (layout only mounts under `/brackets`). */
const BRACKET_SURFACE_TABS = [
  { href: '/brackets', label: 'Lobby' },
  { href: '/brackets/join', label: 'Join' },
  { href: '/brackets/leagues/new', label: 'Create' },
  { href: '/brackets/nba', label: 'NBA' },
  { href: '/brackets/nhl', label: 'NHL' },
  { href: '/brackets/world-cup', label: 'World Cup' },
  { href: '/brackets/discover', label: 'Discover' },
  { href: '/brackets#bracket-sports', label: 'Sports' },
  { href: '/messages', label: 'Chat' },
  { href: CHIMMY_HREF, label: 'AI' },
] as const

function normalizePath(pathname: string): string {
  const raw = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '')
  return raw === '' ? '/' : raw
}

function isBracketSurfaceTabActive(pathname: string, tabHref: string): boolean {
  if (tabHref === CHIMMY_HREF) return false
  const [pathPart, hash] = tabHref.split('#')
  const p = normalizePath(pathname)
  const baseRaw = pathPart.replace(/\/+$/, '')
  const base = baseRaw === '' ? '/' : baseRaw

  if (hash) {
    const anchorBase = base === '/' ? '/' : base
    return p === anchorBase
  }

  if (base === '/brackets') {
    return p === '/brackets'
  }

  return p === base || p.startsWith(`${base}/`)
}

export default function BracketTopNav() {
  const pathname = usePathname() ?? ''

  return (
    <nav
      aria-label="Bracket sections"
      className="-mx-1 flex flex-nowrap items-center gap-px overflow-x-auto pb-0.5 pt-0 sm:mx-0 sm:gap-1"
    >
      {BRACKET_SURFACE_TABS.map((tab, idx) => {
        const active = isBracketSurfaceTabActive(pathname, tab.href)
        return (
          <Link
            key={`${tab.label}-${idx}`}
            href={tab.href}
            className={`touch-manipulation inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded px-2 py-0.5 text-center text-[9px] font-semibold uppercase leading-none tracking-wide transition sm:text-[10px] ${
              active
                ? 'bg-white/[0.14] font-bold text-white ring-1 ring-white/20'
                : 'text-white/40 hover:bg-white/[0.05] hover:text-white/75'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
