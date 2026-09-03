import { PostHog } from 'posthog-node'

let posthogClient: PostHog | null = null

/**
 * Returns a shared PostHog Node.js client for server-side event capture.
 * Configured with flushAt=1 and flushInterval=0 so every enqueued event is
 * sent before a short-lived Next.js API route or server action completes.
 * Always await posthog.flush() after capture() in route handlers.
 */
export function getPostHogClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  if (!token) {
    if (process.env.NODE_ENV !== 'production') {
      // Warn, not error — see the note in components/providers/PostHogProvider.tsx.
      // A missing optional analytics token is a configuration gap, not a fault.
      console.warn(
        'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or ' +
          'un-configured, this causes events to be silently missed. This error stops ' +
          'appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured'
      )
    }
    return null
  }

  if (!posthogClient) {
    posthogClient = new PostHog(token, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    })
  }

  return posthogClient
}
