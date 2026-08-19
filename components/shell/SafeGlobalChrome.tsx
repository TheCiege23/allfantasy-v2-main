"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import Script from "next/script"
import { AuthRouteGlobalChrome } from "@/components/auth/AuthRouteGlobalChrome"
import AgeConfirmationPrompt from "@/components/legal/AgeConfirmationPrompt"
import { shouldRegisterServiceWorker } from "@/lib/pwa/shouldRegisterServiceWorker"

const AUTH_ROUTE_PREFIXES = ["/login", "/signup", "/signin", "/auth"]

/**
 * Paths where the entire global chrome (including AuthRouteGlobalChrome and
 * the service-worker lifecycle) must NOT render. These are the historical
 * auth shells where any extra body content would cause hydration drift, PLUS
 * the World Cup bracket routes.
 *
 * Why /brackets/world-cup: SafeGlobalChrome uses `usePathname()` to gate
 * chrome. On the server the hook returns the real pathname; on the client
 * during the first hydration tick it returns `null` and the bail above fires.
 * When the server renders chrome but the client renders null the trees differ →
 * React #418 hydration mismatch → #423 client-only fallback → Next.js activates
 * global error fallback activation → document-root mutation errors.
 * Adding the prefix here makes the server also render null for these paths so
 * both sides agree. Re-enable after the specific chrome culprit is bisected.
 */
const FULL_CHROME_BAIL_PREFIXES = [
  ...AUTH_ROUTE_PREFIXES,
  "/brackets/world-cup",
]

/**
 * Paths where DOM-mutating third-party scripts (Meta Pixel + Facebook SDK)
 * must NOT execute, but the React-only chrome (toaster, back-to-top, mode
 * toggle, service-worker lifecycle) is still safe to render. These cover
 * `/api/*` (so any not-found page served under an API path never injects the
 * pixel into the document), `/_next/*` (defensive), the username gate, and
 * the high-traffic product surfaces (`/dashboard`, `/brackets`) where the
 * Meta Pixel ↔ React hydration race has been observed crashing pages with
 * React #418/#423, HierarchyRequestError, and removeChild errors.
 */
const THIRD_PARTY_SCRIPT_BAIL_PREFIXES = [
  ...AUTH_ROUTE_PREFIXES,
  "/choose-username",
  "/dashboard",
  "/brackets",
  "/api",
  "/_next",
]

function matchesPrefix(
  pathname: string | null | undefined,
  prefixes: readonly string[],
): boolean {
  if (!pathname) return false
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

function isAuthPath(pathname: string | null | undefined): boolean {
  return matchesPrefix(pathname, AUTH_ROUTE_PREFIXES)
}

function shouldBailChrome(pathname: string | null | undefined): boolean {
  return matchesPrefix(pathname, FULL_CHROME_BAIL_PREFIXES)
}

function shouldBailThirdPartyScripts(
  pathname: string | null | undefined,
): boolean {
  return matchesPrefix(pathname, THIRD_PARTY_SCRIPT_BAIL_PREFIXES)
}

/**
 * Client-side service worker lifecycle. Runs in `useEffect` so the work happens
 * after hydration and never participates in the SSR/CSR diff. Mirrors the
 * previous inline `beforeInteractive` script behaviour: register when the flag
 * is on, otherwise unregister any stale registration and purge our caches.
 */
function ServiceWorkerLifecycle() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return
    }

    if (shouldRegisterServiceWorker()) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* ignore registration failures — non-critical */
      })
      return
    }

    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(
          registrations.map((reg) => {
            const scriptUrl =
              reg.active?.scriptURL ||
              reg.waiting?.scriptURL ||
              reg.installing?.scriptURL ||
              ""
            if (!scriptUrl.includes("/sw.js")) {
              return Promise.resolve(false)
            }
            return reg.unregister()
          }),
        ),
      )
      .catch(() => {
        /* ignore — purely cleanup */
      })

    if (typeof caches === "undefined") return
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("AllFantasy-"))
            .map((key) => caches.delete(key)),
        ),
      )
      .catch(() => {
        /* ignore — purely cleanup */
      })
  }, [])

  return null
}

export interface SafeGlobalChromeProps {
  fbAppId?: string
}

/**
 * Render-once umbrella for every piece of root chrome that must NOT execute on
 * auth routes (`/login`, `/signup`, `/signin`, `/auth/*`).
 *
 * Detection runs entirely inside a client component using `usePathname()` so it
 * does not depend on the middleware-injected `x-af-pathname` header surviving
 * the upstream proxy. The component is rendered as part of the root layout for
 * every request, so the server-rendered HTML and the client tree are always
 * consistent — eliminating the hydration mismatches (#418/#423,
 * HierarchyRequestError, NotFoundError) that previously crashed `/login` on
 * Railway when the header was stripped.
 */
export function SafeGlobalChrome({
  fbAppId = "",
}: SafeGlobalChromeProps) {
  const pathname = usePathname()
  // EMERGENCY HARD BAIL: /brackets root has been crashing with React #418/#423,
  // HierarchyRequestError, and body-wipe even after the page was rolled back to
  // the minimal Phase 6 hardened JSX. The culprit lives somewhere in this chrome
  // umbrella (third-party scripts, double SW registration, Toaster portal, etc.).
  // While we bisect, refuse to mount ANY chrome on the exact /brackets path, and
  // also treat an unknown pathname (first client render) as unsafe.
  if (pathname === null || pathname === undefined) {
    return null
  }
  if (pathname === "/brackets") {
    return null
  }
  if (shouldBailChrome(pathname)) {
    return null
  }

  // On product surfaces and any /api/* fallback render, keep the React-only
  // chrome but suppress the DOM-mutating third-party scripts that race
  // against React hydration.
  const allowThirdPartyScripts = !shouldBailThirdPartyScripts(pathname)
  const renderFacebookSdk = allowThirdPartyScripts && Boolean(fbAppId)

  return (
    <>
      <ServiceWorkerLifecycle />

      {renderFacebookSdk ? <div id="fb-root" /> : null}
      {renderFacebookSdk ? (
        <Script
          src={`https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v25.0&appId=${fbAppId}`}
          strategy="afterInteractive"
          crossOrigin="anonymous"
        />
      ) : null}

      {/*
        Mounted here rather than in the root layout so it inherits this component's route
        bailouts: it must never appear on /login, /signup or /auth/* — asking someone to
        confirm their age on top of the signup form they are already filling in would be
        both confusing and redundant. It self-hides for signed-out visitors.
      */}
      {isAuthPath(pathname) ? null : <AgeConfirmationPrompt />}

      <AuthRouteGlobalChrome />
    </>
  )
}

export { isAuthPath }
