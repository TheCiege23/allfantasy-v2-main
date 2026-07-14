"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo } from "react"
import { Loader2 } from "lucide-react"
import { loginUrlWithIntent, safeRedirectPath } from "@/lib/auth/auth-intent-resolver"
import { AuthStatusHeader, AuthStatusLoadingFallback, AuthStatusShell } from "@/components/auth/AuthStatusShell"

function OAuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const nextParam = searchParams?.get("next") ?? null
  const authType = searchParams?.get("type") ?? null
  const nextPath = useMemo(() => {
    if (!nextParam && authType === "recovery") {
      return "/reset-password"
    }
    return safeRedirectPath(nextParam)
  }, [authType, nextParam])

  useEffect(() => {
    // Social sign-in goes through NextAuth (/api/auth/callback/[provider]).
    // This Supabase OAuth callback route is no longer used — redirect to login.
    router.replace(loginUrlWithIntent(nextPath))
  }, [nextPath, router])

  return (
    <AuthStatusShell>
      <div className="w-full max-w-[440px]">
        <AuthStatusHeader
          title="Redirecting"
          subtitle="Sending you back to sign in."
        />
        <div className="rounded-[18px] border border-violet-400/20 bg-[#16102a] p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-300" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-white">Redirecting</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">
            Sending you back to sign in...
          </p>
        </div>
      </div>
    </AuthStatusShell>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthStatusLoadingFallback />}>
      <OAuthCallbackContent />
    </Suspense>
  )
}


