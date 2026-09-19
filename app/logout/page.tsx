"use client"

import { Suspense, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { signOutAndPurge } from "@/lib/pwa/signOutAndPurge"
import { AuthStatusLoadingFallback } from "@/components/auth/AuthStatusShell"
import { getLoginRedirectUrl } from "@/lib/routing"

function LogoutContent() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const requested = searchParams?.get("callbackUrl") || searchParams?.get("next") || "/"
    const target = getLoginRedirectUrl(requested)

    /*
     * Clears the session AND the service worker's copy of the signed-in pages before the
     * redirect — see lib/pwa/signOutAndPurge.ts. Without the purge, the next person on this
     * device saw the previous user's /core home offline.
     */
    void signOutAndPurge({ callbackUrl: target })
  }, [searchParams])

  return <AuthStatusLoadingFallback label="Signing you out..." />
}

export default function LogoutPage() {
  return (
    <Suspense fallback={<AuthStatusLoadingFallback label="Signing you out..." />}>
      <LogoutContent />
    </Suspense>
  )
}

