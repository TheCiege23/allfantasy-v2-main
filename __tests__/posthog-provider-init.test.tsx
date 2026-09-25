// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

const initMock = vi.hoisted(() => vi.fn())

vi.mock("posthog-js", () => ({ default: { init: initMock } }))
vi.mock("posthog-js/react", () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }))

import { PHProvider } from "@/components/providers/PostHogProvider"

/**
 * Session recording is ON in the PostHog project, with console-log capture ON. Since
 * PR #1243 the remote config actually loads, so the project setting takes effect. The
 * client value wins over it (posthog-js: client ?? server), and it must be false: a
 * replay would otherwise carry whatever the app logs to a third party.
 */
describe("PHProvider posthog.init", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    initMock.mockReset()
  })

  it("turns console-log capture off for session recordings, and keeps the /ingest proxy", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test")
    render(<PHProvider>child</PHProvider>)

    expect(initMock).toHaveBeenCalledTimes(1)
    const [token, config] = initMock.mock.calls[0]
    expect(token).toBe("phc_test")
    expect(config.enable_recording_console_log).toBe(false)
    expect(config.api_host).toBe("/ingest")
    expect(config.capture_exceptions).toBe(true)
  })

  it("does not initialise without a token", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "")
    render(<PHProvider>child</PHProvider>)
    expect(initMock).not.toHaveBeenCalled()
  })
})
