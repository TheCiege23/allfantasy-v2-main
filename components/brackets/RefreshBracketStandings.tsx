"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { primeDeployBaseline, refreshInBackground } from "@/lib/core-app/deployGuard"

/** Refresh the server-rendered standings while the visitor is looking at them. */
export default function RefreshBracketStandings() {
  const router = useRouter()
  useEffect(() => {
    void primeDeployBaseline()
    // Guarded: after a deploy a background refresh is a full page reload (lib/core-app/deployGuard).
    const refresh = () => { if (document.visibilityState === "visible") void refreshInBackground(() => router.refresh()) }
    const timer = setInterval(refresh, 30_000)
    document.addEventListener("visibilitychange", refresh)
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [router])
  return null
}
