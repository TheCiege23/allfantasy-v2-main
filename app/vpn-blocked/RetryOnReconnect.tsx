"use client"

import { useEffect } from "react"

/** An installed iPhone app resumes its last page when returning from Settings. */
export function RetryOnReconnect({ href }: { href: string }) {
  useEffect(() => {
    let wasHidden = document.visibilityState === "hidden"
    const retry = () => window.location.replace(href)
    const onVisibility = () => {
      if (document.visibilityState === "hidden") wasHidden = true
      else if (wasHidden) retry()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("online", retry)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("online", retry)
    }
  }, [href])

  return null
}
