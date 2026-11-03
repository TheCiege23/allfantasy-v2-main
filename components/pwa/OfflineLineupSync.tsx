'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { flushQueuedLineupEdits } from '@/lib/pwa/offlineLineupQueue'

/**
 * Sends lineup changes made offline (lib/pwa/offlineLineupQueue.ts) as soon as the app is online again —
 * on whichever page is open, not only the lineup screen they were made on. Says what happened to each,
 * because a change the server refused (a game kicked off first, or the roster changed meanwhile) is a
 * change the person believes they made.
 */
export function OfflineLineupSync() {
  useEffect(() => {
    const flush = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      void flushQueuedLineupEdits().then((results) => {
        for (const r of results) {
          if (r.outcome === 'saved') toast.success('Lineup changes you made offline are saved.')
          else if (r.outcome === 'rejected') toast.error('Lineup changes you made offline were not saved.', { description: r.message })
        }
      })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush()
    }
    flush()
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
