'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/**
 * AF Core — the error boundary for every /core screen.
 *
 * 🛑 WITHOUT THIS FILE A RENDER THROW TEARS DOWN THE WHOLE SCREEN. `page.tsx` is
 * `force-dynamic` and does its work during the render. When one stage throws
 * after the shell has already streamed, React aborts the boundary (error #419)
 * and, with no error file at this segment, the failure climbs to the app-level
 * boundary — a bare dark card that carries none of the core chrome. That is the
 * black screen the report saw on /core/commissioner.
 *
 * This keeps the failure inside /core and gives it a way out: `reset()` re-runs
 * the server render of this screen only. It is a client component and imports
 * nothing server-only, so it cannot pull database code into a client chunk.
 */
export default function AfCoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.error('[app/core/error] boundary caught', {
        message: error?.message,
        digest: error?.digest,
      })
    } catch {
      /* ignore */
    }
  }, [error])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        background: '#020617',
        color: '#e2e8f0',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.03)',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>This screen did not load</h1>
        <p style={{ marginTop: 8, fontSize: 13, color: 'rgba(226,232,240,0.7)' }}>
          A read timed out or failed while the screen was building. Nothing is lost — reload the
          screen, or go back to your leagues.
        </p>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              background: '#0ea5e9',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload this screen
          </button>
          <Link
            href="/core"
            style={{
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid rgba(255,255,255,0.18)',
              color: 'rgba(226,232,240,0.9)',
              textDecoration: 'none',
            }}
          >
            My leagues
          </Link>
        </div>
      </div>
    </div>
  )
}
