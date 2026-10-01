'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'

/**
 * What a manager sees when a league's ±2 level band keeps them out
 * (`lib/league-join/managerClass.ts`), with the one way forward: asking the
 * commissioner. Shared by every join page so the message and the request flow
 * are the same wherever the invite was opened.
 */

export type ClassGateBlocked = {
  code?: string
  error?: string
  message?: string
  minRankLevel?: number
  maxRankLevel?: number
  userRankLevel?: number
}

export function isClassGateBlocked(payload: unknown): payload is ClassGateBlocked {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as ClassGateBlocked
  return p.code === 'RANK_GATE_BLOCKED' || p.error === 'RANK_GATE_BLOCKED'
}

type RequestState = 'idle' | 'sending' | 'requested' | 'already_requested' | 'already_granted' | 'not_needed' | 'error'

const DONE_COPY: Partial<Record<RequestState, string>> = {
  requested: 'Request sent. The commissioner has been notified — you will get a notification when they decide.',
  already_requested: 'You have already asked. The commissioner has been notified and will decide.',
  already_granted: 'The commissioner has already let you in. Try joining again.',
  not_needed: 'You are inside this league’s level range now. Try joining again.',
}

export function ClassGateNotice({
  blocked,
  code,
  token,
  tone = 'dark',
}: {
  blocked: ClassGateBlocked
  /** The league invite code or tracked-invite token the manager opened. */
  code?: string | null
  /** A `/join/<token>` league invite token. */
  token?: string | null
  tone?: 'dark' | 'theme'
}) {
  const [state, setState] = useState<RequestState>('idle')
  const [error, setError] = useState<string | null>(null)

  const ask = useCallback(async () => {
    setState('sending')
    setError(null)
    try {
      const res = await fetch('/api/leagues/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_class_exception',
          ...(code ? { code } : {}),
          ...(token ? { token } : {}),
        }),
      })
      const data = (await res.json().catch(() => null)) as { requestStatus?: RequestState; error?: string } | null
      if (!res.ok || !data?.requestStatus) {
        setState('error')
        setError(data?.error ?? 'Could not send your request. Try again.')
        return
      }
      setState(data.requestStatus)
    } catch {
      setState('error')
      setError('Could not send your request. Try again.')
    }
  }, [code, token])

  const min = blocked.minRankLevel
  const max = blocked.maxRankLevel
  const you = blocked.userRankLevel
  const muted = tone === 'dark' ? 'text-slate-300' : ''
  const mutedStyle = tone === 'theme' ? { color: 'var(--muted)' } : undefined
  const textStyle = tone === 'theme' ? { color: 'var(--text)' } : undefined
  const done = DONE_COPY[state]

  return (
    <section
      className="w-full rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-left sm:p-5"
      data-testid="class-gate-notice"
      aria-live="polite"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Outside your level range</p>
      <p className={`mt-2 text-sm font-semibold ${tone === 'dark' ? 'text-white' : ''}`} style={textStyle}>
        {min != null && max != null && you != null
          ? `This league is for Level ${min}–${max}. You are Level ${you}.`
          : blocked.message ?? 'This league is outside your level range.'}
      </p>
      <p className={`mt-1 text-sm ${muted}`} style={mutedStyle}>
        AllFantasy matches managers within two levels of each other, so nobody plays far above or below their
        experience. The commissioner can make an exception for you.
      </p>

      {done ? (
        <p className="mt-3 text-sm font-medium text-emerald-300" data-testid="class-gate-request-status">
          {done}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void ask()}
            disabled={state === 'sending'}
            data-testid="class-gate-request-button"
            className="min-h-[44px] rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:opacity-60"
          >
            {state === 'sending' ? 'Sending…' : 'Ask the commissioner to let me in'}
          </button>
          <Link
            href="/find-league"
            className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/15 px-4 py-2 text-sm ${muted}`}
            style={mutedStyle}
          >
            Find a league at my level
          </Link>
        </div>
      )}
      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
    </section>
  )
}
