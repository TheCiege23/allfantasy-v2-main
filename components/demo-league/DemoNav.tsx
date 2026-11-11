'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/demo', label: 'League' },
  { href: '/demo/trades', label: 'Trades' },
  { href: '/demo/chimmy', label: 'Chimmy' },
  { href: '/demo/players', label: 'Player Finder' },
  { href: '/demo/trade-evaluator', label: 'Trade Evaluator' },
] as const

export function DemoNav() {
  const path = usePathname() ?? '/demo'
  return (
    <nav aria-label="Demo league" className="border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-card)' }}>
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
        {TABS.map((t) => {
          const active = t.href === '/demo' ? path === '/demo' || path.startsWith('/demo/teams') : path.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className="whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold"
              style={{
                borderColor: active ? 'var(--color-primary)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
