'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { InvitePreviewCard } from '@/components/invite'
import { signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { canonicalizeProductRoute } from '@/lib/routing/canonicalizeProductRoute'
import { ClassGateNotice, isClassGateBlocked, type ClassGateBlocked } from '@/components/league-join/ClassGateNotice'

interface Preview {
  inviteType: string
  token: string
  title: string
  description: string | null
  targetId: string | null
  targetName: string | null
  sport: string | null
  memberCount: number | null
  maxMembers: number | null
  isFull: boolean
  expired: boolean
  expiresAt: string | null
  status: string
  statusReason: string | null
  destinationHref: string | null
  destinationLabel: string | null
  createdByLabel: string | null
}

export default function AcceptInvitePage() {
  const searchParams = useSearchParams()
  const code = searchParams?.get('code')?.trim() ?? ''
  const { data: session, status: sessionStatus } = useSession()

  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    targetId?: string
    inviteType?: string
    destinationHref?: string | null
    error?: string
    classBlocked?: ClassGateBlocked
  } | null>(null)

  const loadPreview = useCallback(() => {
    if (!code) {
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/invite/preview?code=${encodeURIComponent(code)}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.ok && data.preview) setPreview(data.preview)
        else setPreview(null)
      })
      .catch(() => setPreview(null))
      .finally(() => setLoading(false))
  }, [code])

  useEffect(() => {
    loadPreview()
  }, [loadPreview])

  const callbackUrl = useMemo(() => {
    if (!code) return '/invite/accept'
    return `/invite/accept?code=${encodeURIComponent(code)}`
  }, [code])

  const handleAccept = () => {
    if (!code) return
    if (!session?.user) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
      return
    }

    setAccepting(true)
    setResult(null)
    fetch('/api/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((response) =>
        response
          .json()
          .then((data) => ({ ok: response.ok, status: response.status, data }))
      )
      .then(({ ok, data }) => {
        if (ok && data.ok) {
          setResult({
            ok: true,
            targetId: data.targetId,
            inviteType: data.inviteType,
            destinationHref: data.destinationHref,
          })
          if (data.destinationHref) {
            window.location.href = canonicalizeProductRoute(data.destinationHref)
            return
          }
        } else {
          if (isClassGateBlocked(data)) {
            setResult({ ok: false, classBlocked: data })
            return
          }
          setResult({ ok: false, error: data.error ?? 'Could not accept invite' })
          loadPreview()
        }
      })
      .catch(() => setResult({ ok: false, error: 'Something went wrong' }))
      .finally(() => setAccepting(false))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--muted)' }}>
        Loading invite...
      </div>
    )
  }

  if (!code) {
    return (
      <div className="min-h-screen mode-surface mode-readable flex items-center justify-center">
        <div className="max-w-md mx-auto px-4 text-center">
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            No invite code provided. Use a link from an invite.
          </p>
          <Link href="/" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
            Go home
          </Link>
        </div>
      </div>
    )
  }

  if (!preview || preview.status === 'invalid') {
    return (
      <div className="min-h-screen mode-surface mode-readable flex items-center justify-center">
        <div className="max-w-md mx-auto px-4 text-center">
          <h1 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>
            Invalid invite
          </h1>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            This invite link is not valid or is no longer available.
          </p>
          <Link href="/" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
            Go home
          </Link>
        </div>
      </div>
    )
  }

  const acceptLabel =
    sessionStatus === 'loading'
      ? 'Loading account...'
      : session?.user
        ? accepting
          ? 'Accepting...'
          : 'Accept invite'
        : 'Sign in to accept invite'

  return (
    <div className="min-h-screen mode-surface mode-readable">
      <div className="max-w-lg mx-auto px-4 py-12">
        <InvitePreviewCard
          title={preview.title}
          description={preview.description}
          targetName={preview.targetName}
          sport={preview.sport}
          memberCount={preview.memberCount}
          maxMembers={preview.maxMembers}
          isFull={preview.isFull}
          expired={preview.expired}
          expiresAt={preview.expiresAt}
          status={preview.status}
          statusReason={preview.statusReason}
          inviteType={preview.inviteType}
          destinationHref={preview.destinationHref}
          destinationLabel={preview.destinationLabel}
          createdByLabel={preview.createdByLabel}
          acceptLabel={acceptLabel}
          acceptDisabled={accepting || sessionStatus === 'loading'}
          onAccept={handleAccept}
        />

        {preview.status === 'expired' || preview.status === 'max_used' ? (
          <p data-testid="invite-expired-state" className="mt-4 text-center text-sm" style={{ color: 'var(--destructive)' }}>
            {preview.statusReason}
          </p>
        ) : null}

        {result?.classBlocked ? (
          <div className="mt-4">
            <ClassGateNotice blocked={result.classBlocked} code={code} tone="theme" />
          </div>
        ) : null}

        {result && !result.classBlocked && (
          <div
            className="mt-4 rounded-xl border p-4"
            style={{
              borderColor: result.ok ? 'var(--accent)' : 'var(--destructive)',
              background: result.ok
                ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                : 'color-mix(in srgb, var(--destructive) 15%, transparent)',
            }}
          >
            {result.ok ? (
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                Invite accepted. Redirecting...
              </p>
            ) : (
              <p className="text-sm" style={{ color: 'var(--destructive)' }}>
                {result.error}
              </p>
            )}
          </div>
        )}

        {!session?.user && preview.status === 'valid' && (
          <div className="mt-4 space-y-2 text-center text-sm" style={{ color: 'var(--muted)' }}>
            <p>Sign in first so AllFantasy can apply the invite to your account.</p>
            <p>
              New here?{' '}
              <Link
                href={signupUrlWithIntent(callbackUrl)}
                className="font-medium underline-offset-2 hover:underline"
                style={{ color: 'var(--accent)' }}
                data-testid="invite-accept-signup-link"
              >
                Create an account
              </Link>{' '}
              — you will return to this invite after signup.
            </p>
          </div>
        )}

        <p className="mt-6 text-center">
          <Link href="/" className="text-sm" style={{ color: 'var(--muted)' }}>
            Back to AllFantasy
          </Link>
        </p>
      </div>
    </div>
  )
}
