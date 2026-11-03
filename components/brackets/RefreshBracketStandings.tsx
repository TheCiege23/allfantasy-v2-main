"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/** Refresh the server-rendered standings while the visitor is looking at them. */
export default function RefreshBracketStandings() {
  const router = useRouter()
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh() }
    const timer = setInterval(refresh, 30_000)
    document.addEventListener("visibilitychange", refresh)
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [router])
  return null
}
