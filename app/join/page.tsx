'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { joinedLeagueDestination, readLeagueInviteFocus } from '@/lib/league-invite/engagementInvite'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

type Preview = { leagueId: string; name: string | null; sport: string; requiresPassword: boolean }

export default function JoinByCodePage() {
  const spanish = useOptionalLanguage().language === 'es'
  const searchParams = useSearchParams()
  const codeFromUrl = searchParams?.get('code')?.trim()
  const focus = readLeagueInviteFocus(searchParams?.get('focus'))

  const [code, setCode] = useState(codeFromUrl ?? '')
  const [password, setPassword] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewErrorCode, setPreviewErrorCode] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'joining' | 'success' | 'error' | 'auth'>('idle')
  const [message, setMessage] = useState<string>('')
  const [joinedLeagueId, setJoinedLeagueId] = useState<string | null>(null)

  const effectiveCode = codeFromUrl || code

  useEffect(() => {
    if (!effectiveCode) return
    let cancelled = false
    fetch(`/api/leagues/join/preview?code=${encodeURIComponent(effectiveCode)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data.leagueId && data.sport !== undefined) {
          setPreview({
            leagueId: data.leagueId,
            name: data.name ?? null,
            sport: data.sport,
            requiresPassword: !!data.requiresPassword,
          })
          setPreviewError(typeof data.error === 'string' ? data.error : null)
          setPreviewErrorCode(typeof data.errorCode === 'string' ? data.errorCode : null)
          // Set growth attribution cookie so signup can attribute to league_invite (PROMPT 291)
          fetch(`/api/viral/context?type=league_invite&code=${encodeURIComponent(effectiveCode)}`, { credentials: 'include' }).catch(() => {})
        } else {
          setPreview(null)
          setPreviewError(typeof data.error === 'string' ? data.error : null)
          setPreviewErrorCode(typeof data.errorCode === 'string' ? data.errorCode : null)
        }
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => { cancelled = true }
  }, [effectiveCode])

  const join = useCallback(
    (submitCode?: string, submitPassword?: string) => {
      const c = (submitCode ?? effectiveCode)?.trim()
      if (!c) {
        setStatus('error')
        setMessage('Enter an invite code')
        return
      }
      setStatus('joining')
      const body = { code: c, password: (submitPassword ?? password)?.trim() || undefined }

      fetch('/api/leagues/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (res) => ({ ...(await res.json()), httpStatus: res.status }))
        .then((data) => {
          if (data.success) {
            sendProductAnalyticsBeacon(ENGAGEMENT.ACTIVITY_INVITE_JOINED, { focus, leagueId: data.leagueId, alreadyMember: !!data.alreadyMember })
            setStatus('success')
            setJoinedLeagueId(data.leagueId)
            setMessage(data.alreadyMember ? 'You are already in this league.' : 'You joined the league.')
            if (data.leagueId && !data.creatorLeagueId) {
              setTimeout(() => {
                window.location.href = joinedLeagueDestination(data.leagueId, focus)
              }, 1500)
            }
            return
          }
          if (data.httpStatus === 401) {
            setStatus('auth')
            return
          }
          return fetch('/api/creator-invites/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: c }),
          }).then((r) => r.json())
        })
        .then((data) => {
          if (!data) return
          if (data.success) {
            setStatus('success')
            setMessage(data.creatorLeagueId ? 'You joined the league.' : 'Invite applied.')
            if (data.creatorLeagueId) {
              window.location.href = `/creator/leagues/${data.creatorLeagueId}`
            }
          } else {
            setStatus('error')
            setMessage(data.error || 'Invalid code or could not join')
          }
        })
        .catch(() => {
          setStatus('error')
          setMessage('Something went wrong')
        })
    },
    [effectiveCode, password, focus]
  )

  const returnToInvite = `/join?code=${encodeURIComponent(effectiveCode)}${focus === 'league' ? '' : `&focus=${focus}`}`

  if (status === 'auth') {
    return <div className="min-h-screen flex items-center justify-center mode-surface mode-readable px-4">
      <div className="w-full max-w-md rounded-2xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>{spanish ? 'Tu liga te espera' : 'Your league is waiting'}</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>{spanish ? `Inicia sesión o crea una cuenta para unirte${focus === 'rivalry' ? ' y explorar las rivalidades' : focus === 'chat' ? ' y abrir el chat de la liga' : ''}.` : `Sign in or create an account, then return here to join${focus === 'rivalry' ? ' and explore rivalries' : focus === 'chat' ? ' and open league chat' : ''}.`}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/signup?callbackUrl=${encodeURIComponent(returnToInvite)}`} className="rounded-lg px-4 py-3 text-sm font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{spanish ? 'Crear cuenta' : 'Create account'}</Link>
          <Link href={`/login?callbackUrl=${encodeURIComponent(returnToInvite)}`} className="rounded-lg border px-4 py-3 text-sm font-bold" style={{ borderColor: 'var(--line2)', color: 'var(--text)' }}>{spanish ? 'Iniciar sesión' : 'Sign in'}</Link>
        </div>
      </div>
    </div>
  }


  if (codeFromUrl && preview && !preview.requiresPassword && status === 'idle' && !previewError) {
    return (
      <div className="min-h-screen flex items-center justify-center mode-surface mode-readable">
        <div className="max-w-md mx-auto px-4 w-full">
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
            Join league
          </h1>
          {preview.name && (
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              {preview.name} · {preview.sport}
            </p>
          )}
          {focus !== 'league' ? <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>{spanish ? `Después de unirte, abrirás ${focus === 'chat' ? 'el chat de la liga' : 'Radar de rivalidades'}.` : `After joining, you’ll open ${focus === 'chat' ? 'league chat' : 'Rivalry Radar'}.`}</p> : null}
          <button
            type="button"
            onClick={() => join(codeFromUrl, '')}
            data-testid="league-join-button"
            className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
          >
            Join league
          </button>
        </div>
      </div>
    )
  }

  if (!codeFromUrl && !code) {
    return (
      <div className="min-h-screen flex items-center justify-center mode-surface mode-readable">
        <div className="max-w-md mx-auto px-4 w-full">
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
            Join a league
          </h1>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            Enter the invite code from your invite link. You can also use a link like /join?code=ABC12345
          </p>
          <div className="space-y-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Invite code"
              className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-white"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (if required)"
              className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-white"
            />
            <button
              type="button"
              onClick={() => join(code, password)}
              data-testid="league-join-button"
              className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Join
            </button>
          </div>
          <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>
            <Link href="/creators" className="underline">
              Browse creator leagues
            </Link>
          </p>
        </div>
      </div>
    )
  }

  if (preview?.requiresPassword && status === 'idle') {
    return (
      <div className="min-h-screen flex items-center justify-center mode-surface mode-readable">
        <div className="max-w-md mx-auto px-4 w-full">
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
            Join league
          </h1>
          {preview.name && (
            <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
              {preview.name} · {preview.sport}
            </p>
          )}
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            This league is password protected. Enter the password to join.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="League password"
            className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-white mb-2"
          />
          <button
            type="button"
            onClick={() => join(effectiveCode, password)}
            data-testid="league-join-button"
            className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
          >
            Join
          </button>
        </div>
      </div>
    )
  }

  if (preview && previewError && status === 'idle' && codeFromUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center mode-surface mode-readable">
        <div className="max-w-md mx-auto px-4 w-full">
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
            Join league
          </h1>
          {preview.name && (
            <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
              {preview.name} · {preview.sport}
            </p>
          )}
          <p
            className="text-sm mb-4"
            style={{ color: previewErrorCode === 'EXPIRED' ? 'var(--destructive)' : 'var(--muted)' }}
            data-testid="league-join-preview-error"
          >
            {previewError}
          </p>
          <Link href="/join" className="text-sm underline" style={{ color: 'var(--accent)' }}>
            Try another invite code
          </Link>
        </div>
      </div>
    )
  }

  if (codeFromUrl && !preview && !previewError && status === 'idle') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--muted)' }}>
        Loading…
      </div>
    )
  }

  if (previewError && !preview && status === 'idle' && codeFromUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center mode-surface mode-readable">
        <div className="max-w-md mx-auto px-4 text-center">
          <p className="text-sm mb-4" style={{ color: 'var(--destructive)' }}>
            {previewError}
          </p>
          <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
            You can still try joining (e.g. creator league).
          </p>
          <button
            type="button"
            onClick={() => join(codeFromUrl, '')}
            data-testid="league-join-button"
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
          >
            Try join
          </button>
          <p className="mt-4">
            <Link href="/creators" className="text-sm underline" style={{ color: 'var(--accent)' }}>
              Browse creators
            </Link>
          </p>
        </div>
      </div>
    )
  }

  if (status === 'joining') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--muted)' }}>
        Joining…
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center mode-surface mode-readable">
        <div className="max-w-md mx-auto px-4 text-center">
          <p className="text-sm font-medium mb-4" style={{ color: 'var(--text)' }}>
            {message}
          </p>
          {joinedLeagueId && (
            <Link
              href={`/league/${joinedLeagueId}`}
              className="inline-block rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Open league
            </Link>
          )}
          <p className="mt-4">
            <Link href="/app" className="text-sm underline" style={{ color: 'var(--accent)' }}>
              Dashboard
            </Link>
            {' · '}
            <Link href="/creators" className="text-sm underline" style={{ color: 'var(--accent)' }}>
              Creators
            </Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center mode-surface mode-readable">
      <div className="max-w-md mx-auto px-4 text-center">
        <p className="text-sm mb-4" style={{ color: 'var(--destructive)' }}>
          {message}
        </p>
        <Link href="/join" className="text-sm underline" style={{ color: 'var(--accent)' }}>
          Try another code
        </Link>
        <p className="mt-4">
          <Link href="/creators" className="text-sm underline" style={{ color: 'var(--accent)' }}>
            Browse creators
          </Link>
        </p>
      </div>
    </div>
  )
}
