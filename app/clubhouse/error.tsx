'use client'

import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/community/clubhouse.css'

/** Any Clubhouse page that fails to load lands here rather than on the global error screen. */
export default function ClubhouseError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="af-core ch">
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="text-5xl" aria-hidden>
          🏟️
        </p>
        <h1 className="ch-article-title mt-4">
          The Clubhouse didn't load
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Something went wrong on our side. Try again in a moment.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="ch-btn ch-btn-primary"
          >
            Try again
          </button>
          <Link href="/" className="ch-btn ch-btn-ghost">
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
