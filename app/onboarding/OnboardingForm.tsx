"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, CheckCircle2, TriangleAlert, RefreshCw } from "lucide-react"
import { checkUsernameAvailability, suggestUsername } from "@/lib/signup/UsernameAvailabilityService"
import { validateAvatarUploadFile } from "@/lib/signup/AvatarPickerService"
import { AVATAR_PRESETS, AVATAR_PRESET_LABELS, type AvatarPresetId } from "@/lib/signup/avatar-presets"
import { SIGNUP_TIMEZONES, DEFAULT_SIGNUP_TIMEZONE } from "@/lib/signup/timezones"
import { SUPPORTED_LANGUAGES, DEFAULT_LANG, getLanguageDisplayName, type LanguageCode } from "@/lib/i18n/constants"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"
import "@/components/auth/nocturne-auth.css"

const AVATAR_PRESET_EMOJIS: Record<AvatarPresetId, string> = {
  crest: "🏆", bolt: "⚡", crown: "👑", trophy: "🏆", star: "⭐", flame: "🔥",
  shield: "🛡️", diamond: "💎", medal: "🥇", target: "🎯", zap: "⚡", comet: "☄️",
  moon: "🌙", sun: "☀️", football: "🏈", basketball: "🏀", baseball: "⚾",
  hockey: "🏒", soccer: "⚽", champion: "🤺",
}

const LANGUAGE_BADGES: Record<LanguageCode, string> = {
  en: "EN", es: "ES", zh: "ZH", fil: "FIL", vi: "VI", fr: "FR", ar: "AR",
}

type UsernameStatus = "idle" | "unchanged" | "checking" | "ok" | "taken" | "invalid" | "unchecked"

interface OnboardingFormProps {
  defaultName: string
  defaultUsername: string
  defaultPhone: string
  defaultTimezone: string | null
  defaultLanguage: string | null
  defaultAvatarPreset: string | null
  currentAvatarUrl: string | null
  phoneVerified: boolean
  isVerified: boolean
}

