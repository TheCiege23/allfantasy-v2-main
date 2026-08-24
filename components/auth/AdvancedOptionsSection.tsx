"use client"

import { Sparkles } from "lucide-react"
import { AVATAR_PRESETS, AVATAR_PRESET_LABELS, type AvatarPresetId } from "@/lib/signup/avatar-presets"
import { validateAvatarUploadFile } from "@/lib/signup/AvatarPickerService"
import {
  formatSignupPhoneDisplay,
  normalizePhoneForSubmit,
  normalizeSignupPhoneDigits,
} from "@/lib/signup/SignupFlowController"
import { LEGACY_IMPORT_PROVIDERS, type LegacyImportProvider } from "@/lib/signup/LegacyImportOnboardingService"
import { SIGNUP_TIMEZONES } from "@/lib/signup/timezones"
import { SELECTABLE_LANGUAGES, SUPPORTED_LANGUAGES, DEFAULT_LANG, getLanguageOptionLabel, type LanguageCode } from "@/lib/i18n/constants"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"

const AVATAR_PRESET_EMOJIS: Record<AvatarPresetId, string> = {
  crest: "🏆",
  bolt: "⚡",
  crown: "👑",
  trophy: "🏆",
  star: "⭐",
  flame: "🔥",
  shield: "🛡️",
  diamond: "💎",
  medal: "🥇",
  target: "🎯",
  zap: "⚡",
  comet: "☄️",
  moon: "🌙",
  sun: "☀️",
  football: "🏈",
  basketball: "🏀",
  baseball: "⚾",
  hockey: "🏒",
  soccer: "⚽",
  champion: "🤺",
}

const SIGNUP_LANGUAGE_BADGES: Record<LanguageCode, string> = {
  en: "EN",
  es: "ES",
  zh: "ZH",
  fil: "FIL",
  vi: "VI",
  fr: "FR",
  ar: "AR",
}

const SIGNUP_PHONE_COUNTRIES = [
  { code: "+1", label: "US/CA" },
  { code: "+52", label: "MX" },
  { code: "+44", label: "UK" },
  { code: "+34", label: "ES" },
  { code: "+33", label: "FR" },
  { code: "+49", label: "DE" },
  { code: "+54", label: "AR" },
  { code: "+55", label: "BR" },
  { code: "+61", label: "AU" },
  { code: "+81", label: "JP" },
  { code: "+91", label: "IN" },
]

interface PhoneProps {
  countryCode: string
  onCountryCodeChange: (code: string) => void
  number: string
  onNumberChange: (digits: string) => void
  codeSent: boolean
  code: string
  onCodeChange: (code: string) => void
  codeVerified: boolean
  sendingCode: boolean
  verifyingCode: boolean
  verificationMessage: string | null
  onSendCode: () => void
  onVerifyCode: () => void
}

interface AvatarProps {
  preset: string | null
  onPresetChange: (preset: string | null) => void
  preview: string | null
  onPreviewChange: (dataUrl: string | null) => void
  fileError: string | null
  onFileErrorChange: (error: string | null) => void
  fallbackName: string
}

interface LegacyImportProps {
  message: string | null
  onProviderClick: (provider: LegacyImportProvider) => void
  onSkip: () => void
}

interface TimezoneProps {
  value: string
  onChange: (tz: string) => void
  groups: Record<string, typeof SIGNUP_TIMEZONES>
}

interface LanguageProps {
  value: LanguageCode
  onChange: (lang: LanguageCode) => void
}

interface AdvancedOptionsSectionProps {
  verificationMethod: "EMAIL" | "PHONE"
  onVerificationMethodChange: (method: "EMAIL" | "PHONE") => void
  phone: PhoneProps
  avatar: AvatarProps
  legacyImport: LegacyImportProps
  timezone: TimezoneProps
  language: LanguageProps
}

