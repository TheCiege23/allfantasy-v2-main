'use client'
import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { primeDeployBaseline, refreshInBackground } from '@/lib/core-app/deployGuard'

/** Cheap change detection; expensive Home reads run only when the trade feed changes. */
export default function CoreTradeRefresh() {
  const router = useRouter()
  const [pending, startRefresh] = useTransition()
  const pendingRef = useRef(false)
  pendingRef.current = pending
  useEffect(() => {
    let version: string | null = null
    let checking = false
    const controller = new AbortController()
    const check = async () => {
      if (document.visibilityState !== 'visible' || checking || pendingRef.current) return
      checking = true
      try {
        const response = await fetch('/api/core/trade-version', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) return
        const next = (await response.json()).version
        if (typeof next !== 'string' || controller.signal.aborted) return
        if (version !== next) {
          version = next
          // Guarded: after a deploy a background refresh is a full page reload (lib/core-app/deployGuard).
          void refreshInBackground(() => startRefresh(() => router.refresh()))
        }
      } catch { /* Existing shell refresh remains the fallback. */ }
      finally { checking = false }
    }
    void primeDeployBaseline()
    const timer = window.setInterval(check, 5000)
    document.addEventListener('visibilitychange', check)
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [router])
  return null
}
