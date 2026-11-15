'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import '@/components/core-app/af-core.css'
import DraftRoomMusic from '@/components/core-app/draft-music/DraftRoomMusic'

export function DraftMusicPreviewClient() {
  const params = useSearchParams()
  const mode = params?.get('mode') ?? 'dark'
  const open = params?.get('open') === '1'

  useEffect(() => {
    document.documentElement.dataset.mode = mode
  }, [mode])

  return (
    <main
      className="af-core"
      style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: 16 }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 12 }}>
        <header
          className="af-frame"
          style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between' }}
        >
          <strong>Iron Horse Dynasty · Round 3, pick 4</strong>
          <span style={{ color: 'var(--muted)' }}>On the clock 1:12</span>
        </header>

        <DraftRoomMusic defaultOpen={open} />

        <section className="af-frame" style={{ padding: 14, minHeight: 220 }}>
          <span className="af-label">The board</span>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Board placeholder for the preview.</p>
        </section>
      </div>
    </main>
  )
}
