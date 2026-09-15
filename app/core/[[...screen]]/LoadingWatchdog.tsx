'use client'

import { useEffect, useState } from 'react'

/**
 * The skeleton's timeout-to-error path.
 *
 * `loading.tsx` shows only while the server render of the screen is still open.
 * A healthy render replaces it in a few seconds; a stuck one — a read with no
 * end against the cross-region database — leaves the skeleton up with no way
 * forward. This watchdog runs while the skeleton is mounted and, once the wait
 * is clearly abnormal, offers a reload rather than an endless shimmer.
 *
 * It never fires on a render that is merely slow: the trip point sits well past
 * the recorded p90 (6–7s), so a working screen has painted and unmounted this
 * long before the timer.
 */
const WATCHDOG_MS = 20_000

export default function LoadingWatchdog() {
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), WATCHDOG_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!stalled) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        insetInlineStart: '50%',
        insetBlockEnd: 24,
        transform: 'translateX(-50%)',
        zIndex: 50,
        maxWidth: 420,
        width: 'calc(100% - 32px)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(2,6,23,0.92)',
        color: '#e2e8f0',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1.4 }}>This screen is taking longer than usual.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          flexShrink: 0,
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 600,
          background: '#0ea5e9',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  )
}
