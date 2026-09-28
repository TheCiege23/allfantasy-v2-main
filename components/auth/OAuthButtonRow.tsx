"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import {
  type SocialProvider,
  isSocialProviderEnabled,
} from "@/lib/auth/SocialProviderResolver"
import { buildProviderPendingHref } from "@/lib/auth/ProviderPendingFlow"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

interface OAuthButtonRowProps {
  callbackUrl: string
}

/** Order matches the product spec: Google, Facebook, X/Twitter, Discord, Spotify. Apple renders separately below, always disabled. */
const ROW_PROVIDERS: SocialProvider[] = ["google", "facebook", "x", "discord", "spotify"]

const PROVIDER_LABEL_KEYS: Record<SocialProvider, string> = {
  google: "signup.oauth.google",
  facebook: "signup.oauth.facebook",
  x: "signup.oauth.x",
  discord: "signup.oauth.discord",
  spotify: "signup.oauth.spotify",
  apple: "signup.oauth.apple",
  instagram: "signup.oauth.apple", // unused in this row
  tiktok: "signup.oauth.apple", // unused in this row
}

function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export default function OAuthButtonRow({ callbackUrl }: OAuthButtonRowProps) {
  const router = useRouter()
  const { t } = useOptionalLanguage()
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(null)

  async function handleProviderClick(provider: SocialProvider) {
    if (loadingProvider) return
    setLoadingProvider(provider)
    try {
      if (isSocialProviderEnabled(provider)) {
        await signIn(provider, { callbackUrl })
        return
      }
      router.push(buildProviderPendingHref({ provider, callbackUrl }))
    } finally {
      setLoadingProvider(null)
    }
  }

  return (
    <div className="space-y-2" data-hide-in-ios-app>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ROW_PROVIDERS.map((provider) => {
          const enabled = isSocialProviderEnabled(provider)
          const isLoading = loadingProvider === provider
          return (
            <button
              key={provider}
              type="button"
              onClick={() => void handleProviderClick(provider)}
              disabled={loadingProvider !== null}
              aria-label={
                enabled
                  ? `Continue with ${t(PROVIDER_LABEL_KEYS[provider])}`
                  : `${t(PROVIDER_LABEL_KEYS[provider])} — ${t("signup.oauth.comingSoon")}`
              }
              className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            >
              {provider === "google" && <GoogleGlyph />}
              <span>
                {isLoading ? t("signup.oauth.opening") : t(PROVIDER_LABEL_KEYS[provider])}
              </span>
              {!enabled && !isLoading && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: "color-mix(in srgb, var(--muted2) 18%, transparent)", color: "var(--muted2)" }}
                >
                  {t("signup.oauth.comingSoon")}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/*
        Apple renders separately per the product spec, but is driven by the
        same isSocialProviderEnabled('apple') check as every other provider —
        no hardcoded bypass. lib/auth.ts only registers AppleProvider when
        APPLE_CLIENT_ID+APPLE_CLIENT_SECRET are set, and the resolver checks
        that same condition, so this stays disabled until Apple is actually
        configured and re-enables automatically the moment it is, with no
        further code change needed here or on /login.
      */}
      <button
        type="button"
        onClick={() => void handleProviderClick("apple")}
        disabled={!isSocialProviderEnabled("apple") || loadingProvider !== null}
        aria-disabled={!isSocialProviderEnabled("apple")}
        aria-label={
          isSocialProviderEnabled("apple")
            ? `Continue with ${t("signup.oauth.apple")}`
            : `${t("signup.oauth.apple")} — ${t("signup.oauth.comingSoon")}`
        }
        className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
        style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--muted)" }}
      >
        <span>{loadingProvider === "apple" ? t("signup.oauth.opening") : t("signup.oauth.apple")}</span>
        {!isSocialProviderEnabled("apple") && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: "color-mix(in srgb, var(--muted2) 18%, transparent)", color: "var(--muted2)" }}
          >
            {t("signup.oauth.comingSoon")}
          </span>
        )}
      </button>
    </div>
  )
}
