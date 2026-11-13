'use client'

import { useEffect, useState } from 'react'
import type { CreatorBranding } from '@/lib/creator-system/types'

interface CreatorBrandingEditorProps {
  initialBranding: CreatorBranding | null
  creatorIdOrSlug: string
  onSaved?: (branding: CreatorBranding) => void
}

export function CreatorBrandingEditor({
  initialBranding,
  creatorIdOrSlug,
  onSaved,
}: CreatorBrandingEditorProps) {
  const [branding, setBranding] = useState<CreatorBranding>({
    logoUrl: initialBranding?.logoUrl ?? '',
    coverImageUrl: initialBranding?.coverImageUrl ?? '',
    primaryColor: initialBranding?.primaryColor ?? '#2F6FED',
    accentColor: initialBranding?.accentColor ?? '#FF7A18',
    backgroundColor: initialBranding?.backgroundColor ?? '#0D1526',
    tagline: initialBranding?.tagline ?? '',
    communityName: initialBranding?.communityName ?? '',
    fontFamily: initialBranding?.fontFamily ?? '',
    inviteHeadline: initialBranding?.inviteHeadline ?? '',
    cardStyle: initialBranding?.cardStyle ?? 'bold',
  })
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    setBranding({
      logoUrl: initialBranding?.logoUrl ?? '',
      coverImageUrl: initialBranding?.coverImageUrl ?? '',
      primaryColor: initialBranding?.primaryColor ?? '#2F6FED',
      accentColor: initialBranding?.accentColor ?? '#FF7A18',
      backgroundColor: initialBranding?.backgroundColor ?? '#0D1526',
      tagline: initialBranding?.tagline ?? '',
      communityName: initialBranding?.communityName ?? '',
      fontFamily: initialBranding?.fontFamily ?? '',
      inviteHeadline: initialBranding?.inviteHeadline ?? '',
      cardStyle: initialBranding?.cardStyle ?? 'bold',
    })
  }, [initialBranding])

  const updateField = <K extends keyof CreatorBranding>(key: K, value: CreatorBranding[K]) => {
    setBranding((current) => ({ ...current, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const response = await fetch(`/api/creators/${encodeURIComponent(creatorIdOrSlug)}/branding`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(branding),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setStatus(payload.error || 'Unable to save branding')
        return
      }
      setStatus('Branding saved')
      onSaved?.(branding)
    } catch {
      setStatus('Network error while saving branding')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      data-testid="creator-branding-editor"
      className="space-y-5 rounded-[28px] border p-5"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--panel) 78%, transparent)',
      }}
    >
      <div>
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
          Creator branding
        </h3>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Customize the creator card, invite look, and community presentation.
        </p>
      </div>

      <div
        className="rounded-[28px] border p-5"
        style={{
          borderColor: 'var(--border)',
          background: `linear-gradient(135deg, color-mix(in srgb, ${branding.primaryColor || '#2F6FED'} 28%, ${branding.backgroundColor || '#0D1526'}) 0%, color-mix(in srgb, ${branding.accentColor || '#FF7A18'} 26%, ${branding.backgroundColor || '#0D1526'}) 100%)`,
        }}
      >
        <p className="text-xs uppercase tracking-[0.22em]" style={{ color: 'rgba(255,255,255,0.72)' }}>
          Preview
        </p>
        <p className="mt-3 text-xl font-semibold" style={{ color: 'white' }}>
          {branding.communityName || 'Creator community'}
        </p>
        <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
          {branding.tagline || 'Bold creator-led fantasy competition with branded invite links and weekly recaps.'}
        </p>
        <p className="mt-3 text-xs" style={{ color: 'rgba(255,255,255,0.74)' }}>
          {branding.inviteHeadline || 'Join the branded room and compete with the community.'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Community name</span>
          <input
            data-testid="creator-branding-community-name"
            type="text"
            value={branding.communityName ?? ''}
            onChange={(event) => updateField('communityName', event.target.value)}
            className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Tagline</span>
          <input
            data-testid="creator-branding-tagline"
            type="text"
            value={branding.tagline ?? ''}
            onChange={(event) => updateField('tagline', event.target.value)}
            className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>

        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Invite headline</span>
          <input
            data-testid="creator-branding-invite-headline"
            type="text"
            value={branding.inviteHeadline ?? ''}
            onChange={(event) => updateField('inviteHeadline', event.target.value)}
            className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Logo URL</span>
          <input
            data-testid="creator-branding-logo-url"
            type="url"
            value={branding.logoUrl ?? ''}
            onChange={(event) => updateField('logoUrl', event.target.value)}
            className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Cover image URL</span>
          <input
            data-testid="creator-branding-cover-url"
            type="url"
            value={branding.coverImageUrl ?? ''}
            onChange={(event) => updateField('coverImageUrl', event.target.value)}
            className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Primary color</span>
          <input
            data-testid="creator-branding-primary-color"
            type="color"
            value={branding.primaryColor || '#2F6FED'}
            onChange={(event) => updateField('primaryColor', event.target.value)}
            className="h-12 w-full rounded-2xl border p-1"
            style={{ borderColor: 'var(--border)', background: 'transparent' }}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Accent color</span>
          <input
            data-testid="creator-branding-accent-color"
            type="color"
            value={branding.accentColor || '#FF7A18'}
            onChange={(event) => updateField('accentColor', event.target.value)}
            className="h-12 w-full rounded-2xl border p-1"
            style={{ borderColor: 'var(--border)', background: 'transparent' }}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Background color</span>
          <input
            data-testid="creator-branding-background-color"
            type="color"
            value={branding.backgroundColor || '#0D1526'}
            onChange={(event) => updateField('backgroundColor', event.target.value)}
            className="h-12 w-full rounded-2xl border p-1"
            style={{ borderColor: 'var(--border)', background: 'transparent' }}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Font family hint</span>
          <input
            data-testid="creator-branding-font-family"
            type="text"
            value={branding.fontFamily ?? ''}
            onChange={(event) => updateField('fontFamily', event.target.value)}
            className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </label>
      </div>

      {status && (
        <p className="text-sm" style={{ color: status === 'Branding saved' ? 'var(--text)' : 'var(--destructive)' }}>
          {status}
        </p>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={handleSave}
        data-testid="creator-branding-save-button"
        className="rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-60"
        style={{ background: 'var(--accent)', color: 'var(--bg)' }}
      >
        {saving ? 'Saving...' : 'Save branding'}
      </button>
    </section>
  )
}
