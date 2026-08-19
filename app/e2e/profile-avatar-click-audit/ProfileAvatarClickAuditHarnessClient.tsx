'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { IdentityImageRenderer } from '@/components/identity/IdentityImageRenderer'
import { ProfileImagePreviewController } from '@/components/identity/ProfileImagePreviewController'
import { AVATAR_PRESETS, AVATAR_PRESET_LABELS, type AvatarPresetId } from '@/lib/signup/avatar-presets'
import { validateAvatarUploadFile } from '@/lib/signup/AvatarPickerService'
import { uploadProfileImage, setProfileAvatarUrl, AVATAR_PRESET_EMOJI } from '@/lib/avatar'

const STORAGE_KEY = 'af_e2e_profile_avatar_click_audit_v1'

type PersistedAvatarState = {
  username: string
  displayName: string
  avatarPreset: string | null
  avatarUrl: string | null
}

const DEFAULT_STATE: PersistedAvatarState = {
  username: 'audit_user',
  displayName: 'Audit User',
  avatarPreset: 'crest',
  avatarUrl: null,
}

export function ProfileAvatarClickAuditHarnessClient() {
  const [hydrated, setHydrated] = useState(false)

  const [username, setUsername] = useState(DEFAULT_STATE.username)
  const [displayName, setDisplayName] = useState(DEFAULT_STATE.displayName)
  const [profileAvatarPreset, setProfileAvatarPreset] = useState<string | null>(DEFAULT_STATE.avatarPreset)
  const [profileAvatarUrl, setProfileAvatarUrlState] = useState<string | null>(DEFAULT_STATE.avatarUrl)

  const [signupAvatarPreset, setSignupAvatarPreset] = useState<string | null>(DEFAULT_STATE.avatarPreset)
  const [signupAvatarPreview, setSignupAvatarPreview] = useState<string | null>(null)
  const [signupUploadError, setSignupUploadError] = useState<string | null>(null)
  const [signupActionStatus, setSignupActionStatus] = useState<'idle' | 'applied'>('idle')

  const [avatarSelectionTouched, setAvatarSelectionTouched] = useState(false)
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const signupFileInputRef = useRef<HTMLInputElement>(null)
  const settingsFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedAvatarState>
        setUsername(typeof parsed.username === 'string' ? parsed.username : DEFAULT_STATE.username)
        setDisplayName(typeof parsed.displayName === 'string' ? parsed.displayName : DEFAULT_STATE.displayName)
        setProfileAvatarPreset(
          typeof parsed.avatarPreset === 'string' || parsed.avatarPreset === null
            ? parsed.avatarPreset
            : DEFAULT_STATE.avatarPreset
        )
        setProfileAvatarUrlState(
          typeof parsed.avatarUrl === 'string' || parsed.avatarUrl === null
            ? parsed.avatarUrl
            : DEFAULT_STATE.avatarUrl
        )
        setSignupAvatarPreset(
          typeof parsed.avatarPreset === 'string' || parsed.avatarPreset === null
            ? parsed.avatarPreset
            : DEFAULT_STATE.avatarPreset
        )
      }
    } catch {
      // Keep defaults if storage payload is malformed.
    } finally {
      setHydrated(true)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
    }
  }, [previewObjectUrl])

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    const payload: PersistedAvatarState = {
      username,
      displayName,
      avatarPreset: profileAvatarPreset,
      avatarUrl: profileAvatarUrl,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [hydrated, username, displayName, profileAvatarPreset, profileAvatarUrl])

  const handleSignupPresetSelect = (preset: string | null) => {
    setSignupAvatarPreset(preset)
    setSignupAvatarPreview(null)
    setSignupUploadError(null)
    setSignupActionStatus('idle')
  }

  const handleSignupFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const validationError = validateAvatarUploadFile(file)
    if (validationError) {
      setSignupUploadError(validationError)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setSignupAvatarPreview(String(reader.result ?? ''))
      setSignupUploadError(null)
      setSignupActionStatus('idle')
    }
    reader.readAsDataURL(file)
  }

  const applySignupSelection = () => {
    if (signupAvatarPreview) {
      setProfileAvatarUrlState(signupAvatarPreview)
    } else {
      setProfileAvatarPreset(signupAvatarPreset)
      setProfileAvatarUrlState(null)
    }
    setSignupActionStatus('applied')
  }

  const handleSettingsFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setPreviewObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    setUploadError(null)
    setUploading(true)
    const result = await uploadProfileImage(file)
    setUploading(false)
    setPreviewObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })

    if (!result.ok) {
      setUploadError(result.error ?? 'Upload failed')
      return
    }

    setProfileAvatarUrlState(result.url ?? null)
    setSaveStatus('idle')
  }

  const handleRemoveImage = async () => {
    setUploadError(null)
    const result = await setProfileAvatarUrl(null)
    if (!result.ok) {
      setUploadError(result.error ?? 'Failed to remove image')
      return
    }
    setProfileAvatarUrlState(null)
    setSaveStatus('idle')
  }

  const handleSaveProfile = async () => {
    setSaveStatus('saving')
    try {
      const payload = {
        avatarPreset: (profileAvatarPreset as AvatarPresetId) || null,
        avatarUrl: avatarSelectionTouched ? null : undefined,
      }
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        setSaveStatus('error')
        return
      }
      if (avatarSelectionTouched) {
        setProfileAvatarUrlState(null)
      }
      setAvatarSelectionTouched(false)
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  return (
    <main className="min-h-screen px-4 py-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <h1 className="text-lg font-semibold">Profile avatar click audit harness</h1>

        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <h2 className="mb-3 text-sm font-semibold">Signup avatar controls</h2>
          <div className="mb-3 flex items-center gap-3">
            <IdentityImageRenderer
              avatarUrl={signupAvatarPreview}
              avatarPreset={signupAvatarPreview ? null : signupAvatarPreset}
              displayName={displayName}
              username={username}
              size="md"
              className="shrink-0"
            />
            <div className="text-xs" data-testid="signup-preview-surface">
              signup preview: {signupAvatarPreview ? 'uploaded-image' : signupAvatarPreset ?? 'initial'}
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2" data-testid="signup-preset-grid">
            <button
              type="button"
              data-testid="signup-preset-initial"
              onClick={() => handleSignupPresetSelect(null)}
              className="rounded border px-2 py-1.5 text-xs"
              style={{ borderColor: signupAvatarPreset === null && !signupAvatarPreview ? 'var(--accent-cyan)' : 'var(--border)' }}
            >
              Initial
            </button>
            {AVATAR_PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                data-testid="signup-preset-option"
                onClick={() => handleSignupPresetSelect(id)}
                className="rounded border px-2 py-1.5 text-xs"
                style={{ borderColor: signupAvatarPreset === id && !signupAvatarPreview ? 'var(--accent-cyan)' : 'var(--border)' }}
                title={AVATAR_PRESET_LABELS[id]}
              >
                {AVATAR_PRESET_EMOJI[id]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={signupFileInputRef}
              data-testid="signup-upload-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleSignupFileChange}
            />
            <button
              type="button"
              data-testid="signup-upload-button"
              onClick={() => signupFileInputRef.current?.click()}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)' }}
            >
              Upload image
            </button>
            {signupAvatarPreview && (
              <>
                <img
                  src={signupAvatarPreview}
                  alt="Signup preview"
                  data-testid="signup-upload-preview-image"
                  className="h-8 w-8 rounded-full object-cover"
                />
                <button
                  type="button"
                  data-testid="signup-remove-upload"
                  onClick={() => setSignupAvatarPreview(null)}
                  className="rounded border px-2 py-1 text-xs"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Remove
                </button>
              </>
            )}
            <button
              type="button"
              data-testid="signup-apply-selection"
              onClick={applySignupSelection}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)' }}
            >
              Apply to profile state
            </button>
          </div>
          {signupUploadError && (
            <p className="mt-2 text-xs" style={{ color: 'var(--accent-red-strong)' }} data-testid="signup-upload-error">{signupUploadError}</p>
          )}
          <p className="mt-2 text-xs" data-testid="signup-apply-status">status: {signupActionStatus}</p>
        </section>

        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <h2 className="mb-3 text-sm font-semibold">Settings and profile controls</h2>
          <div className="mb-3 flex items-center gap-3">
            <ProfileImagePreviewController
              previewObjectUrl={previewObjectUrl}
              profileImageUrl={profileAvatarUrl}
              avatarPreset={profileAvatarPreset}
              displayName={displayName}
              username={username}
              size="md"
            />
            <div className="text-xs">
              persisted avatar url: <span data-testid="state-summary-avatar-url">{profileAvatarUrl ?? 'none'}</span>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2" data-testid="settings-preset-grid">
            <button
              type="button"
              data-testid="settings-preset-initial"
              onClick={() => {
                setProfileAvatarPreset(null)
                setAvatarSelectionTouched(true)
                setSaveStatus('idle')
              }}
              className="rounded border px-2 py-1.5 text-xs"
              style={{ borderColor: profileAvatarPreset === null ? 'var(--accent-cyan)' : 'var(--border)' }}
            >
              Initial
            </button>
            {AVATAR_PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                data-testid="settings-preset-option"
                onClick={() => {
                  setProfileAvatarPreset(id)
                  setAvatarSelectionTouched(true)
                  setSaveStatus('idle')
                }}
                className="rounded border px-2 py-1.5 text-xs"
                style={{ borderColor: profileAvatarPreset === id ? 'var(--accent-cyan)' : 'var(--border)' }}
                title={AVATAR_PRESET_LABELS[id]}
              >
                {AVATAR_PRESET_EMOJI[id]}
              </button>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              ref={settingsFileInputRef}
              data-testid="settings-upload-input"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleSettingsFileChange}
            />
            <button
              type="button"
              data-testid="settings-upload-button"
              onClick={() => settingsFileInputRef.current?.click()}
              disabled={uploading}
              className="rounded border px-3 py-1.5 text-xs disabled:opacity-60"
              style={{ borderColor: 'var(--border)' }}
            >
              {uploading ? 'Uploading...' : 'Upload image'}
            </button>
            <button
              type="button"
              data-testid="settings-remove-image"
              onClick={handleRemoveImage}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)' }}
            >
              Remove image
            </button>
            <button
              type="button"
              data-testid="settings-save-profile"
              onClick={handleSaveProfile}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)' }}
            >
              Save profile avatar state
            </button>
          </div>
          {uploadError && (
            <p className="text-xs" style={{ color: 'var(--accent-red-strong)' }} data-testid="settings-upload-error">{uploadError}</p>
          )}
          <p className="text-xs" data-testid="settings-save-status">save: {saveStatus}</p>
        </section>

        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <h2 className="mb-3 text-sm font-semibold">Identity surfaces</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
              <div className="mb-2 text-xs">Top nav</div>
              <div data-testid="surface-nav-avatar">
                <IdentityImageRenderer
                  avatarUrl={profileAvatarUrl}
                  avatarPreset={profileAvatarPreset}
                  displayName={displayName}
                  username={username}
                  size="sm"
                />
              </div>
            </div>
            <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
              <div className="mb-2 text-xs">Header badge</div>
              <div data-testid="surface-header-avatar">
                <IdentityImageRenderer
                  avatarUrl={profileAvatarUrl}
                  avatarPreset={profileAvatarPreset}
                  displayName={displayName}
                  username={username}
                  size="sm"
                />
              </div>
            </div>
            <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
              <div className="mb-2 text-xs">Chat chip</div>
              <div data-testid="surface-chat-avatar">
                <IdentityImageRenderer
                  avatarUrl={profileAvatarUrl}
                  avatarPreset={profileAvatarPreset}
                  displayName={displayName}
                  username={username}
                  size="sm"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <h2 className="mb-3 text-sm font-semibold">State summary</h2>
          <div className="text-xs" data-testid="state-summary-avatar-preset">preset: {profileAvatarPreset ?? 'initial'}</div>
          <div className="text-xs" data-testid="state-summary-avatar-url-echo">url: {profileAvatarUrl ?? 'none'}</div>
          <div className="text-xs" data-testid="state-summary-hydrated">hydrated: {String(hydrated)}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="text-xs">Display name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--text)' }}
            />
            <label className="text-xs">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--text)' }}
            />
          </div>
        </section>
      </div>
    </main>
  )
}
