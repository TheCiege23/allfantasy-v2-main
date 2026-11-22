'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { InviteShareSheet } from './InviteShareSheet'
import type { InviteShareChannel, InviteType } from '@/lib/invite-engine/types'

interface InviteModalProps {
  isOpen: boolean
  onClose: () => void
  inviteType: InviteType
  targetId?: string | null
  targetLabel?: string
  onGenerated?: (inviteUrl: string, token: string, inviteLinkId: string) => void
  onShared?: (channel: InviteShareChannel) => void
}

const EXPIRATION_OPTIONS = [
  { value: 0, label: 'Never expires' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
]

function defaultTitleForType(type: InviteType) {
  switch (type) {
    case 'league':
      return 'Create league invite'
    case 'bracket':
      return 'Create bracket invite'
    case 'creator_league':
      return 'Create creator league invite'
    case 'referral':
      return 'Create referral invite'
    case 'reactivation':
      return 'Create reactivation invite'
    case 'waitlist':
      return 'Create waitlist invite'
    default:
      return 'Create invite'
  }
}

export function InviteModal({
  isOpen,
  onClose,
  inviteType,
  targetId,
  targetLabel,
  onGenerated,
  onShared,
}: InviteModalProps) {
  const [step, setStep] = useState<'form' | 'share'>('form')
  const [inviteUrl, setInviteUrl] = useState('')
  const [token, setToken] = useState('')
  const [inviteLinkId, setInviteLinkId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expiresInDays, setExpiresInDays] = useState(7)
  const [maxUses, setMaxUses] = useState(0)
  const [description, setDescription] = useState('')

  const targetDescription = useMemo(() => targetLabel ?? null, [targetLabel])

  const handleGenerate = () => {
    setLoading(true)
    setError(null)
    fetch('/api/invite/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: inviteType,
        targetId: targetId ?? null,
        expiresInDays,
        maxUses,
        metadata: description.trim() ? { description: description.trim() } : undefined,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.inviteLink) {
          setInviteUrl(data.inviteLink.inviteUrl)
          setToken(data.inviteLink.token)
          setInviteLinkId(data.inviteLink.id)
          setStep('share')
          onGenerated?.(data.inviteLink.inviteUrl, data.inviteLink.token, data.inviteLink.id)
        } else {
          setError(data.error ?? 'Failed to generate invite')
        }
      })
      .catch(() => setError('Something went wrong'))
      .finally(() => setLoading(false))
  }

  const resetState = () => {
    setStep('form')
    setInviteUrl('')
    setToken('')
    setInviteLinkId('')
    setError(null)
    setExpiresInDays(7)
    setMaxUses(0)
    setDescription('')
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border p-6 shadow-xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1 hover:opacity-80"
          style={{ color: 'var(--muted)' }}
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="mb-2 text-lg font-bold">{step === 'form' ? defaultTitleForType(inviteType) : 'Share invite'}</h2>
        {targetDescription && (
          <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>
            {targetDescription}
          </p>
        )}

        {step === 'form' && (
          <div className="space-y-4">
            {error && (
              <p className="rounded-lg py-2 text-sm" style={{ color: 'var(--destructive)' }}>
                {error}
              </p>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Invite note
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--text)' }}
                placeholder="Add a short note for the preview card"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  Expiration
                </span>
                <select
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--text)' }}
                >
                  {EXPIRATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  Max uses
                </span>
                <input
                  type="number"
                  min={0}
                  max={5000}
                  value={maxUses}
                  onChange={(event) => setMaxUses(Math.max(0, Math.min(5000, Number(event.target.value) || 0)))}
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--text)' }}
                />
                <span className="mt-1 block text-xs" style={{ color: 'var(--muted)' }}>
                  Use 0 for unlimited.
                </span>
              </label>
            </div>

            <button
              type="button"
              disabled={loading}
              data-testid="invite-modal-generate"
              onClick={handleGenerate}
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              {loading ? 'Generating...' : 'Generate invite link'}
            </button>
          </div>
        )}

        {step === 'share' && inviteUrl && (
          <>
            <InviteShareSheet
              inviteUrl={inviteUrl}
              inviteLinkId={inviteLinkId}
              token={token}
              onShare={onShared}
              testIdPrefix="invite-share"
            />
            <button
              type="button"
              onClick={handleClose}
              className="mt-4 w-full rounded-lg border py-2 text-sm font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  )
}
