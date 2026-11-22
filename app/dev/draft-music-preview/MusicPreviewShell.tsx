'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-comms.css'
import { AppMusicDock } from '@/components/app-music/AppMusicDock'
import CommsDrawer, { type CommsTab } from '@/components/core-app/comms/CommsDrawer'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from '@/components/core-app/comms/commsEvents'

const SCREENS = [
  { href: '/dev/draft-music-preview', label: 'Draft' },
  { href: '/dev/draft-music-preview/lineup', label: 'Lineup' },
  { href: '/dev/draft-music-preview/trades', label: 'Trades' },
]

/**
 * The REAL chat panel (CommsDrawer) behind a stand-in chat bubble, so the Music
 * tab is previewed in the component users will see, not in a copy of it.
 *
 * ⚠ The drawer stays mounted across these preview screens, unlike the app's,
 * which remounts it on every /core screen change. That makes this preview
 * KINDER than production on one point — the app depends on the music engine
 * (AppMusicDock, here at the bottom) surviving the remount, which it does
 * because it lives in the root layout. `?remount=1` keys the drawer by path to
 * reproduce the production behaviour.
 */
export function MusicPreviewShell({ children }: { children: ReactNode }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const mode = params?.get('mode') ?? 'dark'
  const docked = params?.get('docked') === '1'
  const remount = params?.get('remount') === '1'
  const query = params?.toString() ? `?${params.toString()}` : ''
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<CommsTab>('music')

  useEffect(() => {
    document.documentElement.dataset.mode = mode
  }, [mode])

  // The same event the real chat bubble listens for (the draft room's "Play music" sends it).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<CommsOpenDetail>).detail
      if (detail?.tab) setTab(detail.tab)
      setOpen(true)
    }
    window.addEventListener(COMMS_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(COMMS_OPEN_EVENT, onOpen)
  }, [])

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

      {/* Stand-in for the real chat bubble (CommsDock), with its real class and position. */}
      {open ? null : (
        <button type="button" className="af-cm-launch" aria-label="Open chat" onClick={() => setOpen(true)}>
          <MessageSquare size={22} aria-hidden />
        </button>
      )}
      <CommsDrawer
        key={remount ? pathname ?? 'p' : 'drawer'}
        open={open}
        onClose={() => setOpen(false)}
        mode={docked ? 'docked' : 'overlay'}
        leagues={[]}
        pageLeagueId={null}
        chimmyTokenCost={null}
        initialTab={tab}
        onTabChange={setTab}
      />

      {/* The real app mounts this once in app/layout.tsx; signed-out here, so forced on. */}
      <AppMusicDock alwaysShow />
    </main>
  )
}