export default function OnboardingForm({
  defaultName,
  defaultUsername,
  defaultPhone,
  defaultTimezone,
  defaultLanguage,
  defaultAvatarPreset,
  currentAvatarUrl,
  phoneVerified: initialPhoneVerified,
  isVerified,
}: OnboardingFormProps) {
  const router = useRouter()

  const [displayName, setDisplayName] = useState(defaultName)
  const [username, setUsername] = useState(defaultUsername)
  const [phone, setPhone] = useState(defaultPhone)
  const [timezone, setTimezone] = useState<string>(
    defaultTimezone && SIGNUP_TIMEZONES.some((t) => t.value === defaultTimezone)
      ? defaultTimezone
      : DEFAULT_SIGNUP_TIMEZONE
  )
  const [language, setLanguage] = useState<LanguageCode>(
    (SUPPORTED_LANGUAGES as readonly string[]).includes(defaultLanguage ?? "")
      ? (defaultLanguage as LanguageCode)
      : DEFAULT_LANG
  )
  const [avatarPreset, setAvatarPreset] = useState<string | null>(defaultAvatarPreset)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFileError, setAvatarFileError] = useState<string | null>(null)

  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("unchanged")
  const [usernameMessage, setUsernameMessage] = useState("")
  const [suggesting, setSuggesting] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Auto-detect a sensible timezone once, if the profile has no allowed value yet.
  const tzResolvedRef = useRef(false)
  useEffect(() => {
    if (tzResolvedRef.current) return
    tzResolvedRef.current = true
    if (defaultTimezone && SIGNUP_TIMEZONES.some((t) => t.value === defaultTimezone)) return
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (SIGNUP_TIMEZONES.some((t) => t.value === detected)) setTimezone(detected)
    } catch {
      /* no-op */
    }
  }, [defaultTimezone])

  // Debounced username availability — only when it differs from the current handle.
  useEffect(() => {
    const trimmed = username.trim()
    if (trimmed.toLowerCase() === defaultUsername.trim().toLowerCase()) {
      setUsernameStatus("unchanged")
      setUsernameMessage("")
      return
    }
    if (!trimmed) {
      setUsernameStatus("invalid")
      setUsernameMessage("Pick a username.")
      return
    }
    if (trimmed.length < 3 || trimmed.length > 30) {
      setUsernameStatus("invalid")
      setUsernameMessage("3–30 characters.")
      return
    }
    if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
      setUsernameStatus("invalid")
      setUsernameMessage("Letters, numbers, and underscores only.")
      return
    }

    let cancelled = false
    setUsernameStatus("checking")
    setUsernameMessage("Checking availability…")
    const timer = setTimeout(async () => {
      try {
        const data = await checkUsernameAvailability(trimmed)
        if (cancelled) return
        if (!data.ok) {
          setUsernameStatus("unchecked")
          setUsernameMessage("Couldn't verify right now — you can still continue.")
          return
        }
        if (data.status === "unchecked" || (data.available && data.reason === "unchecked")) {
          setUsernameStatus("unchecked")
          setUsernameMessage("Couldn't verify right now — you can still continue.")
          return
        }
        if (!data.available) {
          setUsernameStatus(data.reason === "taken" ? "taken" : "invalid")
          setUsernameMessage(
            data.reason === "taken"
              ? "That username is taken."
              : data.reason === "profanity"
                ? "Please choose a different username."
                : "That username isn't allowed."
          )
        } else {
          setUsernameStatus("ok")
          setUsernameMessage("Available.")
        }
      } catch {
        if (!cancelled) {
          setUsernameStatus("unchecked")
          setUsernameMessage("Couldn't verify right now — you can still continue.")
        }
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [username, defaultUsername])

  const applySuggestion = useCallback(async () => {
    setSuggesting(true)
    try {
      const s = await suggestUsername(username.trim() || defaultUsername || "player")
      if (s) setUsername(s)
    } finally {
      setSuggesting(false)
    }
  }, [username, defaultUsername])

  const timezoneGroups = useMemo(() => {
    return SIGNUP_TIMEZONES.reduce<Record<string, typeof SIGNUP_TIMEZONES>>((acc, item) => {
      ;(acc[item.region] ||= []).push(item)
      return acc
    }, {})
  }, [])

  const usernameBlocksSubmit = usernameStatus === "taken" || usernameStatus === "invalid" || usernameStatus === "checking"
  const submitDisabled = loading || !isVerified || !displayName.trim() || usernameBlocksSubmit

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitDisabled) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/complete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          username: username.trim() || undefined,
          phone: phone.trim() || undefined,
          timezone,
          preferredLanguage: language,
          avatarPreset,
          avatarDataUrl: avatarPreview || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.")
        setLoading(false)
        return
      }
      router.push("/onboarding/funnel")
    } catch {
      setError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  const usernameColor =
    usernameStatus === "ok"
      ? "var(--color-accent-400)"
      : usernameStatus === "taken" || usernameStatus === "invalid"
        ? "var(--color-error)"
        : "var(--color-neutral-500)"

  return (
    <form
      onSubmit={handleSubmit}
      className="card"
      style={{
        border: "1px solid var(--color-neutral-800)",
        borderRadius: "var(--radius-lg)",
        background: "var(--color-surface)",
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "11px 13px",
            fontSize: 13,
            borderRadius: "var(--radius-md)",
            border: "1px solid color-mix(in srgb, var(--color-error) 45%, transparent)",
            background: "var(--color-neutral-900)",
            color: "color-mix(in srgb, #fff 82%, var(--color-error))",
          }}
        >
          <TriangleAlert size={16} style={{ marginTop: 1, flex: "none", color: "var(--color-error)" }} />
          <div>{error}</div>
        </div>
      )}

      {/* Avatar */}
      <div>
        <label style={{ display: "block", fontSize: 12, marginBottom: 8, color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}>
          Avatar
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <div
            style={{
              width: 60,
              height: 60,
              flex: "none",
              overflow: "hidden",
              borderRadius: "50%",
              border: "2px solid var(--color-neutral-800)",
              background: "var(--color-bg)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <IdentityImageRenderer
              avatarUrl={avatarPreview || currentAvatarUrl}
              avatarPreset={avatarPreview ? null : avatarPreset}
              displayName={displayName || username}
              username={username || displayName}
              size="md"
            />
          </div>
          <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--color-neutral-500)", margin: 0 }}>
            Pick a preset or upload your own. Change it any time.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setAvatarPreset(null)
              setAvatarPreview(null)
              setAvatarFileError(null)
            }}
            style={{
              gridColumn: "span 2",
              minHeight: 44,
              cursor: "pointer",
              fontSize: 12,
              borderRadius: "var(--radius-md)",
              border: `1px solid ${avatarPreset == null && !avatarPreview ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
              background: avatarPreset == null && !avatarPreview ? "var(--color-accent-900)" : "var(--color-bg)",
              color: avatarPreset == null && !avatarPreview ? "var(--color-accent-300)" : "var(--color-neutral-400)",
            }}
          >
            Initials
          </button>
          {AVATAR_PRESETS.map((preset) => {
            const active = avatarPreset === preset && !avatarPreview
            return (
              <button
                key={preset}
                type="button"
                title={AVATAR_PRESET_LABELS[preset as AvatarPresetId]}
                onClick={() => {
                  setAvatarPreset(preset)
                  setAvatarPreview(null)
                  setAvatarFileError(null)
                }}
                style={{
                  minHeight: 44,
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
                  background: active ? "var(--color-accent-900)" : "var(--color-bg)",
                }}
              >
                {AVATAR_PRESET_EMOJIS[preset as AvatarPresetId]}
              </button>
            )
          })}
        </div>

        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label
            className="btn btn-secondary"
            style={{ minHeight: 40, fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const err = validateAvatarUploadFile(file)
                if (err) {
                  setAvatarFileError(err)
                  return
                }
                const reader = new FileReader()
                reader.onload = () => {
                  setAvatarPreview(reader.result as string)
                  setAvatarFileError(null)
                }
                reader.readAsDataURL(file)
              }}
            />
            Upload image
          </label>
          {avatarPreview && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ minHeight: 40, fontSize: 13 }}
              onClick={() => setAvatarPreview(null)}
            >
              Remove upload
            </button>
          )}
        </div>
        {avatarFileError && (
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--color-error)" }}>{avatarFileError}</p>
        )}
      </div>

      {/* Username */}
      <div className="field">
        <label htmlFor="ob-username">Username</label>
        <div style={{ position: "relative" }}>
          <input
            id="ob-username"
            className="input"
            type="text"
            value={username}
            maxLength={30}
            onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
            placeholder="your_username"
            autoComplete="username"
            style={{ paddingRight: 92 }}
          />
          <button
            type="button"
            onClick={applySuggestion}
            disabled={suggesting}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 9px",
              fontSize: 11,
              cursor: "pointer",
              background: "none",
              border: "1px solid var(--color-neutral-800)",
              borderRadius: 999,
              color: "var(--color-neutral-400)",
            }}
          >
            <RefreshCw size={11} className={suggesting ? "animate-spin" : undefined} />
            Suggest
          </button>
        </div>
        <p style={{ marginTop: 6, fontSize: 12, minHeight: 16, color: usernameColor, display: "inline-flex", alignItems: "center", gap: 5 }}>
          {usernameStatus === "ok" && <CheckCircle2 size={13} />}
          {(usernameStatus === "taken" || usernameStatus === "invalid") && <TriangleAlert size={13} />}
          {usernameStatus === "unchanged"
            ? "Letters, numbers, and underscores · 3–30 characters"
            : usernameMessage}
        </p>
      </div>

      {/* Display name */}
      <div className="field">
        <label htmlFor="ob-name">Display name</label>
        <input
          id="ob-name"
          className="input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Jordan Rivera"
          autoComplete="name"
        />
      </div>

      {/* Timezone */}
      <div className="field">
        <label htmlFor="ob-tz">Timezone</label>
        <select
          id="ob-tz"
          className="input"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          style={{ appearance: "auto" }}
        >
          {Object.entries(timezoneGroups).map(([region, zones]) => (
            <optgroup key={region} label={region}>
              {zones.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--color-neutral-600)" }}>
          Used for draft clocks, deadlines, and notifications.
        </p>
      </div>

      {/* Language */}
      <div className="field">
        <label htmlFor="ob-lang">Language</label>
        <select
          id="ob-lang"
          className="input"
          value={language}
          onChange={(e) => setLanguage(e.target.value as LanguageCode)}
          style={{ appearance: "auto" }}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_BADGES[lang]} · {getLanguageDisplayName(lang)}
            </option>
          ))}
        </select>
      </div>

      {/* Phone (optional) */}
      <div className="field">
        <label htmlFor="ob-phone">
          Phone <span style={{ color: "var(--color-neutral-600)", fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          id="ob-phone"
          className="input"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 (555) 123-4567"
          autoComplete="tel"
        />
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--color-neutral-600)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          {initialPhoneVerified ? (
            <>
              <CheckCircle2 size={13} style={{ color: "var(--color-accent-400)" }} />
              Phone verified.
            </>
          ) : (
            <>
              Add a number for account recovery. <a href="/verify?method=phone">Verify it</a> for extra security.
            </>
          )}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={submitDisabled}
          style={{ minHeight: 46, fontSize: 15 }}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Saving…
            </>
          ) : !isVerified ? (
            "Verify your email first"
          ) : (
            "Finish setup"
          )}
        </button>
        <a
          href="/dashboard"
          style={{ textAlign: "center", fontSize: 13, color: "var(--color-neutral-500)" }}
        >
          Skip for now
        </a>
      </div>
    </form>
  )
}
