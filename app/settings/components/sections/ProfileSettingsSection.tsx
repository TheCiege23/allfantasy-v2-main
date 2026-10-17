"use client"

import { useState, useEffect, useRef } from "react"
import { Check, Upload, Trash2 } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { ProfileImagePreviewController } from "@/components/identity/ProfileImagePreviewController"
import { setProfileAvatarUrl, uploadProfileImage, AVATAR_PRESET_EMOJI } from "@/lib/avatar"
import { AvatarCropDialog, shouldCropBeforeUpload } from "@/components/identity/AvatarCropDialog"
import { AVATAR_PRESETS, AVATAR_PRESET_LABELS, AVATAR_PRESET_LABEL_KEYS, type AvatarPresetId } from "@/lib/signup/avatar-presets"
import { tOr } from "@/lib/i18n/tInterpolate"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import type { SettingsOnSave, SettingsProfile } from "./settings-types"
import { MAX_DISPLAY_NAME_LENGTH } from "@/lib/user-settings/types"
import { useSavedFlash } from "./useSavedFlash"

/** The server keeps 160 characters (app/api/user/profile handleProfileWrite); say so before it truncates. */
const BIO_MAX = 160

export function ProfileSettingsSection({
  profile,
  saving,
  onSave,
  onRefetch,
}: {
  profile: SettingsProfile
  saving: boolean
  onSave: SettingsOnSave
  onRefetch: () => void
  /**
   * @deprecated Unused since avatar upload moved off `/api/chat/upload` onto the dedicated
   * avatar route, which is not league-scoped. Kept in the type so existing callers still
   * compile; drop it and its call sites when they are next touched.
   */
  uploadLeagueId?: string | null
}) {
  const { t } = useLanguage()
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "")
  const [bio, setBio] = useState(profile?.bio ?? "")
  const [sports, setSports] = useState<string[]>(profile?.preferredSports ?? [])
  const savedFlash = useSavedFlash()
  const sportsKey = (profile?.preferredSports ?? []).join(",")
  const [avatarPreset, setAvatarPreset] = useState<string | null>(profile?.avatarPreset ?? null)
  const [avatarSelectionTouched, setAvatarSelectionTouched] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null)
  /** Non-null while the crop dialog is framing a freshly picked file. */
  const [cropFile, setCropFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDisplayName(profile?.displayName ?? "")
    setBio(profile?.bio ?? "")
    setSports(profile?.preferredSports ?? [])
    setAvatarPreset(profile?.avatarPreset ?? null)
    setAvatarSelectionTouched(false)
    // Keyed on the joined list, not the array: a refetch hands back a new array with the same
    // sports, and an identity dependency would wipe an unsaved edit every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.displayName, profile?.bio, sportsKey, profile?.avatarPreset])

  const resetDraft = () => {
    savedFlash.clear()
    setDisplayName(profile?.displayName ?? "")
    setBio(profile?.bio ?? "")
    setSports(profile?.preferredSports ?? [])
    setAvatarPreset(profile?.avatarPreset ?? null)
    setAvatarSelectionTouched(false)
    setUploadError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setUploadError(null)
    savedFlash.clear()
    const ok = await onSave({
      displayName: displayName.trim() || null,
      bio: bio.trim() || null,
      /* Order is meaning: the first sport is the default Preferences shows. */
      preferredSports: sports.length > 0 ? sports : null,
      avatarPreset: (avatarPreset as AvatarPresetId) || null,
      avatarUrl: avatarSelectionTouched ? null : undefined,
    })
    if (ok) savedFlash.flash()
  }

  const toggleSport = (sport: string) => {
    savedFlash.clear()
    setSports((prev) => (prev.includes(sport) ? prev.filter((s) => s !== sport) : [...prev, sport]))
  }

  /*
   * ⚠ THIS USED TO POST TO `/api/chat/upload` AND IT FAILED FOR EVERY GOOGLE SIGN-IN.
   * That route is gated by `requireVerifiedUser`, which demands `ageConfirmedAt` — a field
   * no OAuth sign-in ever writes — so changing a profile picture returned 403
   * `AGE_REQUIRED` here while the identical action on `/profile` succeeded. It also
   * needed a follow-up PATCH to clear the preset; the avatar route now does that itself.
   */
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
    else setUploadError(result.error ?? t("settings.profile.uploadFailed"))
    return result.ok
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    else setUploadError(result.error ?? t("settings.profile.removeFailed"))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
          {t("settings.profile.title")}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {t("settings.profile.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <ProfileImagePreviewController
          previewObjectUrl={previewObjectUrl}
          profileImageUrl={profile?.profileImageUrl}
          avatarPreset={avatarPreset}
          displayName={profile?.displayName}
          username={profile?.username}
          size="md"
        />
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{profile?.username ?? "—"}</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.profile.usernameReadonly")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
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
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? t("settings.profile.uploading") : t("settings.profile.uploadImage")}
            </button>
            {profile?.profileImageUrl && (
              <button
                type="button"
                onClick={handleRemoveImage}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: "var(--accent-red)", color: "var(--accent-red-strong)" }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("settings.profile.remove")}
              </button>
            )}
          </div>
          {uploadError && (
            <p className="mt-1 text-xs" style={{ color: "var(--accent-red-strong)" }}>{uploadError}</p>
          )}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium" style={{ color: "var(--muted2)" }}>
          {t("settings.profile.avatarPicker")}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              savedFlash.clear()
              setAvatarPreset(null)
              setAvatarSelectionTouched(true)
            }}
            aria-pressed={avatarPreset == null}
            className="flex h-11 min-w-14 items-center justify-center rounded-lg border px-2 text-xs font-semibold"
            style={{
              borderColor: avatarPreset == null ? "var(--accent-cyan)" : "var(--border)",
              background: avatarPreset == null ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)" : "var(--panel2)",
              color: "var(--text)",
            }}
            title={t("settings.profile.useInitialTitle")}
          >
            {t("settings.profile.initialAvatar")}
          </button>
          {AVATAR_PRESETS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                savedFlash.clear()
                setAvatarPreset(id)
                setAvatarSelectionTouched(true)
              }}
              aria-pressed={avatarPreset === id}
              aria-label={tOr(t, AVATAR_PRESET_LABEL_KEYS[id], AVATAR_PRESET_LABELS[id])}
              className="flex h-11 w-11 items-center justify-center rounded-lg border text-lg"
              style={{
                borderColor: avatarPreset === id ? "var(--accent-cyan)" : "var(--border)",
                background: avatarPreset === id ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)" : "var(--panel2)",
              }}
              title={tOr(t, AVATAR_PRESET_LABEL_KEYS[id], AVATAR_PRESET_LABELS[id])}
            >
              {AVATAR_PRESET_EMOJI[id]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="settings-profile-display-name" className="mb-1 block text-sm font-medium" style={{ color: "var(--muted2)" }}>
          {t("settings.profile.displayName")}
        </label>
        <input
          id="settings-profile-display-name"
          type="text"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          value={displayName}
          onChange={(e) => {
            savedFlash.clear()
            setDisplayName(e.target.value)
          }}
          className="w-full max-w-md rounded-xl border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
          placeholder={t("settings.profile.displayNamePlaceholder")}
        />
      </div>

      {/*
        Bio and sports. The hub card promises "Display name, avatar, bio and preferred sports" and
        its completion meter nudges "Next: add a bio." / "Next: pick your sports." — but until
        2026-10-02 neither field was editable anywhere in Settings, so those nudges led nowhere.
      */}
      <div>
        <label
          htmlFor="settings-profile-bio"
          className="mb-1 block text-sm font-medium"
          style={{ color: "var(--muted2)" }}
        >
          {t("settings.profile.bio")}
        </label>
        <textarea
          id="settings-profile-bio"
          value={bio}
          maxLength={BIO_MAX}
          rows={3}
          onChange={(e) => {
            savedFlash.clear()
            setBio(e.target.value)
          }}
          className="block w-full max-w-md resize-y rounded-xl border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
          placeholder={t("settings.profile.bioPlaceholder")}
          data-testid="settings-profile-bio"
        />
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {bio.length}/{BIO_MAX}
        </p>
      </div>

      <div>
        <span className="ns-field-label mb-2 block text-sm font-medium" style={{ color: "var(--muted2)" }} id="settings-profile-sports-label">
          {t("settings.profile.sports")}
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="settings-profile-sports-label">
          {SUPPORTED_SPORTS.map((sport) => {
            const on = sports.includes(sport)
            return (
              <button
                key={sport}
                type="button"
                onClick={() => toggleSport(sport)}
                aria-pressed={on}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
                style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--muted)" }}
                data-testid={`settings-profile-sport-${sport}`}
              >
                {on ? <Check className="ns-chip-check" aria-hidden="true" /> : null}
                {sport}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
          {t("settings.profile.sportsHint")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="ns-btn-primary"
        >
          {saving ? t("settings.actions.saving") : t("settings.profile.save")}
        </button>
        <button
          type="button"
          onClick={resetDraft}
          className="rounded-xl border px-4 py-2 text-sm font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          {t("settings.actions.cancelChanges")}
        </button>
        <p role="status" aria-live="polite" className="text-sm font-semibold" style={{ color: "#34d399" }}>
          {savedFlash.saved ? t("settings.profile.saved") : ""}
        </p>
      </div>
    </form>
  )
}
