'use client'

import Link from 'next/link'

/** Any Clubhouse page that fails to load lands here rather than on the global error screen. */
export default function ClubhouseError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen mode-surface mode-readable">
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-3xl" aria-hidden>
          🏟️
        </p>
        <h1 className="mt-2 text-xl font-bold" style={{ color: 'var(--text)' }}>
          The Clubhouse didn't load
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Something went wrong on our side. Try again in a moment.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Try again
          </button>
          <Link href="/" className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
