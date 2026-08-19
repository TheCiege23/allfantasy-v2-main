'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, Shield, TriangleAlert } from 'lucide-react'

/** Only allow `next` that points inside `/admin` — matches the consume route's sanitizer. */
function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return '/admin'
  if (!raw.startsWith('/')) return '/admin'
  if (raw.startsWith('//')) return '/admin'
  if (!raw.startsWith('/admin')) return '/admin'
  return raw
}

/**
 * Admin sign-in (magic link). Authored for the app's LIGHT mode: the global
 * `html[data-mode="light"] .mode-readable` layer force-clamps every `text-white*` class to the
 * dark `--text` token with !important, so a dark-background design renders dark-on-dark and is
 * unreadable. This page therefore uses the app's own design tokens (`--text`, `--muted`,
 * `--border`, `--accent`) and hex/arbitrary color classes the clamp does not target, so all
 * contrast is deterministic and meets WCAG AA. See __tests__/admin-login-accessibility.test.tsx.
 */
export default function AdminLoginContent() {
  const searchParams = useSearchParams()
  const next = sanitizeNext(searchParams?.get('next'))
  const errCode = searchParams?.get('err')

  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const banner = useMemo(() => {
    if (errCode === 'magic') {
      return 'That link is no longer valid. Magic links expire after 10 minutes — request a new one below.'
    }
    return null
  }, [errCode])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setErrorMsg('Enter a valid email.')
      setState('error')
      return
    }
    setErrorMsg(null)
    setState('submitting')
    try {
      const res = await fetch('/api/auth/admin-magic/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, next }),
      })
      if (!res.ok) {
        setErrorMsg('Request failed. Try again in a moment.')
        setState('error')
        return
      }
      // The backend always returns {ok:true} to prevent email enumeration.
      // We can't tell here whether the email is on the allowlist — just confirm "check your inbox if eligible."
      setState('sent')
    } catch {
      setErrorMsg('Network error. Try again.')
      setState('error')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-[#EEF1F7] px-4 py-10 text-[color:var(--text)]">
      {/*
        Two scoped, higher-specificity rules (this page only):
        1. The app clamps ALL input placeholders to --muted2 (≈3.3:1) with !important in light mode —
           restore an AA placeholder (≈5.8:1) for this field.
        2. @tailwindcss/forms + Tailwind's ring utilities leave the focused field with no visible
           indicator here (empty ring shadow, transparent outline). Force a solid accent outline
           (var(--accent) #2563EB ≈ 5.2:1 on white) so keyboard focus is always visible.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            'html[data-mode="light"] input.af-admin-email::placeholder{color:rgba(2,6,23,0.62)!important}' +
            '.af-admin-focus:focus{outline:2px solid var(--accent,#2563EB)!important;outline-offset:2px!important}',
        }}
      />
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-[13px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
          <Shield className="h-4 w-4 text-[color:var(--accent)]" />
          <span>AllFantasy Admin</span>
        </div>

        <div className="rounded-2xl border border-[color:var(--border)] bg-[#ffffff] p-6 shadow-xl shadow-slate-900/5">
          <h1 className="text-[20px] font-bold text-[color:var(--text)]">Admin sign in</h1>
          <p className="mt-1 text-[13px] leading-snug text-[color:var(--muted)]">
            Enter your admin email. If you&rsquo;re on the allowlist, we&rsquo;ll send a one-time magic link
            that expires in 10 minutes.
          </p>

          {banner ? (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>{banner}</span>
            </div>
          ) : null}

          {state === 'sent' ? (
            <div
              role="status"
              className="mt-5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-3 text-[13px] text-emerald-900"
            >
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                Check your email
              </div>
              <p className="mt-1 break-words text-[12px] text-emerald-900">
                If <span className="break-all font-mono">{email}</span> is on the admin allowlist, a magic
                link is on the way. It expires in 10 minutes. You can close this tab after clicking the link.
              </p>
              <button
                type="button"
                onClick={() => {
                  setState('idle')
                  setErrorMsg(null)
                }}
                className="af-admin-focus mt-3 inline-flex min-h-[44px] items-center rounded-sm text-[11px] font-semibold uppercase tracking-wide text-emerald-800 underline underline-offset-4 hover:text-emerald-900"
              >
                Send to a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[color:var(--text)]">
                  Admin email
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={state === 'submitting'}
                  placeholder="you@allfantasy.ai"
                  className="af-admin-email af-admin-focus min-h-[44px] w-full rounded-lg border border-[#64748b] bg-[#ffffff] px-3 py-2.5 text-[14px] text-[color:var(--text)] focus:border-[color:var(--accent)] disabled:opacity-60"
                />
              </label>

              {state === 'error' && errorMsg ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800"
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
                  <span>{errorMsg}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={state === 'submitting'}
                className="af-admin-focus inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#4338ca] to-[#6d28d9] px-4 py-2.5 text-[13px] font-semibold text-[#ffffff] shadow-sm transition hover:from-[#3730a3] hover:to-[#5b21b6] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state === 'submitting' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Sending link…
                  </>
                ) : (
                  'Email me a magic link'
                )}
              </button>

              {next !== '/admin' ? (
                <p className="text-center text-[11px] text-[color:var(--muted)]">
                  After sign-in, you&rsquo;ll be sent to <span className="break-all font-mono">{next}</span>
                </p>
              ) : null}
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-[color:var(--muted)]">
          Not an admin?{' '}
          <Link
            href="/login"
            className="af-admin-focus inline-flex min-h-[44px] items-center rounded-sm font-semibold text-[color:var(--accent)] underline underline-offset-4 hover:opacity-80"
          >
            Regular sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
