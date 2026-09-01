"use client"

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { Pencil, X, Check, Upload, Trash2 } from "lucide-react"
import { AVATAR_PRESETS, AVATAR_PRESET_LABELS, type AvatarPresetId } from "@/lib/signup/avatar-presets"
import { getPreferredSportsOptions } from "@/lib/user-settings/PreferredSportsResolver"
import type { ProfileUpdatePayload, UserProfileForSettings } from "@/lib/user-settings/types"
import { ProfileImagePreviewController } from "@/components/identity/ProfileImagePreviewController"
import { uploadProfileImage, setProfileAvatarUrl, AVATAR_PRESET_EMOJI } from "@/lib/avatar"
import { AvatarCropDialog, shouldCropBeforeUpload } from "@/components/identity/AvatarCropDialog"

interface EditableProfileFormControllerProps {
  profile: UserProfileForSettings
  saving: boolean
  error: string | null
  onSave: (payload: ProfileUpdatePayload) => Promise<boolean>
  onCancel: () => void
  onRefetch: () => void
}

/**
 * Edit controller for user-facing profile details.
 * Handles local draft state, save/cancel actions, and avatar upload/remove interactions.
 */
export default function EditableProfileFormController({
  profile,
  saving,
  error,
  onSave,
  onCancel,
  onRefetch,
}: EditableProfileFormControllerProps) {
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(profile.displayName ?? "")
  const [avatarPreset, setAvatarPreset] = useState<string | null>(profile.avatarPreset ?? null)
  const [avatarSelectionTouched, setAvatarSelectionTouched] = useState(false)
  const [bio, setBio] = useState(profile.bio ?? "")
  const [preferredSports, setPreferredSports] = useState<string[]>(profile.preferredSports ?? [])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null)
  /** Non-null while the crop dialog is framing a freshly picked file. */
  const [cropFile, setCropFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDisplayName(profile.displayName ?? "")
    setAvatarPreset(profile.avatarPreset ?? null)
    setAvatarSelectionTouched(false)
    setBio(profile.bio ?? "")
    setPreferredSports(profile.preferredSports ?? [])
  }, [profile.displayName, profile.avatarPreset, profile.bio, profile.preferredSports])

  useEffect(() => {
    return () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
    }
  }, [previewObjectUrl])

  const toggleSport = (code: string) => {
    setPreferredSports((prev) =>
      prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]
    )
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setUploadError(null)
    const ok = await onSave({
      displayName: displayName.trim() || null,
      avatarPreset: (avatarPreset as AvatarPresetId) || null,
      // Clear uploaded image when avatar selection was explicitly changed.
      avatarUrl: avatarSelectionTouched ? null : undefined,
      bio: bio.trim() || null,
      preferredSports: preferredSports.length > 0 ? preferredSports : null,
    })
    if (ok) {
      setEditing(false)
      onRefetch()
    }
  }

  const runUpload = async (file: File) => {
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
    if (result.ok) onRefetch()
    else setUploadError(result.error ?? "Upload failed")
    return result.ok
  }

  /*
   * Same crop step as the settings page, from the same component. These two editors doing
   * the same job differently is what produced the original avatar bug — one posted to
   * /api/chat/upload and the other did not — so parity here is deliberate, not incidental.
   */
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Cleared before any await so picking the SAME file again still fires a change event.
    e.target.value = ""
    if (!file) return
    setUploadError(null)
    // GIFs skip the cropper — a canvas crop would flatten the animation.
    if (shouldCropBeforeUpload(file)) {
      setCropFile(file)
      return
    }
    await runUpload(file)
  }

  const handleCropConfirm = async (cropped: File) => {
    const ok = await runUpload(cropped)
    // Keep the dialog open on failure so the framing is not lost with the error.
    if (ok) setCropFile(null)
  }

  const handleRemoveImage = async () => {
    setUploadError(null)
    const result = await setProfileAvatarUrl(null)
    if (result.ok) onRefetch()
    else setUploadError(result.error ?? "Failed to remove image")
  }

  const handleCancel = () => {
    setPreviewObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setDisplayName(profile.displayName ?? "")
    setAvatarPreset(profile.avatarPreset ?? null)
    setAvatarSelectionTouched(false)
    setBio(profile.bio ?? "")
    setPreferredSports(profile.preferredSports ?? [])
    setEditing(false)
    onCancel()
  }

  const options = getPreferredSportsOptions()

  return (
    <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Edit profile</h2>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
            <button
              type="submit"
              form="profile-edit-form"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
              style={{
                background: "linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))",
                color: "var(--on-accent-bg)",
              }}
            >
              <Check className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--accent-red)", color: "var(--accent-red-strong)" }}>
          {error}
        </div>
      )}

      {editing && (
        <form id="profile-edit-form" onSubmit={handleSave} className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium" style={{ color: "var(--muted2)" }}>Profile image</label>
            <div className="flex flex-wrap items-center gap-4">
              <ProfileImagePreviewController
                previewObjectUrl={previewObjectUrl}
                profileImageUrl={profile.profileImageUrl}
                avatarPreset={avatarPreset}
                displayName={profile.displayName}
                username={profile.username}
                size="lg"
              />
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <AvatarCropDialog
                  file={cropFile}
                  open={cropFile !== null}
                  busy={uploading}
                  onCancel={() => setCropFile(null)}
                  onConfirm={handleCropConfirm}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? "Uploading…" : "Upload image"}
                </button>
                {profile.profileImageUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--accent-red)", color: "var(--accent-red-strong)" }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove image
                  </button>
                )}
              </div>
            </div>
            {uploadError && (
              <p className="mt-1.5 text-sm" style={{ color: "var(--accent-red-strong)" }}>{uploadError}</p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium" style={{ color: "var(--muted2)" }}>Avatar (20 options)</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setAvatarPreset(null)
                  setAvatarSelectionTouched(true)
                }}
                className="flex h-10 min-w-16 items-center justify-center rounded-xl border px-2 text-xs font-semibold"
                style={{
                  borderColor: avatarPreset == null ? "var(--accent-cyan)" : "var(--border)",
                  background: avatarPreset == null ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)" : "var(--panel2)",
                  color: "var(--text)",
                }}
                title="Use initial"
              >
                Initial
              </button>
              {AVATAR_PRESETS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setAvatarPreset(id)
                    setAvatarSelectionTouched(true)
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border text-lg"
                  style={{
                    borderColor: avatarPreset === id ? "var(--accent-cyan)" : "var(--border)",
                    background: avatarPreset === id ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)" : "var(--panel2)",
                  }}
                  title={AVATAR_PRESET_LABELS[id]}
                >
                  {AVATAR_PRESET_EMOJI[id]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Choose one or upload your own image above.</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted2)" }}>Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full max-w-md rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
              placeholder="Your display name"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted2)" }}>Short bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
              placeholder="A few words about you…"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium" style={{ color: "var(--muted2)" }}>Preferred sports</label>
            <div className="flex flex-wrap gap-2">
              {options.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleSport(value)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                  style={{
                    borderColor: preferredSports.includes(value) ? "var(--accent-cyan)" : "var(--border)",
                    background: preferredSports.includes(value) ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)" : "var(--panel2)",
                    color: "var(--text)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
