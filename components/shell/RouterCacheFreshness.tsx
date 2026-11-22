"use client"

import { useEffect, useRef, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { refreshInBackground } from "@/lib/core-app/deployGuard"

/**
 * Keeps the 30-second tab cache (`experimental.staleTimes.dynamic` in next.config.js) honest.
 *
 * That cache is what makes a tab you just left come back instantly. Its risk is showing what the
 * server rendered BEFORE a change you made — measured 2026-11-14: of 77 /core components that send a
 * write, ~40 update only their own panel and never call `router.refresh()`, which is fine without a
 * cache (every tab visit re-rendered) and wrong with one (approve a join request, tap away and back
 * within 30s, and it is still listed as pending).
 *
 * So: a successful write through `fetch` marks the cache dirty, and the NEXT navigation refreshes
 * the route once, in the background. The tab you land on still appears at once; if it came from the
 * cache, it corrects itself a moment later — stale-while-revalidate, the way Sleeper behaves.
 * Nothing happens until you navigate, so a write costs no extra render while you stay put.
 *
 * ⚠ NOT EVERY POST IS A WRITE. Analytics, tracking, previews, analysis, AI/Chimmy questions and chat
 * all POST without changing what any tab shows — and some fire per keystroke or per message.
 * `SKIP_PATH` keeps them from triggering a refresh; a write it wrongly skips only means that one
 * change can show up to 30s late, exactly as before this cache existed it would have shown at once.
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export const SKIP_PATH =
  /\/(analytics|telemetry|track|tracking|events?|beacon|vitals?|logs?|typing|presence|heartbeat|ping|unread|seen|search|previews?|analy[sz]e|evaluate|estimate|simulate|ai|chimmy|chat|auth|af-debug)(\/|$)|preview|analytics|telemetry|track-/i

let writeSeq = 0
let patchedFetch: typeof fetch | null = null
let originalFetch: typeof fetch | null = null

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase()
  return "GET"
}

function requestPath(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
    const url = new URL(raw, window.location.origin)
    return url.origin === window.location.origin ? url.pathname : null
  } catch {
    return null
  }
}

/** True for a same-origin `/api/` write that can change what a tab renders. */
export function isAppWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (!WRITE_METHODS.has(requestMethod(input, init))) return false
  const path = requestPath(input)
  if (!path || !path.startsWith("/api/")) return false
  return !SKIP_PATH.test(path)
}

export function writeCount(): number {
  return writeSeq
}

function installFetchWatch() {
  if (typeof window === "undefined" || patchedFetch) return
  originalFetch = window.fetch
  const base = originalFetch
  patchedFetch = async function watchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const response = await base.call(window, input, init)
    try {
      if (response.ok && isAppWrite(input, init)) writeSeq += 1
    } catch {
      /* watching must never break a request */
    }
    return response
  } as typeof fetch
  window.fetch = patchedFetch
}

/** Test seam. */
export function __resetRouterCacheFreshnessForTests() {
  if (typeof window !== "undefined" && patchedFetch && window.fetch === patchedFetch && originalFetch) {
    window.fetch = originalFetch
  }
  patchedFetch = null
  originalFetch = null
  writeSeq = 0
}

export function RouterCacheFreshness() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ""
  const [, startTransition] = useTransition()
  const seen = useRef<number | null>(null)
  const firstUrl = useRef(true)

  useEffect(() => {
    installFetchWatch()
  }, [])

  useEffect(() => {
    if (firstUrl.current) {
      // The page just loaded fresh from the server: nothing cached to correct.
      firstUrl.current = false
      seen.current = writeSeq
      return
    }
    if (seen.current === writeSeq) return
    seen.current = writeSeq
    void refreshInBackground(() => startTransition(() => router.refresh()))
  }, [pathname, search, router])

  return null
}

export default RouterCacheFreshness