export default function AdvancedOptionsSection({
  verificationMethod,
  onVerificationMethodChange,
  phone,
  avatar,
  legacyImport,
  timezone,
  language,
}: AdvancedOptionsSectionProps) {
  return (
    <div className="space-y-4">
      {/* Verification method + phone */}
      <div>
        <label className="mb-2 block text-sm font-medium" style={{ color: "var(--muted)" }}>
          Verification Method
        </label>
        <div className="grid grid-cols-2 gap-2 rounded-xl border p-1" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <button
            type="button"
            onClick={() => onVerificationMethodChange("EMAIL")}
            className="rounded-lg px-3 py-2 text-sm font-medium transition"
            style={{
              background: verificationMethod === "EMAIL" ? "linear-gradient(135deg, var(--accent-cyan), #3b82f6)" : "transparent",
              color: verificationMethod === "EMAIL" ? "#fff" : "var(--muted)",
            }}
          >
            ✉️ Email
          </button>
          <button
            type="button"
            onClick={() => onVerificationMethodChange("PHONE")}
            className="rounded-lg px-3 py-2 text-sm font-medium transition"
            style={{
              background: verificationMethod === "PHONE" ? "linear-gradient(135deg, var(--accent-cyan), #3b82f6)" : "transparent",
              color: verificationMethod === "PHONE" ? "#fff" : "var(--muted)",
            }}
          >
            📱 Phone
          </button>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
          {verificationMethod === "PHONE"
            ? "We'll send a one-time code to your phone number."
            : "We'll send a verification link to your email address. Add a phone number below if you'd like one on file too."}
        </p>

        <div className="mt-3 space-y-2">
          <div className="grid overflow-hidden rounded-xl border sm:grid-cols-[128px_1fr]" style={{ borderColor: "var(--border)" }}>
            <select
              value={phone.countryCode}
              onChange={(e) => {
                phone.onCountryCodeChange(e.target.value)
              }}
              className="border-0 px-3 py-3 text-sm font-semibold focus-ring"
              style={{ background: "var(--panel2)", color: "var(--text)" }}
              aria-label="Phone country code"
            >
              {SIGNUP_PHONE_COUNTRIES.map((country) => (
                <option key={`${country.code}-${country.label}`} value={country.code}>
                  {country.label} {country.code}
                </option>
              ))}
            </select>
            <input
              value={phone.number}
              onChange={(e) => phone.onNumberChange(normalizeSignupPhoneDigits(e.target.value))}
              type="tel"
              className="min-w-0 border-0 border-t px-4 py-3 text-sm focus-ring sm:border-l sm:border-t-0"
              style={{ background: "var(--panel2)", color: "var(--text)" }}
              placeholder={phone.countryCode === "+1" ? "(555) 123-4567" : "Local number"}
              autoComplete="tel"
              inputMode="numeric"
              aria-label="Phone number"
            />
          </div>
          {phone.number.length > 0 && (
            <p className="text-xs" style={{ color: "var(--muted2)" }}>
              Sends as: {normalizePhoneForSubmit(phone.number, phone.countryCode)}{" "}
              <span aria-hidden>({formatSignupPhoneDisplay(phone.number, phone.countryCode)})</span>
            </p>
          )}

          {verificationMethod === "PHONE" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={phone.onSendCode}
                disabled={phone.sendingCode || !phone.number.trim()}
                className="rounded-xl border px-4 py-3 text-xs transition disabled:opacity-50"
                style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--muted)" }}
              >
                {phone.sendingCode ? "Sending..." : phone.codeSent ? "Resend code" : "Send code"}
              </button>
              <input
                value={phone.code}
                onChange={(e) => phone.onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Enter code"
                inputMode="numeric"
                aria-label="Phone verification code"
                className="flex-1 rounded-xl border px-4 py-3 text-sm transition focus-ring"
                style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
              />
              <button
                type="button"
                onClick={phone.onVerifyCode}
                disabled={phone.verifyingCode || phone.code.length < 4 || !phone.codeSent}
                className="rounded-xl border px-4 py-3 text-xs transition disabled:opacity-50"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-cyan) 35%, transparent)",
                  background: "color-mix(in srgb, var(--accent-cyan) 10%, transparent)",
                  color: "color-mix(in srgb, #fff 84%, var(--accent-cyan))",
                }}
              >
                {phone.verifyingCode ? "Verifying..." : "Verify"}
              </button>
            </div>
          )}
          {phone.verificationMessage && (
            <p className="text-xs" style={{ color: phone.codeVerified ? "var(--accent-emerald-strong)" : "var(--muted2)" }}>
              {phone.verificationMessage}
            </p>
          )}
        </div>
      </div>

      {/* Avatar */}
      <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <label className="mb-2 block text-sm font-medium" style={{ color: "var(--muted)" }}>
          Profile Avatar
        </label>
        <div className="mb-4 flex items-center gap-4">
          <div
            className="flex h-[64px] w-[64px] items-center justify-center overflow-hidden rounded-full border-2"
            style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
          >
            <IdentityImageRenderer
              avatarUrl={avatar.preview}
              avatarPreset={avatar.preview ? null : avatar.preset}
              displayName={avatar.fallbackName}
              username={avatar.fallbackName}
              size="md"
            />
          </div>
          <p className="text-xs leading-5" style={{ color: "var(--muted)" }}>
            Choose a preset or upload your own. You can always change this later.
          </p>
        </div>

        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          <button
            type="button"
            onClick={() => {
              avatar.onPresetChange(null)
              avatar.onPreviewChange(null)
              avatar.onFileErrorChange(null)
            }}
            className="rounded-xl border px-2 py-3 text-center text-[11px] transition"
            style={{
              borderColor: avatar.preset == null && !avatar.preview ? "var(--accent-cyan)" : "var(--border)",
              background: avatar.preset == null && !avatar.preview ? "color-mix(in srgb, var(--accent-cyan) 10%, transparent)" : "var(--panel2)",
              color: avatar.preset == null && !avatar.preview ? "var(--text)" : "var(--muted)",
            }}
          >
            Initial
          </button>
          {AVATAR_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                avatar.onPresetChange(preset)
                avatar.onPreviewChange(null)
                avatar.onFileErrorChange(null)
              }}
              className="rounded-xl border px-2 py-2 text-center transition"
              style={{
                borderColor: avatar.preset === preset && !avatar.preview ? "var(--accent-cyan)" : "var(--border)",
                background: avatar.preset === preset && !avatar.preview ? "color-mix(in srgb, var(--accent-cyan) 10%, transparent)" : "var(--panel2)",
              }}
              title={AVATAR_PRESET_LABELS[preset]}
            >
              <span className="block text-lg">{AVATAR_PRESET_EMOJIS[preset as AvatarPresetId]}</span>
              <span className="mt-1 block text-[9px]" style={{ color: "var(--muted2)" }}>
                {AVATAR_PRESET_LABELS[preset as AvatarPresetId]}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-2 text-xs transition"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            <input
              type="file"
              accept="image/*"
              data-testid="signup-avatar-upload-input"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const validationError = validateAvatarUploadFile(file)
                if (validationError) {
                  avatar.onFileErrorChange(validationError)
                  return
                }
                const reader = new FileReader()
                reader.onload = () => {
                  avatar.onPreviewChange(reader.result as string)
                  avatar.onFileErrorChange(null)
                }
                reader.readAsDataURL(file)
              }}
            />
            Upload your own image
          </label>
          {avatar.preview && (
            <button
              type="button"
              onClick={() => avatar.onPreviewChange(null)}
              className="rounded-lg border px-3 py-2 text-xs transition"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              Remove upload
            </button>
          )}
        </div>
        {avatar.fileError && (
          <p className="mt-2 text-xs" style={{ color: "var(--accent-red-strong)" }}>
            {avatar.fileError}
          </p>
        )}
      </div>

      {/* Legacy import */}
      <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel2) 92%, transparent)" }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />
            Legacy import (optional)
          </div>
          <p className="mb-3 text-xs leading-5" style={{ color: "var(--muted)" }}>
            Import your fantasy history to get placed into rankings and level systems. Skip it for now and start at level 1.
          </p>
          <div className="flex flex-wrap gap-2">
            {LEGACY_IMPORT_PROVIDERS.filter((provider) => provider.id !== "sleeper").map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => legacyImport.onProviderClick(provider.id)}
                className="rounded-xl border px-3 py-2 text-xs transition"
                style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--muted)" }}
              >
                {provider.label} {provider.status === "planned" ? "(soon)" : ""}
              </button>
            ))}
            <button
              type="button"
              onClick={legacyImport.onSkip}
              className="rounded-xl border px-3 py-2 text-xs transition"
              style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--muted)" }}
            >
              Skip import for now
            </button>
          </div>
          {legacyImport.message && (
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              {legacyImport.message}
            </p>
          )}
        </div>
      </div>

      {/* Timezone */}
      <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <label className="mb-2 block text-sm font-medium" style={{ color: "var(--muted)" }}>
          Timezone
        </label>
        <select
          value={timezone.value}
          onChange={(e) => timezone.onChange(e.target.value)}
          className="w-full rounded-xl border px-4 py-3 text-sm transition focus-ring"
          style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
        >
          {Object.entries(timezone.groups).map(([region, timezones]) => (
            <optgroup key={region} label={region}>
              {timezones.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
          Used for draft clocks, matchup deadlines, and notifications.
        </p>
      </div>

      {/* Language */}
      <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <label className="mb-2 block text-sm font-medium" style={{ color: "var(--muted)" }}>
          Language
        </label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SELECTABLE_LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => language.onChange(lang)}
              className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
              style={{
                borderColor: language.value === lang ? "var(--accent-cyan)" : "var(--border)",
                background: language.value === lang ? "color-mix(in srgb, var(--accent-cyan) 8%, transparent)" : "var(--panel2)",
              }}
            >
              <span className="text-xs font-bold" style={{ color: "var(--muted2)" }}>
                {SIGNUP_LANGUAGE_BADGES[lang]}
              </span>
              <span>
                <strong className="block text-sm">{getLanguageOptionLabel(lang)}</strong>
                <small style={{ color: "var(--muted)" }}>{lang === DEFAULT_LANG ? "Default language" : "Available language"}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
