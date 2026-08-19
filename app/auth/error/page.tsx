"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { TriangleAlert, ArrowRight } from "lucide-react"
import { AuthStatusHeader, AuthStatusLoadingFallback, AuthStatusShell } from "@/components/auth/AuthStatusShell"

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "There is a problem with the server configuration.",
  AccessDenied: "You do not have permission to sign in.",
  Verification: "The sign-in link has expired or has already been used.",
  // Fires when the PROVIDER rejects the callback, not only on a missing cookie — naming
  // the browser sent users to clear cookies for a failure on our side. Kept in step with
  // the same string in app/login/LoginContent.tsx.
  OAuthCallback:
    "Social sign-in couldn't complete. Please try again — if it keeps failing, sign in with your email and password instead.",
  OAuthAccountNotLinked:
    "This social account is already linked to a different AllFantasy account. Sign in with your original method and connect the social account from your account settings.",
  SOCIAL_ACCOUNT_LINK_FAILED:
    "We couldn't connect that social sign-in to your AllFantasy account. Please try again or sign in with your email first.",
  FACEBOOK_EMAIL_MISSING:
    "Facebook did not share your email address. To fix this: go to Facebook → Settings → Security and Login → Apps and Websites, remove AllFantasy, then try signing in again. This forces Facebook to re-ask for the email permission cleanly.",
  FACEBOOK_TOKEN_INVALID:
    "Facebook authorization failed — your session may have been revoked or expired. Please try signing in with Facebook again. If this keeps happening, remove AllFantasy from your Facebook app settings and re-authorize.",
  DISCORD_EMAIL_MISSING:
    "Discord did not share a verified email address. Please verify your email on Discord, then try signing in again.",
  SOCIAL_PROVIDER_EMAIL_MISSING:
    "That sign-in method didn't share an email address, so we can't create a new AllFantasy account from it. If you already have an account, sign in with your email and password first, then connect this method from Settings.",
  SOCIAL_EMAIL_UNVERIFIED:
    "That sign-in method's email isn't verified, so we can't safely connect it to an existing AllFantasy account. Verify your email with that provider, or sign in with your original method first and connect this one from Settings.",
  Default: "An error occurred during sign in.",
}

function ErrorContent() {
  const searchParams = useSearchParams()
  const errorType = searchParams?.get("error") || "Default"
  const message = ERROR_MESSAGES[errorType] || ERROR_MESSAGES.Default

  return (
    <AuthStatusShell>
      <div className="w-full max-w-[440px]">
        <AuthStatusHeader
          title="Sign-in issue"
          subtitle="There was a problem while trying to sign you in to AllFantasy."
        />
        <div className="rounded-[18px] border border-red-500/20 bg-[#16102a] p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
            <TriangleAlert className="h-7 w-7 text-red-400" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-white">Sign-in Error</h1>
          <p className="mt-3 text-sm leading-6 text-white/80">{message}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="flex flex-1 items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90"
            >
              <span>Try Again</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/"
              className="flex flex-1 items-center justify-center rounded-[11px] border border-violet-400/30 bg-[#1c1535] px-4 py-3 text-sm font-medium text-white/75 transition hover:border-violet-300/45 hover:bg-[#211a3e] hover:text-white"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </AuthStatusShell>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<AuthStatusLoadingFallback />}>
      <ErrorContent />
    </Suspense>
  )
}
