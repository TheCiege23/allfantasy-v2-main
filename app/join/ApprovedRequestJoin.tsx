'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { joinLandingHref } from '@/lib/league-join/joinLanding'

/**
 * /join?approved=<leagueId> — a private league's commissioner approved this player's Find a League
 * request (lib/public-discovery/privateLeagueRequests.ts), and the approval notification links here.
 *
 * Taking the seat is a separate step from approving it on purpose: the seat is gated on where the
 * PLAYER is (paid leagues), on the league still having room, and on its draft not having started —
 * all things only true or false at the moment they tap. The server answers every one of them;
 * this page shows the answer in its own words.
 */
export function ApprovedRequestJoin({ leagueId }: { leagueId: string }) {
  const { status: authStatus } = useSession()
  const [state, setState] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const callbackUrl = `/join?approved=${encodeURIComponent(leagueId)}`

  const take = async () => {
    setState('joining')
    setMessage('')
    try {
      const res = await fetch('/api/leagues/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'join_approved_request', leagueId }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
        return
      }
      if (data.success) {
        setState('joined')
        setMessage(data.alreadyMember ? 'You are already in this league.' : 'You joined the league.')
        setTimeout(() => {
          window.location.href = joinLandingHref({
            leagueId: typeof data.leagueId === 'string' ? data.leagueId : leagueId,
            memberOnly: Boolean(data.memberOnly),
          })
        }, 1200)
        return
      }
      setState('error')
      setMessage(typeof data.error === 'string' && data.error ? data.error : 'That did not work. Try again.')
    } catch {
      setState('error')
      setMessage('Something went wrong. Try again.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center mode-surface mode-readable">
      <div className="max-w-md mx-auto px-4 w-full" data-testid="league-join-approved">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          You&apos;re approved
        </h1>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
          The commissioner approved your request to join. Take your seat — it is not held for you, so a
          full league or a started draft can still close it.
        </p>
        {authStatus === 'unauthenticated' ? (
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="block w-full rounded-lg px-4 py-2 text-center text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#ffffff' }}
          >
            Sign in to take your seat
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void take()}
            disabled={state === 'joining' || state === 'joined'}
            data-testid="league-join-approved-button"
            className="w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--accent)', color: '#ffffff' }}
          >
            {state === 'joining' ? 'Joining…' : 'Take my seat'}
          </button>
        )}
        {message ? (
          <p
            role={state === 'error' ? 'alert' : 'status'}
            className="mt-3 text-sm"
            style={{ color: state === 'error' ? 'rgb(248, 113, 113)' : 'var(--text)' }}
            data-testid="league-join-approved-message"
          >
            {message}
          </p>
        ) : null}
        <Link href="/find-league" className="mt-4 inline-block text-sm underline" style={{ color: 'var(--muted)' }}>
          Back to Find a League
        </Link>
      </div>
    </div>
  )
}
