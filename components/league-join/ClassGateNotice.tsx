'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'

/** Shared request panel for a manager outside the league’s Career Level band. */

export type ClassGateBlocked = {
  code?: string
  error?: string
  leagueId?: string
  userLevel?: number
  leagueLevel?: number
  band?: [number, number]
  canRequest?: boolean
}

export function isClassGateBlocked(payload: unknown): payload is ClassGateBlocked {
  if (!payload || typeof payload !== 'object') return false
  return (payload as ClassGateBlocked).code === 'CAREER_LEVEL_GATE_BLOCKED'
}

type RequestState = 'idle' | 'sending' | 'requested' | 'already_requested' | 'already_granted' | 'not_needed' | 'error'

const DONE_COPY: Partial<Record<RequestState, string>> = {
  requested: 'Request sent. The commissioner has been notified — you will get a notification when they decide.',
  already_requested: 'You have already asked. The commissioner has been notified and will decide.',
  already_granted: 'The commissioner has already let you in. Try joining again.',
  not_needed: 'You can join this league now. Try joining again.',
}

export function ClassGateNotice({
  blocked,
  code,
  token,
  tone = 'dark',
}: {
  blocked: ClassGateBlocked
  /** The league join code or tracked-invite token the manager opened. */
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

  const band = blocked.band
  const range = band ? (`levels ${band[0]}–${band[1]}`) : null
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
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Commissioner approval required</p>
      <p className={`mt-2 text-sm font-semibold ${tone === 'dark' ? 'text-white' : ''}`} style={textStyle}>
        {blocked.userLevel != null && range
          ? `You are Career Level ${blocked.userLevel}. This league is open to direct joins from ${range}.`
          : blocked.error ?? 'This league is outside your Career Level range.'}
      </p>
      <p className={`mt-1 text-sm ${muted}`} style={mutedStyle}>
        Your request shares your handle, Career Level and a summary of your verified league history with the commissioner.
      </p>

      {done ? (
        <p className="mt-3 text-sm font-medium text-emerald-300" data-testid="class-gate-request-status">
          {done}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          {blocked.canRequest !== false ? (
            <button
              type="button"
              onClick={() => void ask()}
              disabled={state === 'sending'}
              data-testid="class-gate-request-button"
              className="min-h-[44px] rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:opacity-60"
            >
              {state === 'sending' ? 'Sending…' : 'Request to join'}
            </button>
          ) : null}
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
