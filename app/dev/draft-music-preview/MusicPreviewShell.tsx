'use client'

import { useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import '@/components/core-app/af-core.css'
import { AppMusicDock } from '@/components/app-music/AppMusicDock'

const SCREENS = [
  { href: '/dev/draft-music-preview', label: 'Draft' },
  { href: '/dev/draft-music-preview/lineup', label: 'Lineup' },
  { href: '/dev/draft-music-preview/trades', label: 'Trades' },
]

export function MusicPreviewShell({ children }: { children: ReactNode }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const mode = params?.get('mode') ?? 'dark'
  const query = params?.toString() ? `?${params.toString()}` : ''

  useEffect(() => {
    document.documentElement.dataset.mode = mode
  }, [mode])

  return (
    <main
      className="af-core"
      style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: 16 }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 12 }}>
        <nav className="af-frame" style={{ padding: 8, display: 'flex', gap: 6 }} aria-label="Preview screens">
          {SCREENS.map((s) => (
            <Link
              key={s.href}
              href={`${s.href}${query}`}
              className="af-chip"
              aria-current={pathname === s.href ? 'page' : undefined}
              style={{
                padding: '8px 14px',
                fontWeight: pathname === s.href ? 700 : 500,
                background: pathname === s.href ? 'var(--accent-soft)' : undefined,
              }}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
      {/* The real app mounts this once in app/layout.tsx; signed-out here, so forced on. */}
      <AppMusicDock alwaysShow />
    </main>
  )
}
