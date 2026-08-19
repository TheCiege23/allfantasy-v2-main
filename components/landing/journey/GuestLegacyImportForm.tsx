'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLegacySleeperImport } from '@/hooks/useLegacySleeperImport'
import { trackLandingCtaClick } from '@/lib/landing-analytics'

/**
 * No-login Sleeper import: types a username, we build their Legacy Score as
 * a guest (signed cookie, no AppUser yet), then hand them into the
 * /dashboard/universal guest preview. Reuses useLegacySleeperImport pointed
 * at the guest-scoped API + worker/poll loop already built for the
 * authenticated flow.
 */
export function GuestLegacyImportForm() {
  const router = useRouter()
  const renderedAtRef = useRef<number>(Date.now())
  const [inputValue, setInputValue] = useState('')
  const [honeypot, setHoneypot] = useState('')

  const { phase, error, bootLoading, statusMessage, startImport } = useLegacySleeperImport({
    importEndpoint: '/api/legacy/guest-import',
    extraBody: { website: honeypot, form_rendered_at: renderedAtRef.current },
  })

  const busy = phase === 'importing' || bootLoading

  useEffect(() => {
    if (phase !== 'complete') return
    const t = setTimeout(() => router.push('/dashboard/universal'), 600)
    return () => clearTimeout(t)
  }, [phase, router])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || busy) return
    trackLandingCtaClick({ cta_label: 'See my leagues', cta_destination: '/dashboard/universal', cta_type: 'primary', source: 'hero-guest-import' })
    void startImport(inputValue)
  }

  return (
    <form onSubmit={handleSubmit} className="relative z-10 mb-2 flex w-full max-w-sm flex-col items-center gap-2 sm:max-w-md">
      <div className="flex w-full items-stretch gap-2">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Your Sleeper username"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={busy || phase === 'complete'}
          data-testid="guest-import-username"
          className="min-w-0 flex-1 rounded-xl border px-4 py-3 text-sm outline-none transition focus:ring-2"
          style={{
            borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
            background: 'color-mix(in srgb, var(--panel2) 60%, transparent)',
            color: 'var(--text)',
          }}
        />
        {/* Honeypot — real users never see or fill this. */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          aria-hidden="true"
          className="absolute h-0 w-0 opacity-0"
          style={{ pointerEvents: 'none' }}
        />
        <button
          type="submit"
          disabled={busy || !inputValue.trim() || phase === 'complete'}
          data-testid="guest-import-submit"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition hover:opacity-90 disabled:opacity-60"
          style={{
            backgroundImage: 'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))',
            color: 'var(--on-accent-bg)',
          }}
        >
          {phase === 'complete' ? 'Ready!' : busy ? 'Building…' : 'See my leagues'}
        </button>
      </div>

      {phase === 'importing' && (
        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {statusMessage || 'Pulling in your leagues…'}
        </p>
      )}
      {phase === 'failed' && error && (
        <p className="text-[11px]" style={{ color: '#f87171' }} role="alert">
          {error}
        </p>
      )}
      {phase === 'complete' && (
        <p className="text-[11px]" style={{ color: 'var(--accent-emerald, #34d399)' }}>
          Taking you to your board…
        </p>
      )}
      <p className="text-[11px]" style={{ color: 'var(--muted2)' }}>
        No account needed. Free preview — sign up to unlock everything.
      </p>
    </form>
  )
}
