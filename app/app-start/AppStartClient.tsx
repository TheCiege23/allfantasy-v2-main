'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AfCrest } from '@/components/core-app/AfCrest'
import { APP_START_TARGET } from '@/lib/platform/iosAppLaunch'

/**
 * If the client navigation has not swapped /core in by now, load it as a page. /core with a query is
 * never sent back here (lib/platform/iosAppLaunch.ts), so this cannot loop.
 */
export const APP_START_FALLBACK_MS = 30_000

export function AppStartClient({ text }: { text: string }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(APP_START_TARGET)
    const fallback = window.setTimeout(() => window.location.replace(APP_START_TARGET), APP_START_FALLBACK_MS)
    return () => window.clearTimeout(fallback)
  }, [router])

  return (
    <main
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100vh',
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: '#020617',
        color: '#eef0fa',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <AfCrest size={64} />
      <span className="af-app-start-spinner" aria-hidden />
      <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{text}</p>
      <style>{`
        .af-app-start-spinner{width:30px;height:30px;border-radius:50%;border:3px solid rgba(255,255,255,.14);border-top-color:#0b8dcb;animation:af-app-start-spin .9s linear infinite}
        @keyframes af-app-start-spin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion: reduce){.af-app-start-spinner{animation:none}}
      `}</style>
    </main>
  )
}
