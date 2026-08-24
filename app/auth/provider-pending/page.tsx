"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, ArrowRight, Info } from "lucide-react"
import { AuthStatusHeader, AuthStatusShell } from "@/components/auth/AuthStatusShell"
import {
  getProviderDisplayName,
  getProviderFallbackMessage,
} from "@/lib/auth/ProviderFallbackFlowService"
import { type SocialProvider } from "@/lib/auth/SocialProviderResolver"
import { resolveFallbackRoute } from "@/lib/ui-state"
import { signupUrlWithIntent } from "@/lib/auth/auth-intent-resolver"

const SUPPORTED_PROVIDER_IDS: SocialProvider[] = [
  "google",
  "spotify",
  "apple",
  "facebook",
  "discord",
  "instagram",
  "x",
  "tiktok",
]

function toProvider(value: string | null | undefined): SocialProvider {
  if (!value) return "google"
  if (SUPPORTED_PROVIDER_IDS.includes(value as SocialProvider)) {
    return value as SocialProvider
  }
  return "google"
}

export default function ProviderPendingPage() {
  const searchParams = useSearchParams()
  const defaultDashboardHref = resolveFallbackRoute("dashboard").href
  const callbackUrlRaw = searchParams?.get("callbackUrl") ?? defaultDashboardHref
  const callbackUrl = callbackUrlRaw.startsWith("/") ? callbackUrlRaw : defaultDashboardHref
  const provider = toProvider(searchParams?.get("provider") ?? null)
  const landingFallback = resolveFallbackRoute("home")

  const providerName = useMemo(() => getProviderDisplayName(provider), [provider])
  const message = useMemo(() => getProviderFallbackMessage(provider), [provider])

  return (
    <AuthStatusShell>
      <div className="w-full max-w-[440px]">
        <AuthStatusHeader
          title={`${providerName} sign-in`}
          subtitle="This provider is not ready yet, but your AllFantasy account is still accessible."
        />

        <div className="rounded-[18px] border border-violet-400/20 bg-[#16102a] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2">
              <Info className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{providerName} sign-in</h2>
              <p className="text-xs text-white/50">Provider availability</p>
            </div>
          </div>

          <p className="mt-5 text-sm leading-6 text-white/70">{message}</p>

          <div className="mt-4 rounded-xl border border-violet-400/20 bg-[#1c1535] p-3 text-xs leading-6 text-white/55">
            Your account still works with username, email, or mobile number plus password.
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              className="flex flex-1 items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90"
            >
              <span>Back to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={signupUrlWithIntent(callbackUrl)}
              className="flex flex-1 items-center justify-center rounded-[11px] border border-violet-400/30 bg-[#1c1535] px-4 py-3 text-sm font-medium text-white/75 transition hover:border-violet-300/45 hover:bg-[#211a3e] hover:text-white"
            >
              Go to Sign Up
            </Link>
          </div>

          <Link
            href={landingFallback.href}
            className="mt-5 inline-flex items-center gap-2 text-sm text-white/50 transition hover:text-white/70"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {landingFallback.label}
          </Link>
        </div>
      </div>
    </AuthStatusShell>
  )
}
