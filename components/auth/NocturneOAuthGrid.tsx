"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import {
  type SocialProvider,
  isSocialProviderEnabled,
} from "@/lib/auth/SocialProviderResolver"
import { buildProviderPendingHref } from "@/lib/auth/ProviderPendingFlow"
import { buildSignupConsentCookie } from "@/lib/auth/signupConsentCookie"

/**
 * The Nocturne 2×2 OAuth grid shared by /signup and /login.
 *
 * Only the four providers with real conditional NextAuth registration are shown
 * (Google, Apple, Spotify, Discord) — Facebook is manually suspended and
 * X/Instagram/TikTok have no wired provider (see SocialProviderResolver).
 *
 * Enablement + behavior mirror the existing pages exactly:
 *  - Enabled provider → immediate signIn(provider) redirect (brief "Opening…").
 *  - Unconfigured Google/Spotify/Discord stay clickable and route to
 *    /auth/provider-pending ("no dead buttons").
 *  - Apple is the one deliberate exception: hard-disabled when not configured
 *    (no click, no pending route), a documented product decision. It re-enables
 *    automatically the moment APPLE_CLIENT_ID/SECRET (or the public flag) exist.
 */

const GoogleGlyph = () => (
  <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.703-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
    <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335" />
  </svg>
)

const AppleGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="currentColor" d="M12.71 9.43c-.02-2.14 1.75-3.17 1.83-3.22-1-1.46-2.55-1.66-3.1-1.68-1.33-.13-2.6.78-3.27.78-.67 0-1.7-.76-2.8-.74-1.44.02-2.76.83-3.5 2.12-1.5 2.59-.38 6.43 1.07 8.53.71 1.03 1.56 2.18 2.67 2.14 1.07-.04 1.48-.69 2.77-.69 1.3 0 1.67.69 2.81.67 1.15-.02 1.89-1.05 2.59-2.08.82-1.19 1.16-2.34 1.18-2.4-.03-.01-2.26-.87-2.25-3.43z" />
    <path fill="currentColor" d="M10.6 3.12c.59-.71.99-1.7.88-2.69-.85.03-1.88.57-2.49 1.27-.54.63-1.02 1.63-.89 2.59.94.07 1.9-.47 2.5-1.17z" />
  </svg>
)

const SpotifyGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="12" fill="#1DB954" />
    <path d="M16.8 16.64a.75.75 0 0 1-1.03.25c-2.8-1.71-6.32-2.1-10.45-1.13a.75.75 0 1 1-.34-1.46c4.52-1.05 8.43-.62 11.57 1.3.36.22.47.68.25 1.04Zm1.48-3.3a.95.95 0 0 1-1.3.31c-3.2-1.97-8.07-2.55-11.84-1.36a.95.95 0 0 1-.58-1.81c4.3-1.38 9.66-.72 13.4 1.57.45.28.6.86.32 1.3Zm.12-3.43C14.57 7.63 8.82 7.4 5.34 8.48a1.15 1.15 0 1 1-.68-2.2c4-1.22 10.43-.98 14.93 1.7a1.15 1.15 0 0 1-1.18 1.93Z" fill="#fff" />
  </svg>
)

const DiscordGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#5865F2" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.373-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.121.1.247.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
)

const PROVIDERS: { provider: SocialProvider; label: string; glyph: () => JSX.Element }[] = [
  { provider: "google", label: "Google", glyph: GoogleGlyph },
  { provider: "apple", label: "Apple", glyph: AppleGlyph },
  { provider: "spotify", label: "Spotify", glyph: SpotifyGlyph },
  { provider: "discord", label: "Discord", glyph: DiscordGlyph },
]

/**
 * `consent` is supplied by SIGNUP only. On /login there is no checkbox and nothing to
 * carry, so it is omitted and sign-in behaves exactly as before — an existing user must
 * never be re-gated on an agreement they already made.
 */
export default function NocturneOAuthGrid({
  callbackUrl,
  consent,
}: {
  callbackUrl: string
  consent?: {
    /** Has the user ticked the 18+/terms box? */
    granted: boolean
    /** Surface the same inline error the credentials submit shows. */
    onMissing: () => void
  }
}) {
  const router = useRouter()
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(null)

  async function handleClick(provider: SocialProvider) {
    if (loadingProvider) return

    // Two bugs closed here. Previously the grid received only `callbackUrl`, so on /signup
    // a user could tick the box and have it silently discarded, OR click straight through
    // without ticking at all — both produced an account with no consent recorded, and every
    // later gate then told them they had never confirmed their age.
    if (consent && !consent.granted) {
      consent.onMissing()
      return
    }
    if (consent?.granted) {
      // Must be written BEFORE the redirect: the provider round trip leaves this page, and
      // the account-creation path on the way back is the only place that can persist it.
      document.cookie = buildSignupConsentCookie(window.location.protocol === "https:")
    }

    setLoadingProvider(provider)
    try {
      if (isSocialProviderEnabled(provider)) {
        await signIn(provider, { callbackUrl })
        return
      }
      // Apple is hard-disabled when unconfigured and never reaches here (its
      // button is `disabled`); every other provider routes to the pending page.
      router.push(buildProviderPendingHref({ provider, callbackUrl }))
    } finally {
      setLoadingProvider(null)
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {PROVIDERS.map(({ provider, label, glyph: Glyph }) => {
        const enabled = isSocialProviderEnabled(provider)
        const isApple = provider === "apple"
        const hardDisabled = isApple && !enabled
        const isLoading = loadingProvider === provider
        return (
          <button
            key={provider}
            type="button"
            onClick={() => void handleClick(provider)}
            disabled={hardDisabled || loadingProvider !== null}
            aria-disabled={hardDisabled}
            aria-label={enabled ? `Continue with ${label}` : `${label} — Coming soon`}
            className="btn btn-secondary"
            style={{ fontSize: 14, gap: 9 }}
          >
            <Glyph />
            <span>{isLoading ? "Opening…" : label}</span>
            {!enabled && !isLoading && <span className="n-soon">Soon</span>}
          </button>
        )
      })}
    </div>
  )
}
