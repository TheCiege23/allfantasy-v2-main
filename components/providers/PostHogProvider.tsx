'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect } from 'react'
import { useSession } from 'next-auth/react'

/**
 * Reads the authenticated session and calls posthog.identify() so that page
 * refreshes and tab re-opens keep the current user identified.
 * Must be rendered inside next-auth's SessionProvider.
 */
export function PostHogUserIdentifier() {
  // useSession() can be undefined (outside SessionProvider, or a mocked module in
  // tests). Analytics must never crash the provider tree, so read it defensively.
  const session = useSession()?.data
  const userId = (session?.user as { id?: string } | undefined)?.id

  useEffect(() => {
    if (!userId) return
    posthog.identify(userId, {
      email: session?.user?.email ?? undefined,
      name: session?.user?.name ?? undefined,
    })
  }, [userId, session?.user?.email, session?.user?.name])

  return null
}

/**
 * Wraps the application with the PostHog JS SDK.
 * Initialisation is deferred to a useEffect so the browser-only SDK is never
 * evaluated during server-side rendering.
 *
 * PostHogUserIdentifier must be placed as a descendant of next-auth's
 * SessionProvider (see AppProviders.tsx).
 */
export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
    if (!token) {
      /*
       * ⚠ console.WARN, NOT console.ERROR — AND THE DIFFERENCE IS NOT COSMETIC.
       *
       * This is a developer nag about an optional analytics token, fired on every
       * page load in every non-production environment. As a console.error it was
       * indistinguishable from an application crash to anything reading the console,
       * and three e2e specs assert exactly that — `create-league-g30-simple-flow`,
       * `create-league-g31-video-tiles` (x3) and `league-story-creator-click-audit`
       * collect `msg.type() === 'error'` and require the list to be empty. All four
       * tests failed on this line and nothing else, on every CI run, for a config
       * value CI is not supposed to set.
       *
       * The cost of that is worse than the four red tests: a "no runtime errors"
       * check that is ALWAYS red cannot report the crash it exists to catch, so it
       * gets read as noise. Warning keeps the nag visible to a developer and lets
       * the assertion mean something again.
       */
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or ' +
            'un-configured, this causes events to be silently missed. This error stops ' +
            'appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured'
        )
      }
      return
    }
    posthog.init(token, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      defaults: '2026-01-30',
      capture_exceptions: true,
      debug: process.env.NODE_ENV === 'development',
    })
  }, [])

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
